'use strict';
const { chromium } = require('playwright');
const { createDev } = require('./dev.js');
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dev = createDev(); const port = await dev.listen(0);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true });
  const p = await ctx.newPage(); const errs = [], reqs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('response', (r) => { if (/\/audio\//.test(r.url())) reqs.push(r.url().split('/').pop() + ':' + r.status()); });
  await p.goto('http://127.0.0.1:' + port + '/'); await p.waitForSelector('[data-act="createRoom"]');
  assert.strictEqual(reqs.length, 0); console.log('  ✓ ก่อนแตะจอ ยังไม่โหลดเสียง (ไม่กินเน็ตก่อนจำเป็น)');
  await p.click('[data-act="createRoom"]'); await sleep(1200);
  assert(reqs.some((r) => r === 'waves.mp3:200') && reqs.some((r) => r === 'bgm.mp3:200'), reqs.join()); console.log('  ✓ แตะครั้งแรกแล้วโหลดเสียงคลื่น + เพลงพื้นหลังสำเร็จ (200)');
  const playing = await p.evaluate(() => typeof window.IC.audio.isOn === 'function' && window.IC.audio.isOn());
  assert(playing); assert.strictEqual(await p.textContent('#sndFloat'), '🔊'); console.log('  ✓ ปุ่มเสียงลอยแสดง 🔊');
  await p.click('#sndFloat'); assert.strictEqual(await p.textContent('#sndFloat'), '🔇');
  assert.strictEqual(await p.evaluate(() => localStorage.getItem('ic_sound')), '0'); console.log('  ✓ กดปิดเสียง → 🔇 และจำค่าไว้');
  await p.reload(); await p.waitForSelector('#sndFloat'); assert.strictEqual(await p.textContent('#sndFloat'), '🔇'); console.log('  ✓ รีเฟรชแล้วยังปิดเสียงอยู่');
  await p.evaluate(() => window.IC.audio.sfx('dice')); // ปิดอยู่ต้องไม่ error
  await p.click('#sndFloat'); assert.strictEqual(await p.textContent('#sndFloat'), '🔊');
  await p.evaluate(() => { ['dice', 'step', 'kick', 'release', 'shield', 'reflect', 'swap', 'steal', 'card', 'alert', 'turn', 'win'].forEach((n) => window.IC.audio.sfx(n)); });
  await sleep(300); console.log('  ✓ เปิดกลับ + เรียกเสียงเอฟเฟกต์ทั้ง 12 แบบ ไม่เกิด error');
  assert.deepStrictEqual(errs, [], errs.join('\n')); console.log('  ✓ ไม่มี JS error');
  await b.close(); process.exit(0);
})().catch((e) => { console.error('✗', e.stack || e); process.exit(1); });
