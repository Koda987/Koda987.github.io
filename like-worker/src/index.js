/* 点赞计数 Worker:点赞数据存在 Cloudflare D1(SQLite)里,原子自增,免费套餐绰绰有余。
   接口形状与 pet.js 的 Abacus 用法对齐:
     GET/POST /hit/<名字>   自增并返回 {"value": n}
     GET      /get/<名字>   只读返回 {"value": n}
   名字可以带一段命名空间,如 /hit/koda987-site/like。
   CORS 全开:GitHub Pages 可直接 fetch。 */

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const u = new URL(req.url);
    const m = u.pathname.match(/^\/(hit|get)\/([a-zA-Z0-9_-]{1,64}(?:\/[a-zA-Z0-9_-]{1,64})?)\/?$/);
    if (!m) return json({ error: '用法: GET/POST /hit/<名字> 或 GET /get/<名字>' }, 404, cors);
    const [, mode, key] = m;

    try {
      let value = 0;
      if (mode === 'hit') {
        // 原子自增:并发点赞也不会丢计数(SQLite UPSERT + RETURNING)
        const r = await env.DB.prepare(
          'INSERT INTO counters (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n'
        ).bind(key).first();
        value = r ? r.n : 0;
      } else {
        const r = await env.DB.prepare('SELECT n FROM counters WHERE key = ?').bind(key).first();
        value = r ? r.n : 0;
      }
      return json({ value }, 200, cors);
    } catch (e) {
      return json({ error: '数据库错误:' + (e && e.message) }, 500, cors);
    }
  },
};
