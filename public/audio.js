/* เสียงประกอบ: คลื่นทะเลเบาๆ + เพลงพื้นหลัง (ไฟล์ใน /audio) + เสียงเอฟเฟกต์สังเคราะห์ (ไม่ต้องใช้ไฟล์)
   มือถือไม่ให้เล่นเสียงก่อนผู้ใช้แตะจอ จึงเริ่มหลังแตะครั้งแรก ปุ่ม 🔊/🔇 เปิดปิดได้ และจำค่าไว้ในเครื่อง */
(function (root) {
  var TRACKS = [
    { src: '/audio/waves.mp3', vol: 0.50 }, // คลื่นทะเล วนต่อเนื่อง
    { src: '/audio/bgm.mp3', vol: 0.03 }    // เพลงพื้นหลัง
  ];
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  var on = ls('ic_sound') !== '0';
  var unlocked = false, els = [], ctx = null, listeners = [];

  function build() {
    if (els.length) return;
    TRACKS.forEach(function (t) {
      var a = new Audio(t.src);
      a.loop = true; a.preload = 'auto'; a.volume = t.vol;
      els.push(a);
    });
  }
  function playMusic() {
    build();
    els.forEach(function (a) { try { var p = a.play(); if (p && p.catch) p.catch(function () { /* ถูกบล็อก รอแตะอีกครั้ง */ }); } catch (e) { /* ignore */ } });
  }
  function pauseMusic() { els.forEach(function (a) { try { a.pause(); } catch (e) { /* ignore */ } }); }
  function ensureCtx() {
    if (!ctx) { var C = root.AudioContext || root.webkitAudioContext; if (C) { try { ctx = new C(); } catch (e) { ctx = null; } } }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }
  function unlock() {
    if (unlocked) return;
    unlocked = true; ensureCtx();
    if (on) playMusic();
  }
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (ev) { root.addEventListener(ev, unlock, { once: false, passive: true }); });
  root.document.addEventListener('visibilitychange', function () {
    if (root.document.hidden) pauseMusic(); else if (on && unlocked) { playMusic(); ensureCtx(); }
  });

  function notify() { listeners.forEach(function (f) { try { f(on); } catch (e) { /* ignore */ } }); }
  function toggle() {
    on = !on; ls('ic_sound', on ? '1' : '0');
    if (on) { unlocked = true; ensureCtx(); playMusic(); } else pauseMusic();
    notify(); return on;
  }

  // ---- เสียงเอฟเฟกต์
  function tone(freq, dur, type, vol, delay, slideTo) {
    var c = ensureCtx(); if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  var SFX = {
    dice: function () { for (var i = 0; i < 7; i++) tone(180 + Math.random() * 260, 0.05, 'square', 0.05, i * 0.07); tone(660, 0.14, 'triangle', 0.09, 0.52); },
    step: function () { tone(520, 0.05, 'sine', 0.07); },
    kick: function () { tone(420, 0.28, 'sawtooth', 0.09, 0, 70); tone(90, 0.2, 'sine', 0.12, 0.02); },
    release: function () { tone(300, 0.14, 'sine', 0.1, 0, 760); },
    shield: function () { tone(660, 0.12, 'triangle', 0.1); tone(990, 0.2, 'triangle', 0.1, 0.1); },
    reflect: function () { tone(900, 0.18, 'triangle', 0.09, 0, 450); tone(450, 0.2, 'triangle', 0.09, 0.15, 900); },
    swap: function () { tone(380, 0.16, 'sine', 0.09, 0, 760); tone(760, 0.18, 'sine', 0.09, 0.16, 380); },
    steal: function () { tone(330, 0.1, 'triangle', 0.08); tone(247, 0.14, 'triangle', 0.08, 0.1); },
    card: function () { tone(700, 0.07, 'triangle', 0.07); tone(940, 0.08, 'triangle', 0.06, 0.06); },
    alert: function () { tone(880, 0.1, 'square', 0.05); tone(880, 0.1, 'square', 0.05, 0.16); },
    turn: function () { [659, 880, 1175].forEach(function (f, i) { tone(f, 0.16, 'sine', 0.09, i * 0.1); }); },
    win: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.28, 'triangle', 0.1, i * 0.13); }); }
  };
  function sfx(name, delay) {
    if (!on || !unlocked || !SFX[name]) return;
    if (delay) setTimeout(function () { if (on) SFX[name](); }, delay); else SFX[name]();
  }

  root.IC = root.IC || {};
  root.IC.audio = { isOn: function () { return on; }, toggle: toggle, sfx: sfx, onChange: function (f) { listeners.push(f); } };
})(window);
