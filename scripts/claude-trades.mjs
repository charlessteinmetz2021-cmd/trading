// Compte d'entraînement de Claude (paper trading).
// Claude écrit ses ordres dans claude-orders.json ; ce script (GitHub Actions, toutes les 5 minutes)
// rejoue les bougies d'une minute depuis chaque ordre : remplissage de l'ordre limite, stop loss,
// take profit, fermeture à l'heure prévue. Le résultat va dans claude-account.json, affiché par le site.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const START = 10000, RISK = 0.01;
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);

async function yahoo(sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) { log("yahoo", host, r.status); continue; }
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
      return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] })).filter(x => x.close != null && x.high != null);
    } catch (e) { log("yahoo", host, e?.message || e); }
  }
  throw new Error("Yahoo indisponible");
}
async function binance(symbol, coinbase) {
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000`);
      if (!r.ok) continue;
      const rows = await r.json();
      if (rows.length) return rows.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    } catch (e) {}
  }
  const r = await fetch(`https://api.exchange.coinbase.com/products/${coinbase}/candles?granularity=60`, { headers: { "User-Agent": "atelier-trading" } });
  return (await r.json()).map(k => ({ time: k[0], low: +k[1], high: +k[2], open: +k[3], close: +k[4] })).sort((a, b) => a.time - b.time);
}
// Nasdaq : l'indice comptant (^NDX), comme le graphique NAS100 du site, et pas le contrat à terme.
export const FEEDS = { BTC: () => binance("BTCUSDT", "BTC-USD"), XAU: () => binance("PAXGUSDT", "PAXG-USD"), NAS: () => yahoo("^NDX") };

// Rejoue un ordre sur les bougies d'une minute. Renvoie l'état de l'ordre.
export function replay(o, bars, now = Date.now()) {
  const placed = Date.parse(o.placedAt) / 1000, closeBy = o.closeBy ? Date.parse(o.closeBy) / 1000 : Infinity, cancel = o.cancelAt ? Date.parse(o.cancelAt) / 1000 : Infinity;
  const end = Math.min(closeBy, cancel);
  const qty = (START * RISK) / Math.abs(o.entry - o.stop);
  let pos = null;
  const after = bars.filter(b => b.time >= Math.floor(placed / 60) * 60);
  for (const b of after) {
    if (b.time >= end) {
      if (pos) return { ...pos, status: "closed", exit: b.open, why: b.time >= closeBy ? "fermé à l'heure prévue" : "fermé par Claude", closedAt: b.time * 1000, pnl: (b.open - pos.fill) * o.dir * qty };
      return { status: "expired", why: b.time >= closeBy ? "ordre limite jamais touché" : "ordre annulé par Claude", at: b.time * 1000 };
    }
    if (!pos) {
      if (o.type === "market") pos = { fill: b.open, openedAt: b.time * 1000, qty };
      else if (o.dir === -1 && b.high >= o.entry) pos = { fill: Math.max(o.entry, b.open), openedAt: b.time * 1000, qty };
      else if (o.dir === 1 && b.low <= o.entry) pos = { fill: Math.min(o.entry, b.open), openedAt: b.time * 1000, qty };
      if (!pos) continue;
      if ((pos.fill - o.stop) * o.dir <= 0) return { status: "expired", why: "le prix avait déjà dépassé le stop", at: b.time * 1000 };
    }
    // si le stop et l'objectif sont touchés dans la même minute, on compte le stop (prudence)
    const hitStop = o.dir === 1 ? b.low <= o.stop : b.high >= o.stop, hitTp = o.dir === 1 ? b.high >= o.target : b.low <= o.target;
    if (hitStop) return { ...pos, status: "closed", exit: o.stop, why: "stop loss", closedAt: b.time * 1000, pnl: (o.stop - pos.fill) * o.dir * qty };
    if (hitTp) return { ...pos, status: "closed", exit: o.target, why: "take profit", closedAt: b.time * 1000, pnl: (o.target - pos.fill) * o.dir * qty };
  }
  const last = bars.length ? bars[bars.length - 1].close : null;
  if (pos) return { ...pos, status: "open", last, pnl: (last - pos.fill) * o.dir * qty };
  return { status: now / 1000 >= end ? "expired" : "pending", last };
}

export async function run(feeds = FEEDS) {
  const orders = read("claude-orders.json", []);
  const prev = read("claude-account.json", { trades: [] });
  const done = new Map(prev.trades.filter(t => t.status === "closed" || t.status === "expired").map(t => [t.id, t]));
  const cache = {}, trades = [], last = {};
  for (const o of orders) {
    if (done.has(o.id)) { trades.push(done.get(o.id)); continue; }
    try {
      const bars = await (cache[o.sym] ||= feeds[o.sym]());
      last[o.sym] = bars.length ? bars[bars.length - 1].close : null;
      trades.push({ ...o, ...replay(o, bars) });
    } catch (e) { log(o.id, "prix indisponible", e?.message || e); const p = prev.trades.find(t => t.id === o.id); trades.push(p || { ...o, status: "pending" }); }
  }
  const realized = trades.filter(t => t.status === "closed").reduce((s, t) => s + t.pnl, 0);
  const open = trades.filter(t => t.status === "open").reduce((s, t) => s + t.pnl, 0);
  const acc = { start: START, balance: START + realized, open, last, trades, updated: Date.now() };
  writeFileSync("claude-account.json", JSON.stringify(acc, null, 1));
  for (const t of trades) log(t.id, t.status, t.fill ?? "", t.exit ?? "", t.pnl != null ? t.pnl.toFixed(2) : "");
  return acc;
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
