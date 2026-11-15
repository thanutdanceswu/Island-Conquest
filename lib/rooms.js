'use strict';
/*
 * จัดการห้อง: โหลดสถานะจาก store → ให้เอนจินทำงาน → เซฟกลับ (มีล็อกกันสองคนกดพร้อมกัน)
 * ทุกคำขอสร้างเอนจินใหม่จากสถานะที่เก็บไว้ เพราะ serverless จำอะไรข้ามคำขอไม่ได้
 */
const crypto = require('crypto');
const { createGame } = require('../game.js');
const { getStore } = require('./store.js');

const ROOM_TTL = 60 * 60 * 24;     // ห้องอยู่ได้ 24 ชั่วโมงนับจากการเล่นล่าสุด
const PRESENCE_MS = 25000;         // ถือว่าออนไลน์ถ้าส่งสัญญาณในช่วงนี้
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ไม่มี I, O กันสับสน
const err = (msg, status) => ({ error: msg, status: status || 400 });

const key = (code) => 'ic:room:' + code;
const lockKey = (code) => 'ic:lock:' + code;
const presKey = (code) => 'ic:pres:' + code;

function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeGame(state, isConn) {
  const g = createGame({ instantRoll: true, randInt: global.__IC_RANDINT });
  if (state) g.setState(state);
  return g;
}

async function load(code) {
  const raw = await getStore().cmd(['GET', key(code)]);
  return raw ? JSON.parse(raw) : null; // { rev, g }
}

async function save(code, wrap) {
  await getStore().cmd(['SET', key(code), JSON.stringify(wrap), 'EX', String(ROOM_TTL)]);
}

async function withLock(code, fn) {
  const st = getStore(), me = crypto.randomBytes(8).toString('hex');
  let got = false;
  for (let i = 0; i < 40 && !got; i++) {
    got = (await st.cmd(['SET', lockKey(code), me, 'NX', 'PX', '6000'])) === 'OK';
    if (!got) await sleep(60 + Math.random() * 60);
  }
  if (!got) return err('เซิร์ฟเวอร์กำลังยุ่ง ลองใหม่อีกครั้ง', 503);
  try { return await fn(); }
  finally { try { if ((await st.cmd(['GET', lockKey(code)])) === me) await st.cmd(['DEL', lockKey(code)]); } catch (e) { /* ล็อกหมดอายุเองใน 6 วินาที */ } }
}

async function presence(code) {
  const flat = (await getStore().cmd(['HGETALL', presKey(code)])) || [];
  const m = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = Number(flat[i + 1]);
  else Object.assign(m, flat);
  return m;
}
async function beat(code, token) {
  await getStore().pipeline([['HSET', presKey(code), token, String(Date.now())], ['EXPIRE', presKey(code), String(ROOM_TTL)]]);
}
const connFn = (m) => (token) => !!m[token] && Date.now() - m[token] < PRESENCE_MS;

// ---- สร้างห้อง
async function createRoom() {
  const st = getStore();
  for (let i = 0; i < 30; i++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
    const g = makeGame(null);
    const wrap = { rev: 1, g: g.getState() };
    const ok = await st.cmd(['SET', key(code), JSON.stringify(wrap), 'NX', 'EX', String(ROOM_TTL)]);
    if (ok === 'OK') return { ok: true, room: code };
  }
  return err('สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง', 503);
}

// ---- เข้าร่วม
async function join(code, body) {
  code = normCode(code);
  if (code.length !== 4) return err('รหัสห้องต้องเป็นตัวอักษร 4 ตัว');
  return withLock(code, async () => {
    const wrap = await load(code);
    if (!wrap) return err('ไม่พบห้องรหัสนี้ (ห้องหมดอายุหรือพิมพ์ผิด)', 404);
    const pres = await presence(code);
    const game = makeGame(wrap.g);
    const r = game.join({ name: body.name, token: body.token }, connFn(pres));
    if (r.error) return r;
    wrap.g = game.getState(); wrap.rev++;
    await save(code, wrap);
    await beat(code, r.token);
    return { ok: true, token: r.token, id: r.id, room: code };
  });
}

// ---- อ่านสถานะ (ไม่ล็อก)
async function readState(code, token, heartbeat, knownRev) {
  code = normCode(code);
  if (code.length !== 4) return err('รหัสห้องไม่ถูกต้อง');
  const st = getStore();
  const cmds = [['GET', key(code)], ['HGETALL', presKey(code)]];
  if (heartbeat && token) cmds.push(['HSET', presKey(code), token, String(Date.now())]);
  const res = await st.pipeline(cmds);
  if (!res[0]) return err('ไม่พบห้อง (หมดอายุหรือถูกลบ)', 404);
  const wrap = JSON.parse(res[0]);
  const flat = res[1] || [], m = {};
  for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = Number(flat[i + 1]);
  if (heartbeat && token) m[token] = Date.now();
  if (knownRev != null && Number(knownRev) === wrap.rev && !heartbeat) return { ok: true, same: true, rev: wrap.rev };
  const game = makeGame(wrap.g);
  const state = game.snapshot(token, false, connFn(m));
  if (token && !state.you) return { ok: true, rev: wrap.rev, state: state, unknownToken: true };
  return { ok: true, rev: wrap.rev, state: state };
}

// ---- คำสั่งผู้เล่น
const OWNER_ACTIONS = { skip: true, forcePass: true };

async function action(code, token, body) {
  code = normCode(code);
  if (code.length !== 4) return err('รหัสห้องไม่ถูกต้อง');
  if (!token) return err('ไม่พบผู้เล่น — กรุณาเข้าร่วมห้องใหม่', 401);
  return withLock(code, async () => {
    const wrap = await load(code);
    if (!wrap) return err('ไม่พบห้อง (หมดอายุหรือถูกลบ)', 404);
    const pres = await presence(code);
    pres[token] = Date.now();
    const game = makeGame(wrap.g);
    const snap0 = game.snapshot(token, false, connFn(pres));
    if (!snap0.you) return err('ไม่พบผู้เล่น — กรุณาเข้าร่วมห้องใหม่', 401);
    const player = game.getState().players.find((p) => p.token === token);
    let r;
    if (OWNER_ACTIONS[body.type]) {
      if (player.id !== snap0.ownerId) r = err('เฉพาะเจ้าของห้องเท่านั้น');
      else r = game.hostAct({ type: body.type });
    } else {
      r = game.act(player, body);
    }
    if (r && r.error) return r;
    wrap.g = game.getState(); wrap.rev++;
    await save(code, wrap);
    await beat(code, token);
    return { ok: true, rev: wrap.rev, state: game.snapshot(token, false, connFn(pres)) };
  });
}

module.exports = { createRoom, join, readState, action, normCode, ROOM_TTL };
