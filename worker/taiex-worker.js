/* 大盤指數小中轉站（Cloudflare Worker）。
   為什麼需要它：證交所的即時行情介面不允許別人的網頁直接呼叫（瀏覽器的跨網站限制），
   所以讓這個 Worker 代替網頁去問證交所，再把結果「加上通行證」回給你的網頁。
   省流量：結果在 Cloudflare 那邊暫存 15 秒，就算很多人同時開網頁，證交所一分鐘最多只被問 4 次。

   回傳格式：{ "date": "20261110", "time": "13:33:00", "price": 42711.92, "prev": 41661.7 }
   price = 最新成交指數（還沒開盤沒有成交時是 null）；prev = 前一個交易日收盤 */

const UPSTREAM = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0";
const ALLOWED_ORIGINS = [
  "https://rhwj7y2.github.io",   // 正式網站
  "http://127.0.0.1:8765",       // 本機測試
  "http://localhost:8765"
];
const CACHE_SECONDS = 15;

function num(v) {
  const n = Number(v);
  return v != null && v !== "-" && v !== "" && isFinite(n) ? n : null;
}

async function loadIndex() {
  const res = await fetch(UPSTREAM, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) throw new Error("upstream " + res.status);
  const j = await res.json();
  const r = j && j.msgArray && j.msgArray[0];
  if (!r) throw new Error("no data");
  return { date: r.d || null, time: r.t || null, price: num(r.z), prev: num(r.y) };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const headers = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers });

    const cache = caches.default;
    const key = new Request("https://taiex-cache.invalid/v1");  // 只是暫存用的名字，跟呼叫的人無關
    let body;
    const hit = await cache.match(key);
    if (hit) {
      body = await hit.text();
    } else {
      try {
        body = JSON.stringify(await loadIndex());
      } catch (e) {
        return new Response(JSON.stringify({ error: "upstream failed" }), {
          status: 502, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=" + CACHE_SECONDS } })));
    }
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
};
