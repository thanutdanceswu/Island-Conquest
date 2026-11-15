/* Island Conquest – เรขาคณิตกระดาน 11×11 และการหาเส้นทางเดิน (ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าเว็บ) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BOARD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var N = 11;
  var CELLS = N * N;
  // พิกัดกึ่งกลางช่องบนภาพ board.jpg (1521×1076)
  var X = [156, 271, 385, 493, 601, 709, 814, 921, 1028, 1141, 1249, 1357];
  var Y = [97, 165, 243, 324, 403, 479, 558, 634, 711, 792, 870, 957];
  var IMG_W = 1521, IMG_H = 1076;
  // P ม่วง 3, C ปะการัง 4, F ปลา 5, Y/O เปลือกหอยเซฟโซน, I เกาะ 10, M เกาะกลาง 15
  var INNER = ['PYPPPYP', 'PCCICCP', 'OCFFFCO', 'PIFMFIP', 'OCFFFCO', 'PCCICCP', 'PYPPPYP'];
  var POINTS = { P: 3, C: 4, F: 5, Y: 7, O: 7, I: 10, M: 15 };
  var COLORS = ['red', 'blue', 'green', 'yellow'];
  // ช่องเริ่มต้นของแต่ละสี (idx = r*11+c) แดง A1 มุมซ้ายบน / ฟ้า K1 ขวาบน / เขียว K11 ขวาล่าง / เหลือง A11 ซ้ายล่าง
  var START = { red: 0, blue: 10, green: 120, yellow: 110 };
  var PIECES_PER_PLAYER = 4;

  function idx(r, c) { return r * N + c; }
  function rowOf(i) { return (i / N) | 0; }
  function colOf(i) { return i % N; }
  function label(i) { return String.fromCharCode(65 + colOf(i)) + (rowOf(i) + 1); }
  function fromLabel(s) { return idx(parseInt(s.slice(1), 10) - 1, s.charCodeAt(0) - 65); }

  var type = [], points = [], safe = [], island = [];
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      var t, p;
      var ring = Math.min(r, c, N - 1 - r, N - 1 - c);
      if (ring === 0) { t = 'sand'; p = 1; }
      else if (ring === 1) { t = 'sea'; p = 2; }
      else {
        var ch = INNER[r - 2][c - 2];
        t = { P: 'purple', C: 'coral', F: 'fish', Y: 'shell', O: 'shell', I: 'island', M: 'center' }[ch];
        p = POINTS[ch];
      }
      type.push(t); points.push(p);
      safe.push(t === 'shell');
      island.push(t === 'island' || t === 'center');
    }
  }
  var ISLANDS = [];
  for (var i = 0; i < CELLS; i++) if (island[i]) ISLANDS.push(i);
  var ISLAND_WIN = 4; // ต้องครอบครอง 4 จาก 5 เกาะ

  function dist(a, b) { return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)); }

  var NB = [];
  for (i = 0; i < CELLS; i++) {
    var rr = rowOf(i), cc = colOf(i), l = [];
    if (rr > 0) l.push(i - N);
    if (rr < N - 1) l.push(i + N);
    if (cc > 0) l.push(i - 1);
    if (cc < N - 1) l.push(i + 1);
    NB.push(l);
  }

  /* ----- การเดิน -----
     เดินครบ "steps" ช่องพอดี เลี้ยวได้ทุกช่อง ห้ามเฉียง ห้ามเหยียบช่องเดิมซ้ำในการเดินครั้งเดียว
     (ตั้ง ALLOW_REVISIT = true ถ้าอยากให้เดินย้อนช่องเดิมได้) ปลายทางต้องไม่ใช่ช่องเริ่มต้นเอง */
  var CONFIG = { allowRevisit: false };

  function parityOk(d, steps) { return d <= steps && ((steps - d) % 2 === 0); }

  // หาเส้นทาง คืน array ของช่อง (รวมจุดเริ่มและจุดจบ) หรือ null
  function findPath(from, to, steps, blocked) {
    if (from === to || steps < 1) return null;
    if (!parityOk(dist(from, to), steps)) return null;
    var re = CONFIG.allowRevisit;
    var visited = new Uint8Array(CELLS);
    var path = [from];
    visited[from] = 1;
    var budget = 3000000;
    function dfs(cur, rem) {
      if (rem === 0) return cur === to;
      if (--budget < 0) return false;
      var nb = NB[cur];
      for (var k = 0; k < nb.length; k++) {
        var n = nb[k];
        if (!re && visited[n]) continue;
        if (blocked && blocked[n]) continue;
        if (dist(n, to) > rem - 1) continue;
        if (!parityOk(dist(n, to), rem - 1)) continue;
        if (n === to && rem - 1 !== 0 && !re) continue; // ถึงปลายทางก่อนครบก้าวและห้ามเหยียบซ้ำ
        visited[n] = 1; path.push(n);
        if (dfs(n, rem - 1)) return true;
        path.pop(); visited[n] = 0;
      }
      return false;
    }
    return dfs(from, steps) ? path.slice() : null;
  }

  // ช่องปลายทางที่เดินครบ steps พอดีได้
  function reachable(from, steps, blocked) {
    var res = [];
    for (var t = 0; t < CELLS; t++) {
      if (t === from) continue;
      if (blocked && blocked[t]) continue;
      if (!parityOk(dist(from, t), steps)) continue;
      if (findPath(from, t, steps, blocked)) res.push(t);
    }
    return res;
  }

  function canComplete(from, steps, blocked) {
    for (var t = 0; t < CELLS; t++) {
      if (t === from || (blocked && blocked[t])) continue;
      if (!parityOk(dist(from, t), steps)) continue;
      if (findPath(from, t, steps, blocked)) return true;
    }
    return false;
  }

  return {
    N: N, CELLS: CELLS, X: X, Y: Y, IMG_W: IMG_W, IMG_H: IMG_H,
    COLORS: COLORS, START: START, PIECES_PER_PLAYER: PIECES_PER_PLAYER, ISLAND_WIN: ISLAND_WIN,
    type: type, points: points, safe: safe, island: island, ISLANDS: ISLANDS,
    idx: idx, rowOf: rowOf, colOf: colOf, label: label, fromLabel: fromLabel, dist: dist, NB: NB,
    CONFIG: CONFIG, findPath: findPath, reachable: reachable, canComplete: canComplete
  };
});
