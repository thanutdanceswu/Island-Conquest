'use strict';
/* ทดลองบนเครื่องตัวเอง: node dev.js แล้วเปิด http://localhost:3000 (ใช้หน่วยความจำ หรือ Upstash ถ้าตั้งตัวแปรแวดล้อมไว้)
   จำลองสิ่งที่ Vercel ทำ: เสิร์ฟ public/ และเรียกฟังก์ชันใน api/ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.json': 'application/json' };

function createDev() {
  const pub = path.join(__dirname, 'public');
  const api = {};
  ['create', 'join', 'state', 'action'].forEach((n) => { api[n] = require('./api/' + n + '.js'); });
  const server = http.createServer((req, res) => {
    const u = url.parse(req.url, true);
    if (u.pathname.startsWith('/api/')) {
      const fn = api[u.pathname.slice(5)];
      if (!fn) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
      req.on('end', () => {
        req.query = u.query;
        try { req.body = data ? JSON.parse(data) : {}; } catch (e) { req.body = {}; }
        fn(req, res);
      });
      return;
    }
    let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
    const f = path.normalize(path.join(pub, p));
    if (!f.startsWith(pub) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  return { server, listen: (port) => new Promise((r) => server.listen(port || 0, () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
}
module.exports = { createDev };
if (require.main === module) {
  const d = createDev();
  d.listen(Number(process.env.PORT) || 3000).then((p) => console.log('เปิดที่ http://localhost:' + p + (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ? '  (Upstash)' : '  (หน่วยความจำ — ทดลองเท่านั้น)')));
}
