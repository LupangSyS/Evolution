'use strict';

// เครื่องยนต์เกม Evolution — เซิร์ฟเวอร์เป็นผู้ตัดสินทั้งหมด
// ทุกการตัดสินใจของผู้เล่นคือ prompt ที่ await (async state machine) ผู้เล่นที่หลุดกลับมาตอบ prompt เดิมต่อได้

const { TRAITS, DEFENSIVE, DECK_SIZE, buildDeck, cardStr } = require('./cards');
const bot = require('./bot');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_TRAITS = 3;
const MAX_STAT = 6;

const PHASE_NAMES = {
  setup: 'เตรียมเกม', deal: 'แจกการ์ด', food: 'เลือกการ์ดอาหาร', play: 'เล่นการ์ด',
  reveal: 'เปิดการ์ดอาหาร', feed: 'หาอาหาร', over: 'จบเกม',
};

class GameOver extends Error {
  constructor(result) { super('game over'); this.result = result; }
}
class GameAborted extends Error {
  constructor() { super('game aborted'); }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const uniq = (arr) => new Set(arr).size === arr.length;
const strip = (c) => (c ? { id: c.id, trait: c.trait, food: c.food } : null);
const has = (sp, trait) => sp.traits.some((c) => c.trait === trait);

class Game {
  /**
   * @param {object} o
   * @param {{pid:string,name:string,isBot?:boolean}[]} o.players ลำดับที่นั่ง
   * @param {Function} [o.onUpdate] เรียกทุกครั้งที่สถานะเปลี่ยน
   * @param {number} [o.botDelay] หน่วงเวลาบอท (ms)
   * @param {object} [o.timeouts] { food, play, feed, disconnected } (ms)
   * @param {number} [o.maxRounds] จำกัดจำนวนรอบ (0 = ไม่จำกัด) — ใช้ในการทดสอบ
   * @param {number} [o.firstSeat] ที่นั่งผู้เล่นคนแรก (ค่าเริ่มต้นสุ่ม)
   */
  constructor(o) {
    const n = o.players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`จำนวนผู้เล่นต้องอยู่ระหว่าง ${MIN_PLAYERS}-${MAX_PLAYERS} คน`);
    this.onUpdate = o.onUpdate || (() => {});
    this.botDelay = o.botDelay ?? 700;
    this.timeouts = { food: 45000, play: 120000, feed: 30000, disconnected: 12000, ...(o.timeouts || {}) };
    this.maxRounds = o.maxRounds || 0;
    this.players = o.players.map((p, i) => ({
      pid: p.pid, name: p.name, isBot: !!p.isBot, connected: true, seat: i,
      hand: [], species: [], bag: 0, passed: false, ready: false,
    }));
    const deck = buildDeck();
    this.cardById = new Map(deck.map((c) => [c.id, c]));
    this.deck = shuffle(deck);
    this.discard = [];
    this.foodCards = []; // [{seat, card}] คว่ำอยู่ที่แหล่งน้ำ
    this.hole = 0; // อาหารพืชในแหล่งน้ำ
    this.speciesSeq = 0;
    this.pending = new Map();
    this.promptSeq = 0;
    this.logs = [];
    this.logSeq = 0;
    this.events = []; // สำหรับวาดลูกศร (ใครทำอะไรกับใคร)
    this.eventSeq = 0;
    this.round = 0;
    this.phase = 'setup';
    this.firstSeat = o.firstSeat ?? Math.floor(Math.random() * n);
    this.activeSeat = null;
    this.lastRound = false;
    this.result = null;
    this.aborted = false;
  }

  // ════════════════════════════ utilities ════════════════════════════

  update() { this.onUpdate(); }

  log(text) {
    this.logs.push({ id: ++this.logSeq, text });
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    this.update();
  }

  event(e) {
    this.events.push({ id: ++this.eventSeq, round: this.round, at: Date.now(), ...e });
    if (this.events.length > 12) this.events.shift();
  }

  player(pid) { return this.players.find((p) => p.pid === pid); }
  /** ผู้เล่นตามลำดับ เริ่มจากผู้เล่นคนแรกของรอบ */
  order(fromSeat = this.firstSeat) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(fromSeat + i) % n]);
  }
  ownerOf(sp) { return this.players.find((p) => p.species.includes(sp)); }
  findSpecies(id) {
    for (const p of this.players) {
      const sp = p.species.find((s) => s.id === id);
      if (sp) return sp;
    }
    return null;
  }
  spName(sp, owner = this.ownerOf(sp)) {
    const idx = owner.species.indexOf(sp) + 1;
    return `สปีชีส์ ${idx} ของ ${owner.name}`;
  }
  neighbors(sp) {
    const list = this.ownerOf(sp).species;
    const i = list.indexOf(sp);
    return { left: list[i - 1] || null, right: list[i + 1] || null };
  }

  newSpecies(p, side = 'right') {
    const sp = { id: ++this.speciesSeq, size: 1, pop: 1, food: 0, fat: 0, traits: [], hidden: new Set() };
    if (side === 'left') p.species.unshift(sp);
    else p.species.push(sp);
    return sp;
  }

  isCarnivore(sp) { return has(sp, 'carnivore'); }
  /** จำนวนอาหารที่ยังรับได้ (ช่องประชากร + ช่องไขมัน) */
  room(sp) { return (sp.pop - sp.food) + (has(sp, 'fat_tissue') ? sp.size - sp.fat : 0); }
  hungry(sp) { return sp.food < sp.pop; }

  drawOne() {
    if (!this.deck.length) {
      if (!this.discard.length) return null;
      this.deck = shuffle(this.discard);
      this.discard = [];
      if (!this.lastRound) {
        this.lastRound = true;
        this.log('กองจั่วหมด! สับกองทิ้งกลับมา — รอบนี้เป็นรอบสุดท้าย');
      }
    }
    return this.deck.pop() || null;
  }
  draw(p, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = this.drawOne();
      if (!c) break;
      p.hand.push(c);
      got++;
    }
    return got;
  }
  takeFromHand(p, ids) {
    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    p.hand = p.hand.filter((c) => !ids.includes(c.id));
    return cards;
  }

  // ════════════════════════════ prompts ════════════════════════════

  ask(p, req) {
    if (this.aborted) return Promise.reject(new GameAborted());
    const old = this.pending.get(p.pid);
    if (old) old.finish(null);
    return new Promise((resolve, reject) => {
      const id = ++this.promptSeq;
      req.id = id;
      const tmo = Math.max(500, req.timeout || this.timeouts[req.type] || 30000);
      delete req.timeout;
      req.deadline = req.deadline || Date.now() + tmo;
      const entry = { id, p, req, timers: [], reject };
      entry.finish = (raw) => {
        if (this.pending.get(p.pid) !== entry) return;
        entry.timers.forEach(clearTimeout);
        this.pending.delete(p.pid);
        let ans = raw ? this.normalize(p, req, raw) : null;
        if (!ans) ans = this.normalize(p, req, this.fallback(p, req));
        this.update();
        resolve(ans);
      };
      this.pending.set(p.pid, entry);
      if (p.isBot) {
        this.scheduleBot(entry);
      } else {
        entry.timers.push(setTimeout(() => entry.finish(this.timeoutAnswer(p, req)), Math.max(0, req.deadline - Date.now())));
        if (!p.connected) this.addDisconnectTimer(entry);
      }
      this.update();
    });
  }
  scheduleBot(entry) {
    const run = () => entry.finish(this.botAnswer(entry.p, entry.req));
    if (!this.botDelay) { setImmediate(run); return; }
    const k = entry.req.type === 'play' ? 0.5 : 1;
    entry.timers.push(setTimeout(run, this.botDelay * k * (0.6 + Math.random() * 0.8)));
  }
  addDisconnectTimer(entry) {
    clearTimeout(entry.dcTimer);
    entry.dcTimer = setTimeout(() => entry.finish(this.botAnswer(entry.p, entry.req)), this.timeouts.disconnected);
    entry.timers.push(entry.dcTimer);
  }
  botAnswer(p, req) {
    try { return bot.decide(this, p, req); } catch (e) { console.error('bot error', e); return null; }
  }
  timeoutAnswer(p, req) {
    if (req.type === 'play') return { action: 'end' };
    return this.botAnswer(p, req);
  }
  fallback(p, req) {
    switch (req.type) {
      case 'food': return { card: p.hand[0] && p.hand[0].id };
      case 'play': return { action: 'end' };
      case 'feed': {
        const o = req.options.find((x) => x.kind === 'pass') || req.options.find((x) => x.kind === 'eat') || req.options[0];
        return { option: o.id, cards: p.hand.slice(0, o.cost || 0).map((c) => c.id) };
      }
      default: return null;
    }
  }

  /** ตรวจคำตอบ คืนคำตอบที่ถูกต้องแล้ว หรือ null */
  normalize(p, req, a) {
    if (!a || typeof a !== 'object') return null;
    const inHand = (id) => p.hand.some((c) => c.id === id);
    switch (req.type) {
      case 'food':
        return Number.isInteger(a.card) && inHand(a.card) ? { card: a.card } : null;
      case 'play':
        return this.checkPlay(p, a);
      case 'feed': {
        const o = req.options.find((x) => x.id === a.option);
        if (!o) return null;
        const cards = Array.isArray(a.cards) ? a.cards : [];
        if (cards.length !== (o.cost || 0) || !uniq(cards) || !cards.every(inHand)) return null;
        return { option: o, cards };
      }
      default:
        return null;
    }
  }

  /** คำตอบจากไคลเอนต์ — คืนข้อความ error ถ้าไม่ถูกต้อง */
  submit(pid, promptId, data) {
    const entry = this.pending.get(pid);
    if (!entry || entry.id !== promptId) return 'คำสั่งนี้หมดอายุแล้ว';
    if (!this.normalize(entry.p, entry.req, data)) return 'การเลือกไม่ถูกต้อง';
    entry.finish(data);
    return null;
  }

  // ════════════════════════════ main flow ════════════════════════════

  async run() {
    try {
      this.log(`เริ่มเกม! ผู้เล่น ${this.players.length} คน การ์ด ${DECK_SIZE} ใบ`);
      for (;;) {
        this.round++;
        if (this.maxRounds && this.round > this.maxRounds) throw new GameOver(this.scoreResult('ครบจำนวนรอบที่กำหนด'));
        await this.runRound();
        if (this.lastRound) throw new GameOver(this.scoreResult('กองการ์ดหมด'));
        this.firstSeat = (this.firstSeat + 1) % this.players.length;
      }
    } catch (e) {
      if (e instanceof GameOver) this.finish(e.result);
      else if (e instanceof GameAborted) { /* ถูกยกเลิก */ }
      else {
        console.error('game engine error', e);
        this.finish({ winners: [], scores: [], text: 'เกมสิ้นสุดเนื่องจากข้อผิดพลาดของระบบ' });
      }
    }
    return this.result;
  }

  async runRound() {
    const first = this.players[this.firstSeat];
    this.log(`── รอบที่ ${this.round} (${first.name} เริ่มก่อน) ──`);
    this.dealPhase();
    await this.foodPhase();
    await this.playPhase();
    this.revealPhase();
    await this.feedPhase();
    this.endRound();
  }

  dealPhase() {
    this.phase = 'deal';
    for (const p of this.order()) {
      if (!p.species.length) {
        this.newSpecies(p);
        this.log(`${p.name} ไม่มีสปีชีส์เหลือ ได้สปีชีส์ใหม่ 1 ตัว`);
      }
      this.draw(p, 3 + p.species.length);
    }
    this.log('แจกการ์ดคนละ 3 ใบ + 1 ใบต่อสปีชีส์');
  }

  async foodPhase() {
    this.phase = 'food';
    this.foodCards = [];
    const deadline = Date.now() + this.timeouts.food;
    await Promise.all(this.players.filter((p) => p.hand.length).map(async (p) => {
      const ans = await this.ask(p, { type: 'food', title: 'เลือกการ์ด 1 ใบคว่ำลงแหล่งน้ำ (ตัวเลขอาหารจะกลายเป็นพืช)', deadline });
      const [c] = this.takeFromHand(p, [ans.card]);
      this.foodCards.push({ seat: p.seat, card: c });
      this.update();
    }));
    this.log('ทุกคนวางการ์ดอาหารคว่ำลงแหล่งน้ำแล้ว');
  }

  /** ตรวจการกระทำในช่วงเล่นการ์ด คืนคำตอบที่ถูกต้อง หรือ null */
  checkPlay(p, a) {
    if (a.action === 'end') return { action: 'end' };
    const card = Number.isInteger(a.card) && p.hand.find((c) => c.id === a.card);
    if (!card) return null;
    if (a.action === 'new') {
      if (a.side !== 'left' && a.side !== 'right') return null;
      return { action: 'new', card, side: a.side };
    }
    const sp = p.species.find((s) => s.id === a.species);
    if (!sp) return null;
    if (a.action === 'size') return sp.size < MAX_STAT ? { action: 'size', card, sp } : null;
    if (a.action === 'pop') return sp.pop < MAX_STAT ? { action: 'pop', card, sp } : null;
    if (a.action !== 'trait') return null;
    let replace = null;
    if (a.replace !== undefined && a.replace !== null) {
      replace = sp.traits.find((c) => c.id === a.replace);
      if (!replace) return null;
    }
    const remaining = sp.traits.filter((c) => c !== replace);
    if (remaining.some((c) => c.trait === card.trait)) return null;
    if (remaining.length >= MAX_TRAITS) return null;
    return { action: 'trait', card, sp, replace };
  }

  async playPhase() {
    this.phase = 'play';
    for (const p of this.players) p.ready = false;
    const deadline = Date.now() + this.timeouts.play;
    await Promise.all(this.players.map(async (p) => {
      while (p.hand.length) {
        const ans = await this.ask(p, {
          type: 'play', deadline,
          title: 'เล่นการ์ด: ใส่ลักษณะ (คว่ำ) หรือทิ้งเพื่อ เพิ่มขนาดตัว / เพิ่มประชากร / สปีชีส์ใหม่',
        });
        if (ans.action === 'end') break;
        this.applyPlay(p, ans);
      }
      p.ready = true;
      this.update();
    }));
    this.log('ทุกคนเล่นการ์ดเสร็จแล้ว');
  }

  applyPlay(p, a) {
    this.takeFromHand(p, [a.card.id]);
    if (a.action === 'trait') {
      if (a.replace) this.removeTrait(a.sp, a.replace);
      a.sp.traits.push(a.card);
      a.sp.hidden.add(a.card.id);
      this.event({ kind: 'trait', from: { seat: p.seat }, to: { seat: p.seat, species: a.sp.id } });
      this.update();
      return;
    }
    this.discard.push(a.card);
    if (a.action === 'new') {
      const sp = this.newSpecies(p, a.side);
      this.log(`${p.name} สร้างสปีชีส์ใหม่ทาง${a.side === 'left' ? 'ซ้าย' : 'ขวา'}`);
      this.event({ kind: 'new', from: { seat: p.seat }, to: { seat: p.seat, species: sp.id } });
    } else if (a.action === 'size') {
      a.sp.size++;
      this.log(`${p.name} เพิ่มขนาดตัว${this.spName(a.sp, p)} เป็น ${a.sp.size}`);
      this.event({ kind: 'size', from: { seat: p.seat }, to: { seat: p.seat, species: a.sp.id } });
    } else if (a.action === 'pop') {
      a.sp.pop++;
      this.log(`${p.name} เพิ่มประชากร${this.spName(a.sp, p)} เป็น ${a.sp.pop}`);
      this.event({ kind: 'pop', from: { seat: p.seat }, to: { seat: p.seat, species: a.sp.id } });
    }
    this.update();
  }

  removeTrait(sp, card) {
    sp.traits = sp.traits.filter((c) => c !== card);
    sp.hidden.delete(card.id);
    if (card.trait === 'fat_tissue') sp.fat = 0;
    this.discard.push(card);
  }

  revealPhase() {
    this.phase = 'reveal';
    for (const p of this.order()) {
      const shown = [];
      for (const sp of p.species) {
        for (const c of sp.traits) if (sp.hidden.has(c.id)) shown.push(`${cardStr(c)}→สปีชีส์ ${p.species.indexOf(sp) + 1}`);
        sp.hidden.clear();
      }
      if (shown.length) this.log(`${p.name} เปิดลักษณะ: ${shown.join(', ')}`);
    }
    // ก่อนเปิดการ์ดอาหาร: ขยายพันธุ์เร็ว → คอยาว → ไขมันสะสม (ตามลำดับผู้เล่น)
    for (const p of this.order()) {
      for (const sp of p.species) {
        if (has(sp, 'fertile') && this.hole > 0 && sp.pop < MAX_STAT) {
          sp.pop++;
          this.log(`${this.spName(sp, p)} ขยายพันธุ์เร็ว: ประชากร +1`);
        }
      }
    }
    for (const p of this.order()) {
      for (const sp of p.species) {
        if (has(sp, 'long_neck')) {
          const got = this.gain(sp, 1, 'plant', 'bank');
          if (got) this.log(`${this.spName(sp, p)} คอยาว: ได้พืชจากคลัง`);
        }
      }
    }
    for (const p of this.order()) {
      for (const sp of p.species) {
        if (sp.fat > 0) {
          const k = Math.min(sp.fat, sp.pop - sp.food);
          if (k > 0) {
            sp.fat -= k;
            sp.food += k;
            this.log(`${this.spName(sp, p)} ใช้ไขมันสะสม ${k}`);
          }
        }
      }
    }
    const cards = this.foodCards.map((f) => f.card);
    const sum = cards.reduce((s, c) => s + c.food, 0);
    const before = this.hole;
    this.hole = Math.max(0, this.hole + sum);
    const placed = this.foodCards;
    this.revealedFood = placed.map((f) => ({ seat: f.seat, card: strip(f.card) }));
    this.foodCards = [];
    this.discard.push(...cards);
    this.log(`เปิดการ์ดอาหาร: ${placed.map((f) => `${this.players[f.seat].name} ${f.card.food >= 0 ? '+' : ''}${f.card.food}`).join(', ')} → แหล่งน้ำ ${before} → ${this.hole}`);
  }

  /**
   * สปีชีส์ได้อาหาร (พืช/เนื้อ) จากแหล่ง ('hole' = แหล่งน้ำ, 'bank' = คลัง) — รวมผลของ หาอาหารเก่ง / ไขมันสะสม / ร่วมมือ
   * @returns {number} จำนวนที่ได้จริง
   */
  gain(sp, n, kind, source) {
    if (kind === 'plant' && this.isCarnivore(sp)) return 0;
    if (kind === 'plant' && has(sp, 'foraging')) n += 1;
    let amt = Math.min(n, this.room(sp));
    if (source === 'hole') amt = Math.min(amt, this.hole);
    if (amt <= 0) return 0;
    if (source === 'hole') this.hole -= amt;
    const toBoard = Math.min(amt, sp.pop - sp.food);
    sp.food += toBoard;
    sp.fat += amt - toBoard;
    if (has(sp, 'cooperation')) {
      const { right } = this.neighbors(sp);
      if (right) this.gain(right, 1, kind, source);
    }
    return amt;
  }

  /** เหตุผลที่นักล่า C โจมตีเหยื่อ T ไม่ได้: null = โจมตีไม่ได้เลย, [] = ได้, [...] = ลักษณะที่ต้องหักล้าง */
  attackBlockers(C, T) {
    if (C === T) return null;
    const atk = C.size + (has(C, 'pack_hunting') ? C.pop : 0);
    if (atk <= T.size) return null;
    const out = [];
    if (has(T, 'hard_shell') && atk <= T.size + 4) out.push('hard_shell');
    if (has(T, 'burrowing') && !this.hungry(T)) out.push('burrowing');
    if (has(T, 'climbing') && !has(C, 'climbing')) out.push('climbing');
    if (has(T, 'defensive_herding') && C.pop <= T.pop) out.push('defensive_herding');
    const { left, right } = this.neighbors(T);
    if (has(T, 'symbiosis') && right && right.size > T.size) out.push('symbiosis');
    if (!has(C, 'ambush') && ((left && has(left, 'warning_call')) || (right && has(right, 'warning_call')))) out.push('warning_call');
    return out;
  }

  /** ตัวเลือกทั้งหมดในตาหาอาหารของผู้เล่น p */
  feedOptions(p) {
    const opts = [];
    let seq = 0;
    const add = (o) => opts.push({ id: ++seq, cost: 0, negate: [], ...o });
    let mustEat = false;
    for (const sp of p.species) {
      if (this.room(sp) <= 0) continue;
      if (!this.isCarnivore(sp)) {
        if (this.hole > 0) {
          add({ kind: 'eat', species: sp.id });
          if (this.hungry(sp)) mustEat = true;
        }
        if (has(sp, 'intelligence') && p.hand.length >= 1) add({ kind: 'intel', species: sp.id, cost: 1 });
        continue;
      }
      const smart = has(sp, 'intelligence');
      for (const q of this.players) {
        for (const T of q.species) {
          const bl = this.attackBlockers(sp, T);
          if (!bl) continue;
          const target = { seat: q.seat, species: T.id };
          if (bl.length === 0) add({ kind: 'attack', species: sp.id, target });
          else if (smart && bl.length <= p.hand.length) add({ kind: 'attack', species: sp.id, target, negate: bl, cost: bl.length });
          if (smart && has(T, 'horns') && bl.length + 1 <= p.hand.length) {
            add({ kind: 'attack', species: sp.id, target, negate: [...bl, 'horns'], cost: bl.length + 1 });
          }
        }
      }
    }
    if (!opts.length) return opts;
    if (!mustEat) add({ kind: 'pass' });
    return opts;
  }

  async feedPhase() {
    this.phase = 'feed';
    for (const p of this.players) p.passed = false;
    this.log(`ช่วงหาอาหาร — แหล่งน้ำมีพืช ${this.hole}`);
    for (;;) {
      let acted = false;
      for (const p of this.order()) {
        if (p.passed) continue;
        const options = this.feedOptions(p);
        if (!options.length) continue;
        this.activeSeat = p.seat;
        const ans = await this.ask(p, { type: 'feed', title: 'ตาหาอาหารของคุณ: เลือกสปีชีส์ที่จะกิน', options });
        if (ans.option.kind === 'pass') {
          p.passed = true;
          this.log(`${p.name} หยุดหาอาหาร`);
          continue;
        }
        acted = true;
        this.applyFeed(p, ans.option, ans.cards);
      }
      if (!acted) break;
    }
    this.activeSeat = null;
    this.update();
  }

  applyFeed(p, o, cardIds) {
    const sp = p.species.find((s) => s.id === o.species);
    const paid = this.takeFromHand(p, cardIds);
    this.discard.push(...paid);
    if (o.kind === 'eat') {
      const got = this.gain(sp, 1, 'plant', 'hole');
      this.log(`${this.spName(sp, p)} กินพืชจากแหล่งน้ำ ${got} (เหลือ ${this.hole})`);
      this.event({ kind: 'eat', from: { seat: p.seat, species: sp.id }, to: 'hole' });
    } else if (o.kind === 'intel') {
      const got = this.gain(sp, 2, 'plant', 'bank');
      this.log(`${this.spName(sp, p)} เฉลียวฉลาด: ทิ้งการ์ด 1 ใบ รับพืชจากคลัง ${got}`);
      this.event({ kind: 'eat', from: { seat: p.seat, species: sp.id }, to: 'bank' });
    } else if (o.kind === 'attack') {
      this.attack(p, sp, o);
    }
    this.update();
  }

  attack(p, C, o) {
    const q = this.players[o.target.seat];
    const T = q.species.find((s) => s.id === o.target.species);
    const tName = this.spName(T, q);
    const negTxt = o.negate.length ? ` (หักล้าง ${o.negate.map((t) => TRAITS[t].name).join(', ')})` : '';
    this.log(`🦖 ${this.spName(C, p)} โจมตี ${tName}${negTxt}`);
    this.event({ kind: 'attack', from: { seat: p.seat, species: C.id }, to: { seat: q.seat, species: T.id } });
    const meat = T.size;
    T.pop--;
    T.food = Math.min(T.food, T.pop);
    const horned = has(T, 'horns') && !o.negate.includes('horns');
    if (horned) {
      C.pop--;
      C.food = Math.min(C.food, C.pop);
    }
    // ลบสปีชีส์ที่สูญพันธุ์ก่อนส่งสถานะให้ผู้เล่น (ไม่ให้เห็นประชากร 0 ค้างบนโต๊ะ)
    const cName = this.spName(C, p);
    const dead = [];
    if (T.pop <= 0) dead.push(this.extinct(q, T, tName, true));
    if (C.pop <= 0) dead.push(this.extinct(p, C, cName, true));
    dead.forEach((t) => this.log(t));
    if (horned) this.log(`${tName} ใช้เขา: นักล่าเสียประชากร 1`);
    if (C.pop > 0) {
      const got = this.gain(C, meat, 'meat', 'bank');
      this.log(`${this.spName(C, p)} ได้เนื้อ ${got}`);
    }
    for (const s of this.order(p.seat)) {
      for (const sp of s.species) {
        if (has(sp, 'scavenger') && this.gain(sp, 1, 'meat', 'bank')) this.log(`${this.spName(sp, s)} กินซาก: ได้เนื้อ 1`);
      }
    }
  }

  /** สปีชีส์สูญพันธุ์: ทิ้งลักษณะ เจ้าของจั่วการ์ดเท่าจำนวนลักษณะ (quiet = คืนข้อความแทนการ log) */
  extinct(p, sp, name = this.spName(sp, p), quiet = false) {
    const n = sp.traits.length;
    p.species = p.species.filter((s) => s !== sp);
    this.discard.push(...sp.traits);
    sp.traits = [];
    const got = this.draw(p, n);
    const text = `☠ ${name} สูญพันธุ์${got ? ` — ${p.name} จั่วการ์ด ${got} ใบ` : ''}`;
    if (!quiet) this.log(text);
    return text;
  }

  endRound() {
    for (const p of this.order()) {
      let eaten = 0;
      for (const sp of [...p.species]) {
        eaten += sp.food;
        p.bag += sp.food;
        sp.pop = sp.food;
        sp.food = 0;
        if (sp.pop <= 0) this.extinct(p, sp);
      }
      if (eaten) this.log(`${p.name} เก็บอาหาร ${eaten} ลงถุง`);
    }
    this.log(`จบรอบที่ ${this.round} — ประชากรลดลงเท่าอาหารที่กินได้`);
  }

  // ════════════════════════════ scoring ════════════════════════════

  scoreOf(p) {
    const pop = p.species.reduce((s, sp) => s + sp.pop, 0);
    const traits = p.species.reduce((s, sp) => s + sp.traits.length, 0);
    return { seat: p.seat, pid: p.pid, name: p.name, bag: p.bag, pop, traits, total: p.bag + pop + traits };
  }

  scoreResult(reason) {
    const scores = this.players.map((p) => this.scoreOf(p)).sort((a, b) => b.total - a.total || b.bag - a.bag);
    const top = scores[0];
    const winners = scores.filter((s) => s.total === top.total && s.bag === top.bag);
    const names = winners.map((w) => w.name).join(' และ ');
    const text = `${reason} — ${names} ชนะด้วยคะแนน ${top.total}${winners.length > 1 ? ' (เสมอ)' : ''}`;
    return { winners: winners.map((w) => w.pid), scores, text };
  }

  finish(result) {
    this.result = result;
    this.phase = 'over';
    this.activeSeat = null;
    for (const e of [...this.pending.values()]) e.timers.forEach(clearTimeout);
    this.pending.clear();
    this.log(`🏁 จบเกม: ${result.text}`);
    this.update();
  }

  abort() {
    this.aborted = true;
    for (const e of [...this.pending.values()]) {
      e.timers.forEach(clearTimeout);
      e.reject(new GameAborted());
    }
    this.pending.clear();
  }

  setConnected(pid, connected) {
    const p = this.player(pid);
    if (!p) return;
    p.connected = connected;
    const e = this.pending.get(pid);
    if (e && !connected && !p.isBot) this.addDisconnectTimer(e);
    if (e && connected) clearTimeout(e.dcTimer); // กลับมาทันเวลา: ตอบเองได้
    this.update();
  }

  setBot(pid) {
    const p = this.player(pid);
    if (!p || p.isBot) return;
    p.isBot = true;
    const e = this.pending.get(pid);
    if (e) this.scheduleBot(e);
    this.update();
  }

  // ════════════════════════════ views ════════════════════════════

  /** มุมมองของผู้เล่นคนหนึ่ง — ไม่ส่งมือ/ถุงอาหาร/ลักษณะที่ยังคว่ำของคนอื่น */
  viewFor(pid) {
    const me = this.player(pid);
    const over = this.phase === 'over';
    const pe = me && this.pending.get(me.pid);
    return {
      phase: this.phase,
      phaseName: PHASE_NAMES[this.phase],
      round: this.round,
      firstSeat: this.firstSeat,
      activeSeat: this.activeSeat,
      mySeat: me ? me.seat : null,
      lastRound: this.lastRound,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      hole: this.hole,
      foodCount: this.foodCards.length,
      myFood: me ? strip((this.foodCards.find((f) => f.seat === me.seat) || {}).card) : null,
      revealedFood: this.phase === 'feed' ? this.revealedFood || [] : [],
      players: this.players.map((p) => ({
        seat: p.seat, pid: p.pid, name: p.name, isBot: p.isBot, connected: p.connected,
        handCount: p.hand.length,
        bag: over || p === me ? p.bag : null,
        passed: p.passed, ready: p.ready,
        placedFood: this.foodCards.some((f) => f.seat === p.seat),
        species: p.species.map((sp) => ({
          id: sp.id, size: sp.size, pop: sp.pop, food: sp.food, fat: sp.fat,
          traits: sp.traits.map((c) => (sp.hidden.has(c.id)
            ? (p === me ? { ...strip(c), hidden: true } : { hidden: true })
            : strip(c))),
        })),
      })),
      hand: me ? me.hand.map(strip) : [],
      events: this.events,
      log: this.logs.slice(-80),
      waiting: [...this.pending.values()].map((e) => ({ seat: e.p.seat, type: e.req.type, deadline: e.req.deadline })),
      prompt: pe ? pe.req : null,
      result: this.result,
    };
  }
}

module.exports = { Game, GameOver, GameAborted, MIN_PLAYERS, MAX_PLAYERS, MAX_TRAITS, MAX_STAT, PHASE_NAMES, has };
