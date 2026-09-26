'use strict';

// ตัวช่วยควบคุมหน้าเว็บผ่าน Playwright (ใช้ร่วมกันระหว่างการทดสอบและสคริปต์ถ่ายภาพหน้าจอ)

const assert = require('node:assert');
const fs = require('fs');

function launchOpts() {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return exe && fs.statSync(exe).isFile() ? { executablePath: exe } : {};
}

/** ตรวจเลย์เอาต์: ไม่มีเลื่อนแนวนอน, ข้อความบนการ์ดไม่ล้น, ที่นั่งไม่ล้นโต๊ะและไม่ทับกัน */
async function checkLayout(page, label) {
  const r = await page.evaluate(() => {
    const over = [...document.querySelectorAll('.cf-name, .cf-type, .cf-text, .seat .meta')]
      .filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1))
      .map((e) => e.textContent.trim().slice(0, 30));
    const seats = [...document.querySelectorAll('.seat')].map((e) => e.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i]; const b = seats[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
    }
    const outside = seats.filter((s) => s.left < -1 || s.right > innerWidth + 1).length;
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over, overlap, outside };
  });
  assert.ok(r.sw <= r.cw, `${label}: no horizontal page scroll (${r.sw} > ${r.cw})`);
  assert.deepStrictEqual(r.over, [], `${label}: text overflows`);
  assert.strictEqual(r.outside, 0, `${label}: seats stay on screen`);
  assert.strictEqual(r.overlap, 0, `${label}: seats do not overlap`);
}

/** ตอบคำสั่งที่รออยู่หนึ่งครั้งผ่านปุ่มบนหน้าจอ คืน 'over' เมื่อเกมจบ */
async function step(page, st) {
  if (await page.locator('.modal .rtitle').count()) return 'over';
  const choose = page.locator('[data-act="choose"]');
  if (await choose.count()) { await choose.first().click(); return 'acted'; }
  const prompt = page.locator('.prompt:not(.wait)');
  if (!(await prompt.count())) return 'idle';
  const text = await prompt.first().innerText();
  const hand = page.locator('.hand .card.cf.click');
  if (text.includes('คว่ำลงแหล่งน้ำ')) {
    await hand.first().click();
    await page.click('[data-act="food"]');
    st.plays = 0;
    return 'acted';
  }
  if (text.includes('เล่นการ์ด') || text.includes('ใช้「')) {
    if (text.includes('ใช้「')) {
      const board = page.locator('.board.pick');
      if (await board.count()) await board.first().click();
      else await page.click('[data-act="newSp"][data-id="right"]');
      st.plays++;
      return 'acted';
    }
    if (st.plays >= 2 || !(await hand.count())) { await page.click('[data-act="endPlay"]'); return 'acted'; }
    await hand.nth(st.plays % 2).click();
    const modes = ['trait', 'pop', 'size'];
    await page.click(`[data-act="mode"][data-id="${modes[(st.round + st.plays) % 3]}"]`);
    return 'acted';
  }
  if (text.includes('เลือกการ์ดทิ้ง')) {
    const m = /\((?:เลือกแล้ว )?(\d+)\/(\d+)\)/.exec(text);
    const need = m ? Number(m[2]) - Number(m[1]) : 1;
    for (let i = 0; i < need; i++) await page.locator('.hand .card.cf.click:not(.picked)').first().click();
    await page.click('[data-act="pay"]');
    return 'acted';
  }
  if (text.includes('ตาหาอาหาร')) {
    const eat = page.locator('.bbtns [data-act="feed"]');
    if (await eat.count()) { await eat.first().click(); return 'acted'; }
    const atk = page.locator('[data-act="attacker"]');
    if (await atk.count()) {
      await atk.first().click();
      const tgt = page.locator('.tile.tgt');
      if (await tgt.count()) { await tgt.first().click(); return 'acted'; }
    }
    const pass = page.locator('.prompt [data-act="feed"]');
    if (await pass.count()) { await pass.click(); return 'acted'; }
  }
  return 'idle';
}

module.exports = { launchOpts, checkLayout, step };
