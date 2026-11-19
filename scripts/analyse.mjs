// Analyse complète d'un marché pour Claude : structure multi-UT (méthode InstitutionalFx) + tous les indicateurs classiques.
// node scripts/analyse.mjs EURUSD=X
import { scoreMarket, adx } from "../signals.js";
import * as I from "../indicators.js";

const sym = process.argv[2] || "EURUSD=X";
const paris = t => new Date(t * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
async function yahoo(interval, range) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
      return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 })).filter(x => x.close != null && x.high != null && x.low != null);
    } catch (e) {}
  }
  throw new Error("Yahoo indisponible");
}
const agg = (b, sec) => { const o = []; for (const x of b) { const t = x.time - (x.time % sec), l = o[o.length - 1]; if (l && l.time === t) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; l.volume += x.volume; } else o.push({ ...x, time: t }); } return o; };

const px0 = (await yahoo("1m", "1d")).at(-1);
const dec = px0.close < 10 ? 5 : px0.close < 1000 ? 2 : 1, f = v => v == null || isNaN(v) ? "–" : (+v).toFixed(dec);
const tfs = {
  "Daily": [await yahoo("1d", "2y"), 86400, 3],
  "4 h": [agg(await yahoo("1h", "6mo"), 14400), 14400, 3],
  "1 h": [await yahoo("1h", "1mo"), 3600, 4],
  "15 min": [await yahoo("15m", "30d"), 900, 4],
};
console.log(`# ${sym} — prix ${f(px0.close)} à ${paris(px0.time)} (heure de Paris)`);

function swings(b, k) {
  const out = [];
  for (let i = k; i < b.length - k; i++) {
    const w = b.slice(i - k, i + k + 1);
    if (b[i].high === Math.max(...w.map(x => x.high))) out.push({ t: b[i].time, type: "H", p: b[i].high, i });
    if (b[i].low === Math.min(...w.map(x => x.low))) out.push({ t: b[i].time, type: "L", p: b[i].low, i });
  }
  return out;
}
for (const [name, [b, step, k]] of Object.entries(tfs)) {
  const n = b.length - 1, px = b[n].close, atr = I.atr(b).at(-1);
  const sc = b.length >= 210 ? scoreMarket(b.slice(-400), step, 0) : null;
  const sw = swings(b, k), H = sw.filter(s => s.type === "H").slice(-5), L = sw.filter(s => s.type === "L").slice(-5);
  const hh = H.length > 1 && H.at(-1).p > H.at(-2).p, hl = L.length > 1 && L.at(-1).p > L.at(-2).p;
  const trend = hh && hl ? "haussière (HH + HL)" : !hh && !hl ? "baissière (LH + LL)" : "mixte / transition";
  // BOS : dernier swing cassé par une clôture
  let bos = "aucun récent";
  for (let i = n; i > n - 60 && i > 0; i--) {
    const prevH = sw.filter(s => s.type === "H" && s.i < i - k).at(-1), prevL = sw.filter(s => s.type === "L" && s.i < i - k).at(-1);
    if (prevH && b[i].close > prevH.p && b[i - 1].close <= prevH.p) { bos = `haussier : clôture au-dessus de ${f(prevH.p)} le ${paris(b[i].time)}`; break; }
    if (prevL && b[i].close < prevL.p && b[i - 1].close >= prevL.p) { bos = `baissier : clôture sous ${f(prevL.p)} le ${paris(b[i].time)}`; break; }
  }
  const tol = atr * 0.15, eq = (arr, lab) => { const r = []; for (let a = 0; a < arr.length; a++) for (let c = a + 1; c < arr.length; c++) if (Math.abs(arr[a].p - arr[c].p) <= tol) r.push(`${lab} ${f(arr[a].p)}≈${f(arr[c].p)} (${paris(arr[a].t)} / ${paris(arr[c].t)})`); return r; };
  const allH = sw.filter(s => s.type === "H").slice(-12), allL = sw.filter(s => s.type === "L").slice(-12);
  const fvg = [];
  for (let i = n; i > Math.max(2, n - 150); i--) {
    if (b[i].low > b[i - 2].high) { const lo = b[i - 2].high, hi = b[i].low; if (!b.slice(i + 1).some(x => x.low <= lo)) fvg.push(`haussière ${f(lo)}-${f(hi)} (${paris(b[i - 1].time)})`); }
    if (b[i].high < b[i - 2].low) { const lo = b[i].high, hi = b[i - 2].low; if (!b.slice(i + 1).some(x => x.high >= hi)) fvg.push(`baissière ${f(lo)}-${f(hi)} (${paris(b[i - 1].time)})`); }
    if (fvg.length >= 4) break;
  }
  const c = b.map(x => x.close), e20 = I.ema(c, 20).at(-1), e50 = I.ema(c, 50).at(-1), s200 = I.sma(c, 200).at(-1);
  const ic = I.ichimoku(b, step), sa = ic.spanA[n - 26]?.value, sb = ic.spanB[n - 26]?.value;
  console.log(`\n## ${name} (${b.length} bougies, ATR ${f(atr)})`);
  console.log(`Structure : ${trend}. Derniers sommets : ${H.map(s => f(s.p)).join(" → ")}. Derniers creux : ${L.map(s => f(s.p)).join(" → ")}.`);
  console.log(`Dernier BOS : ${bos}.`);
  const eqs = [...new Set([...eq(allH, "EQH"), ...eq(allL, "EQL")])].slice(-8); console.log(`Liquidité égale : ${eqs.length ? eqs.join(" ; ") : "aucune"}.`);
  console.log(`Imbalances non comblées : ${fvg.length ? fvg.join(" ; ") : "aucune proche"}.`);
  console.log(`MM : EMA20 ${f(e20)}, EMA50 ${f(e50)}, SMA200 ${f(s200)} (prix ${px > e20 ? ">" : "<"} EMA20, ${px > e50 ? ">" : "<"} EMA50, ${s200 ? (px > s200 ? ">" : "<") : "?"} SMA200).`);
  console.log(`Ichimoku : tenkan ${f(ic.tenkan.at(-1)?.value ?? ic.tenkan.at(-1))}, kijun ${f(ic.kijun.at(-1)?.value ?? ic.kijun.at(-1))}, nuage ${f(Math.min(sa, sb))}-${f(Math.max(sa, sb))} → prix ${px > Math.max(sa, sb) ? "au-dessus" : px < Math.min(sa, sb) ? "sous" : "dans"} le nuage.`);
  console.log(`RSI ${I.rsi(c).at(-1)?.toFixed(0)}, MACD hist ${I.macd(c).hist.at(-1)?.toExponential(2)}, ADX ${adx(b.slice(-300))?.toFixed(0)}, Bollinger ${f(I.bollinger(c).lo.at(-1))}-${f(I.bollinger(c).up.at(-1))}.`);
  if (sc) console.log(`Score des méthodes : ${sc.score} (${sc.details.map(d => `${d.name} ${d.v > 0 ? "+" : ""}${d.v}`).join(", ")}).`);
  if (name === "4 h" && H.length && L.length) { // Fibonacci de la dernière jambe
    const a = H.at(-1), z = L.at(-1), up = a.t < z.t ? false : true, hi = Math.max(a.p, z.p), lo = Math.min(a.p, z.p);
    console.log(`Fibonacci dernière jambe ${up ? "haussière" : "baissière"} ${f(lo)}-${f(hi)} : ` + [0.382, 0.5, 0.618, 0.786].map(r => `${r * 100}% ${f(up ? hi - (hi - lo) * r : lo + (hi - lo) * r)}`).join(", "));
  }
}
const d = tfs["Daily"][0], y = d.at(-2), P = (y.high + y.low + y.close) / 3;
console.log(`\n## Pivots du jour (veille H ${f(y.high)} L ${f(y.low)} C ${f(y.close)}) : R2 ${f(P + (y.high - y.low))}, R1 ${f(2 * P - y.low)}, P ${f(P)}, S1 ${f(2 * P - y.high)}, S2 ${f(P - (y.high - y.low))}`);
