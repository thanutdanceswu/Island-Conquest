'use strict';
/* เล่นจริงผ่านเบราว์เซอร์มือถือจำลอง 2 เครื่อง ผ่าน API แบบ Vercel (หน่วยความจำแทน Redis) */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { createDev } = require('./dev.js');
const { getStore } = require('./lib/store.js');
const BD = require('./public/board.js');
const SHOTS = path.join(__dirname, '..', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0; const ok = (m) => { passed++; console.log('  ✓ ' + m); };
const dice = [];
global.__IC_RANDINT = (n) => (n === 6 && dice.length ? dice.shift() - 1 : crypto.randomInt(0, n));

(async () => {
  const dev = createDev(); const port = await dev.listen(0);
  const url = 'http://127.0.0.1:' + port + '/';
  const browser = await chromium.launch(); const errors = [];
  async function phone(name, hash) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true });
    await ctx.addInitScript(() => { window.__pollMs = 250; });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.goto(url + (hash || '')); return page;
  }
  let ROOM = '';
  const key = () => 'ic:room:' + ROOM;
  const getG = async () => JSON.parse(await getStore().cmd(['GET', key()])).g;
  const mutate = async (fn) => { const w = JSON.parse(await getStore().cmd(['GET', key()])); fn(w.g); w.rev++; await getStore().cmd(['SET', key(), JSON.stringify(w)]); };
  const tapCell = async (page, cell) => { const c = await page.evaluate((c) => window.__ic.board.cellToClient(c), cell); await page.mouse.click(c.x, c.y); };
  const until = async (fn, msg, t = 6000) => { const s = Date.now(); while (Date.now() - s < t) { if (await fn()) return; await sleep(60); } throw new Error('timeout: ' + msg); };

  console.log('สร้างห้อง / เข้าห้องด้วยลิงก์');
  const A = await phone('A');
  await A.waitForSelector('[data-act="createRoom"]'); ok('หน้าแรกมีปุ่มสร้างห้อง/ใส่รหัส');
  await A.click('[data-act="enterRoom"]'); await A.waitForSelector('.err'); ok('ไม่ใส่รหัสแล้วกดเข้าห้อง → แจ้งเตือน');
  await A.fill('#roomcode', 'QQQQ'); await A.click('[data-act="enterRoom"]');
  await A.waitForSelector('.err >> text=ไม่พบห้อง', { timeout: 4000 }); ok('รหัสที่ไม่มีห้อง → บอกว่าไม่พบห้อง กลับหน้าแรก');
  await A.click('[data-act="createRoom"]'); await A.waitForSelector('#name');
  ROOM = await A.evaluate(() => window.__ic.ui.room); assert(/^[A-Z]{4}$/.test(ROOM)); ok('สร้างห้อง ' + ROOM);
  assert.strictEqual(await A.evaluate(() => location.hash), '#' + ROOM); ok('รหัสห้องอยู่ใน URL (#รหัส) ส่งลิงก์ได้');
  await A.fill('#name', 'แอน'); await A.click('[data-act="join"]'); await A.waitForSelector('.bigcode'); ok('แอนเข้าห้อง เห็นรหัสห้องใหญ่ๆ และปุ่มคัดลอกลิงก์');
  const B = await phone('B', '#' + ROOM);
  await B.waitForSelector('#name'); assert(/ห้อง/.test(await B.innerText('.roombadge')) && (await B.innerText('.roombadge')).includes(ROOM)); ok('บอยเปิดลิงก์เชิญ → เข้าห้องเดียวกันอัตโนมัติ');
  await B.fill('#name', 'บอย'); await B.click('[data-act="join"]'); await B.waitForSelector('.colors');
  await B.click('[data-act="setColor"][data-color="green"]');
  await until(async () => (await getG()).players[1].color === 'green', 'สี'); ok('บอยเลือกเต่า');
  await A.waitForSelector('.roster >> text=บอย', { timeout: 4000 }); ok('แอนเห็นบอยเข้าห้อง (polling)');
  await A.click('[data-act="start"]');
  await A.waitForSelector('#gBoard .tk'); await B.waitForSelector('#gBoard .tk', { timeout: 4000 }); ok('เริ่มเกม: ทั้งสองเครื่องเห็นกระดาน');

  console.log('รีเฟรชหน้า = กลับเข้าที่นั่งเดิม');
  await B.reload(); await B.waitForSelector('#gBoard .tk'); assert.strictEqual(await B.evaluate(() => window.__ic.state.you.name), 'บอย'); ok('บอยรีเฟรช → กลับเข้าเกมเดิมด้วย token ที่จำไว้');

  console.log('ทอยและเดิน');
  dice.push(3);
  await A.click('[data-act="roll"]'); await A.waitForSelector('[data-act="confirmMove"]');
  await tapCell(A, 0); await sleep(150); await tapCell(A, 3); await sleep(150);
  await A.click('[data-act="confirmMove"]');
  await until(async () => (await getG()).players[0].pieces[0].pos === 3, 'เดิน'); ok('เดิน A1→D1 ตามแต้ม 3');
  await A.click('[data-act="endTurn"]');
  await B.waitForSelector('[data-act="roll"]:not([disabled])', { timeout: 4000 }); ok('บอยเห็นว่าถึงเทิร์นตัวเองผ่าน polling');
  dice.push(6);
  await B.click('[data-act="roll"]'); await B.waitForSelector('[data-act="six"][data-choice="release"]');
  await B.click('[data-act="six"][data-choice="release"]');
  await until(async () => (await getG()).players[1].pieces.filter((p) => p.pos >= 0).length === 2, 'ปล่อยตัว'); ok('ทอย 6 → นำตัวออกจากฐาน');
  await B.click('[data-act="endTurn"]'); await A.waitForSelector('[data-act="roll"]:not([disabled])', { timeout: 4000 });

  console.log('ไพ่เตะ + โล่ + ผ่าน');
  await mutate((g) => {
    g.players[0].hand = [{ uid: 'k1', id: 'kickOut' }, { uid: 'k2', id: 'kickOut' }, { uid: 'st', id: 'steal' }];
    g.players[1].hand = [{ uid: 'sh', id: 'shield' }, { uid: 'sp', id: 'stop' }];
    g.players[1].pieces[0].pos = 5;
  });
  await A.waitForSelector('.hc >> nth=2', { timeout: 4000 });
  await A.click('.hc[aria-label="เตะออก"] >> nth=0'); await A.click('[data-act="useCard"]');
  await tapCell(A, 5); await sleep(150); await A.click('[data-act="confirmCard"]');
  await B.waitForSelector('.sheet [data-act="pass"]', { timeout: 4000 }); ok('บอยได้หน้าต่างตอบโต้');
  await A.screenshot({ path: path.join(SHOTS, 'o1-wait.png') });
  await B.screenshot({ path: path.join(SHOTS, 'o2-react.png') });
  await B.click('.sheet [data-act="react"][data-card="shield"]');
  await until(async () => { const g = await getG(); return g.frames.length === 0 && g.players[1].pieces[0].pos === 5; }, 'โล่'); ok('บอยใช้โล่ → ตัวเล่นยังอยู่');
  await A.waitForSelector('#gPanel >> text=ถึงเทิร์นของคุณ', { timeout: 4000 });
  await A.click('.hc[aria-label="เตะออก"]'); await A.click('[data-act="useCard"]');
  await tapCell(A, 5); await A.click('[data-act="confirmCard"]');
  await B.waitForSelector('.sheet [data-act="pass"]'); await B.click('.sheet [data-act="pass"]');
  await until(async () => (await getG()).players[1].pieces[0].pos === -1, 'ถูกเตะ'); ok('บอยกดผ่าน → ถูกเตะกลับฐาน');
  await A.click('.hc[aria-label="ขอขโมยหน่อยน้า"]'); await A.click('[data-act="useCard"]'); await A.click('[data-act="pickPlayer"]'); await A.click('[data-act="confirmCard"]');
  await B.waitForSelector('.sheet [data-act="react"][data-card="stop"]'); await B.click('.sheet [data-act="react"][data-card="stop"]');
  await until(async () => { const g = await getG(); return g.frames.length === 0 && g.players[1].hand.length === 0; }, 'หยุด'); ok('บอยใช้ “หยุดเดี๋ยวนี้” ยกเลิกการขโมย');

  console.log('เจ้าของห้องข้ามเทิร์น + จบเกม');
  await A.click('#gTop [data-act="rules"]'); await A.waitForSelector('[data-act="hostSkip"]'); ok('เจ้าของห้องเห็นเครื่องมือข้ามเทิร์นใน 📖');
  await B.click('#gTop [data-act="rules"]'); assert.strictEqual(await B.locator('[data-act="hostSkip"]').count(), 0); ok('ผู้เล่นอื่นไม่เห็นเครื่องมือนี้');
  assert.strictEqual(await B.locator('[data-act="endGame"]').count(), 0); assert.strictEqual(await B.locator('[data-act="exitRoom"]').count(), 1); ok('ผู้เล่นทั่วไปเห็นปุ่มออกจากห้อง แต่ไม่เห็นปุ่มจบเกม');
  assert.strictEqual(await A.locator('[data-act="endGame"]').count(), 1); ok('เจ้าของห้องเห็นปุ่มจบเกมกลางคัน');
  await B.click('.modal .x');
  await A.click('.modal .x');
  let startCell = -1;
  for (let c = 0; c < BD.CELLS && startCell < 0; c++) if (!BD.island[c] && !BD.safe[c] && BD.dist(c, BD.ISLANDS[3]) === 3 && BD.findPath(c, BD.ISLANDS[3], 3)) startCell = c;
  await mutate((g) => {
    g.players[0].pieces[0].pos = BD.ISLANDS[0]; g.players[0].pieces[1].pos = BD.ISLANDS[1]; g.players[0].pieces[2].pos = BD.ISLANDS[2]; g.players[0].pieces[3].pos = startCell;
    g.players[0].pieces.forEach((pc, i) => { pc.arrive = 500 + i; });
    g.players[1].pieces.forEach((pc) => { pc.pos = -1; }); g.players[1].pieces[0].pos = 0;
  });
  await sleep(600);
  dice.push(3);
  await A.click('[data-act="roll"]'); await A.waitForSelector('[data-act="confirmMove"]');
  await tapCell(A, startCell); await sleep(100); await tapCell(A, BD.ISLANDS[3]); await sleep(100);
  await A.click('[data-act="confirmMove"]');
  await A.waitForSelector('.ttable', { timeout: 4000 }); await B.waitForSelector('.ttable', { timeout: 4000 });
  ok('ครอง 4 เกาะ → จบเกม ทั้งสองเครื่องเห็นผล');
  await sleep(500); await B.screenshot({ path: path.join(SHOTS, 'o3-over.png') });
  await A.click('[data-act="reset"]'); await B.waitForSelector('.colors', { timeout: 4000 }); ok('เริ่มรอบใหม่ → ทุกคนกลับห้องรอ');

  console.log('จบเกมกลางคัน / ออกจากห้อง');
  await A.click('[data-act="start"]'); await A.waitForSelector('#gBoard .tk'); await B.waitForSelector('#gBoard .tk', { timeout: 4000 });
  A.once('dialog', (d) => d.accept()); B.once('dialog', (d) => d.accept());
  await A.click('#gTop [data-act="rules"]'); await A.click('[data-act="endGame"]');
  await A.waitForSelector('.colors'); await B.waitForSelector('.colors', { timeout: 4000 }); ok('เจ้าของห้องจบเกมกลางคัน → ทุกคนกลับห้องรอ');
  await B.click('[data-act="leave"]'); await B.waitForSelector('#name'); ok('ห้องรอ: ออกจากห้องได้ (ปุ่มเดิม)');
  await B.fill('#name', 'บอย'); await B.click('[data-act="join"]'); await B.waitForSelector('.colors');
  await A.click('[data-act="start"]'); await B.waitForSelector('#gBoard .tk', { timeout: 4000 });
  await B.click('#gTop [data-act="rules"]'); await B.click('[data-act="exitRoom"]');
  await B.waitForSelector('[data-act="createRoom"]'); assert.strictEqual(await B.evaluate(() => window.__ic.ui.room), ''); ok('ระหว่างเล่น: ผู้เล่นกด “ออกจากห้องนี้” → กลับหน้าแรก');
  assert.strictEqual((await getG()).players.length, 2); ok('ที่นั่งของเขายังอยู่ในห้อง (กลับมาได้)');
  assert.deepStrictEqual(errors, [], errors.join('\n')); ok('ไม่มี JS error');
  await browser.close(); console.log('\nผ่านทั้งหมด ' + passed + ' ข้อ'); process.exit(0);
})().catch((e) => { console.error('\n✗ ล้มเหลว:', e && e.stack || e); process.exit(1); });
