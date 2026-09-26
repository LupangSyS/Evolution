'use strict';

// ทดสอบหน้าเว็บจริงด้วย Chromium (Playwright): เดสก์ท็อป 1280×800 + มือถือ 400px เล่นเกมจนจบผ่านปุ่มบนหน้าจอ
// รัน: npm run test:ui   (ภาพหน้าจอถูกบันทึกที่ test-results/)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createServer } = require('../../server');
const { launchOpts, checkLayout, step } = require('./driver');

const SHOTS = path.join(__dirname, '..', '..', 'test-results');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('real UI in Chromium: desktop host + phone guest play a full game, rejoin after reload, play again', { timeout: 180000 }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { server, rooms } = createServer({ botDelay: 15, maxRounds: 2, timeouts: { food: 60000, play: 60000, feed: 60000, disconnected: 60000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  try {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const phone = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    // ไม่โหลดฟอนต์จากอินเทอร์เน็ตระหว่างทดสอบ
    for (const ctx of [desk, phone]) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const host = await desk.newPage();
    const guest = await phone.newPage();
    for (const [name, p] of [['desktop', host], ['phone', guest]]) {
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    }

    // หน้าแรก → สร้างห้อง
    await host.goto(base);
    await host.fill('#name', 'เจ้าบ้าน');
    await host.screenshot({ path: path.join(SHOTS, 'desktop-home.png') });
    await host.click('[data-act="create"]');
    const code = (await host.locator('.roomcode b').innerText()).trim();
    assert.match(code, /^[A-Z2-9]{4}$/);

    // เพื่อนเข้าด้วยลิงก์เชิญบนมือถือ
    await guest.goto(`${base}/?room=${code}`);
    assert.strictEqual(await guest.inputValue('#code'), code, 'invite link fills the room code');
    await guest.fill('#name', 'เพื่อน');
    await guest.click('[data-act="join"]');
    await guest.locator('.roomcode b').waitFor();
    await host.click('[data-act="addBot"]');
    await host.click('[data-act="addBot"]');
    await host.locator('.plist li').nth(3).waitFor();
    await guest.screenshot({ path: path.join(SHOTS, 'phone-lobby.png'), fullPage: true });
    await host.click('[data-act="start"]');
    await host.locator('.tablebox').waitFor();
    await guest.locator('.tablebox').waitFor();
    assert.strictEqual((await guest.locator('.seat.me .pn').innerText()).trim(), 'เพื่อน', 'my seat is marked');

    const sts = new Map([[host, { plays: 0, round: 0 }], [guest, { plays: 0, round: 0 }]]);
    const done = new Set();
    let reloaded = false;
    const shots = new Set();
    for (let i = 0; i < 4000 && done.size < 2; i++) {
      for (const [p, name] of [[host, 'desktop'], [guest, 'phone']]) {
        if (done.has(p)) continue;
        const phase = await p.locator('.pill.ph').innerText().catch(() => '');
        const st = sts.get(p);
        st.round = Number((await p.locator('.top .pill').nth(1).innerText().catch(() => '0')).replace(/\D/g, '')) || 0;
        const key = `${name}-${phase}`;
        if (phase && !shots.has(key) && (await p.locator('.prompt:not(.wait)').count())) {
          shots.add(key);
          await checkLayout(p, key);
          await p.screenshot({ path: path.join(SHOTS, `${name}-${['เลือกการ์ดอาหาร', 'เล่นการ์ด', 'หาอาหาร'].indexOf(phase) + 1}-${phase}.png`), fullPage: name === 'phone' });
        }
        // รีเฟรชหน้ากลางเกม → ต้องกลับมาที่นั่งเดิมพร้อมคำสั่งเดิม
        if (!reloaded && p === guest && phase === 'เล่นการ์ด' && (await p.locator('.prompt:not(.wait)').count())) {
          reloaded = true;
          const before = await p.locator('.prompt:not(.wait) b').first().innerText();
          await p.reload();
          await p.locator('.tablebox').waitFor();
          assert.strictEqual((await p.locator('.seat.me .pn').innerText()).trim(), 'เพื่อน', 'same seat after reload');
          await p.locator('.prompt:not(.wait)').waitFor();
          assert.strictEqual(await p.locator('.prompt:not(.wait) b').first().innerText(), before, 'same pending prompt after reload');
        }
        const r = await step(p, st);
        if (r === 'over') done.add(p);
      }
      await wait(40);
    }
    assert.strictEqual(done.size, 2, 'both players reached the results screen');
    assert.ok(reloaded, 'reload was exercised');

    // หน้าผลเกม + กดดูรายละเอียดการ์ด
    for (const [p, name] of [[host, 'desktop'], [guest, 'phone']]) {
      await checkLayout(p, `${name}-results`);
      await p.screenshot({ path: path.join(SHOTS, `${name}-4-results.png`) });
      assert.ok((await p.locator('.scores tbody tr').count()) === 4, 'score table lists every player');
    }
    await guest.click('[data-act="hideResult"]');
    const chip = guest.locator('.hcard .info, .chip[data-info]');
    if (await chip.count()) {
      await chip.first().click();
      await guest.locator('.modal.info').waitFor();
      await guest.screenshot({ path: path.join(SHOTS, 'phone-card-info.png') });
      await guest.click('[data-act="closeInfo"]');
    }
    // เล่นอีกครั้ง → กลับห้องรอ
    await host.click('[data-act="toLobby"]');
    await host.locator('[data-act="start"]').waitFor();
    await guest.locator('.roomcode b').waitFor();
    assert.deepStrictEqual(errors, [], 'no JS errors');
  } finally {
    await browser.close();
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    await new Promise((r) => server.close(r));
  }
});

test('real UI in Chromium: 6-player game on a 400px phone keeps the table readable every step', { timeout: 240000 }, async () => {
  const { server, rooms } = createServer({ botDelay: 10, maxRounds: 4, timeouts: { food: 60000, play: 60000, feed: 60000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(base);
    await p.fill('#name', 'ผู้เล่นมือถือ');
    await p.click('[data-act="create"]');
    for (let i = 0; i < 5; i++) await p.click('[data-act="addBot"]');
    await p.locator('.plist li').nth(5).waitFor();
    assert.ok(await p.locator('[data-act="addBot"]').isDisabled(), 'room is full at 6 players');
    await p.click('[data-act="start"]');
    await p.locator('.tablebox').waitFor();
    const st = { plays: 0, round: 0 };
    let checks = 0;
    let sawAttack = false;
    for (let i = 0; i < 6000; i++) {
      if (i % 2 === 0) { await checkLayout(p, `6p step ${i}`); checks++; }
      if (!sawAttack && await p.locator('.arrow.red').count()) {
        sawAttack = true;
        await p.screenshot({ path: path.join(SHOTS, 'phone-6p-attack.png'), fullPage: true });
      }
      st.round = Number((await p.locator('.top .pill').nth(1).innerText().catch(() => '0')).replace(/\D/g, '')) || 0;
      if (await step(p, st) === 'over') break;
      await wait(20);
    }
    assert.ok(await p.locator('.modal .rtitle').count(), 'game reached the results screen');
    await checkLayout(p, '6p results');
    await p.screenshot({ path: path.join(SHOTS, 'phone-6p-results.png') });
    assert.ok(checks >= 10, `layout was checked throughout the game (${checks} checks)`);
    assert.deepStrictEqual(errors, [], 'no JS errors');
  } finally {
    await browser.close();
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    await new Promise((r) => server.close(r));
  }
});
