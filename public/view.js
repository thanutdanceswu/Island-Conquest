/* ส่วนแสดงผล: รับ "สถานะเกม" แล้วคืนค่า HTML (ไม่แตะ DOM จึงทดสอบใน Node ได้) */
(function (root) {
  var IC = root.IC || (typeof require !== 'undefined' ? require('./cards.js') : {});
  var B = root.BOARD || (typeof require !== 'undefined' ? require('./board.js') : {});
  var T = IC.CARD_TYPES;
  var ANIMAL = { red: 'ปลาหมึก', blue: 'โลมา', green: 'เต่า', yellow: 'แมวน้ำ' };
  var CLABEL = { red: 'แดง', blue: 'ฟ้า', green: 'เขียว', yellow: 'เหลือง' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cardImg(id, cls) { return '<img class="' + (cls || '') + '" src="/cards/' + id + '.webp" alt="' + esc(T[id].name) + '" draggable="false">'; }
  function tok(color, cls) { return '<img class="tokimg ' + (cls || '') + '" src="/img/' + color + '.png" alt="' + esc(ANIMAL[color]) + '" draggable="false">'; }
  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; }
  }
  function pOf(state, id) { return state.players.filter(function (x) { return x.id === id; })[0] || null; }
  function nameOf(state, id) { var p = pOf(state, id); return p ? p.name : 'ผู้เล่น'; }
  function sortHand(hand) { return hand.slice().sort(function (a, b) { return IC.CARD_ORDER.indexOf(a.id) - IC.CARD_ORDER.indexOf(b.id); }); }
  function cellLabel(c) { return B.label(c); }

  // ------------------------------------------------------------------ ค่าที่ใช้บ่อย
  function derive(state) {
    var me = state.you;
    var t = state.turn || { moves: [], six: null };
    var rolling = !!(state.dice && state.dice.rolling);
    var idle = state.phase === 'playing' && !(state.frames && state.frames.length) && !rolling;
    var isMyTurn = !!me && state.phase === 'playing' && state.turnPlayerId === me.id;
    var busy = (t.moves && t.moves.length) || t.six;
    return {
      me: me, isMyTurn: isMyTurn, rolling: rolling, idle: idle, over: state.phase === 'over',
      mv: isMyTurn && idle && t.moves && t.moves.length ? t.moves[0] : null,
      six: isMyTurn && idle && !!t.six,
      canRoll: isMyTurn && idle && t.action !== 'draw' && !!t.canRoll && !busy,
      canDraw: isMyTurn && idle && t.action !== 'roll' && t.draws < IC.MAX_DRAWS_PER_TURN && !!me && me.hand.length < IC.MAX_HAND && !busy,
      canEnd: isMyTurn && idle && !busy,
      canPlayAction: isMyTurn && idle
    };
  }

  function whyNotPlay(state, d, card) {
    if (IC.REACTIVE[card.id]) return 'ไพ่ “' + T[card.id].name + '” ใช้ตอบโต้ได้เฉพาะตอนที่มีหน้าต่างตอบโต้เด้งขึ้นมาให้';
    if (d.over) return 'เกมจบแล้ว';
    if (!d.isMyTurn) return 'ไพ่นี้ใช้ได้เฉพาะเทิร์นของคุณ';
    if (!d.idle) return 'รอการตอบโต้หรือเต๋าให้เสร็จก่อน';
    if (card.id === 'endScene') {
      if (state.endScene) return 'กำลังนับ “ปิดฉาก” อยู่แล้ว';
      if (state.turn.action !== null || d.mv || d.six) return '“ปิดฉาก” ใช้ได้ต้นเทิร์นเท่านั้น (ก่อนทอยเต๋าหรือจั่วไพ่)';
    }
    return '';
  }

  // ------------------------------------------------------------------ คำอธิบายเฟรมตอบโต้
  function describeFrame(state, f) {
    var by = nameOf(state, f.byId), vic = f.victimId != null ? nameOf(state, f.victimId) : '';
    if (f.kind === 'hit') {
      var how = f.source === 'release' ? 'ลงช่องเริ่มต้นชน' : f.source === 'swap' ? 'ถูกสลับมาชน' : 'เดินมาชน';
      return by + ' ' + how + ' ' + vic + ' ที่ช่อง ' + cellLabel(f.cell);
    }
    var cn = T[f.cardId].name;
    switch (f.cardId) {
      case 'kickOut': return by + ' ใช้ “' + cn + '” เตะตัวเล่นของ ' + vic + ' ที่ช่อง ' + cellLabel(f.cell);
      case 'swap': return by + ' ใช้ “' + cn + '” สลับตำแหน่งตัวเล่น 2 ตัว';
      case 'boost': return by + ' ใช้ “' + cn + '” เดินเพิ่ม 3 ช่อง';
      case 'steal': return by + ' ใช้ “' + cn + '” ขโมยไพ่จาก ' + nameOf(state, f.params && f.params.targetId);
      case 'stop': return by + ' ใช้ “' + cn + '” ยกเลิกไพ่ที่อยู่ข้างล่าง';
      case 'shield': return by + ' ใช้ “' + cn + '” ป้องกันการโจมตี';
      case 'reflect': return by + ' ใช้ “' + cn + '” สะท้อนการโจมตีกลับ';
      default: return by + ' ใช้ “' + cn + '”';
    }
  }

  // ------------------------------------------------------------------ หน้าเข้าร่วม / ห้องรอ
  function rosterRow(p, me, state) {
    return '<li style="--c:' + (B.COLORS && p.color ? colorHex(p.color) : '#999') + '">' + tok(p.color, 'sm') + '<span class="nm">' + esc(p.name) +
      (me && p.id === me.id ? ' <span class="chip" style="background:var(--c)">คุณ</span>' : '') +
      (p.id === state.ownerId ? ' <span class="chip" style="background:#f59e0b">เจ้าของห้อง</span>' : '') + '</span>' +
      '<span class="st ' + (p.connected ? 'on' : '') + '">' + (p.connected ? 'ออนไลน์' : 'ออฟไลน์') + '</span></li>';
  }
  function colorHex(c) { return { red: '#f43f5e', blue: '#0ea5e9', green: '#10b981', yellow: '#f59e0b' }[c] || '#999'; }

  function landingScreen(ui) {
    return '<div class="screen">' +
      '<div class="hero"><div class="coverbox"><img src="/img/cover.jpg" alt="Island Conquest" draggable="false"></div><h1 class="title">Island Conquest</h1><div class="muted">ศึกชิงเกาะ • เล่นออนไลน์</div></div>' +
      '<div class="card-box stack">' +
        '<button class="btn btn-ok btn-block" data-act="createRoom">➕ สร้างห้องใหม่</button>' +
        '<div class="muted center">หรือใส่รหัสห้อง 4 ตัวอักษรจากเพื่อน</div>' +
        '<input id="roomcode" class="text codein" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="รหัสห้อง" value="' + esc(ui.roomInput || '') + '">' +
        (ui.landingError ? '<div class="err">' + esc(ui.landingError) + '</div>' : '') +
        '<button class="btn btn-primary btn-block" data-act="enterRoom">เข้าห้อง</button>' +
      '</div></div>';
  }
  function roomBadge(ui) {
    return '<div class="roombadge">ห้อง <b>' + esc(ui.room || '') + '</b> <button class="btn btn-soft sm" data-act="copyInvite">🔗 คัดลอกลิงก์เชิญ</button></div>';
  }

  function joinScreen(state, ui) {
    var inGame = state.phase !== 'lobby';
    var roster = state.players.map(function (p) { return rosterRow(p, null, state); }).join('');
    return '<div class="screen">' +
      '<div class="hero"><div class="coverbox"><img src="/img/cover.jpg" alt="Island Conquest" draggable="false"></div><h1 class="title">Island Conquest</h1><div class="muted">ศึกชิงเกาะ</div></div>' +
      roomBadge(ui) + '<div class="card-box stack">' +
        '<div><b>' + (inGame ? 'เกมเริ่มไปแล้ว' : 'เข้าร่วมห้อง') + '</b>' +
        '<div class="muted">' + (inGame ? 'ถ้าคุณเป็นผู้เล่นเดิม ใส่ “ชื่อเดิม” เพื่อกลับเข้าเกม' : 'ตั้งชื่อของคุณ (ไม่เกิน 16 ตัวอักษร)') + '</div></div>' +
        '<input id="name" class="text" maxlength="16" autocomplete="off" placeholder="ชื่อของคุณ" value="' + esc(ui.joinName || '') + '">' +
        (ui.joinError ? '<div class="err">' + esc(ui.joinError) + '</div>' : '') +
        '<button class="btn btn-primary btn-block" data-act="join">' + (inGame ? 'กลับเข้าเกม' : 'เข้าร่วมเกม') + '</button>' +
        (state.players.length ? '<div><div class="muted" style="margin:4px 0">ผู้เล่นในห้องตอนนี้ (' + state.players.length + '/' + state.maxPlayers + ')</div><ul class="roster">' + roster + '</ul></div>' : '') +
        '<button class="btn btn-soft btn-block" data-act="changeRoom">← เปลี่ยนห้อง</button>' +
      '</div></div>';
  }

  function lobbyScreen(state, ui) {
    var me = state.you, isOwner = me.id === state.ownerId;
    var roster = state.players.map(function (p) { return rosterRow(p, me, state); }).join('');
    var colors = B.COLORS.map(function (c) {
      var taken = state.players.filter(function (p) { return p.color === c && p.id !== me.id; })[0];
      var mine = me.color === c;
      return '<button class="colorpick' + (mine ? ' on' : '') + '" style="--c:' + colorHex(c) + '" data-act="setColor" data-color="' + c + '"' + (taken ? ' disabled' : '') + '>' +
        tok(c) + '<b>' + esc(ANIMAL[c]) + '</b><small>' + (taken ? esc(taken.name) : mine ? '✓ ของคุณ' : 'ว่าง') + '</small></button>';
    }).join('');
    var enough = state.players.length >= state.minPlayers;
    return '<div class="screen stack">' +
      '<div class="hero" style="padding-top:10px"><h1 class="title" style="font-size:26px">ห้องรอ</h1><div class="muted">ผู้เล่น ' + state.players.length + '/' + state.maxPlayers + ' คน</div></div>' +
      '<div class="card-box center"><div class="muted">รหัสห้อง</div><div class="bigcode">' + esc(ui.room || '') + '</div><button class="btn btn-primary btn-block" data-act="copyInvite">🔗 คัดลอกลิงก์เชิญส่งเพื่อน</button></div>' +
      '<div class="card-box"><div class="muted" style="margin-bottom:8px">เลือกตัวละครของคุณ (จุดเริ่มต้นตามมุมกระดาน)</div><div class="colors">' + colors + '</div></div>' +
      '<div class="card-box"><ul class="roster">' + roster + '</ul></div>' +
      (isOwner
        ? '<button class="btn btn-ok btn-block" data-act="start"' + (enough ? '' : ' disabled') + '>▶ เริ่มเกม</button>' +
          '<div class="muted center">' + (enough ? 'กดเริ่มเมื่อทุกคนเข้าห้องและเลือกสีครบ' : 'ต้องมีผู้เล่นอย่างน้อย ' + state.minPlayers + ' คนจึงจะเริ่มได้') + '</div>'
        : '<div class="card-box center"><b>รอ ' + esc(nameOf(state, state.ownerId)) + ' กดเริ่มเกม…</b></div>') +
      '<button class="btn btn-soft btn-block" data-act="rules">📖 กติกา และไพ่ทั้ง 9 แบบ</button>' +
      '<button class="btn btn-soft btn-block" data-act="leave">🚪 ออกจากห้อง</button></div>';
  }

  // ------------------------------------------------------------------ หน้าเล่นเกม
  function dieHtml(state) {
    if (!state.dice) return '';
    return '<div class="die ' + (state.dice.rolling ? 'rolling' : 'done') + '">' + (state.dice.rolling ? '?' : state.dice.value) + '</div>';
  }

  function topbarHtml(state) {
    var me = state.you, d = derive(state);
    var tp = pOf(state, state.turnPlayerId);
    var label = d.over ? 'เกมจบแล้ว' : d.isMyTurn ? '🎯 เทิร์นของคุณ' : (tp ? 'เทิร์น ' + esc(tp.name) : '');
    var flags = '';
    if (state.finallyOverActive && state.phase === 'playing') flags += '<span class="flag fo">🔥 ทอย 6 = จบเกม</span>';
    if (state.endScene && state.phase === 'playing') flags += '<span class="flag es">🪼 ปิดฉาก ' + (IC.END_SCENE_TURNS + 1 - state.endScene.turnsLeft) + '/' + IC.END_SCENE_TURNS + '</span>';
    return '<div class="topbar" style="--c:' + colorHex(me.color) + '">' + tok(me.color, 'sm') +
      '<div class="who"><b>' + esc(me.name) + '</b><small>' + label + ' • #' + state.turn.number + '</small></div>' + flags + dieHtml(state) +
      '<button class="iconbtn" data-act="sound" aria-label="เปิด/ปิดเสียง">' + (root.IC && root.IC.audio && !root.IC.audio.isOn() ? '🔇' : '🔊') + '</button>' +
      '<button class="iconbtn" data-act="rules" aria-label="กติกา">📖</button></div>';
  }

  function playersHtml(state) {
    return '<div class="players" style="--n:' + state.players.length + '">' + state.players.map(function (p) {
      var turn = p.id === state.turnPlayerId && state.phase === 'playing';
      var base = p.pieces.filter(function (x) { return x.pos < 0; }).length;
      return '<div class="pl' + (turn ? ' turn' : '') + '" data-pid="' + p.id + '" style="--c:' + colorHex(p.color) + '">' +
        '<div class="n">' + tok(p.color, 'xs') + '<span class="nm">' + esc(p.name) + '</span></div>' +
        '<div class="meta"><span title="เกาะ">🏝 ' + p.islands + '/' + B.ISLAND_WIN + '</span><span title="คะแนนบนกระดาน">⭐ ' + p.score + '</span></div>' +
        '<div class="meta"><span>🃏 ' + p.handCount + '</span><span>🏠 ' + base + '</span>' + (p.connected ? '' : '<span class="off">ออฟไลน์</span>') + '</div></div>';
    }).join('') + '</div>';
  }

  function pieceLabel(state, playerId, pieceId) {
    var p = pOf(state, playerId); if (!p) return '?';
    var pc = p.pieces[pieceId];
    return esc(p.name) + ' • ' + (pc && pc.pos >= 0 ? cellLabel(pc.pos) : 'ฐาน');
  }

  // แผงข้อความ/ปุ่มใต้กระดาน
  function panelHtml(state, ui, d) {
    var me = state.you, sel = ui.sel, t = state.turn;
    if (d.over) return '<div class="panel"><button class="btn btn-warn btn-block" data-act="showOver">🏁 ดูผลการจบเกม</button></div>';

    if (state.frames.length) {
      var top = state.frames[state.frames.length - 1];
      var wait = state.waitingCount;
      return '<div class="panel wait"><div class="pt">⚡ ' + esc(describeFrame(state, top)) + '</div>' +
        '<div class="ps">' + (me.window ? 'ถึงตาคุณตอบโต้' : wait ? 'รอผู้เล่น ' + wait + ' คน เลือกตอบโต้หรือผ่าน…' : 'กำลังดำเนินการ…') + '</div></div>';
    }
    if (d.rolling) return '<div class="panel"><div class="pt">🎲 กำลังทอยเต๋า…</div></div>';

    if (!d.isMyTurn) {
      var tp = pOf(state, state.turnPlayerId);
      return '<div class="panel"><div class="pt">รอ ' + esc(tp ? tp.name : '') + ' เล่น</div><div class="ps">คุณยังตอบโต้ได้ เมื่อมีไพ่ที่ใช้ได้ ระบบจะเด้งถามเอง</div></div>';
    }

    // เลือกเป้าหมายของไพ่
    if (sel && sel.k === 'card') {
      var c = T[sel.cardId], msg = '', ok = false, extra = '';
      if (sel.cardId === 'kickOut') { msg = sel.picks.length ? 'เตะ ' + pieceLabel(state, sel.picks[0].playerId, sel.picks[0].pieceId) : 'แตะตัวเล่นของคู่แข่งบนกระดานที่จะเตะ (ตัวบนเซฟโซนเตะไม่ได้)'; ok = sel.picks.length === 1; }
      else if (sel.cardId === 'boost') { msg = sel.picks.length ? 'เร่งเครื่อง ' + pieceLabel(state, sel.picks[0].playerId, sel.picks[0].pieceId) : 'แตะตัวเล่นของคุณที่จะเดินเพิ่ม 3 ช่อง'; ok = sel.picks.length === 1; }
      else if (sel.cardId === 'swap') { msg = sel.picks.length === 0 ? 'แตะตัวเล่นตัวแรกที่จะสลับ (ห้ามอยู่บนเกาะ)' : sel.picks.length === 1 ? 'ตัวแรก: ' + pieceLabel(state, sel.picks[0].playerId, sel.picks[0].pieceId) + ' — แตะตัวที่สอง' : 'สลับ ' + pieceLabel(state, sel.picks[0].playerId, sel.picks[0].pieceId) + ' ↔ ' + pieceLabel(state, sel.picks[1].playerId, sel.picks[1].pieceId); ok = sel.picks.length === 2; }
      else if (sel.cardId === 'steal') {
        msg = 'เลือกผู้เล่นที่จะสุ่มขโมยไพ่ 1 ใบ';
        extra = '<div class="pickrow">' + state.players.filter(function (p) { return p.id !== me.id; }).map(function (p) {
          return '<button class="pickp' + (sel.target === p.id ? ' on' : '') + '" style="--c:' + colorHex(p.color) + '" data-act="pickPlayer" data-pid="' + p.id + '">' + tok(p.color, 'xs') + esc(p.name) + ' <small>🃏' + p.handCount + '</small></button>';
        }).join('') + '</div>';
        ok = sel.target != null;
      }
      return '<div class="panel"><div class="pt">' + cardImg(sel.cardId, 'mini') + '<span>' + esc(c.name) + '</span></div><div class="ps">' + esc(msg) + '</div>' + extra +
        '<div class="prow"><button class="btn btn-soft" data-act="cancelSel">ยกเลิก</button><button class="btn btn-ok" data-act="confirmCard"' + (ok ? '' : ' disabled') + '>ยืนยันใช้ไพ่</button></div></div>';
    }

    if (d.six) {
      var baseN = me && state.players.filter(function (p) { return p.id === me.id; })[0].pieces.filter(function (x) { return x.pos < 0; }).length;
      return '<div class="panel"><div class="pt">🎉 ทอยได้ 6!</div><div class="ps">เลือก 1 อย่าง (หลังจากนั้นทอยต่อได้อีกครั้ง)</div><div class="prow">' +
        '<button class="btn btn-primary" data-act="six" data-choice="release"' + (baseN ? '' : ' disabled') + '>🚪 นำตัวออกจากฐาน (' + baseN + ')</button>' +
        '<button class="btn btn-warn" data-act="six" data-choice="run">👣 เดิน 12 ช่อง</button></div></div>';
    }

    if (d.mv) {
      var mv = d.mv, steps = mv.steps;
      var name = mv.kind === 'boost' ? '🐬 เร่งเครื่อง' : mv.kind === 'run' ? '👣 เดิน 12 ช่อง' : '🎲 เดิน ' + steps + ' ช่อง';
      var pcs = me && state.players.filter(function (p) { return p.id === me.id; })[0].pieces;
      var chosen = sel && sel.k === 'move' && sel.pieceId != null ? pcs[sel.pieceId] : null;
      var hint;
      if (!chosen) hint = 'แตะตัวเล่นของคุณที่จะเดิน ' + steps + ' ช่อง';
      else if (sel.dest == null) hint = 'แตะช่องที่ไฮไลต์เพื่อเลือกปลายทาง (เดินครบ ' + steps + ' ช่องพอดี เลี้ยวได้ ห้ามเฉียง)';
      else hint = 'ไปช่อง ' + cellLabel(sel.dest) + ' ได้ กดยืนยัน หรือแตะช่องอื่นเพื่อเปลี่ยน';
      return '<div class="panel"><div class="pt">' + name + '</div><div class="ps">' + esc(hint) + '</div>' +
        '<div class="prow">' + (chosen && mv.pieceId == null ? '<button class="btn btn-soft" data-act="cancelSel">เปลี่ยนตัว</button>' : '') +
        '<button class="btn btn-ok" data-act="confirmMove"' + (chosen && sel.dest != null ? '' : ' disabled') + '>✔ ยืนยันเดิน' + (sel && sel.dest != null ? ' → ' + cellLabel(sel.dest) : '') + '</button></div></div>';
    }

    var tip;
    if (t.action === null) tip = 'เลือก 1 อย่าง: 🎲 ทอยเต๋า หรือ 🃏 จั่วไพ่ 1–2 ใบ (ใช้ไพ่ได้ตลอดเทิร์น)';
    else if (t.action === 'draw') tip = 'จั่วแล้ว ' + t.draws + '/' + IC.MAX_DRAWS_PER_TURN + ' ใบ — จั่วต่อ ใช้ไพ่ หรือกด “จบเทิร์น”';
    else if (t.canRoll) tip = 'ทอยซ้ำได้อีกครั้ง หรือกด “จบเทิร์น”';
    else tip = 'เดินเสร็จแล้ว ใช้ไพ่ต่อหรือกด “จบเทิร์น”';
    return '<div class="panel mine"><div class="pt">🎯 ถึงเทิร์นของคุณ</div><div class="ps">' + esc(tip) + '</div></div>';
  }

  function handHtml(state, ui, d) {
    var me = state.you;
    if (!me.hand.length) return '<div class="handstrip empty">🃏 ยังไม่มีไพ่บนมือ</div>';
    return '<div class="handstrip">' + sortHand(me.hand).map(function (c) {
      var ct = T[c.id];
      var dim = !!whyNotPlay(state, d, c);
      return '<button class="hc' + (dim ? ' dim' : '') + ((ui.newUids || []).indexOf(c.uid) >= 0 ? ' new' : '') + '" data-act="cardMenu" data-uid="' + c.uid + '" aria-label="' + esc(ct.name) + '">' + cardImg(c.id) + '<span class="chip ' + ct.tagClass + '">' + esc(ct.tag) + '</span></button>';
    }).join('') + '<div class="hcount">' + me.hand.length + '/' + IC.MAX_HAND + '</div></div>';
  }

  function dockHtml(state, d) {
    var t = state.turn;
    return '<div class="dock"><div class="row">' +
      '<button class="btn btn-warn" data-act="roll"' + (d.canRoll ? '' : ' disabled') + '>🎲 ทอยเต๋า</button>' +
      '<button class="btn btn-primary" data-act="draw"' + (d.canDraw ? '' : ' disabled') + '>🃏 จั่ว (' + (d.isMyTurn ? t.draws : 0) + '/' + IC.MAX_DRAWS_PER_TURN + ')</button>' +
      '<button class="btn btn-ok" data-act="endTurn"' + (d.canEnd ? '' : ' disabled') + '>⏭ จบเทิร์น</button></div></div>';
  }

  // ------------------------------------------------------------------ หน้าต่างทับ
  function tipsHtml(tips) { return '<ul class="tips">' + tips.map(function (t) { return '<li><span>' + esc(t) + '</span></li>'; }).join('') + '</ul>'; }

  function reactSheet(state, ui) {
    var w = state.you.window; if (!w) return '';
    var top = state.frames[state.frames.length - 1];
    if (!top || top.id !== w.frameId) return '';
    var body = '<div class="sh-t">⚡ ตอบโต้หรือผ่าน?</div><div class="sh-d">' + esc(describeFrame(state, top)) + '</div>';
    if (ui.sel && ui.sel.k === 'react') {
      body += '<div class="muted" style="margin:6px 0">เลือกตัวเล่นของผู้โจมตีที่จะถูกเตะกลับฐาน</div><div class="pickrow">' +
        w.reflectTargets.map(function (pid) {
          return '<button class="pickp" data-act="reactPiece" data-piece="' + pid + '">' + pieceLabel(state, top.byId, pid) + '</button>';
        }).join('') + '</div><button class="btn btn-soft btn-block" style="margin-top:8px" data-act="cancelSel">กลับ</button>';
    } else {
      body += '<div class="react-row">' + w.options.map(function (o) {
        return '<button data-act="react" data-uid="' + o.uid + '" data-card="' + o.id + '">' + cardImg(o.id) + '<span>' + esc(T[o.id].name) + '</span></button>';
      }).join('') + '</div><button class="btn btn-soft btn-block" style="margin-top:10px" data-act="pass" data-frame="' + w.frameId + '">ผ่าน (ไม่ตอบโต้)</button>' +
        '<label class="autochk"><input type="checkbox" data-act="auto"' + (state.players.filter(function (p) { return p.id === state.you.id; })[0].autoPass ? ' checked' : '') + '> ผ่านอัตโนมัติทุกครั้ง (ไม่ถามอีก)</label>';
    }
    return '<div class="sheet" data-stop="1">' + body + '</div>';
  }

  function cardMenu(state, ui, d) {
    var card = state.you.hand.filter(function (c) { return c.uid === ui.menu; })[0];
    if (!card) return '';
    var ct = T[card.id], why = whyNotPlay(state, d, card);
    return '<div class="ov" data-act="closeMenu"><div class="modal" data-stop="1"><button class="x" data-act="closeMenu">✕</button>' +
      '<span class="chip ' + ct.tagClass + '">' + esc(ct.tag) + '</span>' + cardImg(card.id, 'cardimg') +
      '<div class="who" style="font-size:18px">' + esc(ct.name) + '</div><div class="muted">' + esc(ct.desc) + '</div>' + tipsHtml(ct.tips) +
      (why ? '<div class="muted" style="margin-top:8px;color:#b45309">' + esc(why) + '</div>' : '') +
      '<div class="prow" style="margin-top:12px"><button class="btn btn-ok" style="flex:1" data-act="useCard" data-uid="' + card.uid + '"' + (why ? ' disabled' : '') + '>ใช้ไพ่</button>' +
      '<button class="btn btn-soft" data-act="discard" data-uid="' + card.uid + '">🗑 ทิ้ง</button></div></div></div>';
  }

  function revealModal(state) {
    var r = state.reveal, ct = T[r.cardId], me = state.you;
    var mine = r.playerId === me.id;
    return '<div class="ov"><div class="modal"><div class="kicker">' + (r.mode === 'drawn' ? 'จั่วได้ไพ่ที่ต้องเปิดทันที!' : 'เปิดไพ่ให้ทุกคนดู') + '</div>' +
      '<div class="who">' + (mine ? 'คุณ' : esc(r.playerName)) + (r.mode === 'drawn' ? ' จั่วได้' : ' ใช้ไพ่') + ' “' + esc(ct.name) + '”</div>' +
      cardImg(r.cardId, 'cardimg') + tipsHtml(ct.tips) +
      '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="dismissReveal">รับทราบ</button></div></div>';
  }

  function rulesModal(state) {
    var items = IC.CARD_ORDER.map(function (id) {
      var c = T[id];
      return '<div class="rule-item">' + cardImg(id) + '<div><div class="nm">' + esc(c.name) + ' <span class="chip ' + c.tagClass + '">' + esc(c.tag) + '</span> <span class="muted">' + c.count + ' ใบ</span></div>' + tipsHtml(c.tips) + '</div></div>';
    }).join('');
    var score = IC.SCORE_TABLE.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><b>' + r[1] + '</b></div>'; }).join('');
    var auto = '';
    if (state.you) {
      var mePl = state.players.filter(function (p) { return p.id === state.you.id; })[0];
      auto = '<label class="autochk"><input type="checkbox" data-act="auto"' + (mePl && mePl.autoPass ? ' checked' : '') + '> ผ่านการตอบโต้อัตโนมัติ (ไม่ถามเมื่อมีไพ่ตอบโต้)</label>';
    }
    var owner = '';
    if (state.you && state.you.id === state.ownerId && state.phase === 'playing') {
      owner = '<div class="ownertools"><b>เครื่องมือเจ้าของห้อง</b><div class="muted">ใช้เมื่อมีคนหลุด/ค้างนาน</div><div class="prow">' +
        '<button class="btn btn-warn" data-act="hostSkip">⏭ ข้ามเทิร์น</button>' +
        (state.frames && state.frames.length ? '<button class="btn btn-warn" data-act="hostForce">⏩ ข้ามการตอบโต้</button>' : '') + '</div></div>';
    }
    if (state.you && state.you.id === state.ownerId && state.phase === 'playing') {
      owner += '<div class="ownertools"><b>จบเกมกลางคัน</b><div class="muted">กลับห้องรอ ทุกคนยังอยู่ในห้อง เริ่มรอบใหม่ได้</div><div class="prow"><button class="btn btn-warn" data-act="endGame">🏁 จบเกม กลับห้องรอ</button></div></div>';
    }
    if (state.you) owner += '<div class="prow" style="margin:8px 0"><button class="btn btn-soft" data-act="exitRoom">🚪 ออกจากห้องนี้ (กลับหน้าแรก)</button></div>';
    return '<div class="ov" data-act="closeRules"><div class="modal wide" data-stop="1"><button class="x" data-act="closeRules">✕</button>' +
      '<h3 class="title" style="margin:0 0 6px">📖 กติกาย่อ</h3>' + owner + volBox() +
      '<ul class="tips"><li><span>เทิร์นละ 1 ทางเลือก: ทอยเต๋าแล้วเดิน หรือ จั่วไพ่ 1–2 ใบ (ใช้ไพ่ได้ตลอดเทิร์น แม้หลังทอย)</span></li>' +
      '<li><span>เดินครบแต้มพอดี เลี้ยวได้ทุกช่อง ห้ามเฉียง ห้ามเหยียบช่องเดิมซ้ำ หยุดตรงไหนก็ได้ที่เดินครบ</span></li>' +
      '<li><span>ทอยได้ 6: นำตัวออกจากฐาน (ไปช่องเริ่มต้นตามมุม) หรือเดิน 12 ช่อง แล้วทอยต่อได้</span></li>' +
      '<li><span>เดินไปหยุดช่องที่มีคู่แข่ง = ปะทะ เขาถูกเตะกลับฐาน ยกเว้นเซฟโซน (เปลือกหอย) ซึ่งอยู่ร่วมกันได้</span></li>' +
      '<li><span>ครอบครอง 4 จาก 5 เกาะ ชนะทันที เกาะเป็นของตัวที่เข้ามาล่าสุด</span></li></ul>' + auto +
      '<h4 style="margin:12px 0 6px;color:#334155">ไพ่ทั้ง 72 ใบ</h4>' + items +
      '<h4 style="margin:16px 0 6px;color:#334155">คะแนนช่อง (ตัดสินตอนปิดฉาก)</h4><div class="score">' + score + '</div>' +
      '<p class="muted">ตัดสิน: 1) เกาะมากที่สุด 2) คะแนนรวมบนกระดาน 3) เท่ากัน = เสมอ (ตัวในฐานไม่นับ)</p></div></div>';
  }

  function volBox() {
    var A = root.IC && root.IC.audio; if (!A || !A.getVolume) return '';
    function row(kind, label) { return '<label class="volrow"><span>' + label + '</span><input type="range" min="0" max="100" step="5" value="' + Math.round(A.getVolume(kind) * 100) + '" data-vol="' + kind + '" aria-label="' + label + '"></label>'; }
    return '<div class="volbox"><b>🔊 เสียง</b>' + row('music', 'เพลงและคลื่น') + row('sfx', 'เสียงเอฟเฟกต์') + '</div>';
  }

  function overModal(state) {
    var me = state.you, go = state.gameOver, isOwner = me.id === state.ownerId;
    var table = (go.table || []).map(function (r) {
      var win = go.winnerIds.indexOf(r.id) >= 0;
      return '<div class="trow' + (win ? ' win' : '') + '" style="--c:' + colorHex(r.color) + '">' + tok(r.color, 'xs') + '<span class="nm">' + esc(r.name) + (win ? ' 🏆' : '') + '</span><span>🏝 ' + r.islands + '</span><span>⭐ ' + r.score + '</span></div>';
    }).join('');
    return '<div class="ov top"><div class="modal"><div style="font-size:54px">🏁</div><h2 class="title" style="margin:2px 0 8px">เกมจบแล้ว!</h2>' +
      '<div style="font-weight:900;color:#0369a1;margin-bottom:6px">' + esc(go.title) + '</div><div class="muted" style="margin-bottom:10px">' + esc(go.detail) + '</div>' +
      '<div class="ttable">' + table + '</div>' +
      (isOwner ? '<button class="btn btn-primary btn-block" data-act="reset">เริ่มรอบใหม่ (กลับห้องรอ)</button>'
               : '<div class="card-box muted">รอ ' + esc(nameOf(state, state.ownerId)) + ' (เจ้าของห้อง) เริ่มรอบใหม่…</div>') +
      '<button class="btn btn-soft btn-block" style="margin-top:8px" data-act="closeOver">ปิดหน้าต่างนี้ (ดูกระดานต่อ)</button></div></div>';
  }

  function renderOverlay(state, ui) {
    if (!state || !state.you) return '';
    var d = derive(state);
    if (state.phase === 'over' && state.gameOver && !ui.closedOver) return overModal(state);
    if (ui.showRules) return rulesModal(state);
    if (state.phase === 'playing' && state.reveal && state.reveal.id !== ui.dismissedReveal &&
        (state.reveal.mode === 'drawn' || state.reveal.cardId === 'endScene')) return revealModal(state);
    if (ui.menu && state.phase === 'playing') return cardMenu(state, ui, d);
    if (state.phase === 'playing') return reactSheet(state, ui);
    return '';
  }

  var api = {
    esc: esc, derive: derive, whyNotPlay: whyNotPlay, describeFrame: describeFrame, colorHex: colorHex,
    landingScreen: landingScreen, joinScreen: joinScreen, lobbyScreen: lobbyScreen, topbarHtml: topbarHtml, playersHtml: playersHtml, panelHtml: panelHtml,
    handHtml: handHtml, dockHtml: dockHtml, renderOverlay: renderOverlay, fmtTime: fmtTime, tok: tok, cardImg: cardImg, ANIMAL: ANIMAL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IC.view = api;
})(typeof window !== 'undefined' ? window : this);
