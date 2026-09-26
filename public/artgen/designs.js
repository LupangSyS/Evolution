/* สูตรวาดภาพประกอบทุกใบของ Evolution วิวัฒนาการ — pixel art สร้างจากโค้ดล้วน
   ภาพผลลัพธ์ถูกบันทึกถาวรที่ public/art/ ด้วย scripts/build-art.js */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./raster'));
  else root.ArtDesigns = factory(root.ArtRaster);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { Canvas, hash, rng, mix, shade } = R;
  const VERSION = 1;

  // ขนาดพิกเซลจริง (logical) และตัวคูณขยายตอนบันทึกเป็นไฟล์
  const SPECS = {
    cards: { w: 66, h: 54, scale: 3 }, // ภาพบนหน้าการ์ดลักษณะ
    back: { w: 66, h: 94, scale: 3 },
    felt: { w: 160, h: 100, scale: 4 },
    pond: { w: 64, h: 40, scale: 3 },
  };
  const W = SPECS.cards.w;
  const H = SPECS.cards.h;

  // ───────────────────────── helpers ─────────────────────────
  const INK = '#140b07';

  function background(seed, top, bottom, glow, gy = 0.42) {
    const r = rng(seed);
    return new Canvas(W, H).fill((x, y) => {
      let c = mix(top, bottom, y / (H - 1));
      const dx = (x - W / 2) / W; const dy = (y - H * gy) / H;
      const g = Math.max(0, 1 - Math.hypot(dx, dy) * 2.3);
      c = mix(c, glow, g * g * 0.75);
      const v = Math.max(0, Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) - 0.8) * 110;
      const n = (r() - 0.5) * 12;
      return [c[0] + n - v, c[1] + n - v, c[2] + n - v];
    });
  }
  function compose(bg, draw) { const L = new Canvas(W, H); draw(L); return bg.draw(L.outline(INK)); }
  function eye(L, x, y, c = '#fff6c8') { L.px(x, y, c).px(x + 1, y, INK); }
  function grass(L, seed, y0, c) {
    const r = rng(seed);
    L.rect(0, y0, W, H - y0, shade(c, -0.25));
    for (let x = 0; x < W; x += 2) L.line(x, y0 + 1, x + (r() - 0.5) * 3, y0 - 2 - r() * 4, 1, c);
  }
  function palm(L, x, y, h, c = '#4f9a3a') {
    L.path([[x, y], [x + 1, y - h * 0.5], [x - 1, y - h]], 2, '#7a5a30');
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI + (i / 4) * Math.PI;
      L.path([[x - 1, y - h], [x - 1 + Math.cos(a) * 6, y - h + Math.sin(a) * 3 + 2], [x - 1 + Math.cos(a) * 9, y - h + 4]], 1.6, c);
    }
  }
  function leaves(L, seed, n, box, c = '#3a8a3a') {
    const r = rng(seed);
    for (let i = 0; i < n; i++) L.ellipse(box[0] + r() * box[2], box[1] + r() * box[3], 4, 2, c);
  }
  function waves(L, y0, c) {
    for (let y = y0; y < H; y += 4) for (let x = (y % 8 ? 0 : 3); x < W; x += 9) L.line(x, y, x + 4, y, 1, c);
  }
  /** สัตว์สี่ขาทั่วไป (หมาป่า/ไฮยีน่า) หันซ้าย ขนาด s */
  function hound(L, x, y, s, fur, spot) {
    L.ellipse(x + 7 * s, y, 7 * s, 3.2 * s, fur);
    L.circle(x, y - 2 * s, 3 * s, fur);
    L.poly([[x - 2.6 * s, y - 1.4 * s], [x - 6 * s, y - 0.5 * s], [x - 2.4 * s, y + 0.6 * s]], fur);
    L.poly([[x + 0.5 * s, y - 4.4 * s], [x + 1.6 * s, y - 7 * s], [x + 2.4 * s, y - 4 * s]], fur);
    for (const lx of [x + 2 * s, x + 4 * s, x + 10 * s, x + 12 * s]) L.line(lx, y + 2 * s, lx - 0.5 * s, y + 6 * s, Math.max(1, s * 1.1), fur);
    L.path([[x + 13.5 * s, y - 1 * s], [x + 16 * s, y - 3 * s]], Math.max(1, s), fur);
    if (spot) for (const [dx, dy] of [[4, -1], [8, 0.5], [11, -1.2], [6, 1.5]]) L.circle(x + dx * s, y + dy * s, 0.9 * s, spot);
    eye(L, Math.round(x - 1 * s), Math.round(y - 3 * s), '#ffd040');
  }

  // ───────────────────────── trait cards ─────────────────────────
  const CARD = {};
  const card = (key, bg, draw) => { CARD[key] = { bg, draw }; };

  // — นักล่า —
  card('carnivore', ['#c8483a', '#2a0808', '#ffb080'], (L) => {
    L.rect(0, 46, W, 8, '#e8dcd0');
    const fur = '#e6e1d8';
    L.ellipse(36, 32, 16, 9, fur);
    L.poly([[20, 30], [8, 22], [6, 30], [12, 36], [22, 36]], fur);
    L.poly([[12, 22], [15, 16], [17, 24]], fur);
    L.poly([[7, 30], [2, 33], [9, 38], [14, 35]], '#b8302a');
    for (const x of [4, 7, 10]) L.line(x, 32, x + 1, 34, 1, '#ffffff');
    L.line(48, 30, 60, 22, 3, fur).line(60, 22, 63, 16, 2, fur);
    for (const [x0, x1] of [[26, 22], [32, 30], [42, 46], [48, 54]]) L.line(x0, 38, x1, 47, 3, fur);
    for (let i = 0; i < 5; i++) L.poly([[27 + i * 5, 24], [30 + i * 5, 24], [27 + i * 5, 31]], '#7a7a8a');
    eye(L, 12, 25, '#ffd040');
  });
  card('ambush', ['#5ab8c8', '#0a2a3a', '#fff0c0', 0.3], (L) => {
    L.rect(0, 40, W, 14, '#2a8aa0');
    waves(L, 42, '#8fd8e8');
    const skin = '#4a9a3a';
    // ขากรรไกรล่าง + ปากด้านใน + ขากรรไกรบนที่อ้ากว้าง
    L.poly([[4, 46], [36, 38], [40, 42], [8, 52]], skin);
    L.poly([[8, 45], [34, 37], [30, 30], [10, 40]], '#e87a8a');
    L.poly([[4, 44], [10, 36], [30, 18], [36, 20], [34, 26], [12, 42]], skin);
    L.ellipse(9, 40, 6, 5, skin);
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      L.poly([[12 + t * 20, 40 - t * 18], [14 + t * 20, 40 - t * 18], [14 + t * 20, 42 - t * 17]], '#ffffff');
      L.poly([[12 + t * 22, 46 - t * 7], [14 + t * 22, 46 - t * 7], [13 + t * 22, 44 - t * 7]], '#ffffff');
    }
    for (let i = 0; i < 4; i++) L.circle(16 + i * 5, 35 - i * 4.5, 0.9, '#2a6a22');
    eye(L, 10, 36, '#ffd040');
    L.ellipse(48, 14, 9, 4, '#f08a2a');
    for (let i = 0; i < 4; i++) L.line(43 + i * 3, 11, 44 + i * 3, 17, 1, '#fff0d8');
    L.poly([[56, 14], [62, 9], [62, 19]], '#f08a2a');
    eye(L, 41, 13);
    for (const [x, y] of [[38, 30], [44, 26], [54, 26], [30, 12], [60, 30]]) L.circle(x, y, 1.3, '#e8fbff');
  });
  card('pack_hunting', ['#e8c890', '#4a3010', '#fff4d0'], (L) => {
    L.rect(0, 44, W, 10, '#c8a060');
    hound(L, 8, 22, 1.1, '#f0e0c8', '#c86a2a');
    hound(L, 30, 34, 1.3, '#f0e0c8', '#c86a2a');
    hound(L, 40, 16, 0.9, '#f0e0c8', '#c86a2a');
  });
  card('intelligence', ['#c8d8e8', '#2a3040', '#fff8e0', 0.3], (L) => {
    L.poly([[0, 42], [22, 34], [48, 38], [66, 34], [66, 54], [0, 54]], '#a8b0c0');
    const fur = '#f09030';
    L.ellipse(30, 34, 8, 9, fur);
    L.circle(30, 22, 7, fur);
    L.ellipse(30, 24, 4, 3.5, '#8a4a20');
    eye(L, 28, 22, '#fff6c8'); eye(L, 31, 22, '#fff6c8');
    L.path([[37, 38], [46, 42], [50, 36], [46, 32]], 2, fur);
    L.line(22, 32, 16, 40, 2, fur);
    L.line(14, 46, 24, 30, 1.4, '#7a5a30');
    L.circle(46, 10, 4, '#fff3a0');
    L.rect(45, 14, 3, 3, '#b8b8c0');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; L.line(46 + Math.cos(a) * 6, 10 + Math.sin(a) * 6, 46 + Math.cos(a) * 8, 10 + Math.sin(a) * 8, 1, '#fff3a0'); }
  });

  // — ป้องกัน —
  card('burrowing', ['#a07040', '#2a1408', '#ffd890'], (L) => {
    L.ellipse(33, 44, 26, 12, '#3a2210');
    L.ellipse(33, 46, 20, 8, '#140a04');
    const fur = '#c89a5a';
    L.ellipse(33, 38, 10, 7, fur);
    L.circle(24, 32, 5, fur);
    L.poly([[22, 28], [20, 12], [24, 12], [25, 28]], fur);
    L.poly([[26, 28], [27, 13], [30, 14], [28, 29]], fur);
    L.line(21, 14, 22, 26, 1, '#f0b0a0');
    eye(L, 21, 31);
    L.path([[43, 40], [52, 36], [58, 38]], 1.4, fur);
    L.circle(59, 38, 2.4, '#f4efe0');
    for (let i = 0; i < 4; i++) L.line(28 + i * 3, 34, 29 + i * 3, 40, 1, '#8a6a3a');
  });
  card('climbing', ['#8fd0e8', '#1a3a3a', '#ffffe0', 0.3], (L) => {
    for (const x of [10, 22, 46, 58]) L.path([[x, 54], [x + 2, 36], [x - 1, 18], [x + 1, 0]], 2, '#6cb84a');
    const skin = '#3a6ad0';
    L.path([[34, 50], [33, 42], [34, 34], [33, 24], [34, 16]], 5, skin);
    L.ellipse(34, 12, 3.4, 4, skin);
    for (const [y, d] of [[22, 1], [36, 1]]) { L.line(34, y, 34 - 7 * d, y - 3, 1.6, skin); L.line(34, y, 34 + 7 * d, y - 3, 1.6, skin); }
    L.path([[34, 50], [38, 52], [41, 49], [39, 46]], 1.6, skin);
    for (const y of [20, 28, 36, 44]) L.rect(33, y, 3, 2, '#f0d040');
    eye(L, 32, 11, '#ffd040');
  });
  card('defensive_herding', ['#e8e0b0', '#3a4a2a', '#fffbe0', 0.35], (L) => {
    L.rect(0, 44, W, 10, '#b8b070');
    for (const [x, y, s] of [[14, 36, 1], [34, 34, 1.15], [52, 38, 0.9]]) {
      L.ellipse(x, y, 10 * s, 7 * s, '#5a6ad0');
      for (let k = -2; k <= 2; k++) L.line(x + k * 3.5 * s, y - 6 * s, x + k * 3.5 * s, y + 5 * s, 1, '#8a9af0');
      L.ellipse(x - 10 * s, y + 3 * s, 3.4 * s, 2.6 * s, '#7a8ae0');
      eye(L, Math.round(x - 11 * s), Math.round(y + 2 * s));
      for (const lx of [x - 5 * s, x + 5 * s]) L.rect(lx, y + 5 * s, 2, 3, '#4a5ab0');
    }
  });
  card('hard_shell', ['#6a7ab0', '#161a2e', '#f0d8a0'], (L) => {
    L.ellipse(33, 48, 26, 5, '#3a3060', 0.8);
    L.ellipse(33, 34, 18, 12, '#b07a2a');
    for (const [x, y] of [[26, 28], [34, 26], [42, 29], [22, 36], [31, 35], [40, 36], [47, 37]]) {
      L.poly([[x - 3, y], [x - 1.5, y - 3], [x + 1.5, y - 3], [x + 3, y], [x + 1.5, y + 3], [x - 1.5, y + 3]], '#e0b040');
      L.px(x, y, '#6a3a10');
    }
    L.ellipse(33, 44, 18, 2.4, '#d8a23c');
    L.ellipse(12, 40, 5, 4, '#c89a5a');
    for (const x of [20, 44]) L.rect(x, 44, 5, 5, '#c89a5a');
    eye(L, 10, 38);
  });
  card('horns', ['#e0906a', '#3a1a10', '#ffe8b0', 0.35], (L) => {
    L.rect(0, 44, W, 10, '#a8a8c0');
    L.ellipse(34, 36, 16, 8, '#e05a3a');
    const r = rng(4);
    for (let i = 0; i < 22; i++) L.circle(22 + r() * 26, 31 + r() * 9, 1.2, ['#f0c040', '#40a0e0', '#60c060'][i % 3]);
    L.ellipse(16, 30, 7, 6, '#40a0e0');
    L.path([[14, 25], [10, 16], [14, 10], [18, 8]], 2, '#f0e0c0');
    L.path([[19, 25], [22, 16], [28, 12], [30, 14]], 2, '#f0e0c0');
    L.path([[48, 38], [58, 42], [62, 48]], 2.4, '#e05a3a');
    for (const x of [22, 44]) L.rect(x, 41, 4, 5, '#c04a2a');
    eye(L, 14, 29, '#ffd040');
  });
  card('symbiosis', ['#f0d8a0', '#4a3a20', '#fff8e0', 0.35], (L) => {
    L.rect(0, 46, W, 8, '#c8a868');
    const hide = '#f4ecd8';
    L.ellipse(32, 30, 16, 8, hide);
    for (let i = 0; i < 6; i++) L.line(22 + i * 4, 23, 20 + i * 4, 37, 1.6, '#3a3050');
    L.path([[46, 28], [52, 16], [54, 8]], 4, hide);
    L.ellipse(56, 7, 4, 2.6, hide);
    for (const x of [20, 26, 38, 44]) L.line(x, 36, x, 47, 2.4, hide);
    eye(L, 56, 6);
    for (const [x, y, c] of [[24, 20, '#f08030'], [32, 20, '#40b0e0'], [40, 21, '#60c050']]) {
      L.circle(x, y, 2.4, c);
      L.poly([[x - 2, y - 1], [x - 4.5, y], [x - 2, y + 0.5]], '#f0c040');
      L.px(x - 1, y - 1, INK);
    }
  });
  card('warning_call', ['#7ac8b0', '#12302a', '#f8f0c0'], (L) => {
    L.path([[0, 40], [20, 38], [40, 42], [66, 36]], 3, '#6f4424');
    leaves(L, 12, 12, [0, 36, W, 10]);
    const fur = '#d8d8e0';
    L.ellipse(30, 30, 6, 9, fur);
    L.circle(30, 19, 5, fur);
    L.ellipse(30, 20, 2.5, 1.5, INK);
    eye(L, 28, 18, '#ffd040'); eye(L, 31, 18, '#ffd040');
    L.poly([[27, 22], [33, 22], [30, 25]], '#2a2a2a');
    for (let i = 0; i < 8; i++) L.rect(34 + (i % 2), 38 + i * 2, 2, 2, i % 2 ? INK : fur);
    for (const rr of [8, 12, 16]) {
      for (let a = -0.7; a <= 0.7; a += 0.08) {
        L.px(36 + Math.cos(a) * rr, 16 + Math.sin(a) * rr, '#fff6c8', 0.9);
        L.px(24 - Math.cos(a) * rr, 16 + Math.sin(a) * rr, '#fff6c8', 0.9);
      }
    }
  });

  // — หาอาหาร —
  card('long_neck', ['#8fd0e8', '#2a5a2a', '#fff4c0', 0.3], (L) => {
    grass(L, 3, 47, '#6cb84a');
    palm(L, 8, 47, 30);
    palm(L, 60, 47, 26, '#5aa840');
    const skin = '#4f7fc8';
    L.ellipse(36, 38, 14, 7, skin);
    L.path([[26, 36], [22, 24], [22, 12], [26, 5]], 4, skin);
    L.ellipse(29, 5, 5, 2.6, skin);
    L.path([[49, 38], [58, 42], [64, 46]], 2.4, skin);
    for (const x of [28, 33, 40, 45]) L.rect(x, 42, 3, 6, shade(skin, -0.2));
    for (let i = 0; i < 5; i++) L.line(30 + i * 3, 33, 31 + i * 3, 38, 1, '#e8883a');
    eye(L, 30, 4);
    L.circle(35, 4, 1.4, '#6cb84a');
  });
  card('fertile', ['#f0d060', '#5a4010', '#fff8d0', 0.3], (L) => {
    const r = rng(9);
    for (let i = 0; i < 40; i++) { const x = r() * W; L.line(x, 54, x + (r() - 0.5) * 12, 14 + r() * 16, 1, r() < 0.5 ? '#d8b040' : '#b8902a'); }
    L.ellipse(33, 42, 24, 8, '#8a6a30');
    for (const [x, y] of [[20, 38], [28, 36], [36, 37], [44, 38], [24, 42], [32, 42], [40, 42], [48, 41], [16, 42]]) {
      L.ellipse(x, y, 4, 3.4, '#3a7ad0'); L.px(x - 1, y - 1, '#a8d0ff'); L.px(x + 1, y, '#1a3a8a');
    }
  });
  card('fat_tissue', ['#f0c8a0', '#4a2a18', '#fff0d8'], (L) => {
    L.rect(0, 46, W, 8, '#d8b888');
    L.ellipse(34, 32, 20, 14, '#f07a3a');
    for (let i = 0; i < 5; i++) L.path([[20 + i * 7, 20 + (i % 2)], [18 + i * 7, 32], [21 + i * 7, 44]], 1.4, '#fff0e0');
    L.ellipse(12, 30, 6, 5, '#f07a3a');
    L.ellipse(8, 32, 3, 2.4, '#e06a30');
    eye(L, 11, 28);
    for (const x of [20, 30, 40, 48]) L.rect(x, 43, 4, 5, '#d8602a');
    L.path([[6, 30], [2, 22], [4, 18]], 1, '#6cb84a');
    L.circle(4, 18, 1.4, '#6cb84a');
  });
  card('foraging', ['#b8d8a0', '#2a3a1a', '#fffbe0', 0.35], (L) => {
    L.rect(0, 42, W, 12, '#a8c070');
    const skin = '#8ab0e0';
    L.ellipse(38, 34, 16, 7, skin);
    L.ellipse(20, 38, 7, 4.5, skin);
    for (let i = 0; i < 4; i++) L.path([[30 + i * 5, 28], [32 + i * 5, 34], [30 + i * 5, 40]], 1.4, '#e0703a');
    for (const x of [28, 36, 46, 50]) L.line(x, 39, x - 1, 45, 2.4, skin);
    L.path([[54, 34], [62, 38], [64, 44]], 2, skin);
    eye(L, 17, 36);
    for (const [x, y] of [[8, 46], [12, 49], [18, 47], [24, 50], [6, 50]]) { L.circle(x, y, 2, '#5ab040'); L.px(x - 1, y - 1, '#a8f080'); }
  });
  card('cooperation', ['#c8e890', '#2a4a1a', '#fffbe0', 0.3], (L) => {
    L.rect(0, 48, W, 6, '#e0d8c0');
    const ant = (x, y, a) => {
      const ux = Math.cos(a); const uy = Math.sin(a);
      for (const [k, r] of [[-3, 1.6], [0, 1.4], [3, 2]]) L.circle(x + ux * k, y + uy * k, r, '#d8401a');
      for (const k of [-1, 1]) L.line(x, y, x - uy * 3 * k + ux, y + ux * 3 * k + uy, 1, '#a8300a');
    };
    const pts = [[12, 46, -0.9], [18, 40, -1.0], [22, 33, -1.2], [26, 26, -1.3], [30, 19, -1.4], [34, 44, -2.2], [30, 38, -2.0], [38, 30, -1.8]];
    for (const [x, y, a] of pts) ant(x, y, a);
    L.line(32, 14, 32, 4, 1, '#4a8a2a');
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [0, 0]]) L.circle(32 + dx, 5 + dy, 1.6, '#a060d0');
  });
  card('scavenger', ['#f0e0c0', '#5a4a30', '#fffaf0'], (L) => {
    L.rect(0, 44, W, 10, '#d8c090');
    const bone = '#f4ecd8';
    L.path([[10, 36], [22, 30], [36, 30], [50, 34]], 2, bone);
    for (let i = 0; i < 6; i++) L.path([[20 + i * 5, 31], [18 + i * 5, 38], [21 + i * 5, 43]], 1.2, bone);
    L.ellipse(54, 36, 6, 4, bone);
    L.circle(53, 35, 1.2, INK);
    L.poly([[58, 38], [64, 40], [58, 41]], bone);
    for (const x of [14, 44]) L.line(x, 38, x - 2, 45, 1.6, bone);
    L.ellipse(22, 14, 7, 4, '#5a4a6a');
    L.poly([[16, 14], [2, 8], [14, 18]], '#4a3a5a');
    L.poly([[28, 14], [42, 6], [30, 18]], '#4a3a5a');
    L.circle(22, 10, 2.4, '#e0a0a0');
    L.poly([[20, 10], [17, 12], [20, 12]], '#f0c040');
  });

  function renderCard(key) {
    const d = CARD[key];
    if (!d) throw new Error(`unknown card ${key}`);
    const [top, bottom, glow, gy] = d.bg;
    return compose(background(hash(key), top, bottom, glow, gy), d.draw);
  }

  // ───────────────────────── misc ─────────────────────────
  function renderBack() {
    const B = SPECS.back;
    const r = rng(hash('back'));
    const cv = new Canvas(B.w, B.h).fill((x, y) => {
      const d = Math.hypot((x - 33) / 33, (y - 47) / 47);
      const c = mix('#4a8a4a', '#16301a', Math.min(1, d));
      const n = (r() - 0.5) * 10;
      return [c[0] + n, c[1] + n, c[2] + n];
    });
    const L = new Canvas(B.w, B.h);
    L.rect(2, 2, 62, 1, '#e8c070').rect(2, 91, 62, 1, '#e8c070').rect(2, 2, 1, 90, '#e8c070').rect(63, 2, 1, 90, '#e8c070');
    L.circle(33, 47, 16, '#e8c070').circle(33, 47, 14, '#1f4a2a');
    L.poly([[33, 34], [42, 44], [33, 60], [24, 44]], '#7ac050');
    L.line(33, 36, 33, 58, 1, '#2a5a1a');
    for (const [x, y] of [[20, 20], [46, 20], [20, 74], [46, 74]]) {
      L.circle(x, y, 3, '#e8c070');
      L.circle(x - 3, y - 4, 1.3, '#e8c070'); L.circle(x, y - 5, 1.3, '#e8c070'); L.circle(x + 3, y - 4, 1.3, '#e8c070');
    }
    return cv.draw(L);
  }

  function renderFelt() {
    const F = SPECS.felt;
    const r = rng(hash('felt'));
    const cv = new Canvas(F.w, F.h).fill((x, y) => {
      const d = Math.hypot((x - F.w / 2) / (F.w / 2), (y - F.h / 2) / (F.h / 2));
      const c = mix('#3f7a4a', '#1b3a22', Math.min(1, d * 0.9));
      const n = (r() - 0.5) * 10;
      return [c[0] + n, c[1] + n * 1.2, c[2] + n];
    });
    const r2 = rng(hash('tufts'));
    for (let i = 0; i < 70; i++) {
      const x = r2() * F.w; const y = r2() * F.h;
      for (let k = -1; k <= 1; k++) cv.line(x + k * 1.5, y, x + k * 2.5, y - 3 - r2() * 2, 1, '#8ac070', 0.18);
    }
    return cv;
  }

  function renderPond() {
    const P = SPECS.pond;
    const cv = new Canvas(P.w, P.h);
    const L = new Canvas(P.w, P.h);
    L.ellipse(32, 21, 30, 17, '#8a6a3a');
    L.ellipse(32, 21, 26, 14, '#3a8ac8');
    L.ellipse(28, 17, 16, 7, '#6ab8e8');
    L.ellipse(24, 15, 6, 2, '#c8ecff');
    for (const [x, y] of [[6, 10], [58, 12], [10, 34], [56, 32], [32, 4]]) { L.circle(x, y, 3, '#4f9a3a'); L.circle(x + 2, y - 1, 2, '#6cb84a'); }
    for (const [x, y] of [[40, 26], [18, 26]]) { L.ellipse(x, y, 3, 1.6, '#4f9a3a'); L.px(x, y - 1, '#f0a0c0'); }
    return cv.draw(L.outline(INK));
  }

  /** เรนเดอร์ภาพตามประเภท คืน Canvas ขนาดขยายพร้อมบันทึก */
  function render(kind, id) {
    if (kind === 'cards') return renderCard(id).scale(SPECS.cards.scale);
    if (kind === 'misc' && id === 'back') return renderBack().scale(SPECS.back.scale);
    if (kind === 'misc' && id === 'felt') return renderFelt().scale(SPECS.felt.scale);
    if (kind === 'misc' && id === 'pond') return renderPond().scale(SPECS.pond.scale);
    throw new Error(`unknown art ${kind}/${id}`);
  }

  return { VERSION, SPECS, CARD_KEYS: Object.keys(CARD), MISC_KEYS: ['back', 'felt', 'pond'], render, renderCard, renderBack, renderFelt, renderPond };
}));
