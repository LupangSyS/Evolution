'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

function client(url) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.last = null;
  s.on('state', (st) => { s.last = st; });
  return s;
}
function waitFor(s, pred, ms = 4000) {
  return new Promise((resolve, reject) => {
    if (s.last && pred(s.last)) return resolve(s.last);
    const t = setTimeout(() => { s.off('state', h); reject(new Error('timeout waiting for state')); }, ms);
    const h = (st) => { if (pred(st)) { clearTimeout(t); s.off('state', h); resolve(st); } };
    s.on('state', h);
  });
}

test('end-to-end: create room → join → bots → start → disconnect → rejoin same seat and prompt', async () => {
  const { server, rooms } = createServer({ botDelay: 0, timeouts: { food: 20000, play: 20000, feed: 20000, disconnected: 20000 } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const socks = [];
  try {
    const a = client(url); socks.push(a);
    a.emit('hello', { token: 'token-alice-123' });
    await waitFor(a, (st) => st.room === null);
    a.emit('create', { name: 'อลิซ' });
    const s1 = await waitFor(a, (st) => st.room && st.room.players.length === 1);
    const code = s1.room.code;
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.strictEqual(s1.room.hostPid, s1.me);

    const b = client(url); socks.push(b);
    b.emit('hello', { token: 'token-bob-456' });
    await waitFor(b, (st) => st.room === null);
    b.emit('join', { code: code.toLowerCase(), name: 'บ๊อบ' });
    await waitFor(b, (st) => st.room && st.room.players.length === 2);

    // แชทในห้อง
    b.emit('chat', { text: 'สวัสดี' });
    await waitFor(a, (st) => st.room.chat.some((m) => m.from === 'บ๊อบ' && m.text === 'สวัสดี'));

    // คนที่ไม่ใช่หัวห้องเริ่มเกม/เพิ่มบอทไม่ได้; หัวห้องเพิ่มบอท เตะบอท แล้วเริ่ม
    b.emit('start');
    b.emit('addBot');
    a.emit('addBot'); a.emit('addBot'); a.emit('addBot');
    const s4 = await waitFor(a, (st) => st.room.players.length === 5);
    const bot = s4.room.players.find((p) => p.isBot);
    a.emit('kick', { pid: bot.pid });
    await waitFor(a, (st) => st.room.players.length === 4 && st.room.status === 'lobby');
    a.emit('start');
    await waitFor(a, (st) => st.room.status === 'playing' && st.game);

    // บ๊อบได้คำสั่งเลือกการ์ดอาหาร แล้วหลุดกลางเกม
    const withPrompt = await waitFor(b, (st) => st.game && st.game.prompt && st.game.prompt.type === 'food');
    const bobPid = withPrompt.me;
    const promptId = withPrompt.game.prompt.id;
    assert.ok(withPrompt.game.hand.length >= 4, 'bob sees his own hand');
    const aliceView = a.last.game.players.find((p) => p.pid === bobPid);
    assert.ok(!('hand' in aliceView) && aliceView.bag === null, 'alice cannot see bob\'s hand or food bag');
    b.disconnect();
    await waitFor(a, (st) => st.room.players.some((p) => p.pid === bobPid && !p.connected));

    const b2 = client(url); socks.push(b2);
    b2.emit('hello', { token: 'token-bob-456' });
    const back = await waitFor(b2, (st) => st.room && st.game);
    assert.strictEqual(back.me, bobPid, 'same seat after rejoin');
    assert.strictEqual(back.room.code, code);
    assert.strictEqual(back.game.prompt && back.game.prompt.id, promptId, 'pending prompt restored');
    await waitFor(a, (st) => st.room.players.some((p) => p.pid === bobPid && p.connected));

    // ตอบผิดถูกปฏิเสธ ตอบถูกผ่าน
    const toastBad = new Promise((r) => b2.once('toast', r));
    b2.emit('answer', { promptId, data: { card: -1 } });
    assert.strictEqual(await toastBad, 'การเลือกไม่ถูกต้อง');
    b2.emit('answer', { promptId, data: { card: back.game.hand[0].id } });
    await waitFor(b2, (st) => st.game.myFood && st.game.myFood.id === back.game.hand[0].id);

    // คนนอกเข้าห้องที่เริ่มเกมแล้วไม่ได้
    const c = client(url); socks.push(c);
    c.emit('hello', { token: 'token-carol-789' });
    await waitFor(c, (st) => st.room === null);
    const toast = new Promise((r) => c.once('toast', r));
    c.emit('join', { code, name: 'แครอล' });
    assert.match(await toast, /เริ่มไปแล้ว/);

    // ออกกลางเกม = บอทเล่นแทนถาวร
    b2.emit('leave');
    await waitFor(b2, (st) => st.room === null);
    assert.strictEqual(rooms.rooms.get(code).game.player(bobPid).isBot, true);
  } finally {
    socks.forEach((s) => s.disconnect());
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    await new Promise((r) => server.close(r));
  }
});

test('card database is read-only over HTTP', async () => {
  const { server, rooms } = createServer({});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const db = await (await fetch(`${base}/api/cards`)).json();
    assert.strictEqual(Object.values(db.deck).reduce((s, l) => s + l.length, 0), 129);
    assert.strictEqual(db.traits.long_neck.name, 'คอยาว');
    for (const [method, url] of [['POST', '/api/cards'], ['PUT', '/api/cards'], ['DELETE', '/api/cards']]) {
      const r = await fetch(base + url, { method, body: method === 'DELETE' ? undefined : 'x' });
      assert.strictEqual(r.status, 404, `${method} ${url} is not writable`);
    }
  } finally {
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    await new Promise((r) => server.close(r));
  }
});
