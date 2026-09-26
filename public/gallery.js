/* คลังภาพ: แสดงภาพที่บันทึกถาวร + ข้อมูลการ์ด (อ่านอย่างเดียว) และวาดใหม่สดจากตัวสร้างภาพเพื่อตรวจสอบ */
'use strict';

const { esc } = window.CardFace;
const S = { db: null, manifest: null, tab: 'cards', live: false, checks: {} };
const MISC = {
  back: ['หลังการ์ด', 'ด้านหลังของการ์ดทุกใบ'],
  felt: ['ผ้าปูโต๊ะ', 'พื้นโต๊ะวงรีกลางห้องเล่น'],
  pond: ['แหล่งน้ำ', 'แหล่งน้ำกลางโต๊ะ ที่อาหารพืชทั้งหมดอยู่'],
};

async function init() {
  const [db, manifest] = await Promise.all([
    fetch('api/cards').then((r) => r.json()),
    fetch('art/manifest.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  Object.assign(S, { db, manifest });
  render();
}

function slots() {
  if (S.tab === 'cards') return Object.keys(S.db.traits).map((id) => ({ kind: 'cards', id }));
  return Object.keys(MISC).map((id) => ({ kind: 'misc', id }));
}

const artUrl = (kind, id) => { const u = S.manifest.items[`${kind}/${id}`]; return u ? `art/${u}` : null; };

function faceHTML(sl) {
  if (sl.kind === 'cards') return CardFace.card(S.db, artUrl, { trait: sl.id, food: S.db.deck[sl.id][0] });
  if (sl.id === 'back') return CardFace.card(S.db, artUrl, null);
  return `<img src="${esc(artUrl('misc', sl.id))}" alt="${esc(MISC[sl.id][0])}">`;
}

function metaHTML(sl) {
  if (sl.kind === 'cards') {
    const t = S.db.traits[sl.id];
    const foods = S.db.deck[sl.id] || [];
    return `<b>${esc(t.name)}</b>
      <div class="sub">${esc(CardFace.typeLine(S.db, t))} · ในสำรับ ${foods.length} ใบ</div>
      <p>${esc(t.desc)}</p>
      <div class="sub">ตัวเลขอาหารของแต่ละใบ:</div>
      <div class="foods">${foods.map((f) => `<span>${f}</span>`).join('')}</div>`;
  }
  const [name, desc] = MISC[sl.id];
  return `<b>${esc(name)}</b><p>${esc(desc)}</p>`;
}

function render() {
  const { db, manifest } = S;
  const n = Object.keys(manifest.items).length;
  document.getElementById('app').innerHTML = `<div class="gal">
    <div class="gbar2"><h1>🖼 คลังภาพ Evolution</h1><span class="sp"></span>
      <label class="btn sm"><input type="checkbox" id="live" ${S.live ? 'checked' : ''}> วาดใหม่สดจากโค้ดเพื่อเทียบ</label>
      <a class="btn sm" href="/">กลับไปเกม</a></div>
    <div class="note">ภาพทั้ง ${n} ภาพวาดจากโค้ดทีละพิกเซล (RGB) ด้วย <code>public/artgen/</code> และบันทึกถาวรเป็นไฟล์ใน <code>public/art/</code> พร้อมลายนิ้วมือ SHA-256 —
      ไม่ใช้ภาพจาก AI หรือภาพจากเกมจริง ไม่มีระบบแก้ไขหรืออัปโหลด และการทดสอบจะตรวจว่าไฟล์ตรงกับตัวสร้างภาพทุกพิกเซล (${esc(manifest.generator)})</div>
    <div class="tabs">
      <button class="btn sm ${S.tab === 'cards' ? 'on' : ''}" data-tab="cards">การ์ดลักษณะ (${Object.keys(db.traits).length})</button>
      <button class="btn sm ${S.tab === 'misc' ? 'on' : ''}" data-tab="misc">หลังการ์ด & โต๊ะ (${Object.keys(MISC).length})</button></div>
    <div class="items">${slots().map((sl) => {
      const key = `${sl.kind}/${sl.id}`;
      const url = manifest.items[key];
      const cls = sl.kind === 'cards' || sl.id === 'back' ? 'card-it' : 'wide-it';
      const chk = S.checks[key];
      return `<div class="item ${cls}">
        <div class="pics">${faceHTML(sl)}${url ? `<img hidden src="art/${esc(url)}" alt="" data-key="${esc(key)}">` : ''}${S.live ? `<canvas data-live="${esc(key)}" title="วาดใหม่สดในเบราว์เซอร์"></canvas>` : ''}</div>
        <div class="meta">${metaHTML(sl)}
          <div class="hash">sha256 ${esc((manifest.sha256[`${key}.png`] || '').slice(0, 16))}…</div>
          ${S.live ? `<div class="small ${chk === true ? 'ok' : chk === false ? 'bad' : ''}">${chk === true ? '✓ วาดใหม่ได้ตรงกับไฟล์ทุกพิกเซล' : chk === false ? '✗ ไม่ตรงกับไฟล์' : 'กำลังตรวจ…'}</div>` : ''}
        </div></div>`;
    }).join('')}</div></div>`;
  if (S.live) requestAnimationFrame(drawLive);
}

function drawLive() {
  for (const cv of document.querySelectorAll('canvas[data-live]')) {
    const key = cv.dataset.live;
    const [kind, id] = key.split('/');
    const img = window.ArtDesigns.render(kind, id);
    cv.width = img.w;
    cv.height = img.h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h), 0, 0);
    const saved = document.querySelector(`img[data-key="${key}"]`);
    if (saved && S.checks[key] === undefined) compare(key, saved, img);
  }
}

/** เทียบภาพที่วาดสดกับไฟล์ที่บันทึกไว้ทีละพิกเซล */
function compare(key, el, img) {
  const run = () => {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(el, 0, 0);
    const got = ctx.getImageData(0, 0, img.w, img.h).data;
    let same = got.length === img.d.length;
    for (let i = 0; same && i < got.length; i += 4) {
      if (got[i + 3] && (Math.abs(got[i] - img.d[i]) > 1 || Math.abs(got[i + 1] - img.d[i + 1]) > 1 || Math.abs(got[i + 2] - img.d[i + 2]) > 1)) same = false;
    }
    S.checks[key] = same;
    const box = el.closest('.item').querySelector('.small');
    if (box) { box.className = `small ${same ? 'ok' : 'bad'}`; box.textContent = same ? '✓ วาดใหม่ได้ตรงกับไฟล์ทุกพิกเซล' : '✗ ไม่ตรงกับไฟล์'; }
  };
  if (el.complete) run(); else el.addEventListener('load', run, { once: true });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { S.tab = t.dataset.tab; render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'live') { S.live = e.target.checked; render(); }
});

init().catch((e) => { document.getElementById('app').innerHTML = `<div class="loading">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; });
