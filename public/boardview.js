/* ตัววาดกระดาน: ภาพบอร์ด + ตัวเล่น + ไฮไลต์ + ซูม/เลื่อน + แอนิเมชันเดิน/เตะ (ใช้ทั้งมือถือและหน้าโฮสต์) */
(function (root) {
  var B = root.BOARD;
  var W = B.IMG_W, H = B.IMG_H;
  var HEX = { red: '#f43f5e', blue: '#0ea5e9', green: '#10b981', yellow: '#f59e0b' };

  function cellRect(i) {
    var r = B.rowOf(i), c = B.colOf(i);
    return { x: B.X[c], y: B.Y[r], w: B.X[c + 1] - B.X[c], h: B.Y[r + 1] - B.Y[r], cx: (B.X[c] + B.X[c + 1]) / 2, cy: (B.Y[r] + B.Y[r + 1]) / 2 };
  }
  function cellFromPoint(x, y) {
    var c = -1, r = -1;
    for (var i = 0; i < B.N; i++) {
      if (x >= B.X[i] && x < B.X[i + 1]) c = i;
      if (y >= B.Y[i] && y < B.Y[i + 1]) r = i;
    }
    return c < 0 || r < 0 ? -1 : r * B.N + c;
  }
  var SLOTS = {
    1: [[0, 0]],
    2: [[-25, 0], [25, 0]],
    3: [[-24, -15], [24, -15], [0, 17]],
    4: [[-24, -16], [24, -16], [-24, 16], [24, 16]]
  };

  function create(el, opts) {
    opts = opts || {};
    el.classList.add('bv');
    el.innerHTML = '<div class="bv-in" style="width:' + W + 'px;height:' + H + 'px">' +
      '<img class="bv-img" alt="" draggable="false" src="/img/board.jpg">' +
      '<div class="bv-ow"></div><div class="bv-hl"></div><div class="bv-pc"></div><div class="bv-fxl"></div></div>';
    var inner = el.querySelector('.bv-in'), ow = el.querySelector('.bv-ow'), hl = el.querySelector('.bv-hl'), pcl = el.querySelector('.bv-pc'), fxl = el.querySelector('.bv-fxl');
    var view = { s: 1, tx: 0, ty: 0 }, minS = 0.2, maxS = 3.2, zoomed = false;
    var disp = {}, toks = {}, colors = {}, rings = {}, latest = null, lastFx = -1, first = true;
    var queue = [], running = false, lastOwners = '';

    // ------------------------------------------------ มุมมอง (ซูม/เลื่อน)
    function clamp() {
      var cw = el.clientWidth, ch = el.clientHeight, sw = W * view.s, sh = H * view.s;
      view.tx = sw <= cw ? (cw - sw) / 2 : Math.min(0, Math.max(cw - sw, view.tx));
      view.ty = sh <= ch ? (ch - sh) / 2 : Math.min(0, Math.max(ch - sh, view.ty));
    }
    function apply() { clamp(); inner.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.s + ')'; }
    function fit() {
      var cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      minS = Math.min(cw / W, ch / H);
      maxS = Math.max(minS * 4, 1.2);
      if (!zoomed || view.s < minS) { view.s = minS; zoomed = false; }
      apply();
    }
    function zoomAt(px, py, f) {
      var ns = Math.min(maxS, Math.max(minS, view.s * f));
      var k = ns / view.s;
      view.tx = px - (px - view.tx) * k; view.ty = py - (py - view.ty) * k; view.s = ns;
      zoomed = ns > minS * 1.02;
      apply();
    }
    function toImg(clientX, clientY) {
      var rc = el.getBoundingClientRect();
      return { x: (clientX - rc.left - view.tx) / view.s, y: (clientY - rc.top - view.ty) / view.s };
    }

    if (opts.gestures !== false) {
      var ptrs = {}, count = 0, moved = false, sx = 0, sy = 0, pinch = null;
      var dist = function () { var k = Object.keys(ptrs); var a = ptrs[k[0]], b = ptrs[k[1]]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
      el.addEventListener('pointerdown', function (e) {
        try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; count = Object.keys(ptrs).length;
        if (count === 1) { moved = false; sx = e.clientX; sy = e.clientY; }
        else if (count === 2) { moved = true; var d = dist(); pinch = { d: d.d, x: d.x, y: d.y }; }
      });
      el.addEventListener('pointermove', function (e) {
        if (!ptrs[e.pointerId]) return;
        var prev = ptrs[e.pointerId];
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (count === 2 && pinch) {
          var d = dist(), rc = el.getBoundingClientRect();
          if (pinch.d > 0) zoomAt(d.x - rc.left, d.y - rc.top, d.d / pinch.d);
          view.tx += d.x - pinch.x; view.ty += d.y - pinch.y; apply();
          pinch = { d: d.d, x: d.x, y: d.y };
        } else if (count === 1) {
          if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true;
          if (moved) { view.tx += e.clientX - prev.x; view.ty += e.clientY - prev.y; apply(); }
        }
      });
      var up = function (e) {
        if (!ptrs[e.pointerId]) return;
        delete ptrs[e.pointerId];
        var was = count; count = Object.keys(ptrs).length; pinch = null;
        if (e.type === 'pointerup' && was === 1 && !moved && opts.onCell) {
          var p = toImg(e.clientX, e.clientY), cell = cellFromPoint(p.x, p.y);
          if (cell >= 0) {
            // หมากหลายตัวอยู่ช่องเดียวกัน: ส่งตัวที่ถูกแตะ (ใกล้นิ้วที่สุด) ไปด้วย
            var ks = keysAt(cell), near = null, best = 1e9;
            ks.forEach(function (k) {
              var te = toks[k]; if (!te) return;
              var r = te.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
              if (d < best) { best = d; near = k; }
            });
            opts.onCell(cell, ks, near);
          }
        }
        if (count === 1) { var k = Object.keys(ptrs)[0]; sx = ptrs[k].x; sy = ptrs[k].y; moved = true; }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', function (e) {
        e.preventDefault();
        var rc = el.getBoundingClientRect();
        zoomAt(e.clientX - rc.left, e.clientY - rc.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      }, { passive: false });
      el.addEventListener('dblclick', function (e) {
        var rc = el.getBoundingClientRect();
        if (zoomed) { zoomed = false; fit(); } else zoomAt(e.clientX - rc.left, e.clientY - rc.top, 2.2);
      });
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(el);
    window.addEventListener('resize', fit);

    // ------------------------------------------------ ตัวเล่น
    function key(pid, id) { return pid + ':' + id; }
    function keysAt(cell) { return Object.keys(disp).filter(function (k) { return disp[k].cell === cell; }).sort(); }
    function tokEl(k) {
      if (toks[k]) return toks[k];
      var d = document.createElement('div');
      d.className = 'tk out';
      d.style.backgroundImage = 'url(/img/' + colors[k.split(':')[0]] + '.png)';
      pcl.appendChild(d);
      toks[k] = d;
      return d;
    }
    function layout() {
      var groups = {};
      Object.keys(disp).forEach(function (k) { var c = disp[k].cell; if (c >= 0) (groups[c] = groups[c] || []).push(k); });
      Object.keys(disp).forEach(function (k) {
        var e = tokEl(k), on = disp[k].cell >= 0;
        e.classList.toggle('out', !on);
        e.classList.remove('sel', 'tgt', 'pick');
        if (rings[k]) e.classList.add(rings[k]);
      });
      Object.keys(groups).forEach(function (c) {
        var ks = groups[c].sort(), n = ks.length, cr = cellRect(+c);
        var slots = SLOTS[Math.min(n, 4)], size = n === 1 ? 66 : n === 2 ? 50 : 42;
        ks.forEach(function (k, i) {
          var sl = slots[i % slots.length], e = tokEl(k);
          e.style.width = size + 'px'; e.style.height = size + 'px';
          e.style.transform = 'translate(' + (cr.cx + sl[0] - size / 2) + 'px,' + (cr.cy + sl[1] - size / 2) + 'px)';
          e.style.zIndex = String(10 + i);
        });
      });
    }
    function sync() {
      if (!latest) return;
      latest.players.forEach(function (p) {
        colors[p.id] = p.color;
        p.pieces.forEach(function (pc) { disp[key(p.id, pc.id)] = { cell: pc.pos }; });
      });
      layout(); renderOwners();
    }
    function renderOwners() {
      if (!latest) return;
      var html = '';
      (latest.islands || []).forEach(function (i) {
        if (i.ownerId == null) return;
        var pl = latest.players.filter(function (p) { return p.id === i.ownerId; })[0];
        if (!pl) return;
        var r = cellRect(i.cell);
        html += '<div class="own" style="left:' + (r.x + 4) + 'px;top:' + (r.y + 4) + 'px;width:' + (r.w - 8) + 'px;height:' + (r.h - 8) + 'px;--c:' + HEX[pl.color] + '"></div>';
      });
      if (html !== lastOwners) { ow.innerHTML = html; lastOwners = html; }
    }

    // ------------------------------------------------ แอนิเมชัน (เข้าคิว เล่นทีละอัน)
    function enqueue(fn) { queue.push(fn); if (!running) run(); }
    function run() {
      running = true;
      (function next() {
        var f = queue.shift();
        if (!f) { running = false; return; }
        f(next);
      })();
    }
    // ---- เอฟเฟกต์ที่ช่อง (วงกระเพื่อม ประกาย ฯลฯ) ลบตัวเองหลังเล่นจบ
    function burst(cell, kind, color, ms) {
      var r = cellRect(cell), d = document.createElement('div');
      d.className = 'fxb fxb-' + kind;
      d.style.left = r.cx + 'px'; d.style.top = r.cy + 'px';
      if (color) d.style.setProperty('--c', color);
      if (kind === 'clash' || kind === 'island' || kind === 'swap') {
        for (var i = 0; i < 8; i++) { var sp = document.createElement('i'); sp.style.setProperty('--a', (i * 45) + 'deg'); d.appendChild(sp); }
      }
      fxl.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 900);
    }
    function shake() { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(function () { el.classList.remove('shake'); }, 420); }
    function hop(k) {
      var e = toks[k]; if (!e) return;
      e.classList.remove('hop'); void e.offsetWidth; e.classList.add('hop');
      setTimeout(function () { e.classList.remove('hop'); }, 140);
    }
    function colorOf(pid) { return HEX[colors[pid]] || '#fff'; }

    function playFx(f, done) {
      var k, e;
      if (opts.onFx) { try { opts.onFx(f); } catch (x) { /* ignore */ } }
      if (f.type === 'move') {
        k = key(f.playerId, f.pieceId);
        if (!disp[k]) return done();
        disp[k].cell = f.path[0]; layout();
        var i = 1;
        (function step() {
          if (i >= f.path.length) { burst(f.path[f.path.length - 1], 'dust', colorOf(f.playerId), 600); return setTimeout(done, 120); }
          disp[k].cell = f.path[i++]; layout(); hop(k);
          setTimeout(step, 125);
        })();
      } else if (f.type === 'kick') {
        k = key(f.playerId, f.pieceId);
        e = toks[k];
        burst(f.cell, 'clash', '#fb7185', 800); shake();
        if (e && disp[k] && e.animate) {
          var base = e.style.transform || '';
          var fly = e.animate([
            { transform: base + ' rotate(0deg) scale(1)', opacity: 1 },
            { transform: base + ' translate(0px,-160px) rotate(540deg) scale(1.25)', opacity: 1, offset: 0.45 },
            { transform: base + ' translate(' + (Math.random() < 0.5 ? -1 : 1) * 140 + 'px,-60px) rotate(900deg) scale(.2)', opacity: 0 }
          ], { duration: 650, easing: 'ease-in', fill: 'none' });
          fly.onfinish = function () { disp[k].cell = -1; layout(); done(); };
        } else { if (disp[k]) { disp[k].cell = -1; layout(); } setTimeout(done, 450); }
      } else if (f.type === 'release') {
        k = key(f.playerId, f.pieceId);
        disp[k] = { cell: f.to }; layout();
        e = toks[k]; if (e) { e.classList.remove('spawn'); void e.offsetWidth; e.classList.add('spawn'); setTimeout(function () { e.classList.remove('spawn'); }, 700); }
        burst(f.to, 'spawn', colorOf(f.playerId), 900);
        setTimeout(done, 500);
      } else if (f.type === 'swap') {
        burst(f.a.from, 'swap', '#a78bfa', 900); burst(f.b.from, 'swap', '#a78bfa', 900);
        [f.a, f.b].forEach(function (x) { var kk = key(x.playerId, x.pieceId); if (disp[kk]) disp[kk].cell = x.to; });
        pcl.classList.add('slow'); layout();
        setTimeout(function () { pcl.classList.remove('slow'); burst(f.a.to, 'dust', '#a78bfa', 600); burst(f.b.to, 'dust', '#a78bfa', 600); done(); }, 700);
      } else if (f.type === 'clash') {
        burst(f.cell, 'clash', '#facc15', 800); shake(); setTimeout(done, 380);
      } else if (f.type === 'shield') {
        burst(f.cell, 'shield', '#38bdf8', 1100); setTimeout(done, 700);
      } else if (f.type === 'reflect') {
        burst(f.cell, 'reflect', '#e879f9', 1000); setTimeout(done, 650);
      } else if (f.type === 'island') {
        burst(f.cell, 'island', colorOf(f.ownerId), 1400); setTimeout(done, 700);
      } else done();
    }

    function update(state) {
      latest = state;
      state.players.forEach(function (p) { colors[p.id] = p.color; });
      var maxId = lastFx;
      var fresh = (state.fx || []).filter(function (f) { return f.id > lastFx; });
      fresh.forEach(function (f) { if (f.id > maxId) maxId = f.id; });
      if (first) {
        first = false;
        (state.fx || []).forEach(function (f) { if (f.id > maxId) maxId = f.id; });
        lastFx = maxId; sync(); fit(); return;
      }
      lastFx = maxId;
      fresh.forEach(function (f) { enqueue(function (done) { playFx(f, done); }); });
      enqueue(function (done) { sync(); done(); });
    }

    // ------------------------------------------------ ไฮไลต์
    function setHighlights(h) {
      h = h || {};
      rings = h.rings || {};
      var html = '';
      (h.cells || []).forEach(function (c) {
        var r = cellRect(c);
        html += '<div class="hlc" style="left:' + (r.x + 3) + 'px;top:' + (r.y + 3) + 'px;width:' + (r.w - 6) + 'px;height:' + (r.h - 6) + 'px"></div>';
      });
      (h.path || []).forEach(function (c) {
        var r = cellRect(c);
        html += '<div class="hlp" style="left:' + (r.cx - 9) + 'px;top:' + (r.cy - 9) + 'px"></div>';
      });
      if (h.dest != null && h.dest >= 0) {
        var d = cellRect(h.dest);
        html += '<div class="hld" style="left:' + (d.x + 2) + 'px;top:' + (d.y + 2) + 'px;width:' + (d.w - 4) + 'px;height:' + (d.h - 4) + 'px"></div>';
      }
      if (html !== hl._html) { hl.innerHTML = html; hl._html = html; }
      layout();
    }

    function zoomBy(f) { var rc = el.getBoundingClientRect(); zoomAt(rc.width / 2, rc.height / 2, f); }
    function reset() { zoomed = false; fit(); }
    function focusCell(c, s) {
      var r = cellRect(c), cw = el.clientWidth, ch = el.clientHeight;
      view.s = Math.min(maxS, Math.max(minS, s || minS * 2)); zoomed = view.s > minS * 1.02;
      view.tx = cw / 2 - r.cx * view.s; view.ty = ch / 2 - r.cy * view.s; apply();
    }
    function cellToClient(c) { var r = cellRect(c), rc = el.getBoundingClientRect(); return { x: rc.left + view.tx + r.cx * view.s, y: rc.top + view.ty + r.cy * view.s }; }
    fit();
    return { cellToClient: cellToClient, update: update, setHighlights: setHighlights, zoomBy: zoomBy, reset: reset, focusCell: focusCell, keysAt: keysAt, fit: fit, isZoomed: function () { return zoomed; } };
  }

  root.BoardView = { create: create, cellRect: cellRect, HEX: HEX };
})(window);
