/* หน้ามือถือผู้เล่น: รับสถานะจากเซิร์ฟเวอร์ (SSE) วาดหน้าจอ จัดการการเลือกตัวเล่น/ช่อง/ไพ่ แล้วส่งคำสั่งกลับไป */
(function () {
  var V = window.IC.view, B = window.BOARD, T = window.IC.CARD_TYPES;
  var $app = document.getElementById('app');
  var $game = document.getElementById('game');
  var $top = document.getElementById('gTop'), $pl = document.getElementById('gPlayers'), $boardEl = document.getElementById('gBoard');
  var $panel = document.getElementById('gPanel'), $hand = document.getElementById('gHand'), $dock = document.getElementById('gDock');
  var $toast = document.getElementById('toast'), $conn = document.getElementById('conn');
  var $ov = null;

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  function ss(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }

  var state = null, rev = null;
  var token = '';
  var ui = { room: '', roomInput: '', landingError: '', joinName: ls('ic_name') || '', joinError: '', showRules: false, menu: null, sel: null, closedOver: false, dismissedReveal: Number(ss('ic_dismissed')) || 0 };
  var toastTimer = null, board = null, autoRejoinTried = false;
  var cache = { app: '', top: '', pl: '', panel: '', hand: '', dock: '', ov: '' };
  var prevTurnId = null, prevPhase = null, prevOverKey = '', lastPlayedId = 0;
  var reachCache = { key: '', cells: [] };
  var AU = window.IC.audio, snd = { init: false, fx: 0, dice: 0, frame: 0, over: '', reveal: 0 };
  function updateSoundBtns() {
    var f = document.getElementById('sndFloat');
    if (f) f.textContent = AU && !AU.isOn() ? '🔇' : '🔊';
    cache.top = '';
  }
  // ---- ลูกเต๋ากลางจอ
  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  var diceEl = null, diceTimers = [], diceAnimId = null;
  function faceHtml(n) { var h = ''; for (var i = 0; i < 9; i++) h += '<i class="' + (PIPS[n].indexOf(i) >= 0 ? 'p' : '') + '"></i>'; return h; }
  function showDice(value, who) {
    if (!diceEl) { diceEl = document.createElement('div'); diceEl.id = 'diceOv'; document.body.appendChild(diceEl); }
    diceTimers.forEach(clearTimeout); diceTimers = [];
    diceEl.className = '';
    diceEl.innerHTML = '<div class="dshadow"></div><div class="dicebox rolling"><div class="face">' + faceHtml(1 + Math.floor(Math.random() * 6)) + '</div></div><div class="dlabel"></div>';
    void diceEl.offsetWidth; diceEl.className = 'show';
    var box = diceEl.querySelector('.dicebox'), face = box.querySelector('.face'), label = diceEl.querySelector('.dlabel');
    label.textContent = who + ' กำลังทอยเต๋า…';
    var cyc = setInterval(function () { face.innerHTML = faceHtml(1 + Math.floor(Math.random() * 6)); }, 75);
    diceTimers.push(cyc);
    diceTimers.push(setTimeout(function () {
      clearInterval(cyc);
      face.innerHTML = faceHtml(value); box.classList.remove('rolling'); box.classList.add('land');
      label.innerHTML = esc2(who) + ' ทอยได้ <b>' + value + '</b>';
    }, 800));
    diceTimers.push(setTimeout(function () { diceEl.className = 'show out'; }, 2000));
    diceTimers.push(setTimeout(function () { diceEl.className = ''; diceEl.innerHTML = ''; }, 2400));
  }
  function esc2(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // ---- แบนเนอร์เทิร์น / ป๊อปอัปไพ่ / ลูกปลิวไพ่ขโมย / ไพ่ใหม่ / กระดาษสี
  var bannerEl = null, bannerT = null, popEl = null, popT = null;
  function showBanner(html, kind) {
    if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'banner'; document.body.appendChild(bannerEl); }
    clearTimeout(bannerT); bannerEl.className = ''; bannerEl.innerHTML = '<span class="bn">' + html + '</span>'; void bannerEl.offsetWidth;
    bannerEl.className = 'show ' + (kind || '');
    bannerT = setTimeout(function () { bannerEl.className = 'out ' + (kind || ''); }, kind === 'mine' ? 1500 : 1100);
    setTimeout(function () { if (bannerEl && /out/.test(bannerEl.className)) bannerEl.className = ''; }, kind === 'mine' ? 1900 : 1500);
  }
  function cardPop(cardId, who, verb) {
    if (!popEl) { popEl = document.createElement('div'); popEl.id = 'cardPop'; document.body.appendChild(popEl); }
    clearTimeout(popT); popEl.className = ''; void popEl.offsetWidth;
    popEl.innerHTML = '<div class="cp-in"><div class="cp-card"><img src="/cards/' + cardId + '.webp" alt="" draggable="false"></div><div class="cp-lbl">' + esc2(who) + ' ' + (verb || 'ใช้') + ' “' + esc2(T[cardId].name) + '”</div></div>';
    popEl.className = 'show';
    popT = setTimeout(function () { popEl.className = 'out'; setTimeout(function () { popEl.className = ''; popEl.innerHTML = ''; }, 350); }, 1350);
  }
  function flyCard(fromEl, toEl, label) {
    if (!fromEl || !toEl || !fromEl.getBoundingClientRect) return;
    var f = fromEl.getBoundingClientRect(), t = toEl.getBoundingClientRect();
    var g = document.createElement('div'); g.className = 'flycard'; g.textContent = label || '🃏';
    g.style.left = (f.left + f.width / 2 - 22) + 'px'; g.style.top = (f.top + f.height / 2 - 30) + 'px';
    document.body.appendChild(g);
    var dx = t.left + t.width / 2 - (f.left + f.width / 2), dy = t.top + t.height / 2 - (f.top + f.height / 2);
    if (!g.animate) { setTimeout(function () { g.remove(); }, 300); return; }
    var an = g.animate([
      { transform: 'translate(0,0) rotate(-8deg) scale(.8)', opacity: 0 },
      { transform: 'translate(' + dx * 0.2 + 'px,' + (dy * 0.2 - 50) + 'px) rotate(10deg) scale(1.2)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(360deg) scale(.7)', opacity: 0.2 }
    ], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
    an.onfinish = function () { g.remove(); };
  }
  function chipOf(pid) { return document.querySelector('#gPlayers .pl[data-pid="' + pid + '"]'); }
  function boardFx(f) {
    if (f.type === 'steal') flyCard(chipOf(f.victimId), chipOf(f.thiefId), '🃏');
    else if (f.type === 'island') {
      var p = state.players.filter(function (x) { return x.id === f.ownerId; })[0];
      if (p) showBanner('🏝️ ' + esc2(state.you && p.id === state.you.id ? 'คุณ' : p.name) + ' ยึดเกาะ!', 'island');
      AU.sfx('win');
    } else if (f.type === 'stop') {
      showBanner('✋ หยุดเดี๋ยวนี้!', 'stop'); AU.sfx('alert');
    } else if (f.type === 'shield') AU.sfx('shield');
    else if (f.type === 'reflect') AU.sfx('reflect');
  }
  function confetti() {
    var c = document.createElement('div'); c.id = 'confetti';
    var cols = ['#f43f5e', '#0ea5e9', '#10b981', '#f59e0b', '#a78bfa', '#fde047', '#ffffff'];
    for (var i = 0; i < 70; i++) {
      var s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%'; s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 0.8) + 's'; s.style.animationDuration = (2 + Math.random() * 1.8) + 's';
      s.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px'); s.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      s.style.width = (6 + Math.random() * 6) + 'px'; s.style.height = (10 + Math.random() * 8) + 'px';
      c.appendChild(s);
    }
    document.body.appendChild(c); setTimeout(function () { c.remove(); }, 4800);
  }
  var prevHand = null;
  function handTick() {
    var uids = state.you ? state.you.hand.map(function (c) { return c.uid; }) : [];
    if (prevHand && state.phase === 'playing') {
      var added = uids.filter(function (u) { return prevHand.indexOf(u) < 0; });
      if (added.length) {
        ui.newUids = added;
        var from = document.querySelector('#gDock [data-act="draw"]') || document.getElementById('gBoard');
        setTimeout(function () { flyCard(from, document.getElementById('gHand'), '🃏'); }, 0);
        setTimeout(function () { ui.newUids = []; cache.hand = ''; renderAll(); }, 900);
      }
    }
    prevHand = uids;
  }

  function diceTick() {
    var d = state.dice, id = d ? d.id : 0;
    if (diceAnimId !== null && d && !d.rolling && id !== diceAnimId && state.phase === 'playing') {
      var p = state.players.filter(function (x) { return x.id === d.playerId; })[0];
      showDice(d.value, p ? (state.you && p.id === state.you.id ? 'คุณ' : p.name) : 'ผู้เล่น');
    }
    diceAnimId = id;
  }

  function playSounds() {
    var s = state, myId = s.you ? s.you.id : null;
    var maxFx = snd.fx;
    (s.fx || []).forEach(function (f) { if (f.id > maxFx) maxFx = f.id; });
    var dId = s.dice ? s.dice.id : 0, fr = s.you && s.you.window ? s.you.window.frameId : 0;
    var ov = s.phase === 'over' && s.gameOver ? s.gameOver.title : '';
    var rvId = s.reveal ? s.reveal.id : 0;
    if (snd.init && s.phase !== 'lobby') {
      (s.fx || []).filter(function (f) { return f.id > snd.fx; }).forEach(function (f) {
        if (f.type === 'move') { var n = Math.min(f.path.length - 1, 12); for (var i = 0; i < n; i++) AU.sfx('step', i * 125); }
        else if (f.type === 'kick') AU.sfx('kick');
        else if (f.type === 'release') AU.sfx('release');
        else if (f.type === 'swap') AU.sfx('swap');
        else if (f.type === 'steal') AU.sfx('steal');
      });
      if (s.dice && !s.dice.rolling && dId !== snd.dice) AU.sfx('dice');
      if (fr && fr !== snd.frame) AU.sfx('alert');
      if (ov && ov !== snd.over) AU.sfx('win');
      if (rvId && rvId !== snd.reveal && s.reveal.mode !== 'drawn' && s.reveal.playerId !== myId) {
        var cid = s.reveal.cardId; AU.sfx(cid === 'shield' ? 'shield' : cid === 'reflect' ? 'reflect' : 'card');
      }
    }
    snd.init = true; snd.fx = maxFx; snd.dice = dId; snd.frame = fr; snd.over = ov; snd.reveal = rvId;
  }

  function toast(msg) {
    $toast.textContent = msg; $toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $toast.hidden = true; }, 2800);
  }

  // ---------------------------------------------------------------- เครือข่าย (polling)
  function tokenKey() { return 'ic_token_' + ui.room; }
  function setRoom(code) {
    ui.room = code || '';
    ls('ic_room', ui.room || null);
    try { history.replaceState(null, '', ui.room ? '#' + ui.room : location.pathname); } catch (e) { /* ignore */ }
    token = ui.room ? (ls(tokenKey()) || '') : '';
    state = null; rev = null; autoRejoinTried = false; cache = { app: '', top: '', pl: '', panel: '', hand: '', dock: '', ov: '' };
    ui.sel = null; ui.menu = null;
  }
  function request(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return { error: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ' }; }).then(function (j) { j.__status = r.status; return j; }); })
      .catch(function () { return { error: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตของคุณ', __net: true }; });
  }
  function post(url, body) { return request('POST', url, body); }
  function apply(r) {
    if (!r || !r.state) return;
    rev = r.rev; state = r.state;
    onState();
  }
  function act(type, extra) {
    var body = { room: ui.room, token: token, type: type };
    if (extra) for (var k in extra) body[k] = extra[k];
    return post('/api/action', body).then(function (r) {
      if (r.error) {
        toast(r.error);
        if (r.__status === 401) { token = ''; ls(tokenKey(), null); rev = null; }
        if (r.__status === 404) { toast('ห้องหมดอายุแล้ว'); setRoom(''); renderAll(); }
      } else apply(r);
      return r;
    });
  }
  var pollN = 0, pollTimer = null, polling = false;
  function poll() {
    clearTimeout(pollTimer);
    if (!ui.room) { pollTimer = setTimeout(poll, 1000); return; }
    var room = ui.room, tk = token, hb = (pollN++ % 8 === 0) ? '1' : '0';
    var url = '/api/state?room=' + encodeURIComponent(room) + '&token=' + encodeURIComponent(token) + '&hb=' + hb + (rev != null ? '&rev=' + rev : '');
    request('GET', url).then(function (r) {
      if (room !== ui.room || tk !== token) return; // เปลี่ยนห้อง/ออกจากที่นั่งระหว่างรอ — ทิ้งคำตอบเก่า
      if (r.__net) { $conn.hidden = false; return; }
      $conn.hidden = true;
      if (r.error) {
        if (r.__status === 404) { toast('ไม่พบห้องนี้ (หมดอายุหรือพิมพ์รหัสผิด)'); ui.landingError = 'ไม่พบห้องรหัส ' + room; setRoom(''); renderAll(); }
        return;
      }
      if (r.same) return;
      apply(r);
    }).then(function () { var fast = state && state.phase === 'playing' && ((state.frames && state.frames.length) || (state.you && state.turnPlayerId !== state.you.id));
      pollTimer = setTimeout(poll, document.hidden ? 5000 : (window.__pollMs || (fast ? 700 : 1000))); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollN = 0; poll(); } });

  // ---------------------------------------------------------------- ตัวช่วยอ่านสถานะ
  function me() { return state && state.you ? state.players.filter(function (p) { return p.id === state.you.id; })[0] : null; }
  function pieceAt(pid, id) { var p = state.players.filter(function (x) { return x.id === pid; })[0]; return p ? p.pieces[id] : null; }

  function eligiblePieces(cardId) {
    var out = [], mid = state.you.id;
    state.players.forEach(function (p) {
      p.pieces.forEach(function (pc) {
        if (pc.pos < 0) return;
        var ok = false;
        if (cardId === 'kickOut') ok = p.id !== mid && !B.safe[pc.pos];
        else if (cardId === 'boost') ok = p.id === mid;
        else if (cardId === 'swap') ok = !B.island[pc.pos];
        if (ok) out.push({ playerId: p.id, pieceId: pc.id, pos: pc.pos });
      });
    });
    return out;
  }
  function samePiece(a, b) { return a.playerId === b.playerId && a.pieceId === b.pieceId; }

  function reach(pos, steps) {
    var k = pos + ':' + steps;
    if (reachCache.key !== k) reachCache = { key: k, cells: B.reachable(pos, steps) };
    return reachCache.cells;
  }

  // ---------------------------------------------------------------- ไฮไลต์บนกระดาน
  function currentHighlights() {
    if (!state || !state.you || state.phase !== 'playing') return {};
    var d = V.derive(state), sel = ui.sel, h = { rings: {}, cells: [] };
    var mid = state.you.id;
    if (sel && sel.k === 'card') {
      if (sel.cardId === 'kickOut' || sel.cardId === 'boost' || sel.cardId === 'swap') {
        eligiblePieces(sel.cardId).forEach(function (e) { h.rings[e.playerId + ':' + e.pieceId] = 'tgt'; });
        sel.picks.forEach(function (e) { h.rings[e.playerId + ':' + e.pieceId] = 'sel'; });
      }
      return h;
    }
    if (d.mv) {
      var mine = me();
      if (!(sel && sel.k === 'move' && sel.pieceId != null)) {
        if (d.mv.pieceId == null) mine.pieces.forEach(function (pc) { if (pc.pos >= 0) h.rings[mid + ':' + pc.id] = 'pick'; });
      } else {
        var pc = mine.pieces[sel.pieceId];
        h.rings[mid + ':' + pc.id] = 'sel';
        h.cells = reach(pc.pos, d.mv.steps);
        if (sel.dest != null) {
          h.dest = sel.dest;
          var path = B.findPath(pc.pos, sel.dest, d.mv.steps);
          if (path) h.path = path.slice(1, -1);
        }
      }
    }
    return h;
  }

  // ---------------------------------------------------------------- การแตะบนกระดาน
  function onCell(cell) {
    if (!state || !state.you || state.phase !== 'playing') return;
    var d = V.derive(state), sel = ui.sel, mid = state.you.id;
    if (sel && sel.k === 'card' && (sel.cardId === 'kickOut' || sel.cardId === 'boost' || sel.cardId === 'swap')) {
      var cand = eligiblePieces(sel.cardId).filter(function (e) { return e.pos === cell; });
      if (!cand.length) { toast(sel.cardId === 'kickOut' && pieceOnSafeOrOwn(cell) ? 'ช่องนี้เตะไม่ได้ (เซฟโซน หรือเป็นของคุณ)' : 'แตะตัวเล่นที่เลือกได้ (มีวงเรืองแสง)'); return; }
      var fresh = cand.filter(function (e) { return !sel.picks.some(function (p) { return samePiece(p, e); }); });
      // แตะซ้ำที่ตัวที่เลือกอยู่ = ยกเลิกการเลือกตัวนั้น
      if (!fresh.length) { sel.picks = sel.picks.filter(function (p) { return !cand.some(function (e) { return samePiece(p, e); }); }); renderAll(); return; }
      var pick = fresh[0];
      var max = sel.cardId === 'swap' ? 2 : 1;
      if (max === 1) sel.picks = [{ playerId: pick.playerId, pieceId: pick.pieceId }];
      else sel.picks.push({ playerId: pick.playerId, pieceId: pick.pieceId });
      renderAll(); return;
    }
    if (d.mv) {
      var mine = me();
      var ownHere = mine.pieces.filter(function (pc) { return pc.pos === cell; });
      var chosen = sel && sel.k === 'move' && sel.pieceId != null ? sel.pieceId : null;
      if (chosen != null) {
        var pcs = mine.pieces[chosen];
        if (reach(pcs.pos, d.mv.steps).indexOf(cell) >= 0) { sel.dest = cell; renderAll(); return; }
        if (d.mv.pieceId == null && ownHere.length) {
          var nxt = ownHere.filter(function (pc) { return pc.id !== chosen; })[0] || ownHere[0];
          ui.sel = { k: 'move', pieceId: nxt.id, dest: null }; renderAll(); return;
        }
        toast('เดินไปช่องนั้นให้ครบ ' + d.mv.steps + ' ก้าวพอดีไม่ได้ — แตะช่องที่ไฮไลต์');
        return;
      }
      if (d.mv.pieceId == null) {
        if (ownHere.length) { ui.sel = { k: 'move', pieceId: ownHere[0].id, dest: null }; renderAll(); }
        else toast('แตะตัวเล่นของคุณก่อน');
      }
    }
  }
  function pieceOnSafeOrOwn(cell) { return B.safe[cell] || state.players.some(function (p) { return p.id === state.you.id && p.pieces.some(function (pc) { return pc.pos === cell; }); }); }

  // ---------------------------------------------------------------- เมื่อได้สถานะใหม่
  function normalizeSel() {
    var d = V.derive(state), s = ui.sel;
    if (!s) { if (d.mv && d.mv.pieceId != null && d.isMyTurn) ui.sel = { k: 'move', pieceId: d.mv.pieceId, dest: null }; return; }
    if (s.k === 'move') {
      if (!d.mv) ui.sel = null;
      else if (d.mv.pieceId != null && s.pieceId !== d.mv.pieceId) ui.sel = { k: 'move', pieceId: d.mv.pieceId, dest: null };
      else if (s.pieceId != null) {
        var pc = me().pieces[s.pieceId];
        if (!pc || pc.pos < 0) ui.sel = null;
      }
    } else if (s.k === 'card') {
      if (!d.canPlayAction) ui.sel = null;
    } else if (s.k === 'react') {
      if (!state.you.window) ui.sel = null;
    }
    if (!ui.sel && d.mv && d.mv.pieceId != null && d.isMyTurn) ui.sel = { k: 'move', pieceId: d.mv.pieceId, dest: null };
    if (ui.menu && !state.you.hand.some(function (c) { return c.uid === ui.menu; })) ui.menu = null;
  }

  function onState() {
    if (token && !state.you && !autoRejoinTried && ui.joinName) {
      autoRejoinTried = true;
      post('/api/join', { room: ui.room, name: ui.joinName, token: token }).then(function (r) {
        if (r && r.ok) { token = r.token; ls(tokenKey(), token); rev = null; poll(); }
        else { token = ''; ls(tokenKey(), null); renderAll(); }
      });
    }
    if (state.you) autoRejoinTried = false;

    var myTurn = state.you && state.phase === 'playing' && state.turnPlayerId === state.you.id;
    if (myTurn && prevTurnId !== state.turnPlayerId && prevPhase === 'playing') {
      try { if (navigator.vibrate) navigator.vibrate([180, 80, 180]); } catch (e) { /* ignore */ }
      showBanner('🎯 ถึงเทิร์นของคุณ!', 'mine'); AU.sfx('turn', 150);
    }
    if (snd.init && state.phase === 'playing' && prevPhase === 'playing' && !myTurn && prevTurnId !== null && prevTurnId !== state.turnPlayerId) {
      var tpl = state.players.filter(function (x) { return x.id === state.turnPlayerId; })[0];
      if (tpl) showBanner('เทิร์นของ ' + esc2(tpl.name), 'other');
    }
    if (state.you && state.you.window && state.phase === 'playing') { try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) { /* ignore */ } }
    if (state.lastPlayed && state.reveal && state.reveal.id !== lastPlayedId) {
      lastPlayedId = state.reveal.id;
      var rv = state.reveal;
      if (snd.init && rv.mode !== 'drawn' && rv.cardId !== 'endScene' && state.phase === 'playing') cardPop(rv.cardId, state.you && rv.playerId === state.you.id ? 'คุณ' : rv.playerName, rv.mode === 'respond' ? 'ตอบโต้ด้วย' : 'ใช้');
    }
    prevTurnId = state.turnPlayerId; prevPhase = state.phase;

    var overKey = state.phase === 'over' && state.gameOver ? state.gameOver.title : '';
    if (overKey !== prevOverKey) { ui.closedOver = false; prevOverKey = overKey; if (overKey) confetti(); }
    if (state.phase === 'lobby') { ui.closedOver = false; ui.sel = null; ui.menu = null; }
    if (state.you && state.phase !== 'lobby') normalizeSel();
    if (state.you) { diceTick(); handTick(); playSounds(); }
    renderAll();
  }

  // ---------------------------------------------------------------- วาดหน้าจอ
  function setHtml(el, key, html) { if (cache[key] !== html) { el.innerHTML = html; cache[key] = html; } }
  function ensureOv() { if (!$ov) { $ov = document.createElement('div'); $ov.id = 'overlay'; document.body.appendChild($ov); } return $ov; }

  function renderAll() {
    var inGame = state && state.you && state.phase !== 'lobby';
    $app.hidden = !!inGame; $game.hidden = !inGame;
    document.body.classList.toggle('ingame', !!inGame);
    AU.setInGame(!!inGame);
    var sf = document.getElementById('sndFloat'); if (sf) sf.hidden = !!inGame;
    if (!inGame) {
      var focused = document.activeElement && document.activeElement.id === 'name';
      var html = !ui.room ? V.landingScreen(ui) : !state ? '<div class="boot">🏝️<br>กำลังเชื่อมต่อ…</div>' : !state.you ? V.joinScreen(state, ui) : V.lobbyScreen(state, ui);
      var typing = focused || (document.activeElement && document.activeElement.id === 'roomcode');
      if (!(typing && (!ui.room || (state && !state.you)))) setHtml($app, 'app', html);
    } else {
      if (!board) board = window.BoardView.create($boardEl, { onCell: onCell, onFx: boardFx });
      var d = V.derive(state);
      setHtml($top, 'top', V.topbarHtml(state));
      setHtml($pl, 'pl', V.playersHtml(state));
      setHtml($panel, 'panel', V.panelHtml(state, ui, d));
      setHtml($hand, 'hand', V.handHtml(state, ui, d));
      setHtml($dock, 'dock', V.dockHtml(state, d));
      board.update(state);
      board.setHighlights(currentHighlights());
      board.fit();
    }
    var ovHtml = V.renderOverlay(state, ui);
    if (ovHtml !== cache.ov) { ensureOv().innerHTML = ovHtml; cache.ov = ovHtml; }
  }

  // ---------------------------------------------------------------- การกดปุ่ม
  function doJoin() {
    var input = document.getElementById('name');
    var name = (input ? input.value : ui.joinName).trim();
    ui.joinName = name;
    if (!name) { ui.joinError = 'กรุณาใส่ชื่อก่อน'; cache.app = ''; renderAll(); return; }
    ls('ic_name', name);
    post('/api/join', { room: ui.room, name: name, token: token }).then(function (r) {
      if (r.error) { ui.joinError = r.error; cache.app = ''; renderAll(); return; }
      ui.joinError = ''; token = r.token; ls(tokenKey(), token); rev = null; poll();
    });
  }

  var handlers = {
    join: doJoin,
    start: function () { act('start'); },
    leave: function () {
      // ไม่ใช้ act() เพราะมันจะ apply สถานะใหม่ (ที่ไม่มีเราแล้ว) ทั้งที่ยังถือ token เก่า ทำให้ระบบเข้าห้องใหม่ให้เองโดยไม่ตั้งใจ
      post('/api/action', { room: ui.room, token: token, type: 'leave' }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        ls(tokenKey(), null); token = ''; rev = null; state = null; cache.app = ''; renderAll(); poll();
      });
    },
    createRoom: function () {
      ui.landingError = '';
      post('/api/create', {}).then(function (r) {
        if (r.error) { ui.landingError = r.error; cache.app = ''; renderAll(); return; }
        setRoom(r.room); renderAll(); poll();
      });
    },
    enterRoom: function () {
      var inp = document.getElementById('roomcode');
      var code = (inp ? inp.value : '').toUpperCase().replace(/[^A-Z]/g, '');
      ui.roomInput = code;
      if (code.length !== 4) { ui.landingError = 'รหัสห้องต้องเป็นตัวอักษรภาษาอังกฤษ 4 ตัว'; cache.app = ''; renderAll(); return; }
      ui.landingError = ''; setRoom(code); renderAll(); poll();
    },
    changeRoom: function () { ui.landingError = ''; setRoom(''); renderAll(); },
    copyInvite: function () {
      var link = location.origin + location.pathname + '#' + ui.room;
      var done = function () { toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย'); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, function () { window.prompt('คัดลอกลิงก์นี้', link); }); return; }
      } catch (e) { /* ignore */ }
      window.prompt('คัดลอกลิงก์นี้', link);
    },
    sound: function () { AU.toggle(); updateSoundBtns(); renderAll(); },
    exitRoom: function () {
      if (!window.confirm('ออกจากห้องนี้? ที่นั่งของคุณยังอยู่ กลับมาได้ด้วยลิงก์เดิมและชื่อเดิมภายใน 24 ชั่วโมง')) return;
      ui.showRules = false; ui.landingError = ''; setRoom(''); renderAll();
    },
    endGame: function () {
      if (!window.confirm('จบเกมนี้กลางคันและกลับห้องรอ? ความคืบหน้าของเกมจะหายทั้งหมด')) return;
      ui.showRules = false; act('reset');
    },
    hostSkip: function () { ui.showRules = false; act('skip'); },
    hostForce: function () { ui.showRules = false; act('forcePass'); },
    setColor: function (el) { act('setColor', { color: el.getAttribute('data-color') }); },
    roll: function () { act('roll'); },
    draw: function () { act('draw'); },
    endTurn: function () { act('endTurn'); },
    reset: function () { act('reset'); },
    six: function (el) { act('six', { choice: el.getAttribute('data-choice') }); },
    cancelSel: function () { ui.sel = null; normalizeSel(); renderAll(); },
    confirmMove: function () {
      var d = V.derive(state), s = ui.sel;
      if (!d.mv || !s || s.k !== 'move' || s.pieceId == null || s.dest == null) return;
      act('move', { mid: d.mv.mid, pieceId: s.pieceId, to: s.dest }).then(function (r) { if (r && r.ok) { ui.sel = null; normalizeSel(); renderAll(); } });
    },
    cardMenu: function (el) { ui.menu = el.getAttribute('data-uid'); renderAll(); },
    closeMenu: function () { ui.menu = null; renderAll(); },
    discard: function (el) { var u = el.getAttribute('data-uid'); ui.menu = null; act('discard', { uid: u }); renderAll(); },
    useCard: function (el) {
      var uid = el.getAttribute('data-uid');
      var card = state.you.hand.filter(function (c) { return c.uid === uid; })[0];
      if (!card) return;
      var d = V.derive(state), why = V.whyNotPlay(state, d, card);
      if (why) { toast(why); return; }
      ui.menu = null;
      if (card.id === 'endScene') { act('play', { uid: uid }); renderAll(); return; }
      if (card.id === 'kickOut' || card.id === 'boost' || card.id === 'swap') {
        if (!eligiblePieces(card.id).length) { toast(card.id === 'kickOut' ? 'ไม่มีตัวเล่นคู่แข่งที่เตะได้ในตอนนี้' : card.id === 'boost' ? 'คุณไม่มีตัวเล่นบนกระดาน' : 'ไม่มีตัวเล่นที่สลับได้ในตอนนี้'); renderAll(); return; }
        if (card.id === 'swap' && eligiblePieces('swap').length < 2) { toast('ต้องมีตัวเล่นที่สลับได้อย่างน้อย 2 ตัวบนกระดาน'); renderAll(); return; }
      }
      ui.sel = { k: 'card', uid: uid, cardId: card.id, picks: [], target: null };
      renderAll();
    },
    pickPlayer: function (el) { if (ui.sel && ui.sel.k === 'card') { ui.sel.target = Number(el.getAttribute('data-pid')); renderAll(); } },
    confirmCard: function () {
      var s = ui.sel; if (!s || s.k !== 'card') return;
      var params = {};
      if (s.cardId === 'kickOut') params = { targetId: s.picks[0].playerId, pieceId: s.picks[0].pieceId };
      else if (s.cardId === 'boost') params = { pieceId: s.picks[0].pieceId };
      else if (s.cardId === 'swap') params = { a: s.picks[0], b: s.picks[1] };
      else if (s.cardId === 'steal') params = { targetId: s.target };
      act('play', { uid: s.uid, params: params }).then(function (r) { if (r && r.ok) { ui.sel = null; normalizeSel(); } renderAll(); });
    },
    react: function (el) {
      var uid = el.getAttribute('data-uid'), cid = el.getAttribute('data-card'), w = state.you.window;
      if (!w) return;
      if (cid === 'reflect' && w.reflectTargets.length > 1) { ui.sel = { k: 'react', uid: uid, frameId: w.frameId }; renderAll(); return; }
      act('respond', { frameId: w.frameId, uid: uid });
    },
    reactPiece: function (el) {
      var s = ui.sel, w = state.you.window; if (!s || !w) return;
      act('respond', { frameId: w.frameId, uid: s.uid, pieceId: Number(el.getAttribute('data-piece')) }).then(function (r) { if (r && r.ok) { ui.sel = null; } renderAll(); });
    },
    pass: function (el) { act('pass', { frameId: Number(el.getAttribute('data-frame')) }); },
    auto: function (el) { act('auto', { value: !!el.checked }); },
    rules: function () { ui.showRules = true; renderAll(); },
    closeRules: function () { ui.showRules = false; renderAll(); },
    dismissReveal: function () { if (state && state.reveal) { ui.dismissedReveal = state.reveal.id; ss('ic_dismissed', String(ui.dismissedReveal)); } renderAll(); },
    closeOver: function () { ui.closedOver = true; renderAll(); },
    showOver: function () { ui.closedOver = false; renderAll(); },
    zoomIn: function () { if (board) board.zoomBy(1.4); },
    zoomOut: function () { if (board) board.zoomBy(1 / 1.4); },
    zoomFit: function () { if (board) board.reset(); }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-act')) break;
      if (el.getAttribute && el.getAttribute('data-stop')) return;
      el = el.parentNode;
    }
    if (!el || el === document.body) return;
    var fn = handlers[el.getAttribute('data-act')];
    if (fn) { if (el.tagName !== 'INPUT') ev.preventDefault(); fn(el); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target) { if (ev.target.id === 'name') doJoin(); else if (ev.target.id === 'roomcode') handlers.enterRoom(); } });

  // สำหรับทดสอบ (อ่านอย่างเดียว)
  window.__ic = { get state() { return state; }, get ui() { return ui; }, get board() { return board; } };

  var hashCode = (location.hash || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  setRoom(hashCode.length === 4 ? hashCode : (ls('ic_room') || ''));
  AU.onChange(updateSoundBtns); updateSoundBtns();
  renderAll();
  poll();
})();
