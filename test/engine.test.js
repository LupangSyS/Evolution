'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, MAX_TRAITS } = require('../server/game/engine');
const { buildDeck, TRAITS, DECK_SIZE } = require('../server/game/cards');

const bots = (n) => Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, name: `P${i}`, isBot: true }));
const allCards = (g) => [
  ...g.deck, ...g.discard, ...g.foodCards.map((f) => f.card),
  ...g.players.flatMap((p) => [...p.hand, ...p.species.flatMap((sp) => sp.traits)]),
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function promptFor(g, pid, type) {
  for (let i = 0; i < 400; i++) {
    const e = g.pending.get(pid);
    if (e && (!type || e.req.type === type)) return e;
    await wait(5);
  }
  throw new Error(`no ${type || ''} prompt for ${pid}`);
}

/** เกมเปล่าสำหรับทดสอบกฎ: ผู้เล่นทุกคนไม่มีสปีชีส์ */
function blank(n = 2) {
  const g = new Game({ players: bots(n), botDelay: 0, firstSeat: 0 });
  g.round = 1;
  return g;
}
function species(g, seat, { size = 1, pop = 1, food = 0, fat = 0, traits = [] } = {}) {
  const p = g.players[seat];
  const sp = g.newSpecies(p);
  Object.assign(sp, { size, pop, food, fat });
  for (const t of traits) {
    const c = g.deck.find((x) => x.trait === t);
    g.deck.splice(g.deck.indexOf(c), 1);
    sp.traits.push(c);
  }
  return sp;
}

function checkInvariants(g) {
  const cards = allCards(g);
  assert.strictEqual(cards.length, DECK_SIZE, 'no card lost or duplicated');
  assert.strictEqual(new Set(cards.map((c) => c.id)).size, DECK_SIZE, 'card ids unique');
  assert.ok(g.hole >= 0, 'watering hole never negative');
  for (const p of g.players) {
    assert.ok(p.bag >= 0);
    for (const sp of p.species) {
      assert.ok(sp.size >= 1 && sp.size <= 6, `size ${sp.size}`);
      assert.ok(sp.pop >= 1 && sp.pop <= 6, `pop ${sp.pop}`);
      assert.ok(sp.food >= 0 && sp.food <= sp.pop, `food ${sp.food}/${sp.pop}`);
      assert.ok(sp.fat >= 0 && sp.fat <= sp.size, 'fat within body size');
      if (sp.fat) assert.ok(sp.traits.some((c) => c.trait === 'fat_tissue'), 'fat only with fat tissue');
      assert.ok(sp.traits.length <= MAX_TRAITS, 'max 3 traits');
      assert.strictEqual(new Set(sp.traits.map((c) => c.trait)).size, sp.traits.length, 'no duplicate traits');
      if (sp.traits.some((c) => c.trait === 'carnivore') && g.phase === 'feed') assert.ok(true);
    }
  }
}

test('deck has 129 cards, 17 traits, and every trait has Thai text', () => {
  const deck = buildDeck();
  assert.strictEqual(deck.length, 129);
  assert.strictEqual(Object.keys(TRAITS).length, 17);
  assert.strictEqual(deck.filter((c) => c.trait === 'carnivore').length, 17);
  for (const [k, t] of Object.entries(TRAITS)) {
    if (k !== 'carnivore') assert.strictEqual(t.food.length, 7, k);
    assert.ok(t.name && t.short && t.short.length <= 80 && t.desc, `text for ${k}`);
    assert.ok(!/[A-Za-z一-鿿]/.test(t.name + t.short + t.desc), `${k} text is Thai only`);
  }
});

test('hundreds of all-bot games finish for every player count with invariants held', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    for (let i = 0; i < 300; i++) {
      const n = 2 + (i % 5);
      let g = null;
      g = new Game({
        players: bots(n), botDelay: 0,
        onUpdate: () => { if (g) checkInvariants(g); },
      });
      const r = await g.run();
      checkInvariants(g);
      assert.ok(r && r.text && r.scores.length === n, 'game produced a result');
      assert.ok(g.lastRound, 'game ends only after the deck runs out');
      // คะแนน = อาหารในถุง + ประชากร + จำนวนลักษณะ และผู้ชนะมีคะแนนสูงสุด
      for (const s of r.scores) {
        const p = g.players[s.seat];
        assert.strictEqual(s.total, p.bag + p.species.reduce((a, sp) => a + sp.pop + sp.traits.length, 0));
      }
      const max = Math.max(...r.scores.map((s) => s.total));
      assert.ok(r.winners.length >= 1);
      for (const pid of r.winners) assert.strictEqual(r.scores.find((s) => s.pid === pid).total, max);
      const maxBag = Math.max(...r.scores.filter((s) => s.total === max).map((s) => s.bag));
      for (const pid of r.winners) assert.strictEqual(r.scores.find((s) => s.pid === pid).bag, maxBag, 'tie broken by food bag');
    }
  } finally {
    console.error = orig;
  }
  assert.deepStrictEqual(errors, []);
});

test('attack rules: body size, hard shell, climbing, herding, burrowing, symbiosis, warning call, ambush, pack hunting', () => {
  const g = blank(2);
  const C = species(g, 0, { size: 3, pop: 2, traits: ['carnivore'] });
  const small = species(g, 1, { size: 2 });
  const same = species(g, 1, { size: 3 });
  assert.deepStrictEqual(g.attackBlockers(C, small), []);
  assert.strictEqual(g.attackBlockers(C, same), null, 'must be strictly larger');
  assert.strictEqual(g.attackBlockers(C, C), null, 'cannot attack itself');

  const shell = species(g, 1, { size: 1, traits: ['hard_shell'] });
  assert.deepStrictEqual(g.attackBlockers(C, shell), ['hard_shell']);
  const climb = species(g, 1, { size: 1, traits: ['climbing'] });
  assert.deepStrictEqual(g.attackBlockers(C, climb), ['climbing']);
  const herd = species(g, 1, { size: 1, pop: 2, traits: ['defensive_herding'] });
  assert.deepStrictEqual(g.attackBlockers(C, herd), ['defensive_herding']);
  const burrow = species(g, 1, { size: 1, pop: 2, food: 2, traits: ['burrowing'] });
  assert.deepStrictEqual(g.attackBlockers(C, burrow), ['burrowing'], 'fed burrower is safe');
  burrow.food = 1;
  assert.deepStrictEqual(g.attackBlockers(C, burrow), [], 'hungry burrower can be attacked');

  const g2 = blank(2);
  const C2 = species(g2, 0, { size: 2, pop: 3, traits: ['carnivore'] });
  const sym = species(g2, 1, { size: 1, traits: ['symbiosis'] });
  const big = species(g2, 1, { size: 4, traits: ['warning_call'] });
  const guarded = species(g2, 1, { size: 1 });
  assert.deepStrictEqual(g2.attackBlockers(C2, sym), ['symbiosis', 'warning_call']);
  assert.deepStrictEqual(g2.attackBlockers(C2, guarded), ['warning_call']);
  C2.traits.push(g2.deck.find((c) => c.trait === 'ambush'));
  assert.deepStrictEqual(g2.attackBlockers(C2, guarded), [], 'ambush ignores warning call');
  assert.strictEqual(g2.attackBlockers(C2, big), null);
  C2.traits.push(g2.deck.find((c) => c.trait === 'pack_hunting'));
  assert.deepStrictEqual(g2.attackBlockers(C2, big), [], 'pack hunting: size + population');
});

test('attack resolution: meat, horns, extinction draws cards, scavenger', () => {
  const g = blank(2);
  const C = species(g, 0, { size: 4, pop: 3, traits: ['carnivore'] });
  const scav = species(g, 0, { size: 1, pop: 2, traits: ['scavenger'] });
  const T = species(g, 1, { size: 2, pop: 1, traits: ['horns', 'climbing'] });
  C.traits.push(g.deck.find((c) => c.trait === 'climbing'));
  const hand = g.players[1].hand.length;
  g.attack(g.players[0], C, { target: { seat: 1, species: T.id }, negate: [] });
  assert.strictEqual(g.players[1].species.length, 0, 'prey went extinct');
  assert.strictEqual(g.players[1].hand.length, hand + 2, 'owner draws one card per trait');
  assert.strictEqual(C.pop, 2, 'horns: carnivore loses 1 population');
  assert.strictEqual(C.food, 2, 'carnivore eats meat equal to prey body size');
  assert.strictEqual(scav.food, 1, 'scavenger takes 1 meat');
});

test('feeding: foraging, cooperation chain, fat tissue, carnivores never eat plants', () => {
  const g = blank(2);
  const a = species(g, 0, { size: 2, pop: 3, traits: ['foraging', 'cooperation'] });
  const b = species(g, 0, { size: 2, pop: 2, traits: ['cooperation'] });
  const c = species(g, 0, { size: 2, pop: 2, traits: ['carnivore'] });
  g.hole = 5;
  assert.strictEqual(g.gain(a, 1, 'plant', 'hole'), 2, 'foraging takes 2');
  assert.strictEqual(b.food, 1, 'cooperation gives right neighbour 1');
  assert.strictEqual(c.food, 0, 'carnivore cannot take plant food');
  assert.strictEqual(g.hole, 2);
  const f = species(g, 1, { size: 3, pop: 1, traits: ['fat_tissue'] });
  g.gain(f, 5, 'meat', 'bank');
  assert.strictEqual(f.food, 1);
  assert.strictEqual(f.fat, 3, 'fat tissue stores up to body size');
});

test('before reveal: fertile, long neck, fat tissue; food cards set the watering hole', () => {
  const g = blank(2);
  const fer = species(g, 0, { size: 1, pop: 1, traits: ['fertile'] });
  const ln = species(g, 0, { size: 1, pop: 2, traits: ['long_neck'] });
  const fat = species(g, 1, { size: 3, pop: 2, fat: 3, traits: ['fat_tissue'] });
  g.hole = 1;
  const neg = g.deck.find((c) => c.food < 0);
  const pos = g.deck.find((c) => c.food >= 5);
  g.deck = g.deck.filter((c) => c !== neg && c !== pos);
  g.foodCards = [{ seat: 0, card: neg }, { seat: 1, card: pos }];
  g.revealPhase();
  assert.strictEqual(fer.pop, 2, 'fertile +1 population');
  assert.strictEqual(ln.food, 1, 'long neck takes 1 plant from bank');
  assert.strictEqual(fat.food, 2);
  assert.strictEqual(fat.fat, 1, 'fat moves to feed population');
  assert.strictEqual(g.hole, Math.max(0, 1 + neg.food + pos.food));
  assert.ok(g.discard.includes(neg) && g.discard.includes(pos));
});

test('end of round: population drops to food eaten, food goes to bag, starving species go extinct', () => {
  const g = blank(2);
  const a = species(g, 0, { size: 2, pop: 4, food: 2 });
  species(g, 0, { size: 2, pop: 2, food: 0, traits: ['foraging'] });
  const hand = g.players[0].hand.length;
  g.endRound();
  assert.strictEqual(a.pop, 2);
  assert.strictEqual(a.food, 0);
  assert.strictEqual(g.players[0].bag, 2);
  assert.strictEqual(g.players[0].species.length, 1);
  assert.strictEqual(g.players[0].hand.length, hand + 1);
});

test('play-phase answers are validated; invalid ones rejected', async () => {
  const players = [{ pid: 'h', name: 'Human' }, ...bots(2)];
  const g = new Game({ players, botDelay: 0, firstSeat: 0, timeouts: { food: 3000, play: 3000, feed: 3000 }, maxRounds: 1 });
  const done = g.run();
  const h = g.player('h');
  const pf = await promptFor(g, 'h', 'food');
  assert.strictEqual(g.submit('h', pf.id + 999, { card: h.hand[0].id }), 'คำสั่งนี้หมดอายุแล้ว');
  assert.strictEqual(g.submit('h', pf.id, { card: 99999 }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pf.id, { card: 'x' }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pf.id, { card: h.hand[0].id }), null);

  let pp = await promptFor(g, 'h', 'play');
  const sp = h.species[0];
  const [c1, c2, c3] = h.hand;
  assert.strictEqual(g.submit('h', pp.id, { action: 'fly', card: c1.id }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pp.id, { action: 'size', card: c1.id, species: 12345 }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pp.id, { action: 'new', card: c1.id, side: 'up' }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pp.id, { action: 'trait', card: c1.id, species: sp.id }), null);
  pp = await promptFor(g, 'h', 'play');
  assert.strictEqual(g.submit('h', pp.id, { action: 'size', card: c1.id, species: sp.id }), 'การเลือกไม่ถูกต้อง', 'card already used');
  // ลักษณะซ้ำบนสปีชีส์เดียวกันไม่ได้
  c2.trait = c1.trait;
  assert.strictEqual(g.submit('h', pp.id, { action: 'trait', card: c2.id, species: sp.id }), 'การเลือกไม่ถูกต้อง');
  assert.strictEqual(g.submit('h', pp.id, { action: 'trait', card: c2.id, species: sp.id, replace: c1.id }), null, 'replacing is allowed');
  pp = await promptFor(g, 'h', 'play');
  sp.size = 6;
  assert.strictEqual(g.submit('h', pp.id, { action: 'size', card: c3.id, species: sp.id }), 'การเลือกไม่ถูกต้อง', 'body size max 6');
  // ลักษณะที่ยังคว่ำอยู่ ผู้เล่นอื่นมองไม่เห็น
  const other = g.viewFor('p1').players[0].species[0];
  assert.deepStrictEqual(other.traits, [{ hidden: true }]);
  assert.strictEqual(g.viewFor('h').players[0].species[0].traits[0].trait, c2.trait);
  assert.strictEqual(g.submit('h', pp.id, { action: 'end' }), null);

  const fe = await promptFor(g, 'h', 'feed').catch(() => null);
  if (fe) {
    assert.strictEqual(g.submit('h', fe.id, { option: 999 }), 'การเลือกไม่ถูกต้อง');
    const costly = fe.req.options.find((o) => o.cost > 0);
    if (costly) assert.strictEqual(g.submit('h', fe.id, { option: costly.id, cards: [] }), 'การเลือกไม่ถูกต้อง', 'must pay cards');
    const o = fe.req.options.find((x) => x.kind === 'eat') || fe.req.options[0];
    assert.strictEqual(g.submit('h', fe.id, { option: o.id, cards: h.hand.slice(0, o.cost).map((c) => c.id) }), null);
  }
  const r = await done;
  assert.ok(r.text);
  checkInvariants(g);
});

test('feeding: a hungry plant-eater must eat when there is food (no pass option)', () => {
  const g = blank(2);
  species(g, 0, { size: 1, pop: 2 });
  g.hole = 3;
  const opts = g.feedOptions(g.players[0]);
  assert.ok(opts.some((o) => o.kind === 'eat'));
  assert.ok(!opts.some((o) => o.kind === 'pass'));
  const g2 = blank(2);
  species(g2, 0, { size: 3, pop: 1, traits: ['carnivore'] });
  species(g2, 1, { size: 1 });
  const o2 = g2.feedOptions(g2.players[0]);
  assert.ok(o2.some((o) => o.kind === 'attack') && o2.some((o) => o.kind === 'pass'), 'carnivore may decline to attack');
});

test('intelligence: carnivore pays one card per negated trait; plant-eater takes 2 from bank', () => {
  const g = blank(2);
  const C = species(g, 0, { size: 2, pop: 2, traits: ['carnivore', 'intelligence'] });
  species(g, 1, { size: 1, traits: ['hard_shell', 'horns'] });
  g.players[0].hand = g.deck.splice(0, 2);
  const opts = g.feedOptions(g.players[0]).filter((o) => o.kind === 'attack');
  assert.deepStrictEqual(opts.map((o) => [o.negate, o.cost]), [[['hard_shell'], 1], [['hard_shell', 'horns'], 2]]);
  const g2 = blank(2);
  const I = species(g2, 0, { size: 1, pop: 3, traits: ['intelligence'] });
  g2.players[0].hand = g2.deck.splice(0, 1);
  const o = g2.feedOptions(g2.players[0]).find((x) => x.kind === 'intel');
  g2.applyFeed(g2.players[0], o, [g2.players[0].hand[0].id]);
  assert.strictEqual(I.food, 2);
  assert.strictEqual(g2.players[0].hand.length, 0);
  assert.ok(C);
});

test('views never leak other hands, food bags or face-down food cards', async () => {
  const g = new Game({ players: [{ pid: 'h', name: 'H' }, ...bots(3)], botDelay: 0, timeouts: { food: 2000 } });
  g.run();
  await promptFor(g, 'h', 'food');
  const v = g.viewFor('h');
  for (const p of v.players) {
    assert.ok(!('hand' in p));
    if (p.pid !== 'h') assert.strictEqual(p.bag, null);
  }
  assert.strictEqual(v.hand.length, g.player('h').hand.length);
  const json = JSON.stringify(v);
  for (const f of g.foodCards) assert.ok(!json.includes(`"id":${f.card.id},`) || f.seat === 0);
  g.abort();
});

test('rejoin: a disconnected player keeps the same pending prompt; a bot answers after the wait', async () => {
  const g = new Game({ players: [{ pid: 'h', name: 'H' }, ...bots(1)], botDelay: 0, timeouts: { food: 5000, disconnected: 60 } });
  g.run();
  const pe = await promptFor(g, 'h', 'food');
  g.setConnected('h', false);
  g.setConnected('h', true);
  await wait(150);
  assert.strictEqual(g.viewFor('h').prompt.id, pe.id, 'same prompt after reconnect');
  g.setConnected('h', false);
  await wait(150);
  assert.strictEqual(g.foodCards.filter((f) => f.seat === 0).length, 1, 'bot answered for the disconnected player');
  g.setBot('h');
  assert.ok(g.player('h').isBot, 'leaving hands the seat to a bot');
  g.abort();
});
