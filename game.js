'use strict';
/*
 * Island Conquest — เอนจินกติกาเกม (ไม่มี HTTP ในไฟล์นี้ เพื่อให้ทดสอบง่าย)
 *
 * แนวคิดหลัก
 *  - เซิร์ฟเวอร์เป็นผู้ตัดสินทุกอย่าง (ทอยเต๋า จั่ว ขโมย ปะทะ ตรวจเส้นทางเดิน)
 *  - การตอบโต้ใช้ "กองเฟรม" (stack) แบบเข้าหลังออกก่อน:
 *      เฟรมไพ่ (kickOut/swap/boost/steal/shield/reflect/stop) และเฟรมปะทะ (hit) จากการเดินชนกัน
 *      เฟรมบนสุดเปิดหน้าต่างให้ผู้ที่มีไพ่ตอบโต้ได้ "ตอบโต้หรือผ่าน" ครบทุกคนแล้วจึงทำงาน
 *      Stop ยกเลิกเฟรมไพ่ที่อยู่ใต้มัน (รวมถึง Stop/โล่/สะท้อน) แต่ยกเลิกการปะทะจากการเดินไม่ได้
 *  - ค่าตั้งที่ยังไม่ได้ยืนยันกับผู้ออกแบบ อยู่ใน RULES ด้านล่าง ปรับได้ที่เดียว
 */
const crypto = require('crypto');
const IC = require('./public/cards.js');
const B = require('./public/board.js');
const { CARD_TYPES, MAX_HAND, MAX_DRAWS_PER_TURN, END_SCENE_TURNS, MAX_PLAYERS, MIN_PLAYERS } = IC;

// ค่าตั้งของกติกาที่ผู้ออกแบบยังไม่ได้ระบุ (ใช้ค่าเริ่มต้นที่สมเหตุสมผล)
const RULES = {
  startCellSafe: false,       // ช่องเริ่มต้นไม่ใช่เซฟโซน (ปล่อยตัวลงช่องที่มีศัตรูยืนอยู่ = ปะทะ)
  rollAgainOptional: true     // ทอยซ้ำหลังได้ 6 เป็นตัวเลือก (จบเทิร์นได้) — ปัจจุบันบังคับใช้เป็นตัวเลือกเสมอ
};

const err = (msg) => ({ error: msg });
const COLOR_LABEL = { red: 'แดง', blue: 'ฟ้า', green: 'เขียว', yellow: 'เหลือง' };
const ANIMAL = { red: 'ปลาหมึก', blue: 'โลมา', green: 'เต่า', yellow: 'แมวน้ำ' };

function cleanName(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/[\u0000-\u001f<>&"'`]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 16).join('');
}

function createGame(opts) {
  opts = opts || {};
  const randInt = opts.randInt || function (n) { return crypto.randomInt(0, n); };
  const rollMs = opts.rollMs == null ? 700 : opts.rollMs;
  const instantRoll = !!opts.instantRoll; // serverless: ไม่มี timer ให้เปิดแต้มทันที
  const onChange = opts.onChange || function () {};
  const newToken = opts.newToken || function () { return crypto.randomBytes(16).toString('hex'); };

  let G = fresh();
  let diceTimer = null;

  function fresh() {
    return {
      phase: 'lobby', // lobby | playing | over
      players: [],    // { id, name, token, color, hand, pieces:[{id,pos,arrive}], autoPass }
      deck: [], discard: [],
      turnPlayerId: null,
      turn: { number: 1, action: null, draws: 0, canRoll: true, moves: [], six: null },
      frames: [], hitQueue: [], arriveSeq: 0, islandOwners: {},
      finallyOverActive: false, endScene: null, gameOver: null,
      lastPlayed: null, reveal: null, dice: null,
      fx: [], logs: [], seq: 0
    };
  }

  // ---------------------------------------------------------------- helpers
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function createDeck() {
    const deck = []; let uid = 1;
    Object.keys(CARD_TYPES).forEach(function (id) {
      for (let i = 0; i < CARD_TYPES[id].count; i++) deck.push({ uid: 'c' + (uid++), id: id });
    });
    return shuffle(deck);
  }
  function log(text) {
    G.logs.push({ id: ++G.seq, text: text, t: Date.now() });
    if (G.logs.length > 150) G.logs.splice(0, G.logs.length - 150);
  }
  function fx(type, data) {
    const e = Object.assign({ id: ++G.seq, type: type }, data);
    G.fx.push(e);
    if (G.fx.length > 20) G.fx.splice(0, G.fx.length - 20);
  }
  const P = function (id) { return G.players.find(function (p) { return p.id === id; }) || null; };
  const byToken = function (t) { return t ? (G.players.find(function (p) { return p.token === t; }) || null) : null; };
  const ownerId = function () { return G.players.length ? G.players[0].id : null; };
  const cname = function (c) { return CARD_TYPES[c].name; };
  const cellName = B.label;
  const onBoard = function (pc) { return pc.pos >= 0; };
  const top = function () { return G.frames[G.frames.length - 1]; };
  const rolling = function () { return !!(G.dice && G.dice.rolling); };
  const idle = function () { return G.frames.length === 0 && G.hitQueue.length === 0 && !rolling(); };

  function piecesAt(cell) {
    const out = [];
    G.players.forEach(function (p) { p.pieces.forEach(function (pc) { if (pc.pos === cell) out.push({ p: p, pc: pc }); }); });
    return out;
  }
  // เจ้าของเกาะ = เจ้าของตัวที่เข้ามาถึงเกาะล่าสุดในบรรดาตัวที่ยังอยู่ (กติกา 7.1/7.2)
  function islandOwner(cell) {
    let best = null;
    piecesAt(cell).forEach(function (x) { if (!best || x.pc.arrive > best.pc.arrive) best = x; });
    return best ? best.p.id : null;
  }
  function islandsOf(pid) { return B.ISLANDS.filter(function (c) { return islandOwner(c) === pid; }).length; }
  function scoreOf(p) { return p.pieces.reduce(function (s, pc) { return s + (pc.pos >= 0 ? B.points[pc.pos] : 0); }, 0); }
  function standings() {
    return G.players.map(function (p) {
      return { id: p.id, name: p.name, color: p.color, islands: islandsOf(p.id), score: scoreOf(p) };
    });
  }

  // ---------------------------------------------------------------- จบเกม
  function endGame(title, detail, winnerIds) {
    clearTimeout(diceTimer);
    G.phase = 'over';
    G.frames = []; G.hitQueue = [];
    G.turn.moves = []; G.turn.six = null;
    G.gameOver = { title: title, detail: detail, winnerIds: winnerIds || [], table: standings() };
    log('🏁 เกมจบ: ' + title);
  }
  function endByRanking(title, detail) {
    const t = standings();
    t.sort(function (a, b) { return b.islands - a.islands || b.score - a.score; });
    const best = t[0];
    const winners = t.filter(function (x) { return x.islands === best.islands && x.score === best.score; });
    const names = winners.map(function (w) { return w.name; }).join(' และ ');
    const tail = winners.length > 1 ? ' — เสมอกัน (' + names + ')' : ' — ผู้ชนะคือ ' + names;
    endGame(title, detail + tail, winners.map(function (w) { return w.id; }));
  }
  function checkWin() {
    if (G.phase !== 'playing') return;
    for (let i = 0; i < G.players.length; i++) {
      const p = G.players[i];
      if (islandsOf(p.id) >= B.ISLAND_WIN) {
        endGame(p.name + ' ครอบครอง ' + B.ISLAND_WIN + ' เกาะ!', 'ชนะทันที ไม่ว่าไพ่จบเกมจะทำงานอยู่หรือไม่', [p.id]);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- เตะ/ปะทะ
  function kick(p, pc, why) {
    const cell = pc.pos;
    pc.pos = -1;
    fx('kick', { playerId: p.id, pieceId: pc.id, cell: cell });
    log('💥 ตัวเล่นของ ' + p.name + ' (' + ANIMAL[p.color] + ') ถูกเตะกลับฐาน' + (why ? ' — ' + why : ''));
  }
  // ตัวเล่นของ p มาหยุดที่ cell: สร้างรายการปะทะกับตัวของฝ่ายตรงข้ามที่อยู่ช่องนั้น
  function collide(p, pc, cell, source) {
    if (B.safe[cell]) return;
    const order = G.players.filter(function (x) { return x.id !== p.id; });
    const idx = G.players.indexOf(p);
    order.sort(function (a, b) {
      const da = (G.players.indexOf(a) - idx + G.players.length) % G.players.length;
      const db = (G.players.indexOf(b) - idx + G.players.length) % G.players.length;
      return da - db;
    });
    order.forEach(function (v) {
      v.pieces.forEach(function (vp) {
        if (vp.pos === cell) {
          G.hitQueue.push({ attackerId: p.id, attackerPiece: pc.id, victimId: v.id, victimPiece: vp.id, cell: cell, source: source });
        }
      });
    });
  }

  // ---------------------------------------------------------------- เฟรมตอบโต้
  const hitLike = function (f) { return f.kind === 'hit' || f.cardId === 'kickOut'; };

  function eligible(f, p) {
    const out = [];
    p.hand.forEach(function (c) {
      if (c.id === 'stop') { if (f.kind === 'card' && f.byId !== p.id) out.push(c.uid); }
      else if (c.id === 'shield' || c.id === 'reflect') {
        if (hitLike(f) && f.victimId === p.id && !f.shielded && !f.reflected) out.push(c.uid);
      }
    });
    return out;
  }
  function openWindow(f) {
    f.waiting = G.players.filter(function (p) { return !p.autoPass && eligible(f, p).length > 0; }).map(function (p) { return p.id; });
  }
  function pushFrame(f) {
    f.id = ++G.seq;
    G.frames.push(f);
    openWindow(f);
    return f;
  }
  function reflectTargets(f) {
    const atk = P(f.byId); if (!atk) return [];
    if (f.kind === 'hit') return [f.attackerPiece];
    return atk.pieces.filter(function (pc) { return onBoard(pc) && !B.safe[pc.pos]; }).map(function (pc) { return pc.id; });
  }

  function nextHit() {
    while (G.hitQueue.length) {
      const h = G.hitQueue.shift();
      const a = P(h.attackerId), v = P(h.victimId);
      if (!a || !v || a.pieces[h.attackerPiece].pos !== h.cell || v.pieces[h.victimPiece].pos !== h.cell) continue;
      const lbl = h.source === 'move' ? 'เดินมาชน' : h.source === 'release' ? 'ลงช่องเริ่มต้นชน' : 'ถูกสลับมาชน';
      log('⚔️ ' + a.name + ' ' + lbl + ' ' + v.name + ' ที่ช่อง ' + cellName(h.cell));
      fx('clash', { cell: h.cell });
      pushFrame({ kind: 'hit', byId: h.attackerId, attackerPiece: h.attackerPiece, victimId: h.victimId, victimPiece: h.victimPiece, cell: h.cell, source: h.source });
      return true;
    }
    return false;
  }

  // แจ้งเหตุการณ์ "ยึดเกาะ" เมื่อเจ้าของเกาะเปลี่ยน (ให้หน้าเว็บทำแอนิเมชัน)
  function syncIslands() {
    if (!G.islandOwners) G.islandOwners = {};
    B.ISLANDS.forEach(function (c) {
      const o = islandOwner(c), prev = G.islandOwners[c] == null ? null : G.islandOwners[c];
      if (o !== prev) { G.islandOwners[c] = o; if (o != null) fx('island', { cell: c, ownerId: o }); }
    });
  }

  function tick() {
    for (let guard = 0; guard < 1000; guard++) {
      if (G.phase !== 'playing') return;
      const t = top();
      if (!t) { if (nextHit()) continue; syncIslands(); checkWin(); return; }
      if (t.waiting.length) return;
      resolveTop();
    }
  }

  function applyHit(f) {
    const atk = P(f.byId), vic = P(f.victimId);
    if (!atk || !vic) return;
    if (f.shielded) { fx('shield', { playerId: vic.id, cell: f.cell }); log('🛡️ โล่ของ ' + vic.name + ' ป้องกันไว้ได้ — ตัวเล่นยังอยู่ที่เดิม'); return; }
    if (f.kind === 'hit') {
      const ap = atk.pieces[f.attackerPiece], vp = vic.pieces[f.victimPiece];
      if (ap.pos !== f.cell || vp.pos !== f.cell) return;
      if (f.reflected) { fx('reflect', { cell: f.cell }); kick(atk, ap, 'ถูกสะท้อนกลับ'); }
      else kick(vic, vp, 'ถูก ' + atk.name + ' เดินมาชน');
      return;
    }
    // ไพ่เตะออก
    if (f.reflected) {
      fx('reflect', { cell: f.cell });
      const t = f.reflectPiece != null ? atk.pieces[f.reflectPiece] : null;
      if (t && onBoard(t) && !B.safe[t.pos]) kick(atk, t, 'ถูกสะท้อนกลับ');
      else log('🪞 สะท้อนกลับแล้ว แต่ ' + atk.name + ' ไม่มีตัวเล่นที่เตะได้ — ไม่มีใครถูกเตะ');
      return;
    }
    const vp = vic.pieces[f.victimPiece];
    if (!onBoard(vp) || B.safe[vp.pos]) { log('ไพ่เตะออก ไม่มีผล (ตัวเป้าหมายไม่อยู่ในที่ที่เตะได้แล้ว)'); return; }
    kick(vic, vp, 'ถูก ' + atk.name + ' ใช้ไพ่เตะออก');
  }

  function resolveTop() {
    const f = G.frames.pop();
    const parent = top();
    if (f.kind === 'hit') { applyHit(f); return; }
    const owner = P(f.byId);
    switch (f.cardId) {
      case 'stop': {
        const target = G.frames.pop(); // ยกเลิกเฟรมที่อยู่ใต้
        fx('stop', { byId: owner.id });
        if (target) log('✋ "หยุดเดี๋ยวนี้" ของ ' + owner.name + ' ยกเลิก "' + cname(target.cardId) + '" ได้สำเร็จ');
        const gp = top();
        if (gp) openWindow(gp); // ถ้าไพ่ที่ถูกหยุดเป็นไพ่ตอบโต้ ให้เฟรมเดิมเปิดหน้าต่างใหม่
        return;
      }
      case 'shield':
        if (parent) { parent.shielded = true; G.frames.pop(); applyHit(parent); }
        return;
      case 'reflect':
        if (parent) {
          parent.reflected = true;
          if (f.params && f.params.pieceId != null) parent.reflectPiece = f.params.pieceId;
          G.frames.pop(); applyHit(parent);
        }
        return;
      case 'kickOut': applyHit(f); return;
      case 'swap': applySwap(f); return;
      case 'boost': {
        const pc = owner.pieces[f.params.pieceId];
        if (!pc || !onBoard(pc)) { log('เร่งเครื่องไม่มีผล (ตัวเล่นไม่อยู่บนกระดานแล้ว)'); return; }
        G.turn.moves.push({ mid: ++G.seq, kind: 'boost', steps: 3, pieceId: pc.id });
        log('🐬 ' + owner.name + ' ได้เดินเพิ่ม 3 ช่อง');
        return;
      }
      case 'steal': {
        const v = P(f.params.targetId);
        if (!v || v.hand.length === 0) { log('🥷 ' + owner.name + ' พยายามขโมยจาก ' + (v ? v.name : '?') + ' แต่ไม่มีไพ่ให้ขโมย — ไม่เกิดผล'); return; }
        const i = randInt(v.hand.length);
        const stolen = v.hand.splice(i, 1)[0];
        owner.hand.push(stolen);
        log('🥷 ' + owner.name + ' ขโมยไพ่จาก ' + v.name + ' สำเร็จ!');
        fx('steal', { thiefId: owner.id, victimId: v.id, cardId: stolen.id });
        return;
      }
      default: return;
    }
  }

  function applySwap(f) {
    const owner = P(f.byId);
    const a = P(f.params.a.playerId), b = P(f.params.b.playerId);
    if (!a || !b) return;
    const pa = a.pieces[f.params.a.pieceId], pb = b.pieces[f.params.b.pieceId];
    if (!onBoard(pa) || !onBoard(pb) || B.island[pa.pos] || B.island[pb.pos]) { log('สลับตำแหน่งไม่มีผล (ตัวเล่นอยู่ในที่ที่สลับไม่ได้แล้ว)'); return; }
    const ca = pa.pos, cb = pb.pos;
    pa.pos = cb; pb.pos = ca;
    pa.arrive = ++G.arriveSeq; pb.arrive = ++G.arriveSeq;
    fx('swap', { a: { playerId: a.id, pieceId: pa.id, from: ca, to: cb }, b: { playerId: b.id, pieceId: pb.id, from: cb, to: ca } });
    log('🔀 ' + owner.name + ' สลับตำแหน่ง ' + a.name + ' ที่ ' + cellName(ca) + ' กับ ' + b.name + ' ที่ ' + cellName(cb));
    collide(a, pa, cb, 'swap');
    collide(b, pb, ca, 'swap');
  }

  // ---------------------------------------------------------------- เทิร์น
  function advanceTurn() {
    G.frames = []; G.hitQueue = [];
    if (G.endScene) {
      const left = G.endScene.turnsLeft - 1;
      if (left <= 0) {
        G.endScene = { turnsLeft: 0 };
        endByRanking('ปิดฉาก! ครบ ' + END_SCENE_TURNS + ' เทิร์นแล้ว', 'ตัดสินจากจำนวนเกาะ แล้วคะแนนบนกระดาน');
        return;
      }
      G.endScene = { turnsLeft: left };
    }
    const i = G.players.findIndex(function (p) { return p.id === G.turnPlayerId; });
    const next = G.players[(i + 1) % G.players.length];
    G.turnPlayerId = next.id;
    G.turn = { number: G.turn.number + 1, action: null, draws: 0, canRoll: true, moves: [], six: null };
    G.dice = null;
    log('▶ ถึงเทิร์นของ ' + next.name);
  }

  function gate(p, needTurn) {
    if (G.phase !== 'playing') return err(G.phase === 'lobby' ? 'เกมยังไม่เริ่ม' : 'เกมจบแล้ว');
    if (needTurn && p.id !== G.turnPlayerId) return err('ยังไม่ถึงเทิร์นของคุณ');
    if (G.frames.length || G.hitQueue.length) return err('กำลังมีการตอบโต้อยู่ รอให้เสร็จก่อน');
    if (rolling()) return err('รอเต๋าหยุดหมุนก่อน');
    return null;
  }

  function doStart(byHost, p) {
    if (G.phase !== 'lobby') return err('เกมเริ่มไปแล้ว');
    if (!byHost && (!p || p.id !== ownerId())) return err('เฉพาะเจ้าของห้อง (ผู้เล่นคนแรก) หรือคอมโฮสต์เท่านั้นที่เริ่มเกมได้');
    if (G.players.length < MIN_PLAYERS) return err('ต้องมีผู้เล่นอย่างน้อย ' + MIN_PLAYERS + ' คน');
    clearTimeout(diceTimer);
    const keep = { players: G.players, logs: G.logs, seq: G.seq };
    G = fresh();
    G.players = keep.players; G.logs = keep.logs; G.seq = keep.seq;
    G.players.forEach(function (pl) {
      pl.hand = [];
      pl.pieces = [0, 1, 2, 3].map(function (i) { return { id: i, pos: i === 0 ? B.START[pl.color] : -1, arrive: 0 }; });
      pl.pieces[0].arrive = ++G.arriveSeq;
    });
    G.deck = createDeck();
    G.phase = 'playing';
    G.turnPlayerId = G.players[0].id;
    log('เริ่มเกม ' + G.players.length + ' คน! สับไพ่ ' + G.deck.length + ' ใบเรียบร้อย');
    log('▶ เทิร์นแรก: ' + G.players[0].name);
    return { ok: true };
  }

  function doDraw(p) {
    const e = gate(p, true); if (e) return e;
    if (G.turn.action === 'roll') return err('เทิร์นนี้เลือกทอยเต๋าไปแล้ว จึงจั่วไพ่ไม่ได้');
    if (G.turn.moves.length || G.turn.six) return err('ต้องเดินหรือเลือกให้เสร็จก่อน');
    if (G.turn.draws >= MAX_DRAWS_PER_TURN) return err('จั่วครบ ' + MAX_DRAWS_PER_TURN + ' ใบแล้วในเทิร์นนี้ กด “จบเทิร์น” ได้เลย');
    if (p.hand.length >= MAX_HAND) return err('ไพ่เต็มมือ ' + MAX_HAND + ' ใบแล้ว ใช้หรือทิ้งไพ่ก่อนจึงจะจั่วเพิ่มได้');
    if (G.deck.length === 0) {
      if (G.discard.length === 0) return err('ไม่มีไพ่เหลือในกองจั่วและกองทิ้ง');
      G.deck = shuffle(G.discard); G.discard = [];
      log('🔄 สับกองทิ้งกลับมาเป็นกองจั่วใหม่');
    }
    const card = G.deck.pop();
    G.turn.action = 'draw'; G.turn.draws += 1;
    if (card.id === 'finallyOver') {
      G.discard.push(card);
      G.finallyOverActive = true;
      G.lastPlayed = { cardId: card.id, playerId: p.id, playerName: p.name };
      G.reveal = { id: ++G.seq, cardId: card.id, playerId: p.id, playerName: p.name, mode: 'drawn' };
      log('🔥 ' + p.name + ' จั่วได้ "จบสักที"! เปิดไพ่ทันที — ใครทอยได้ 6 หลังจากนี้ เกมจบทันที');
    } else {
      p.hand.push(card);
      log('🎴 ' + p.name + ' จั่วไพ่ 1 ใบ');
    }
    return { ok: true };
  }

  function takeCard(p, uid) {
    const i = p.hand.findIndex(function (c) { return c.uid === uid; });
    return i < 0 ? null : p.hand.splice(i, 1)[0];
  }
  function announce(p, card, mode) {
    G.lastPlayed = { cardId: card.id, playerId: p.id, playerName: p.name };
    G.reveal = { id: ++G.seq, cardId: card.id, playerId: p.id, playerName: p.name, mode: mode };
  }

  // ---- เล่นไพ่ (ไพ่แอ็กชันเฉพาะเทิร์นตัวเอง)
  function doPlay(p, b) {
    const e = gate(p, true); if (e) return e;
    const card = p.hand.find(function (c) { return c.uid === b.uid; });
    if (!card) return err('ไม่พบไพ่ใบนี้ในมือของคุณ');
    const prm = b.params || {};
    const id = card.id;
    if (id === 'shield' || id === 'reflect' || id === 'stop') return err('ไพ่ “' + cname(id) + '” ใช้ได้เฉพาะตอนที่มีการตอบโต้ (จะมีหน้าต่างให้เลือกเอง)');

    if (id === 'endScene') {
      if (G.turn.action !== null || G.turn.moves.length || G.turn.six) return err('“ปิดฉาก” ใช้ได้เฉพาะต้นเทิร์นของตัวเอง ก่อนทอยเต๋าหรือจั่วไพ่');
      if (G.endScene) return err('กำลังนับถอยหลัง “ปิดฉาก” อยู่แล้ว');
      takeCard(p, card.uid); G.discard.push(card);
      announce(p, card, 'play');
      G.endScene = { turnsLeft: END_SCENE_TURNS };
      log('✨ ' + p.name + ' ใช้ไพ่ "ปิดฉาก" — นับ ' + END_SCENE_TURNS + ' เทิร์น (เทิร์นนี้คือเทิร์นที่ 1)');
      return { ok: true };
    }
    if (id === 'finallyOver') return err('ไพ่นี้ใช้ไม่ได้');

    let frame;
    if (id === 'kickOut') {
      const v = P(Number(prm.targetId));
      if (!v || v.id === p.id) return err('เลือกฝ่ายตรงข้ามที่จะเตะ');
      const vp = v.pieces[Number(prm.pieceId)];
      if (!vp || !onBoard(vp)) return err('ตัวเล่นนั้นไม่ได้อยู่บนกระดาน');
      if (B.safe[vp.pos]) return err('เตะตัวเล่นที่อยู่บนเซฟโซน (เปลือกหอย) ไม่ได้');
      frame = { kind: 'card', cardId: id, byId: p.id, victimId: v.id, victimPiece: vp.id, cell: vp.pos, params: { targetId: v.id, pieceId: vp.id } };
    } else if (id === 'boost') {
      const pc = p.pieces[Number(prm.pieceId)];
      if (!pc || !onBoard(pc)) return err('เลือกตัวเล่นของคุณที่อยู่บนกระดาน');
      frame = { kind: 'card', cardId: id, byId: p.id, params: { pieceId: pc.id } };
    } else if (id === 'swap') {
      const A = prm.a || {}, Bb = prm.b || {};
      const pa = P(Number(A.playerId)), pb = P(Number(Bb.playerId));
      if (!pa || !pb) return err('เลือกตัวเล่นให้ครบ 2 ตัว');
      const xa = pa.pieces[Number(A.pieceId)], xb = pb.pieces[Number(Bb.pieceId)];
      if (!xa || !xb || !onBoard(xa) || !onBoard(xb)) return err('ตัวเล่นที่เลือกต้องอยู่บนกระดาน');
      if (xa === xb) return err('ต้องเลือกตัวเล่นคนละตัว');
      if (B.island[xa.pos] || B.island[xb.pos]) return err('สลับตัวเล่นที่อยู่บนเกาะไม่ได้');
      frame = { kind: 'card', cardId: id, byId: p.id, params: { a: { playerId: pa.id, pieceId: xa.id }, b: { playerId: pb.id, pieceId: xb.id } } };
    } else if (id === 'steal') {
      const v = P(Number(prm.targetId));
      if (!v || v.id === p.id) return err('เลือกฝ่ายตรงข้ามที่จะขโมยไพ่');
      frame = { kind: 'card', cardId: id, byId: p.id, params: { targetId: v.id } };
    } else return err('ไพ่นี้ใช้ไม่ได้');

    takeCard(p, card.uid); G.discard.push(card);
    announce(p, card, 'play');
    log('✨ ' + p.name + ' ใช้ไพ่ "' + cname(id) + '"');
    pushFrame(frame);
    tick();
    return { ok: true };
  }

  // ---- ตอบโต้
  function doRespond(p, b) {
    if (G.phase !== 'playing') return err('เกมไม่ได้กำลังเล่นอยู่');
    const f = top();
    if (!f || f.id !== Number(b.frameId)) return err('หน้าต่างตอบโต้นี้หมดอายุแล้ว');
    if (f.waiting.indexOf(p.id) < 0) return err('ตอนนี้ยังไม่ถึงตาคุณตอบโต้');
    const card = p.hand.find(function (c) { return c.uid === b.uid; });
    if (!card) return err('ไม่พบไพ่ใบนี้ในมือของคุณ');
    if (eligible(f, p).indexOf(card.uid) < 0) return err('ใช้ไพ่ใบนี้ตอบโต้ในตอนนี้ไม่ได้');
    const frame = { kind: 'card', cardId: card.id, byId: p.id, params: {} };
    if (card.id === 'reflect' && f.cardId === 'kickOut') {
      const cands = reflectTargets(f);
      if (cands.length > 1) {
        if (cands.indexOf(Number(b.pieceId)) < 0) return err('เลือกตัวเล่นของผู้โจมตีที่จะให้ถูกเตะกลับฐาน');
        frame.params.pieceId = Number(b.pieceId);
      } else if (cands.length === 1) frame.params.pieceId = cands[0];
    }
    takeCard(p, card.uid); G.discard.push(card);
    announce(p, card, 'respond');
    log('↩️ ' + p.name + ' ตอบโต้ด้วย "' + cname(card.id) + '"');
    pushFrame(frame);
    tick();
    return { ok: true };
  }

  function doPass(p, b) {
    if (G.phase !== 'playing') return err('เกมไม่ได้กำลังเล่นอยู่');
    const f = top();
    if (!f || f.id !== Number(b.frameId)) return err('หน้าต่างตอบโต้นี้หมดอายุแล้ว');
    const i = f.waiting.indexOf(p.id);
    if (i < 0) return err('คุณไม่ได้อยู่ในรายชื่อที่ต้องตอบโต้');
    f.waiting.splice(i, 1);
    tick();
    return { ok: true };
  }

  function doDiscard(p, uid) {
    if (G.phase !== 'playing') return err('เกมไม่ได้กำลังเล่นอยู่');
    if (G.frames.length || G.hitQueue.length) return err('กำลังมีการตอบโต้อยู่ รอให้เสร็จก่อน');
    const card = takeCard(p, uid);
    if (!card) return err('ไม่พบไพ่ใบนี้ในมือของคุณ');
    G.discard.push(card);
    log('🗑️ ' + p.name + ' ทิ้งไพ่ 1 ใบ');
    return { ok: true };
  }

  // ---- ทอยเต๋า / เดิน
  function doRoll(p) {
    const e = gate(p, true); if (e) return e;
    if (G.turn.moves.length || G.turn.six) return err('ต้องเดินหรือเลือกให้เสร็จก่อน');
    if (G.turn.action === 'draw') return err('เทิร์นนี้เลือกจั่วไพ่ไปแล้ว จึงทอยเต๋าไม่ได้');
    if (!G.turn.canRoll) return err('ทอยได้อีกครั้งเมื่อทอยได้ 6 เท่านั้น — กด “จบเทิร์น” ได้เลย');
    const value = randInt(6) + 1;
    const id = ++G.seq;
    G.turn.action = 'roll'; G.turn.canRoll = false;
    G.dice = { id: id, playerId: p.id, value: null, rolling: true };
    clearTimeout(diceTimer);
    if (instantRoll) { revealRoll(id, value, p.id); return { ok: true }; }
    diceTimer = setTimeout(function () { revealRoll(id, value, p.id); }, rollMs);
    return { ok: true };
  }

  function addMove(kind, steps, pieceId) {
    G.turn.moves.push({ mid: ++G.seq, kind: kind, steps: steps, pieceId: pieceId == null ? null : pieceId });
  }

  function revealRoll(id, value, pid) {
    if (!G.dice || G.dice.id !== id || G.phase !== 'playing') return;
    const p = P(pid);
    G.dice = { id: id, playerId: pid, value: value, rolling: false };
    log('🎲 ' + p.name + ' ทอยได้ ' + value);
    if (value === 6 && G.finallyOverActive) {
      endByRanking(p.name + ' ทอยได้ 6!', 'ไพ่ “จบสักที” ทำงานอยู่ — เกมจบทันที (ชนะทันทีถ้าใครครองครบ 4 เกาะ) ตัดสินจากเกาะและคะแนนบนกระดาน');
      onChange(); return;
    }
    const board = p.pieces.filter(onBoard), base = p.pieces.filter(function (x) { return !onBoard(x); });
    if (value === 6) {
      if (!board.length) { release(p); tick(); }
      else if (!base.length) addMove('run', 12);
      else G.turn.six = { release: true, run: true };
    } else if (!board.length) {
      log('⏭️ ' + p.name + ' ไม่มีตัวเล่นบนกระดานให้เดิน — ข้ามเทิร์น');
      advanceTurn();
    } else addMove('dice', value);
    onChange();
  }

  function release(p) {
    const pc = p.pieces.find(function (x) { return !onBoard(x); });
    if (!pc) return false;
    pc.pos = B.START[p.color]; pc.arrive = ++G.arriveSeq;
    fx('release', { playerId: p.id, pieceId: pc.id, to: pc.pos });
    log('🚪 ' + p.name + ' นำ ' + ANIMAL[p.color] + ' ออกจากฐานที่ช่อง ' + cellName(pc.pos));
    G.turn.canRoll = true;
    collide(p, pc, pc.pos, 'release');
    return true;
  }

  function doSix(p, choice) {
    const e = gate(p, true); if (e) return e;
    if (!G.turn.six) return err('ไม่มีสิทธิ์เลือกจากการทอยได้ 6');
    if (choice === 'release') {
      if (!p.pieces.some(function (x) { return !onBoard(x); })) return err('ไม่มีตัวเล่นในฐานให้นำออก');
      G.turn.six = null;
      release(p); tick();
      return { ok: true };
    }
    if (choice === 'run') {
      if (!p.pieces.some(onBoard)) return err('ไม่มีตัวเล่นบนกระดานให้เดิน');
      G.turn.six = null;
      addMove('run', 12);
      return { ok: true };
    }
    return err('ตัวเลือกไม่ถูกต้อง');
  }

  function doMove(p, b) {
    const e = gate(p, true); if (e) return e;
    const mv = G.turn.moves.find(function (m) { return m.mid === Number(b.mid); });
    if (!mv) return err('ไม่มีการเดินที่รออยู่');
    const pieceId = mv.pieceId != null ? mv.pieceId : Number(b.pieceId);
    const pc = p.pieces[pieceId];
    if (!pc || !onBoard(pc)) return err('เลือกตัวเล่นของคุณที่อยู่บนกระดาน');
    const to = Number(b.to);
    if (!Number.isInteger(to) || to < 0 || to >= B.CELLS) return err('ช่องปลายทางไม่ถูกต้อง');
    const path = B.findPath(pc.pos, to, mv.steps);
    if (!path) return err('เดินไปช่องนั้นให้ครบ ' + mv.steps + ' ก้าวพอดีไม่ได้');
    const from = pc.pos;
    pc.pos = to; pc.arrive = ++G.arriveSeq;
    G.turn.moves = G.turn.moves.filter(function (m) { return m !== mv; });
    if (mv.kind === 'run') G.turn.canRoll = true;
    fx('move', { playerId: p.id, pieceId: pc.id, path: path, from: from, to: to });
    log('👣 ' + p.name + ' เดิน ' + mv.steps + ' ช่อง ' + cellName(from) + ' → ' + cellName(to));
    collide(p, pc, to, 'move');
    tick();
    return { ok: true };
  }

  function doEndTurn(p) {
    const e = gate(p, true); if (e) return e;
    if (G.turn.moves.length) return err('ยังต้องเดินตัวเล่นให้ครบก่อน');
    if (G.turn.six) return err('ทอยได้ 6 — เลือกนำตัวเล่นออกจากฐาน หรือเดิน 12 ช่องก่อน');
    log('⏭️ ' + p.name + ' จบเทิร์น');
    advanceTurn();
    return { ok: true };
  }

  // ---------------------------------------------------------------- ห้องรอ
  function doJoin(body, isConnected) {
    const name = cleanName(body.name);
    let p = byToken(body.token);
    if (p) {
      if (G.phase === 'lobby' && name && name !== p.name && !G.players.some(function (x) { return x !== p && x.name.toLowerCase() === name.toLowerCase(); })) p.name = name;
      return { ok: true, token: p.token, id: p.id };
    }
    if (name) {
      const seat = G.players.find(function (x) { return !isConnected(x.token) && x.name.toLowerCase() === name.toLowerCase(); });
      if (seat) { seat.token = newToken(); log('🔌 ' + seat.name + ' กลับเข้าเกม'); return { ok: true, token: seat.token, id: seat.id }; }
    }
    if (G.phase !== 'lobby') return err('เกมเริ่มไปแล้ว — ถ้าเป็นผู้เล่นเดิม ให้ใส่ "ชื่อเดิม" เพื่อกลับเข้าเกม');
    if (G.players.length >= MAX_PLAYERS) return err('ห้องเต็มแล้ว (สูงสุด ' + MAX_PLAYERS + ' คน)');
    let seatId = 1;
    while (G.players.some(function (x) { return x.id === seatId; })) seatId++;
    const finalName = name || ('ผู้เล่น ' + seatId);
    if (G.players.some(function (x) { return x.name.toLowerCase() === finalName.toLowerCase(); })) return err('ชื่อนี้มีคนใช้อยู่แล้ว ลองใช้ชื่ออื่น');
    const color = B.COLORS.find(function (c) { return !G.players.some(function (x) { return x.color === c; }); });
    p = { id: seatId, name: finalName, token: newToken(), color: color, hand: [], pieces: [], autoPass: false };
    G.players.push(p);
    G.players.sort(function (a, b) { return a.id - b.id; });
    log('👋 ' + p.name + ' เข้าร่วมห้อง (' + ANIMAL[color] + ' สี' + COLOR_LABEL[color] + ')');
    return { ok: true, token: p.token, id: p.id };
  }

  function doSetColor(p, color) {
    if (G.phase !== 'lobby') return err('เปลี่ยนสีได้เฉพาะตอนรอเริ่มเกม');
    if (B.COLORS.indexOf(color) < 0) return err('สีไม่ถูกต้อง');
    if (G.players.some(function (x) { return x !== p && x.color === color; })) return err('มีคนเลือกสีนี้แล้ว');
    p.color = color;
    return { ok: true };
  }

  function doLeave(p) {
    if (G.phase !== 'lobby') return err('ออกจากห้องได้เฉพาะตอนรอเริ่มเกม');
    G.players = G.players.filter(function (x) { return x.id !== p.id; });
    log('🚪 ' + p.name + ' ออกจากห้อง');
    return { ok: true };
  }

  function resetToLobby() {
    clearTimeout(diceTimer);
    const keep = { players: G.players, logs: G.logs, seq: G.seq };
    G = fresh();
    G.players = keep.players; G.logs = keep.logs; G.seq = keep.seq;
    G.players.forEach(function (p) { p.hand = []; p.pieces = []; });
    log('🔄 กลับสู่ห้องรอ — กดเริ่มเกมเมื่อพร้อม');
  }

  // ---------------------------------------------------------------- คำสั่งจากผู้เล่น / โฮสต์
  function act(p, b) {
    switch (b.type) {
      case 'start': return doStart(false, p);
      case 'leave': return doLeave(p);
      case 'setColor': return doSetColor(p, b.color);
      case 'draw': return doDraw(p);
      case 'roll': return doRoll(p);
      case 'six': return doSix(p, b.choice);
      case 'move': return doMove(p, b);
      case 'endTurn': return doEndTurn(p);
      case 'play': return doPlay(p, b);
      case 'respond': return doRespond(p, b);
      case 'pass': return doPass(p, b);
      case 'discard': return doDiscard(p, b.uid);
      case 'auto': p.autoPass = !!b.value; return { ok: true };
      case 'reset':
        if (p.id !== ownerId()) return err('เฉพาะเจ้าของห้อง (ผู้เล่นคนแรก) เริ่มรอบใหม่ได้');
        resetToLobby(); return { ok: true };
      default: return err('คำสั่งไม่ถูกต้อง');
    }
  }

  function hostAct(b) {
    switch (b.type) {
      case 'start': return doStart(true, null);
      case 'skip':
        if (G.phase !== 'playing') return err('เกมยังไม่เริ่มหรือจบแล้ว');
        clearTimeout(diceTimer);
        log('⏭️ โฮสต์ข้ามเทิร์นของ ' + (P(G.turnPlayerId) ? P(G.turnPlayerId).name : ''));
        advanceTurn(); return { ok: true };
      case 'forcePass': {
        const f = top();
        if (!f) return err('ไม่มีการตอบโต้ที่รออยู่');
        f.waiting = []; log('⏩ โฮสต์ข้ามการตอบโต้');
        tick(); return { ok: true };
      }
      case 'reset': resetToLobby(); return { ok: true };
      case 'clear':
        clearTimeout(diceTimer);
        G = fresh(); log('🧹 โฮสต์ล้างห้อง — ผู้เล่นทุกคนต้องเข้าร่วมใหม่');
        return { ok: true };
      case 'kick': {
        if (G.phase !== 'lobby') return err('ลบผู้เล่นได้เฉพาะตอนรอเริ่มเกม');
        const k = P(Number(b.playerId));
        if (!k) return err('ไม่พบผู้เล่น');
        G.players = G.players.filter(function (x) { return x.id !== k.id; });
        log('🚫 โฮสต์ลบ ' + k.name + ' ออกจากห้อง'); return { ok: true };
      }
      default: return err('คำสั่งไม่ถูกต้อง');
    }
  }

  // ---------------------------------------------------------------- snapshot
  function publicFrame(f) {
    return {
      id: f.id, kind: f.kind, cardId: f.cardId || null, byId: f.byId, victimId: f.victimId == null ? null : f.victimId,
      victimPiece: f.victimPiece == null ? null : f.victimPiece, attackerPiece: f.attackerPiece == null ? null : f.attackerPiece,
      cell: f.cell == null ? null : f.cell, source: f.source || null, params: f.params || null,
      shielded: !!f.shielded, reflected: !!f.reflected
    };
  }

  function snapshot(token, host, isConnected) {
    const me = byToken(token);
    const t = top();
    const s = {
      phase: G.phase, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      players: G.players.map(function (p) {
        return {
          id: p.id, name: p.name, color: p.color, handCount: p.hand.length, connected: isConnected(p.token), autoPass: !!p.autoPass,
          pieces: p.pieces.map(function (pc) { return { id: pc.id, pos: pc.pos, arrive: pc.arrive }; }),
          islands: G.phase === 'lobby' ? 0 : islandsOf(p.id), score: G.phase === 'lobby' ? 0 : scoreOf(p)
        };
      }),
      islands: G.phase === 'lobby' ? [] : B.ISLANDS.map(function (c) { return { cell: c, ownerId: islandOwner(c) }; }),
      deckCount: G.deck.length, discardCount: G.discard.length,
      turnPlayerId: G.turnPlayerId,
      turn: { number: G.turn.number, action: G.turn.action, draws: G.turn.draws, canRoll: G.turn.canRoll, moves: G.turn.moves, six: G.turn.six },
      finallyOverActive: G.finallyOverActive, endScene: G.endScene, gameOver: G.gameOver,
      lastPlayed: G.lastPlayed, reveal: G.reveal, dice: G.dice,
      frames: G.frames.map(publicFrame),
      waitingCount: t ? t.waiting.length : 0,
      fx: G.fx.slice(-12).map(function (f) { return f.type === 'steal' && !(me && me.id === f.thiefId) ? { id: f.id, type: f.type, thiefId: f.thiefId, victimId: f.victimId } : f; }),
      logs: G.logs.slice(-60), ownerId: ownerId(), you: null
    };
    if (me) {
      const you = { id: me.id, name: me.name, color: me.color, hand: me.hand.map(function (c) { return { uid: c.uid, id: c.id }; }), window: null };
      if (t && t.waiting.indexOf(me.id) >= 0) {
        const el = eligible(t, me);
        you.window = {
          frameId: t.id,
          options: me.hand.filter(function (c) { return el.indexOf(c.uid) >= 0; }).map(function (c) { return { uid: c.uid, id: c.id }; }),
          reflectTargets: t.cardId === 'kickOut' ? reflectTargets(t) : []
        };
      }
      s.you = you;
    }
    return s;
  }

  function getState() { return G; }
  function setState(g) {
    G = Object.assign(fresh(), g);
    if (G.dice && G.dice.rolling) { G.dice = null; G.turn = Object.assign({}, G.turn, { action: null, canRoll: true }); }
    if (G.phase === 'playing') tick();
  }

  return {
    join: doJoin, act: act, hostAct: hostAct, snapshot: snapshot, getState: getState, setState: setState,
    standings: standings, islandOwner: islandOwner, tick: tick, RULES: RULES
  };
}

module.exports = { createGame: createGame, RULES: RULES, cleanName: cleanName };
