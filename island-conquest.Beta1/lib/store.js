'use strict';
/*
 * ที่เก็บข้อมูลห้อง: Upstash Redis (REST) เมื่อมีตัวแปรแวดล้อม ไม่งั้นใช้หน่วยความจำ (สำหรับทดลองบนเครื่องตัวเองเท่านั้น
 * — บน Vercel หน่วยความจำไม่แชร์ระหว่างคำขอ จึงเล่นไม่ได้จริง ต้องตั้ง Upstash)
 * ไม่ต้องติดตั้งแพ็กเกจ ใช้ fetch ของ Node 18+ ตามรูปแบบ REST ของ Upstash:
 *   POST {url}            body ["SET","k","v","EX","60"]            → {"result":"OK"}
 *   POST {url}/pipeline   body [["GET","a"],["GET","b"]]            → [{"result":..},{"result":..}]
 */
function restConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function createRestStore(cfg) {
  async function call(path, body) {
    const r = await fetch(cfg.url + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Redis ตอบกลับผิดรูปแบบ (' + r.status + ')'); }
    if (!r.ok) throw new Error('Redis error: ' + (j && j.error ? j.error : r.status));
    return j;
  }
  return {
    kind: 'upstash',
    async cmd(args) {
      const j = await call('', args);
      if (j.error) throw new Error('Redis error: ' + j.error);
      return j.result;
    },
    async pipeline(list) {
      const arr = await call('/pipeline', list);
      return arr.map(function (x) { if (x.error) throw new Error('Redis error: ' + x.error); return x.result; });
    }
  };
}

function createMemoryStore() {
  const kv = new Map(); // key -> { v, exp }
  const live = function (k) {
    const e = kv.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) { kv.delete(k); return null; }
    return e;
  };
  function run(a) {
    const op = String(a[0]).toUpperCase();
    switch (op) {
      case 'GET': { const e = live(a[1]); return e ? e.v : null; }
      case 'SET': {
        let nx = false, exp = 0;
        for (let i = 3; i < a.length; i++) {
          const o = String(a[i]).toUpperCase();
          if (o === 'NX') nx = true;
          else if (o === 'EX') exp = Date.now() + Number(a[++i]) * 1000;
          else if (o === 'PX') exp = Date.now() + Number(a[++i]);
        }
        if (nx && live(a[1])) return null;
        kv.set(a[1], { v: String(a[2]), exp: exp });
        return 'OK';
      }
      case 'DEL': return kv.delete(a[1]) ? 1 : 0;
      case 'HSET': {
        let e = live(a[1]); if (!e) { e = { v: {}, exp: 0 }; kv.set(a[1], e); }
        for (let i = 2; i + 1 < a.length; i += 2) e.v[a[i]] = String(a[i + 1]);
        return 1;
      }
      case 'HGETALL': {
        const e = live(a[1]); const out = [];
        if (e) Object.keys(e.v).forEach(function (k) { out.push(k, e.v[k]); });
        return out;
      }
      case 'EXPIRE': { const e = live(a[1]); if (!e) return 0; e.exp = Date.now() + Number(a[2]) * 1000; return 1; }
      default: throw new Error('คำสั่ง Redis ไม่รองรับในโหมดหน่วยความจำ: ' + op);
    }
  }
  return {
    kind: 'memory',
    async cmd(args) { return run(args); },
    async pipeline(list) { return list.map(run); },
    _kv: kv
  };
}

let shared = null;
function getStore() {
  if (shared) return shared;
  const cfg = restConfig();
  shared = cfg ? createRestStore(cfg) : createMemoryStore();
  return shared;
}
function setStore(s) { shared = s; }

module.exports = { getStore, setStore, createRestStore, createMemoryStore };
