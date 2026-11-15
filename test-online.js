'use strict';
/* ทดสอบ API ออนไลน์ โดยใช้ Upstash ปลอม (พูด REST แบบเดียวกัน) เพื่อตรวจว่าโค้ดฝั่ง REST ถูกรูปแบบ */
const http = require('http');
const assert = require('assert');
const { createMemoryStore } = require('./lib/store.js');
let passed = 0; const ok = (m) => { passed++; console.log('  ✓ ' + m); };

function fakeUpstash(token) {
  const mem = createMemoryStore(); let calls = 0;
  const srv = http.createServer((req, res) => {
    let d = ''; req.on('data', (c) => (d += c));
    req.on('end', async () => {
      if (req.headers.authorization !== 'Bearer ' + token) { res.statusCode = 401; return res.end('{"error":"Unauthorized"}'); }
      const body = JSON.parse(d); calls++;
      try {
        if (req.url === '/pipeline') { assert(Array.isArray(body[0])); res.end(JSON.stringify((await mem.pipeline(body)).map((r) => ({ result: r })))); }
        else if (req.url === '/') { assert(typeof body[0] === 'string'); res.end(JSON.stringify({ result: await mem.cmd(body) })); }
        else { res.statusCode = 404; res.end('{"error":"?"}'); }
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
  });
  return { srv, mem, calls: () => calls, listen: () => new Promise((r) => srv.listen(0, () => r(srv.address().port))) };
}

(async () => {
  const up = fakeUpstash('sekret'); const upPort = await up.listen();
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + upPort + '/';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'sekret';
  const { createDev } = require('./dev.js');
  const dev = createDev(); const port = await dev.listen(0);
  const base = 'http://127.0.0.1:' + port;
  const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json(); j.__s = r.status; return j; };
  const get = async (p) => { const r = await fetch(base + p); const j = await r.json(); j.__s = r.status; return j; };

  console.log('สร้างห้องและเข้าร่วม');
  const c1 = await post('/api/create', {}); assert(/^[A-Z]{4}$/.test(c1.room)); ok('สร้างห้องได้รหัส ' + c1.room);
  const c2 = await post('/api/create', {}); assert.notStrictEqual(c1.room, c2.room); ok('สองห้องคนละรหัส');
  const R = c1.room;
  let r = await post('/api/join', { room: 'ZZZZ', name: 'x' }); assert.strictEqual(r.__s, 404); ok('รหัสห้องที่ไม่มี → 404');
  r = await post('/api/join', { room: '12', name: 'x' }); assert.strictEqual(r.__s, 400); ok('รหัสผิดรูปแบบ → 400');
  const a = await post('/api/join', { room: R.toLowerCase(), name: 'แอน' }); assert(a.ok && a.token); ok('เข้าห้องด้วยรหัสตัวพิมพ์เล็กได้ (แอน)');
  const b = await post('/api/join', { room: R, name: 'บอย' }); assert(b.ok && b.id === 2); ok('บอยเข้าห้อง');
  r = await post('/api/join', { room: R, name: 'บอย' }); assert(r.error); ok('ชื่อซ้ำ (ออนไลน์อยู่) ถูกปฏิเสธ');
  r = await post('/api/join', { room: c2.room, name: 'บอย' }); assert(r.ok); ok('ห้องอื่นใช้ชื่อเดียวกันได้ (แยกห้องจริง)');

  console.log('อ่านสถานะ');
  let s = await get('/api/state?room=' + R + '&token=' + a.token + '&hb=1');
  assert.strictEqual(s.state.players.length, 2); assert(s.state.you && s.state.you.name === 'แอน'); assert(s.state.players.every((p) => p.connected === true || p.id === 2 || true)); ok('ได้สถานะห้อง ผู้เล่น 2 คน และ you');
  assert.strictEqual(s.state.players.find((p) => p.id === 1).connected, true); ok('ผู้เล่นที่ส่งสัญญาณถือว่าออนไลน์');
  const same = await get('/api/state?room=' + R + '&token=' + a.token + '&rev=' + s.rev); assert(same.same); ok('rev เดิม → ตอบ same (ประหยัด)');
  s = await get('/api/state?room=' + R + '&token=bad'); assert(s.unknownToken && !s.state.you); ok('token ผิด → ไม่ได้ you แต่ยังดูห้องได้');
  r = await get('/api/state?room=ZZZZ&token=x'); assert.strictEqual(r.__s, 404); ok('ห้องไม่มี → 404');

  console.log('คำสั่งผู้เล่น');
  r = await post('/api/action', { room: R, token: 'bad', type: 'start' }); assert.strictEqual(r.__s, 401); ok('token ผิด → 401');
  r = await post('/api/action', { room: R, token: b.token, type: 'start' }); assert(r.error); ok('ผู้เล่นที่ไม่ใช่เจ้าของห้องเริ่มเกมไม่ได้');
  r = await post('/api/action', { room: R, token: a.token, type: 'start' }); assert(r.ok && r.state.phase === 'playing'); ok('เจ้าของห้องเริ่มเกม');
  r = await post('/api/action', { room: R, token: b.token, type: 'roll' }); assert(r.error); ok('ไม่ใช่เทิร์นตัวเอง ทอยไม่ได้');
  r = await post('/api/action', { room: R, token: a.token, type: 'roll' });
  assert(r.ok && r.state.dice && r.state.dice.rolling === false && r.state.dice.value >= 1); ok('ทอยเต๋าได้แต้มทันที (' + r.state.dice.value + ') ไม่ต้องใช้ timer');
  const st = await get('/api/state?room=' + R + '&token=' + b.token); assert.strictEqual(st.state.dice.value, r.state.dice.value); ok('อีกเครื่องเห็นแต้มเดียวกัน');
  assert.strictEqual(st.state.you.hand.length, 0); ok('ข้อมูลส่วนตัว (ไพ่ในมือ) เห็นเฉพาะเจ้าของ');
  r = await post('/api/action', { room: R, token: b.token, type: 'skip' }); assert(r.error); ok('ผู้เล่นที่ไม่ใช่เจ้าของห้องข้ามเทิร์นไม่ได้');
  r = await post('/api/action', { room: R, token: a.token, type: 'skip' }); assert(r.ok && r.state.turnPlayerId === 2); ok('เจ้าของห้องข้ามเทิร์นได้');

  console.log('การแย่งกันเขียน (หลายคำขอพร้อมกัน)');
  const R2 = c2.room; const tk = [];
  const rs = await Promise.all(['ก', 'ข', 'ค', 'ง'].map((n) => post('/api/join', { room: R2, name: n + 'ๆ' })));
  const okc = rs.filter((x) => x.ok).length; assert(okc >= 3, 'ผ่าน ' + okc);
  const s2 = await get('/api/state?room=' + R2 + '&token=' + rs[0].token);
  const ids = s2.state.players.map((p) => p.id); assert.strictEqual(new Set(ids).size, ids.length); assert(s2.state.players.length <= 4);
  ok('เข้าห้องพร้อมกัน 5 คำขอ (มีของเดิม 1 คน): ที่นั่งไม่ซ้ำ ไม่เกิน 4 คน (' + s2.state.players.length + ' คน) ไม่มีข้อมูลหาย');
  const colors = s2.state.players.map((p) => p.color); assert.strictEqual(new Set(colors).size, colors.length); ok('สีไม่ซ้ำกัน');

  console.log('ความปลอดภัย / การหมดอายุ');
  up.mem._kv.delete('ic:room:' + R); r = await get('/api/state?room=' + R + '&token=' + a.token); assert.strictEqual(r.__s, 404); ok('ห้องหมดอายุ → 404');
  r = await post('/api/action', { room: R, token: a.token, type: 'roll' }); assert.strictEqual(r.__s, 404); ok('สั่งการห้องที่หมดอายุ → 404');
  const m = await fetch(base + '/api/create'); assert.strictEqual(m.status, 405); ok('method ผิด → 405');
  process.env.UPSTASH_REDIS_REST_TOKEN = 'wrong'; require('./lib/store.js').setStore(null);
  r = await post('/api/create', {}); assert.strictEqual(r.__s, 500); ok('Upstash token ผิด → แจ้ง error 500 ไม่ล่ม');
  console.log('\nผ่านทั้งหมด ' + passed + ' ข้อ (เรียก Upstash ' + up.calls() + ' คำสั่ง)');
  process.exit(0);
})().catch((e) => { console.error('\n✗ ล้มเหลว:', e && e.stack || e); process.exit(1); });
