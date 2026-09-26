'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildAll, manifestFor, allSlots, ART_DIR } = require('../scripts/build-art');
const { createServer } = require('../server');
const { TRAITS } = require('../server/game/cards');

test('every trait card, the card back, table felt and watering hole have saved artwork', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8'));
  const slots = allSlots();
  for (const id of Object.keys(TRAITS)) assert.ok(slots.some(([k, i]) => k === 'cards' && i === id), `slot for ${id}`);
  for (const [kind, id] of slots) {
    const rel = `${kind}/${id}.png`;
    assert.ok(manifest.items[`${kind}/${id}`], `manifest lists ${rel}`);
    const buf = fs.readFileSync(path.join(ART_DIR, rel));
    assert.strictEqual(buf.subarray(1, 4).toString('ascii'), 'PNG');
    assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), manifest.sha256[rel], `${rel} fingerprint`);
  }
});

test('saved artwork is exactly what the generator draws (tamper check)', () => {
  const a = buildAll();
  const b = buildAll();
  for (const rel of Object.keys(a)) assert.ok(a[rel].equals(b[rel]), `${rel} renders deterministically`);
  for (const [rel, buf] of Object.entries(a)) {
    assert.ok(fs.readFileSync(path.join(ART_DIR, rel)).equals(buf), `${rel} was modified — run npm run build:art`);
  }
  const expected = JSON.stringify(manifestFor(a), null, 2) + '\n';
  assert.strictEqual(fs.readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8'), expected, 'manifest.json is generated');
  const onDisk = fs.readdirSync(ART_DIR, { recursive: true }).filter((f) => f.endsWith('.png')).map((f) => f.split(path.sep).join('/'));
  assert.deepStrictEqual(onDisk.sort(), Object.keys(a).sort(), 'no extra images in public/art');
});

test('art, gallery and card database are read-only over HTTP', async () => {
  const { server, rooms } = createServer({});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const img = await fetch(`${base}/art/cards/carnivore.png`);
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.strictEqual((await fetch(`${base}/gallery.html`)).status, 200);
    for (const [method, url] of [['PUT', '/art/cards/carnivore.png'], ['POST', '/art/cards/carnivore.png'], ['DELETE', '/art/cards/carnivore.png'], ['POST', '/art/manifest.json'], ['POST', '/api/art'], ['POST', '/upload']]) {
      const r = await fetch(base + url, { method, body: method === 'DELETE' ? undefined : 'x' });
      assert.strictEqual(r.status, 404, `${method} ${url} is not writable`);
    }
    const after = fs.readFileSync(path.join(ART_DIR, 'cards', 'carnivore.png'));
    assert.ok(after.equals(Buffer.from(await img.arrayBuffer())));
  } finally {
    for (const r of rooms.rooms.values()) rooms.destroy(r);
    await new Promise((r) => server.close(r));
  }
});
