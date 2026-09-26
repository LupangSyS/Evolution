/* Evolution วิวัฒนาการ — client (HTML/CSS/JS ล้วน ไม่ต้อง build) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const { esc } = window.CardFace;

function makeToken() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, () => ((Math.random() * 16) | 0).toString(16));
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
let token = store.get('evo_token');
if (!token) { token = makeToken(); store.set('evo_token', token); }

const S = {
  art: {}, meta: null, st: null, offset: 0, online: false,
  sel: null, // การเลือกที่กำลังทำกับ prompt ปัจจุบัน
  info: null, // { trait } หรือ { seat } สำหรับหน้าต่างรายละเอียด
  hideResult: false,
  urlCode: new URLSearchParams(location.search).get('room') || '',
};
const M = () => S.meta;

// ════════════════════ socket ════════════════════
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect', () => { S.online = true; socket.emit('hello', { token }); render(); });
socket.on('disconnect', () => { S.online = false; render(); });
socket.on('meta', (m) => { S.meta = m; render(); });
fetch('art/manifest.json', { cache: 'no-cache' }).then((r) => r.json()).then((m) => { S.art = m.items || {}; render(); }).catch(() => {});
socket.on('toast', (m) => toast(m));
socket.on('state', (st) => {
  S.offset = st.now - Date.now();
  const prevStatus = S.st && S.st.room && S.st.room.status;
  S.st = st;
  if (st.kicked) toast('คุณถูกเชิญออกจากห้อง');
  if (st.replaced) toast('บัญชีนี้เปิดเล่นอยู่ในแท็บอื่น');
  if (st.room) {
    if (location.search !== `?room=${st.room.code}`) history.replaceState(null, '', `${location.pathname}?room=${st.room.code}`);
    if (st.room.status === 'playing' && prevStatus !== 'playing') S.hideResult = false;
  }
  const pr = curPrompt();
  if (!pr || !S.sel || S.sel.pid !== pr.id) S.sel = pr ? newSel(pr) : null;
  render();
});

function send(ev, data) { socket.emit(ev, data); }
function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// ════════════════════ helpers ════════════════════
const G = () => S.st && S.st.game;
const curPrompt = () => (G() && G().prompt) || null;
const now = () => Date.now() + S.offset;
const newSel = (pr) => ({ pid: pr.id, card: null, mode: null, attacker: null, opt: null, pay: [] });
const trait = (k) => M().traits[k];
const groupOf = (k) => (k ? trait(k).group : 'hid');
function artUrl(kind, id) { const u = S.art[`${kind}/${id}`]; return u ? `art/${u}` : null; }
function cardHTML(c, cls = '', attrs = '') { return CardFace.card(M(), artUrl, c, { cls, attrs }); }
function spIndex(p, id) { return p.species.findIndex((s) => s.id === id) + 1; }
function roomPlayer(pid) { return S.st.room.players.find((p) => p.pid === pid) || {}; }
function mySpecies(id) { const g = G(); return g.players[g.mySeat].species.find((s) => s.id === id); }

// ════════════════════ play-phase validation (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ) ════════════════════
function handCard(id) { return G().hand.find((c) => c.id === id); }
function canTrait(sp, card, replaceId) {
  const rest = sp.traits.filter((t) => t.id !== replaceId);
  return rest.length < 3 && !rest.some((t) => t.trait === card.trait);
}
function boardTargets() {
  const pr = curPrompt();
  const sel = S.sel;
  if (!pr || pr.type !== 'play' || !sel.card || !sel.mode) return new Set();
  const card = handCard(sel.card);
  const out = new Set();
  for (const sp of G().players[G().mySeat].species) {
    if (sel.mode === 'size' && sp.size < 6) out.add(sp.id);
    if (sel.mode === 'pop' && sp.pop < 6) out.add(sp.id);
    if (sel.mode === 'trait' && card && canTrait(sp, card, null)) out.add(sp.id);
  }
  return out;
}

// ════════════════════ feeding ════════════════════
function feedOpts() { const pr = curPrompt(); return pr && pr.type === 'feed' ? pr.options : []; }
function attackTargets() {
  if (!S.sel || !S.sel.attacker) return new Map();
  const m = new Map();
  for (const o of feedOpts()) {
    if (o.kind !== 'attack' || o.species !== S.sel.attacker) continue;
    const list = m.get(o.target.species) || [];
    list.push(o);
    m.set(o.target.species, list);
  }
  return m;
}
function pickFeed(o) {
  if (o.cost > 0) { S.sel.opt = o.id; S.sel.pay = []; render(); return; }
  answer({ option: o.id, cards: [] });
}

function answer(data) {
  const pr = curPrompt();
  if (!pr) return;
  send('answer', { promptId: pr.id, data });
  S.sel = newSel(pr);
  S.sel.sent = true;
  render();
}

// ════════════════════ rendering ════════════════════
function snapshotInputs() {
  const a = document.activeElement;
  const vals = {};
  document.querySelectorAll('#app input[id]').forEach((i) => { vals[i.id] = i.value; });
  return { vals, focus: a && a.id, start: a && a.selectionStart, end: a && a.selectionEnd };
}
function restoreInputs(s) {
  for (const [id, v] of Object.entries(s.vals)) { const el = document.getElementById(id); if (el) el.value = v; }
  if (s.focus) {
    const el = document.getElementById(s.focus);
    if (el) { el.focus(); try { el.setSelectionRange(s.start, s.end); } catch { /* */ } }
  }
}

function render() {
  const app = $('#app');
  const snap = snapshotInputs();
  const logBox = $('#logbox');
  const logAtBottom = !logBox || logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
  const handScroll = $('.hand') ? $('.hand').scrollLeft : 0;
  if (!S.meta || !S.st) app.innerHTML = `<div class="loading">${S.online ? 'กำลังโหลด…' : 'กำลังเชื่อมต่อเซิร์ฟเวอร์…'}</div>`;
  else if (!S.st.room) app.innerHTML = homeHTML();
  else if (S.st.room.status === 'lobby' || !G()) app.innerHTML = lobbyHTML();
  else app.innerHTML = gameHTML();
  restoreInputs(snap);
  document.querySelectorAll('.msgs').forEach((m) => { if (m.id !== 'logbox' || logAtBottom) m.scrollTop = m.scrollHeight; });
  if ($('.hand')) $('.hand').scrollLeft = handScroll;
  renderModal();
  layoutTable();
  tick();
}

function homeHTML() {
  const name = store.get('evo_name') || '';
  return `<div class="home">
    <div class="logo"><img src="${esc(artUrl('cards', 'horns') || '')}" alt="" class="logo-art"><h1>Evolution <span>วิวัฒนาการ</span></h1><p>เกมการ์ดวิวัฒนาการสัตว์ · เล่นออนไลน์ 2–6 คน</p></div>
    <div class="panel form">
      <label for="name">ชื่อของคุณ</label>
      <input type="text" id="name" maxlength="16" placeholder="เช่น นักสำรวจ" value="${esc(name)}">
      <button class="btn go big" data-act="create">สร้างห้องใหม่</button>
      <div class="or">— หรือเข้าร่วมห้องของเพื่อน —</div>
      <div class="row"><input type="text" id="code" maxlength="4" placeholder="รหัสห้อง 4 ตัว" value="${esc(S.urlCode)}" style="text-transform:uppercase"><button class="btn gold" data-act="join">เข้าร่วม</button></div>
      ${S.online ? '' : '<div class="flag">⚠ ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์</div>'}
    </div>
    <details class="panel rules"><summary>📖 วิธีเล่นโดยย่อ</summary><ul>
      <li>แต่ละคนดูแล <b>สปีชีส์</b> สัตว์ (ขนาดตัว · ประชากร) และใส่ <b>ลักษณะ</b> ได้สปีชีส์ละ 3 อย่าง</li>
      <li>แต่ละรอบ: รับการ์ด → คว่ำการ์ด 1 ใบเป็นอาหารลงแหล่งน้ำ → เล่นการ์ดพร้อมกัน → เปิดการ์ดอาหาร → ผลัดกันหาอาหาร</li>
      <li>การ์ดใช้เป็นลักษณะ หรือทิ้งเพื่อ +ขนาดตัว / +ประชากร / สร้างสปีชีส์ใหม่</li>
      <li>สัตว์กินพืชกินพืชจากแหล่งน้ำ · นักล่าโจมตีสปีชีส์ที่ตัวเล็กกว่า</li>
      <li>จบรอบ ประชากรลดเหลือเท่าอาหารที่กินได้ อาหารลงถุงเป็นคะแนน</li>
      <li>การ์ดหมดกองแล้วเกมจบ · คะแนน = อาหารในถุง + ประชากร + จำนวนลักษณะ</li>
      <li>หลุดการเชื่อมต่อ? เปิดหน้าเว็บนี้อีกครั้งจากเบราว์เซอร์เดิม ระบบจะพากลับที่นั่งเดิม</li>
    </ul></details>
    <a class="btn ghost" href="gallery.html">🖼 คลังภาพการ์ด</a>
  </div>`;
}

function chatHTML() {
  const chat = S.st.room.chat;
  return `<div class="chat"><h3>💬 แชท</h3>
    <div class="msgs" id="chatbox">${chat.map((m) => (m.from ? `<div><b>${esc(m.from)}:</b> ${esc(m.text)}</div>` : `<div class="sys">${esc(m.text)}</div>`)).join('')}</div>
    <form data-form="chat"><input type="text" id="chatin" maxlength="200" placeholder="พิมพ์ข้อความ…" autocomplete="off"><button class="btn sm">ส่ง</button></form></div>`;
}

function lobbyHTML() {
  const r = S.st.room;
  const host = r.hostPid === S.st.me;
  const n = r.players.length;
  const max = M().maxPlayers;
  const rows = r.players.map((p, i) => `<li>
      <span class="dot ${p.connected ? '' : 'off'}"></span><span class="muted">${i + 1}.</span>
      <span class="nm">${esc(p.name)}${p.pid === S.st.me ? ' <span class="muted">(คุณ)</span>' : ''}</span>
      ${p.pid === r.hostPid ? '<span class="badge host">หัวห้อง</span>' : ''}${p.isBot ? '<span class="badge bot">บอท</span>' : ''}
      ${host && p.pid !== S.st.me ? `<button class="btn sm ghost" data-act="kick" data-pid="${esc(p.pid)}" title="เชิญออก">✕</button>` : ''}
    </li>`).join('');
  const ended = r.status !== 'lobby';
  return `<div class="lobby">
    <div class="panel">
      <div class="roomcode">ห้อง <b>${esc(r.code)}</b><button class="btn sm" data-act="copy">📋 คัดลอกลิงก์เชิญ</button></div>
      <p class="muted small">ส่งลิงก์ให้เพื่อน หรือเพิ่มบอทให้ครบ · ผู้เล่น ${M().minPlayers}–${max} คน · ปิดหน้าเว็บแล้วเปิดใหม่ได้ ระบบจำที่นั่งของคุณ</p>
      <ul class="plist">${rows}</ul>
      <div class="actions">
        ${host && !ended ? `<button class="btn" data-act="addBot" ${n >= max ? 'disabled' : ''}>🤖 เพิ่มบอท</button>
          <button class="btn go" data-act="start" ${n < M().minPlayers ? 'disabled' : ''}>▶ เริ่มเกม (${n} คน)</button>` : `<span class="muted">${ended ? 'เกมจบแล้ว' : 'รอหัวห้องเริ่มเกม…'}</span>`}
        <span class="sp"></span>
        <button class="btn ghost" data-act="leave">ออกจากห้อง</button>
      </div>
    </div>
    <div class="panel">${chatHTML()}</div>
  </div>`;
}

// ── โต๊ะ ──
function tileHTML(p, sp, k, targets) {
  const hit = targets && targets.has(sp.id);
  const pips = `${'●'.repeat(sp.food)}${'○'.repeat(Math.max(0, sp.pop - sp.food))}`;
  const traits = sp.traits.map((t) => `<i class="${groupOf(t.trait)}${t.hidden ? ' down' : ''}"></i>`).join('');
  return `<div class="tile ${hit ? 'tgt' : ''}" id="sp${sp.id}" data-sp="${sp.id}" data-seat="${p.seat}" title="สปีชีส์ ${k}: ขนาด ${sp.size} ประชากร ${sp.pop}">
    <div class="st">${sp.size}·${sp.pop}</div><div class="fd">${pips}${sp.fat ? `<b>+${sp.fat}</b>` : ''}</div><div class="tr">${traits}</div></div>`;
}

function seatStatus(p, g) {
  const w = g.waiting.find((x) => x.seat === p.seat);
  if (g.phase === 'over') return '';
  if (g.activeSeat === p.seat) return '<span class="st-now">กำลังหาอาหาร</span>';
  if (g.phase === 'feed' && p.passed) return '<span class="muted">หยุดแล้ว</span>';
  if (w && (g.phase === 'food' || g.phase === 'play')) return '<span class="st-think">กำลังคิด…</span>';
  if (g.phase === 'play' && p.ready) return '<span class="st-ok">✓ พร้อม</span>';
  if (g.phase === 'food' && p.placedFood) return '<span class="st-ok">✓ วางอาหาร</span>';
  return '';
}

function seatHTML(p, g, targets) {
  const mine = p.seat === g.mySeat;
  const rp = roomPlayer(p.pid);
  const turn = g.activeSeat === p.seat;
  const offline = !p.isBot && !p.connected;
  return `<div class="seat ${mine ? 'me' : ''} ${turn ? 'turn' : ''}" id="seat${p.seat}" data-seat-info="${p.seat}">
    <div class="nm">${mine ? '<span class="badge me">คุณ</span>' : ''}<span class="pn">${esc(p.name)}</span>${p.isBot ? '<span class="badge bot">บอท</span>' : ''}${g.firstSeat === p.seat ? '<span class="badge first" title="ผู้เล่นคนแรกของรอบ">①</span>' : ''}${offline ? '<span class="badge off">หลุด</span>' : ''}${rp.left ? '<span class="badge bot">ออกแล้ว</span>' : ''}</div>
    <div class="meta">มือ ${p.handCount} ใบ ${seatStatus(p, g)}</div>
    <div class="splist">${p.species.map((sp, i) => tileHTML(p, sp, i + 1, targets)).join('') || '<span class="muted">ไม่มีสปีชีส์</span>'}</div>
  </div>`;
}

function centerHTML(g) {
  let sub = '';
  if (g.phase === 'food' || g.phase === 'play') sub = `การ์ดอาหารคว่ำ ${g.foodCount}/${g.players.length}`;
  if (g.phase === 'feed' && g.revealedFood.length) sub = `การ์ดอาหาร ${g.revealedFood.map((f) => (f.card.food >= 0 ? `+${f.card.food}` : `${f.card.food}`)).join(' ')}`;
  const pond = artUrl('misc', 'pond');
  return `<div class="hole" id="hole"><div class="pond"${pond ? ` style="background-image:url('${esc(pond)}')"` : ''}><span>🌿 ${g.hole}</span></div>
    <small>แหล่งน้ำ${sub ? ` · ${esc(sub)}` : ''}</small></div>`;
}

function tableHTML(g) {
  const targets = new Set(attackTargets().keys());
  const felt = artUrl('misc', 'felt');
  return `<div class="tablebox" id="tablebox">
    <div class="oval"${felt ? ` style="background-image:url('${esc(felt)}')"` : ''}></div>
    ${centerHTML(g)}
    ${g.players.map((p) => seatHTML(p, g, targets)).join('')}
    <svg class="arrows" id="arrows"></svg>
  </div>`;
}

// ── พื้นที่ของฉัน ──
function boardHTML(sp, k, g) {
  const pr = curPrompt();
  const sel = S.sel;
  const bt = boardTargets();
  const card = sel && sel.card && handCard(sel.card);
  const traitMode = pr && pr.type === 'play' && sel.mode === 'trait' && card;
  const chips = sp.traits.map((t) => {
    const rep = traitMode && canTrait(sp, card, t.id);
    const attr = rep ? `data-act="replace" data-sp="${sp.id}" data-id="${t.id}"` : bt.has(sp.id) ? '' : `data-info="${esc(t.trait)}"`;
    return `<span class="chip ${groupOf(t.trait)} ${t.hidden ? 'down' : ''} ${rep ? 'rep' : ''}" ${attr}>${esc(trait(t.trait).name)}${t.hidden ? ' <small>(คว่ำ)</small>' : ''}${rep ? ' <small>⇄ แทนที่</small>' : ''}</span>`;
  }).join('');
  let btns = '';
  if (pr && pr.type === 'feed' && !sel.opt) {
    for (const o of feedOpts().filter((x) => x.species === sp.id)) {
      if (o.kind === 'eat') btns += `<button class="btn sm go" data-act="feed" data-id="${o.id}">🌿 กินพืช</button>`;
      if (o.kind === 'intel') btns += `<button class="btn sm" data-act="feed" data-id="${o.id}">🧠 รับพืช 2 (ทิ้ง 1 ใบ)</button>`;
    }
    if (feedOpts().some((x) => x.kind === 'attack' && x.species === sp.id)) {
      btns += `<button class="btn sm red ${sel.attacker === sp.id ? 'on' : ''}" data-act="attacker" data-id="${sp.id}">🦖 ${sel.attacker === sp.id ? 'เลือกเหยื่อบนโต๊ะ' : 'โจมตี'}</button>`;
    }
  }
  const carn = sp.traits.some((t) => t.trait === 'carnivore');
  const pips = `${'🍃'.repeat(sp.food)}${'◌'.repeat(Math.max(0, sp.pop - sp.food))}`;
  return `<div class="board ${carn ? 'carn' : ''} ${bt.has(sp.id) ? 'pick' : ''}" ${bt.has(sp.id) ? `data-act="board" data-id="${sp.id}"` : ''} id="board${sp.id}">
    <div class="bhead">สปีชีส์ ${k}</div>
    <div class="stats"><span>${sp.size}<small>ขนาดตัว</small></span><span>${sp.pop}<small>ประชากร</small></span></div>
    <div class="pips" title="อาหารที่กินแล้ว">อาหาร ${pips}${sp.fat ? ` <span class="fat">ไขมัน ${sp.fat}</span>` : ''}</div>
    <div class="chips">${chips}</div>${btns ? `<div class="bbtns">${btns}</div>` : ''}</div>`;
}

function promptHTML(g) {
  const pr = curPrompt();
  const sel = S.sel;
  if (!pr) {
    if (g.phase === 'over') return '';
    const w = g.waiting.filter((x) => x.seat !== g.mySeat).map((x) => g.players[x.seat].name);
    return `<div class="prompt wait">${w.length ? `⏳ รอ ${esc(w.join(', '))}` : '⏳ กำลังดำเนินเกม…'}</div>`;
  }
  const timer = `<span class="cd" data-deadline="${pr.deadline}"></span>`;
  if (pr.type === 'food') {
    return `<div class="prompt"><b>🌿 เลือกการ์ด 1 ใบคว่ำลงแหล่งน้ำ</b> ${timer}<div class="hint">ตัวเลขมุมการ์ดจะกลายเป็นอาหารพืช (ติดลบ = ลดอาหาร)</div>
      <div class="actions"><button class="btn go" data-act="food" ${sel.card ? '' : 'disabled'}>วางเป็นอาหาร</button></div></div>`;
  }
  if (pr.type === 'play') {
    if (!sel.card) {
      return `<div class="prompt"><b>🃏 เล่นการ์ด</b> ${timer}<div class="hint">แตะการ์ดในมือเพื่อใช้ หรือกด "เสร็จสิ้น" เก็บการ์ดที่เหลือไว้</div>
        <div class="actions"><button class="btn go" data-act="endPlay">✓ เสร็จสิ้น</button></div></div>`;
    }
    const c = handCard(sel.card);
    const hints = { trait: 'แตะสปีชีส์ที่จะใส่ลักษณะ (หรือแตะลักษณะเดิมเพื่อแทนที่)', size: 'แตะสปีชีส์ที่จะเพิ่มขนาดตัว', pop: 'แตะสปีชีส์ที่จะเพิ่มประชากร' };
    const b = (mode, label) => `<button class="btn sm ${sel.mode === mode ? 'on' : ''}" data-act="mode" data-id="${mode}">${label}</button>`;
    return `<div class="prompt"><b>ใช้「${esc(trait(c.trait).name)}」</b> ${timer}<div class="hint">${esc(hints[sel.mode] || 'เลือกวิธีใช้การ์ดใบนี้')}</div>
      <div class="actions">${b('trait', '🧬 ใส่เป็นลักษณะ')}${b('size', '⬆ +ขนาดตัว')}${b('pop', '➕ +ประชากร')}
        <button class="btn sm" data-act="newSp" data-id="left">🐣 สปีชีส์ใหม่ ⬅</button><button class="btn sm" data-act="newSp" data-id="right">🐣 สปีชีส์ใหม่ ➡</button>
        <button class="btn sm ghost" data-act="cancel">ยกเลิก</button></div></div>`;
  }
  if (pr.type === 'feed') {
    if (sel.opt) {
      const o = feedOpts().find((x) => x.id === sel.opt);
      return `<div class="prompt"><b>เลือกการ์ดทิ้ง ${o.cost} ใบ</b> ${timer}<div class="hint">${o.kind === 'attack' ? `หักล้าง: ${esc(o.negate.map((t) => trait(t).name).join(', '))}` : 'เฉลียวฉลาด: รับพืช 2 จากคลัง'} (เลือกแล้ว ${sel.pay.length}/${o.cost})</div>
        <div class="actions"><button class="btn go" data-act="pay" ${sel.pay.length === o.cost ? '' : 'disabled'}>ยืนยัน</button><button class="btn ghost" data-act="cancel">ยกเลิก</button></div></div>`;
    }
    const pass = feedOpts().find((x) => x.kind === 'pass');
    return `<div class="prompt turn"><b>🍽 ตาหาอาหารของคุณ</b> ${timer}<div class="hint">${sel.attacker ? 'แตะสปีชีส์เหยื่อที่มีกรอบแดงบนโต๊ะ' : 'กดปุ่มบนสปีชีส์ของคุณเพื่อกินหรือโจมตี'}${pass ? '' : ' · สัตว์กินพืชที่ยังหิวต้องกินเมื่อมีอาหาร'}</div>
      <div class="actions">${pass ? `<button class="btn ghost" data-act="feed" data-id="${pass.id}">หยุดหาอาหาร</button>` : ''}${sel.attacker ? '<button class="btn ghost" data-act="cancel">ยกเลิกการโจมตี</button>' : ''}</div></div>`;
  }
  return '';
}

function handHTML(g) {
  const pr = curPrompt();
  const sel = S.sel;
  const selectable = pr && (pr.type === 'food' || pr.type === 'play' || (pr.type === 'feed' && sel.opt));
  return g.hand.map((c) => {
    const on = sel && (sel.card === c.id || sel.pay.includes(c.id));
    return `<div class="hcard">${cardHTML(c, `${selectable ? 'click' : ''} ${on ? 'picked' : ''}`, `data-card="${c.id}"`)}<button class="info" data-info="${esc(c.trait)}" title="กติกาเต็ม">i</button></div>`;
  }).join('') || '<span class="muted">ไม่มีการ์ดในมือ</span>';
}

function gameHTML() {
  const g = G();
  const mine = g.players[g.mySeat];
  const pr = curPrompt();
  const myTimer = pr ? pr.deadline : (g.waiting[0] && g.waiting[0].deadline);
  return `<div class="top">
      <b class="brand">Evolution</b><span class="pill">ห้อง ${esc(S.st.room.code)}</span><span class="pill">รอบ ${g.round}</span>
      <span class="pill ph">${esc(g.phaseName)}</span><span class="pill">กองจั่ว ${g.deckCount}</span>
      ${g.lastRound ? '<span class="pill last">รอบสุดท้าย!</span>' : ''}
      <span class="sp"></span>${myTimer && g.phase !== 'over' ? `<span class="timer ${pr ? 'mine' : ''}">⏱ <span class="cd" data-deadline="${myTimer}"></span></span>` : ''}
      ${g.phase === 'over' ? '<button class="btn sm gold" data-act="showResult">🏆 ผลเกม</button>' : ''}
      <button class="btn sm ghost" data-act="leaveGame">ออก</button></div>
    <div class="wrap">
      <div class="main">
        ${tableHTML(g)}
        <div class="mine">
          ${promptHTML(g)}
          <h3>สปีชีส์ของคุณ · ถุงอาหาร ${mine.bag} 🍃</h3>
          <div class="boards">${mine.species.map((sp, i) => boardHTML(sp, i + 1, g)).join('') || '<span class="muted">ยังไม่มีสปีชีส์</span>'}</div>
          <h3>การ์ดในมือ (${g.hand.length})${g.myFood ? ` · <span class="muted">อาหารที่คว่ำไว้: ${esc(trait(g.myFood.trait).name)} (${g.myFood.food})</span>` : ''}</h3>
          <div class="hand">${handHTML(g)}</div>
        </div>
      </div>
      <div class="side">
        <div class="panel"><h3>📜 บันทึกเกม</h3><div class="msgs" id="logbox">${g.log.map((l) => `<p>${esc(l.text)}</p>`).join('')}</div></div>
        <div class="panel">${chatHTML()}</div>
      </div>
    </div>`;
}

// ── วางที่นั่งรอบโต๊ะวงรี + ลูกศร ──
function placeSeats(tb) {
  const g = G();
  const n = g.players.length;
  const W = tb.clientWidth;
  const H = tb.clientHeight;
  const rects = [];
  for (const p of g.players) {
    const el = $(`#seat${p.seat}`);
    if (!el) continue;
    const i = (p.seat - g.mySeat + n) % n; // ที่นั่งของฉันอยู่ล่างสุด แล้วเวียนตามลำดับการเล่น
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = W / 2 + Math.cos(a) * (W / 2 - w / 2 - 2) - w / 2;
    const y = H / 2 + Math.sin(a) * (H / 2 - h / 2 - 2) - h / 2;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    rects.push([x, y, x + w, y + h]);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i], rects[j]];
      if (a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] + 3 && b[1] < a[3] + 3) return false;
    }
  }
  return true;
}

/** วางที่นั่งรอบโต๊ะวงรี ถ้าที่นั่งทับกัน (สปีชีส์เยอะ/จอแคบ) ให้โต๊ะสูงขึ้นทีละนิดจนไม่ทับ */
function layoutTable() {
  const tb = $('#tablebox');
  if (!tb) return;
  tb.style.height = '';
  for (let k = 0; k < 40 && !placeSeats(tb); k++) {
    if (tb.clientHeight > tb.clientWidth * 3) break;
    tb.style.height = `${tb.clientHeight + 24}px`;
  }
  drawArrows();
}

function centerOf(el, box) {
  const b = el.getBoundingClientRect();
  return [b.left + b.width / 2 - box.left, b.top + b.height / 2 - box.top];
}
function drawArrows() {
  const svg = $('#arrows');
  const tb = $('#tablebox');
  if (!svg || !tb) return;
  const g = G();
  const box = tb.getBoundingClientRect();
  const t = now();
  const recent = g.events.filter((e) => e.round === g.round && t - e.at < 6000 && (e.kind === 'eat' || e.kind === 'attack')).slice(-4);
  // การ์ดที่เล่นลงสปีชีส์ของตัวเอง: ให้สปีชีส์นั้นเรืองแสงแทนลูกศร (ต้นทางกับปลายทางอยู่ติดกัน)
  document.querySelectorAll('.tile.flash').forEach((el) => el.classList.remove('flash'));
  for (const e of g.events) {
    if (e.round === g.round && t - e.at < 6000 && ['trait', 'size', 'pop', 'new'].includes(e.kind) && e.to.species) {
      const el = $(`#sp${e.to.species}`);
      if (el) el.classList.add('flash');
    }
  }
  const attack = [...g.events].reverse().find((e) => e.kind === 'attack' && e.round === g.round && g.phase === 'feed');
  if (attack && !recent.includes(attack)) recent.unshift(attack);
  const find = (ref) => {
    if (ref === 'hole' || ref === 'bank') return $('#hole .pond');
    return (ref.species && $(`#sp${ref.species}`)) || $(`#seat${ref.seat} .nm`);
  };
  let html = '<defs><marker id="ah-red" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ff5040"/></marker><marker id="ah-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8fe070"/></marker></defs>';
  for (const e of recent) {
    const from = find(e.from);
    const to = find(e.to);
    if (!from || !to || from === to) continue;
    const [x1, y1] = centerOf(from, box);
    const [x2, y2] = centerOf(to, box);
    const cls = e.kind === 'attack' ? 'red' : 'green';
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
    const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.15 - 12;
    html += `<path class="arrow ${cls}" d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" marker-end="url(#ah-${cls})"/>`;
  }
  svg.innerHTML = html;
}

// ── หน้าต่างรายละเอียด / ผลเกม ──
function renderModal() {
  const box = $('#modal');
  const g = G();
  let html = '';
  if (S.choose && !curPrompt()) S.choose = null;
  if (S.choose) {
    html = chooseHTML();
  } else if (S.info && S.info.trait) {
    const t = trait(S.info.trait);
    html = `<div class="modal info"><div class="bigcard">${cardHTML({ trait: S.info.trait })}</div>
      <div><h2>${esc(t.name)}</h2><div class="muted small">${esc(CardFace.typeLine(M(), t))}</div><p>${esc(t.desc)}</p>
      <button class="btn" data-act="closeInfo">ปิด</button></div></div>`;
  } else if (S.info && S.info.seat !== undefined && g) {
    const p = g.players[S.info.seat];
    html = `<div class="modal"><h2>${esc(p.name)}${p.seat === g.mySeat ? ' (คุณ)' : ''}</h2>
      <div class="muted small">มือ ${p.handCount} ใบ${p.bag !== null ? ` · ถุงอาหาร ${p.bag}` : ''}</div>
      <div class="boards wrapb">${p.species.map((sp, i) => `<div class="board ${sp.traits.some((t) => t.trait === 'carnivore') ? 'carn' : ''}"><div class="bhead">สปีชีส์ ${i + 1}</div>
        <div class="stats"><span>${sp.size}<small>ขนาดตัว</small></span><span>${sp.pop}<small>ประชากร</small></span></div>
        <div class="pips">อาหาร ${'🍃'.repeat(sp.food)}${'◌'.repeat(Math.max(0, sp.pop - sp.food))}${sp.fat ? ` <span class="fat">ไขมัน ${sp.fat}</span>` : ''}</div>
        <div class="chips">${sp.traits.map((t) => (t.trait ? `<span class="chip ${groupOf(t.trait)}" data-info="${esc(t.trait)}">${esc(trait(t.trait).name)}</span>` : '<span class="chip hid">คว่ำอยู่</span>')).join('')}</div></div>`).join('') || '<span class="muted">ไม่มีสปีชีส์</span>'}</div>
      <div class="actions"><button class="btn" data-act="closeInfo">ปิด</button></div></div>`;
  } else if (g && g.phase === 'over' && g.result && !S.hideResult) {
    const host = S.st.room.hostPid === S.st.me;
    const iWon = g.result.winners.includes(S.st.me);
    const rows = g.result.scores.map((s, i) => `<tr class="${g.result.winners.includes(s.pid) ? 'win' : ''}"><td>${g.result.winners.includes(s.pid) ? '🏆' : i + 1}</td><td class="pn">${esc(s.name)}${s.pid === S.st.me ? ' (คุณ)' : ''}</td><td>${s.bag}</td><td>${s.pop}</td><td>${s.traits}</td><td><b>${s.total}</b></td></tr>`).join('');
    html = `<div class="modal result"><div class="rtitle">${iWon ? '🎉 คุณชนะ!' : '🏁 จบเกม'}</div>
      <p class="center">${esc(g.result.text)}</p>
      <table class="scores"><thead><tr><th></th><th>ผู้เล่น</th><th>ถุง</th><th>ประชากร</th><th>ลักษณะ</th><th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions"><button class="btn ghost" data-act="hideResult">ดูกระดาน</button><span class="sp"></span>
      ${host ? '<button class="btn gold" data-act="toLobby">🔁 เล่นอีกครั้ง</button>' : '<span class="muted">รอหัวห้องกดเล่นอีกครั้ง</span>'}</div></div>`;
  }
  box.innerHTML = html ? `<div class="modal-bg" data-act="bg">${html}</div>` : '';
}

function tick() {
  const t = now();
  document.querySelectorAll('.cd[data-deadline]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.deadline) - t) / 1000));
    el.textContent = `${left}s`;
    el.classList.toggle('low', left <= 5);
  });
}
setInterval(tick, 500);
setInterval(() => { if (G()) drawArrows(); }, 1000);
window.addEventListener('resize', layoutTable);

// ════════════════════ events ════════════════════
function nameVal() {
  const el = $('#name');
  const v = (el && el.value.trim()) || store.get('evo_name') || '';
  if (v) store.set('evo_name', v);
  return v;
}
function leaveRoom() { send('leave'); S.urlCode = ''; history.replaceState(null, '', location.pathname); }

function onCard(id) {
  const pr = curPrompt();
  if (!pr) { S.info = { trait: handCard(id).trait }; renderModal(); return; }
  const sel = S.sel;
  if (pr.type === 'feed') {
    if (!sel.opt) { S.info = { trait: handCard(id).trait }; renderModal(); return; }
    const o = feedOpts().find((x) => x.id === sel.opt);
    const i = sel.pay.indexOf(id);
    if (i >= 0) sel.pay.splice(i, 1);
    else if (sel.pay.length < o.cost) sel.pay.push(id);
  } else {
    sel.card = sel.card === id ? null : id;
    if (pr.type === 'play') sel.mode = sel.card ? 'trait' : null;
  }
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-card],[data-sp],[data-info],[data-seat-info]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'bg') {
    if (e.target !== el) return;
    if (S.info || S.choose) { S.info = null; S.choose = null; renderModal(); }
    return;
  }
  if (!act && el.dataset.info) { e.stopPropagation(); S.info = { trait: el.dataset.info }; renderModal(); return; }
  if (!act && el.dataset.card) { onCard(Number(el.dataset.card)); return; }
  if (!act && el.dataset.sp) {
    const targets = attackTargets();
    const list = targets.get(Number(el.dataset.sp));
    if (list) {
      // เลือกตัวเลือกที่ถูกที่สุด (ไม่หักล้างเขาถ้าไม่จำเป็น); ถ้ามีหลายแบบให้เลือกในหน้าต่าง
      if (list.length === 1) pickFeed(list[0]);
      else { S.choose = list; renderChoose(); }
      return;
    }
    S.info = { seat: Number(el.dataset.seat) }; renderModal();
    return;
  }
  if (!act && el.dataset.seatInfo) { S.info = { seat: Number(el.dataset.seatInfo) }; renderModal(); return; }
  const pr = curPrompt();
  const sel = S.sel;
  switch (act) {
    case 'create': {
      const name = nameVal();
      if (!name) { toast('กรุณาใส่ชื่อ'); $('#name').focus(); return; }
      send('create', { name });
      break;
    }
    case 'join': {
      const name = nameVal();
      const code = ($('#code').value || '').trim().toUpperCase();
      if (!name) { toast('กรุณาใส่ชื่อ'); $('#name').focus(); return; }
      if (code.length !== 4) { toast('รหัสห้องต้องมี 4 ตัว'); return; }
      send('join', { code, name });
      break;
    }
    case 'copy': {
      const url = `${location.origin}${location.pathname}?room=${S.st.room.code}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('คัดลอกลิงก์แล้ว'), () => prompt('คัดลอกลิงก์นี้', url));
      break;
    }
    case 'leave': leaveRoom(); break;
    case 'leaveGame':
      if (G().phase === 'over' || confirm('ออกจากเกม? บอทจะเล่นแทนคุณ และคุณจะกลับเข้ามาไม่ได้')) leaveRoom();
      break;
    case 'addBot': send('addBot'); break;
    case 'kick': send('kick', { pid: el.dataset.pid }); break;
    case 'start': send('start'); break;
    case 'toLobby': send('toLobby'); break;
    case 'closeInfo': S.info = null; S.choose = null; renderModal(); break;
    case 'hideResult': S.hideResult = true; renderModal(); break;
    case 'showResult': S.hideResult = false; renderModal(); break;
    case 'food': if (sel.card) answer({ card: sel.card }); break;
    case 'endPlay': answer({ action: 'end' }); break;
    case 'mode': sel.mode = el.dataset.id; render(); break;
    case 'newSp': answer({ action: 'new', card: sel.card, side: el.dataset.id }); break;
    case 'board': answer({ action: sel.mode, card: sel.card, species: Number(el.dataset.id) }); break;
    case 'replace': e.stopPropagation(); answer({ action: 'trait', card: sel.card, species: Number(el.dataset.sp), replace: Number(el.dataset.id) }); break;
    case 'cancel': S.sel = newSel(pr); render(); break;
    case 'feed': {
      const o = feedOpts().find((x) => x.id === Number(el.dataset.id));
      if (o) pickFeed(o);
      break;
    }
    case 'attacker': { const id = Number(el.dataset.id); sel.attacker = sel.attacker === id ? null : id; render(); break; }
    case 'choose': {
      const o = feedOpts().find((x) => x.id === Number(el.dataset.id));
      S.choose = null;
      renderModal();
      if (o) pickFeed(o);
      break;
    }
    case 'pay': if (sel.opt) answer({ option: sel.opt, cards: sel.pay }); break;
    default: break;
  }
});

function renderChoose() { renderModal(); }
function chooseHTML() {
  const g = G();
  const rows = S.choose.map((o) => {
    const q = g.players[o.target.seat];
    const neg = o.negate.length ? `หักล้าง ${o.negate.map((t) => trait(t).name).join(', ')} (ทิ้ง ${o.cost} ใบ)` : 'โจมตีปกติ';
    return `<button class="btn" data-act="choose" data-id="${o.id}">🦖 ${esc(q.name)} สปีชีส์ ${spIndex(q, o.target.species)} · ${esc(neg)}</button>`;
  }).join('');
  return `<div class="modal"><h2>เลือกวิธีโจมตี</h2><div class="col">${rows}</div>
    <div class="actions"><button class="btn ghost" data-act="closeInfo">ยกเลิก</button></div></div>`;
}

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form="chat"]');
  if (!f) return;
  e.preventDefault();
  const inp = $('#chatin', f);
  const text = inp.value.trim();
  if (text) send('chat', { text });
  inp.value = '';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'code') $('[data-act="join"]').click();
  if (e.key === 'Enter' && e.target.id === 'name' && !$('#code').value) $('[data-act="create"]').click();
  if (e.key === 'Escape') { S.info = null; S.choose = null; renderModal(); }
});
