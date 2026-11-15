'use strict';
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
// ห่อ handler: ตรวจ method, อ่าน body (Vercel parse ให้แล้ว), จับ error, แปลงผลลัพธ์ {error,status}
function handler(method, fn) {
  return async function (req, res) {
    try {
      if (req.method !== method) { res.setHeader('Allow', method); return send(res, 405, { error: 'method not allowed' }); }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      if (!body || typeof body !== 'object') body = {};
      const r = await fn({ body: body, query: req.query || {} });
      if (r && r.error) { const st = r.status || 400; const o = { error: r.error }; return send(res, st, o); }
      return send(res, 200, r);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (e && e.message ? e.message : e) });
    }
  };
}
module.exports = { send, handler };
