// Backtest des signaux du serveur (scoreMarket) sur l'historique 15 min, avec plusieurs variantes de filtres.
// node scripts/backtest.mjs  → tableau par marché et par variante (résultats en R, frais inclus)
import { scoreMarket } from "../signals.js";
import * as I from "../indicators.js";

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
async function binance15(sym, days) {
  let end = Date.now(), out = [];
  while (out.length < days * 96) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=15m&limit=1000&endTime=${end}`);
    const rows = await r.json(); if (!rows.length) break;
    out = rows.map(k => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).concat(out);
    end = rows[0][0] - 1;
  }
  return out;
}
async function yahoo15(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=60d`, UA);
  const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
  return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 })).filter(x => x.close != null && x.high != null);
}
const hourParis = t => parseInt(new Date(t * 1000).toLocaleString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }), 10);
function to1h(b) { const o = []; for (const x of b) { const t = x.time - (x.time % 3600), l = o[o.length - 1]; if (l && l.time === t) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; } else o.push({ ...x, time: t }); } return o; }
function adx(b, n = 14) {
  const tr = [], pd = [], md = [];
  for (let i = 1; i < b.length; i++) { const u = b[i].high - b[i - 1].high, d = b[i - 1].low - b[i].low; pd.push(u > d && u > 0 ? u : 0); md.push(d > u && d > 0 ? d : 0); tr.push(Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close))); }
  const w = a => { let s = a.slice(0, n).reduce((x, y) => x + y, 0); const o = [s]; for (let i = n; i < a.length; i++) { s = s - s / n + a[i]; o.push(s); } return o; };
  const T = w(tr), P = w(pd), M = w(md), dx = T.map((t, i) => { const p = 100 * P[i] / t, m = 100 * M[i] / t; return 100 * Math.abs(p - m) / (p + m || 1); });
  let a = dx.slice(0, n).reduce((x, y) => x + y, 0) / n; for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n; return a;
}

async function run(name, b, cost) {
  const W = 300, sig = [];
  const h1 = to1h(b);
  for (let i = W; i < b.length - 1; i++) {
    const w = b.slice(i - W + 1, i + 1), sc = scoreMarket(w, 900, 0);
    if (Math.abs(sc.score) < 6) continue;
    const dir = Math.sign(sc.score);
    let stop = dir === 1 ? Math.min(sc.px - 1.5 * sc.atr, sc.pl ?? Infinity) : Math.max(sc.px + 1.5 * sc.atr, sc.ph ?? -Infinity);
    if (!isFinite(stop) || Math.abs(sc.px - stop) > 4 * sc.atr) stop = sc.px - dir * 1.5 * sc.atr;
    const hb = h1.filter(x => x.time + 3600 <= b[i].time + 900).slice(-W), hs = hb.length > 210 ? scoreMarket(hb, 3600, 0).score : 0;
    const rsi = I.rsi(w.map(x => x.close)).at(-1), hi24 = Math.max(...w.slice(-96).map(x => x.high)), lo24 = Math.min(...w.slice(-96).map(x => x.low));
    sig.push({ i, t: b[i].time, dir, score: sc.score, px: sc.px, stop, R: Math.abs(sc.px - stop), atr: sc.atr, hs, adx: adx(w), rsi, pos: (sc.px - lo24) / (hi24 - lo24 || 1), hour: hourParis(b[i].time), struct: sc.details.some(d => d.name === "Structure") });
  }
  function sim(s, tpR, beAt) {
    let stop = s.stop; const tgt = s.px + s.dir * tpR * s.R;
    for (let j = s.i + 1; j < Math.min(b.length, s.i + 97); j++) {
      const x = b[j], adv = s.dir === 1 ? x.low : x.high, fav = s.dir === 1 ? x.high : x.low;
      if ((adv - stop) * s.dir <= 0) return (stop - s.px) * s.dir / s.R;
      if ((fav - tgt) * s.dir >= 0) return tpR;
      if (beAt && (fav - s.px) * s.dir >= beAt * s.R) stop = s.dir === 1 ? Math.max(stop, s.px + 0.05 * s.R) : Math.min(stop, s.px - 0.05 * s.R);
    }
    return (b[Math.min(b.length - 1, s.i + 96)].close - s.px) * s.dir / s.R;
  }
  const V = {
    "A base (score 8, 2R)": s => Math.abs(s.score) >= 8,
    "B score 10": s => Math.abs(s.score) >= 10,
    "C base + tendance 1h": s => Math.abs(s.score) >= 8 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4,
    "D base + 16h-22h": s => Math.abs(s.score) >= 8 && s.hour >= 16 && s.hour < 22,
    "E base + 8h-18h": s => Math.abs(s.score) >= 8 && s.hour >= 8 && s.hour < 18,
    "F base + ADX>25": s => Math.abs(s.score) >= 8 && s.adx > 25,
    "G base sans RSI extrême": s => Math.abs(s.score) >= 8 && !(s.dir === 1 ? s.rsi > 70 : s.rsi < 30),
    "H base, pas en bout de range 24h": s => Math.abs(s.score) >= 8 && (s.dir === 1 ? s.pos < 0.8 : s.pos > 0.2),
    "I 1h + ADX>25": s => Math.abs(s.score) >= 8 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4 && s.adx > 25,
    "J 1h + pas en bout de range": s => Math.abs(s.score) >= 8 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4 && (s.dir === 1 ? s.pos < 0.8 : s.pos > 0.2),
    "L score 10 + ADX>25": s => Math.abs(s.score) >= 10 && s.adx > 25,
    "M score 10 + 1h": s => Math.abs(s.score) >= 10 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4,
    "N ADX>25 + 16h-22h": s => Math.abs(s.score) >= 8 && s.adx > 25 && s.hour >= 16 && s.hour < 22,
    "O score 10 + 8h-18h": s => Math.abs(s.score) >= 10 && s.hour >= 8 && s.hour < 18,
    "P score 10 + 1h + 8h-18h": s => Math.abs(s.score) >= 10 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4 && s.hour >= 8 && s.hour < 18,
    "Q ADX>25 + 0h-3h": s => Math.abs(s.score) >= 8 && s.adx > 25 && s.hour < 3,
    "R score 10 + 0h-3h": s => Math.abs(s.score) >= 10 && s.hour < 3,
    "K score 6 + 1h": s => Math.abs(s.score) >= 6 && Math.sign(s.hs) === s.dir && Math.abs(s.hs) >= 4,
  };
  const half = b[Math.floor(W + (b.length - W) * 0.6)].time;
  console.log(`\n=== ${name} : ${b.length} bougies 15 min, du ${new Date(b[0].time * 1000).toISOString().slice(0, 10)} au ${new Date(b.at(-1).time * 1000).toISOString().slice(0, 10)}, frais ${cost}`);
  console.log("variante | sortie | trades | gagnants % | R moyen | R total | creux max R | R moyen 1re partie / 2e partie");
  for (const [vn, f] of Object.entries(V)) for (const [tpR, beAt, lab] of [[2, 0, "2R"], [2, 1, "2R+BE1R"], [1.5, 0, "1,5R"], [3, 1, "3R+BE1R"]]) {
    let last = -1e9; const rs = [], parts = [[], []];
    for (const s of sig) { if (!f(s) || s.t - last < 5400) continue; last = s.t; const r = sim(s, tpR, beAt) - cost / s.R * 1; rs.push(r); parts[s.t < half ? 0 : 1].push(r); }
    if (!rs.length) { console.log(`${vn} | ${lab} | 0`); continue; }
    let eq = 0, pk = 0, dd = 0; for (const r of rs) { eq += r; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "–";
    console.log(`${vn} | ${lab} | ${rs.length} | ${Math.round(100 * rs.filter(r => r > 0).length / rs.length)} | ${avg(rs)} | ${eq.toFixed(1)} | ${dd.toFixed(1)} | ${avg(parts[0])} / ${avg(parts[1])}`);
  }
}
await run("Bitcoin (Binance BTCUSDT)", await binance15("BTCUSDT", 90), 15);
await run("Euro/dollar (Yahoo EURUSD=X)", await yahoo15("EURUSD=X"), 0.0001);
