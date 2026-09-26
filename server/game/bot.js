'use strict';

// บอทแบบใช้กฎ (heuristic): ประเมินค่าการกระทำแต่ละอย่างแล้วเลือกที่ดีที่สุด

const has = (sp, t) => sp.traits.some((c) => c.trait === t);
const isCarn = (sp) => has(sp, 'carnivore');
const jitter = () => (Math.random() - 0.5) * 0.4;

/** จำนวนนักล่าของผู้เล่นอื่นที่ตัวใหญ่กว่าสปีชีส์นี้ (ภัยคุกคาม) */
function threat(g, p, sp) {
  let t = 0;
  for (const q of g.players) {
    if (q === p) continue;
    for (const s of q.species) {
      if (!isCarn(s)) continue;
      const atk = s.size + (has(s, 'pack_hunting') ? s.pop : 0);
      if (atk > sp.size) t += 1;
      else if (atk + 1 >= sp.size) t += 0.4;
    }
  }
  return t;
}

/** ค่าของการใส่ลักษณะ trait ให้สปีชีส์ sp (ไม่นับการแทนที่) */
function traitValue(g, p, sp, trait) {
  if (has(sp, trait)) return -Infinity;
  const carn = isCarn(sp);
  const danger = Math.min(2, threat(g, p, sp));
  const i = p.species.findIndex((s) => s.id === sp.id);
  const left = p.species[i - 1];
  const right = p.species[i + 1];
  const anyCarn = g.players.some((q) => q.species.some(isCarn));
  const myCarns = p.species.filter(isCarn).length;
  switch (trait) {
    case 'carnivore':
      if (carn) return -Infinity;
      if (p.species.length < 2 || myCarns >= Math.ceil(p.species.length / 3)) return -2;
      if (sp.traits.some((c) => ['long_neck', 'foraging'].includes(c.trait))) return -2;
      return 1.5 + sp.size * 0.5;
    case 'long_neck': return carn ? -5 : 3.4;
    case 'foraging': return carn ? -5 : 3;
    case 'fertile': return carn ? 1.2 : 2.6;
    case 'fat_tissue': return 1.4 + sp.size * 0.3;
    case 'cooperation': return right ? (isCarn(right) ? 1 : 2.4) : 0.4;
    case 'scavenger': return (anyCarn ? 2.4 : 1.2) - (carn ? 0.6 : 0);
    case 'intelligence': return carn ? 2.4 : 1.8;
    case 'pack_hunting': return carn ? 2.6 + sp.pop * 0.2 : -5;
    case 'ambush': return carn ? 1.5 : -5;
    case 'climbing': return 1 + danger * 1.1 + (carn ? 0.6 : 0);
    case 'burrowing': return 0.8 + danger * 1.2;
    case 'hard_shell': return 0.6 + danger * 1.4;
    case 'horns': return 0.7 + danger * 1.1;
    case 'defensive_herding': return 0.5 + danger * 1.1 + sp.pop * 0.1;
    case 'symbiosis': return right && right.size > sp.size ? 0.8 + danger * 1.3 : 0.2;
    case 'warning_call': return (left || right) ? 0.8 + danger * 0.8 : 0.1;
    default: return 0.5;
  }
}

/** การใส่ลักษณะที่ดีที่สุดสำหรับการ์ดใบนี้ { value, sp, replace } */
function bestPlacement(g, p, card) {
  let best = { value: -Infinity, sp: null, replace: undefined };
  for (const sp of p.species) {
    const v = traitValue(g, p, sp, card.trait);
    if (v === -Infinity) continue;
    if (sp.traits.length < 3) {
      if (v > best.value) best = { value: v, sp, replace: undefined };
    } else {
      let weakest = null;
      let wv = Infinity;
      for (const c of sp.traits) {
        if (c.trait === card.trait) continue;
        const cv = traitValue(g, p, { ...sp, traits: sp.traits.filter((x) => x !== c) }, c.trait);
        if (cv < wv) { wv = cv; weakest = c; }
      }
      if (weakest && v - wv - 1 > best.value) best = { value: v - wv - 1, sp, replace: weakest.id };
    }
  }
  return best;
}

function food(g, p) {
  const carns = p.species.filter(isCarn).length;
  const plant = p.species.length - carns;
  const bias = plant >= carns ? 0.35 : -0.35;
  let best = null;
  let bv = -Infinity;
  for (const c of p.hand) {
    const keep = Math.max(0, bestPlacement(g, p, c).value);
    const v = c.food * bias - keep + jitter();
    if (v > bv) { bv = v; best = c; }
  }
  return { card: best.id };
}

function play(g, p) {
  if (!p.hand.length) return { action: 'end' };
  const reserve = p.species.some((sp) => has(sp, 'intelligence')) ? 1 : 0;
  const acts = [];
  const cheap = [...p.hand].map((c) => ({ c, v: bestPlacement(g, p, c).value })).sort((a, b) => a.v - b.v)[0];
  const cheapCost = Math.max(0, cheap.v) * 0.35;
  for (const c of p.hand) {
    const b = bestPlacement(g, p, c);
    if (b.sp) acts.push({ v: b.value + jitter(), a: { action: 'trait', card: c.id, species: b.sp.id, replace: b.replace } });
  }
  const n = p.species.length;
  const newV = (n < 2 ? 5 : n < 4 ? 3 : n < 5 ? 1.6 : 0.6) - cheapCost;
  acts.push({ v: newV + jitter(), a: { action: 'new', card: cheap.c.id, side: Math.random() < 0.5 ? 'left' : 'right' } });
  for (const sp of p.species) {
    const carn = isCarn(sp);
    const d = threat(g, p, sp);
    if (sp.pop < 6) {
      const v = (carn ? 2 - sp.pop * 0.3 : 3.1 - sp.pop * 0.45) + (has(sp, 'pack_hunting') ? 0.8 : 0) + (has(sp, 'defensive_herding') ? 0.5 : 0);
      acts.push({ v: v - cheapCost + jitter(), a: { action: 'pop', card: cheap.c.id, species: sp.id } });
    }
    if (sp.size < 6) {
      const v = carn ? 3.3 - sp.size * 0.35 : 0.6 + Math.min(2, d) * 0.9 + (has(sp, 'fat_tissue') ? 0.5 : 0);
      acts.push({ v: v - cheapCost + jitter(), a: { action: 'size', card: cheap.c.id, species: sp.id } });
    }
  }
  acts.sort((x, y) => y.v - x.v);
  const best = acts[0];
  if (!best || best.v < 0.9 || p.hand.length <= reserve) return { action: 'end' };
  return best.a;
}

function feed(g, p, req) {
  let best = null;
  let bv = -Infinity;
  for (const o of req.options) {
    let v = 0;
    const sp = p.species.find((s) => s.id === o.species);
    if (o.kind === 'pass') v = 0.1;
    else if (o.kind === 'eat') {
      const need = sp.pop - sp.food;
      v = need > 0 ? 2 + need * 0.3 : 0.6;
      if (has(sp, 'cooperation')) v += 0.4;
    } else if (o.kind === 'intel') {
      v = (sp.pop - sp.food > 0 ? 1.8 : 0.4) - (g.hole > 0 ? 1 : 0);
    } else if (o.kind === 'attack') {
      const q = g.players[o.target.seat];
      const T = q.species.find((s) => s.id === o.target.species);
      const gain = Math.min(T.size, g.room(sp));
      v = gain * 0.6 + 1.2;
      if (q === p) v -= 3 + T.traits.length + (T.pop === 1 ? 2 : 0);
      else if (T.pop === 1) v += 0.8;
      if (has(T, 'horns') && !o.negate.includes('horns')) v -= sp.pop === 1 ? 10 : 1.5;
      v -= o.cost * 1.1;
    }
    v += jitter() * 0.5;
    if (v > bv) { bv = v; best = o; }
  }
  return { option: best.id, cards: [...p.hand].sort((a, b) => bestPlacement(g, p, a).value - bestPlacement(g, p, b).value).slice(0, best.cost || 0).map((c) => c.id) };
}

function decide(g, p, req) {
  switch (req.type) {
    case 'food': return food(g, p);
    case 'play': return play(g, p);
    case 'feed': return feed(g, p, req);
    default: return null;
  }
}

module.exports = { decide, traitValue, bestPlacement };
