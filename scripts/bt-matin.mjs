// Backtest « entrée entre 7h45 et 8h (Paris), trade laissé seul ensuite » sur 60 jours de bougies 15 min Yahoo.
// node scripts/bt-matin.mjs → résultats par paire et par variante, en R, écart achat/vente compris.
import * as I from "../indicators.js";
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
async function yahoo(sym, interval, range) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, UA);
  const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
  return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] })).filter(x => x.close != null && x.high != null);
}
const parts = t => { const s = new Date(t * 1000).toLocaleString("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }); const [wd, d, hm] = s.split(", "); const [h, m] = hm.split(":").map(Number); return { wd, d, mins: h * 60 + m }; };
const PAIRS = { "EURUSD=X": 0.0001, "GBPUSD=X": 0.00015, "USDJPY=X": 0.015, "USDCHF=X": 0.00015, "AUDUSD=X": 0.00012, "USDCAD=X": 0.00015 };
const res = {};
for (const [sym, spread] of Object.entries(PAIRS)) {
  let b; try { b = await yahoo(sym, "15m", "60d"); } catch (e) { console.log(sym, "erreur", e.message); continue; }
  const h1 = []; for (const x of b) { const t = x.time - (x.time % 3600), l = h1.at(-1); if (l && l.time === t) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; } else h1.push({ ...x }); }
  const e50 = I.ema(h1.map(x => x.close), 50), e200 = I.ema(h1.map(x => x.close), 200);
  const emaAt = (arr, t) => { let k = -1; for (let i = 0; i < h1.length && h1[i].time <= t - 3600; i++) k = i; return k >= 0 ? (arr[k]?.value ?? arr[k]) : null; };
  const atr1 = I.atr(h1); const atrAt = t => { let k = -1; for (let i = 0; i < h1.length && h1[i].time <= t - 3600; i++) k = i; return k >= 0 ? (atr1[k]?.value ?? atr1[k]) : null; };
  const days = {}; for (const x of b) { const p = parts(x.time); (days[p.d] ||= []).push({ ...x, ...p }); }
  const R = {}; const add = (k, r) => (R[k] ||= []).push(r);
  const sim = (bars, dir, entry, stop, target) => { // SL prioritaire si les deux dans la même bougie ; sortie 22h
    const e = entry + dir * spread / 2, risk = Math.abs(e - stop);
    for (const x of bars) { if (dir === 1 ? x.low <= stop : x.high >= stop) return -1; if (dir === 1 ? x.high >= target : x.low <= target) return Math.abs(target - e) / risk; }
    const last = bars.at(-1); return last ? (last.close - e) * dir / risk : 0;
  };
  for (const [d, bars] of Object.entries(days)) {
    if (["Sat", "Sun"].includes(bars[0].wd)) continue;
    const asia = bars.filter(x => x.mins < 7 * 60 + 45), e0 = bars.find(x => x.mins === 7 * 60 + 45);
    if (asia.length < 20 || !e0) continue;
    const after = bars.filter(x => x.mins >= 7 * 60 + 45 && x.mins < 22 * 60), entry = e0.open;
    const aH = Math.max(...asia.map(x => x.high)), aL = Math.min(...asia.map(x => x.low)), rng = aH - aL, buf = 0.1 * rng;
    const m50 = emaAt(e50, e0.time), m200 = emaAt(e200, e0.time), atr = atrAt(e0.time); if (m50 == null || m200 == null || !atr) continue;
    const bias1 = entry > m50 ? 1 : -1, bias2 = m50 > m200 ? 1 : -1, both = bias1 === bias2 ? bias1 : 0;
    // V1 : sens EMA50 1 h, stop de l'autre côté du range asiatique, objectif 1,5 R / 2 R
    for (const [name, dir] of [["V1 EMA50", bias1], ["V1b EMA50+200", both]]) {
      if (!dir) continue; const stop = dir === 1 ? aL - buf : aH + buf, risk = Math.abs(entry - stop); if (risk <= 0 || risk > 3 * atr) continue;
      for (const k of [1.5, 2]) add(`${name} stop range ${k}R`, sim(after, dir, entry, stop, entry + dir * k * risk));
    }
    // V3 : sens EMA50+200, stop 1,5 ATR 1 h, objectif 2 R
    if (both) { const stop = entry - both * 1.5 * atr; for (const k of [1.5, 2]) add(`V3 tendance stop 1,5ATR ${k}R`, sim(after, both, entry, stop, entry + both * k * 1.5 * atr)); }
    // V2 : chasse de liquidité asiatique (formation) : le range 0h-6h est balayé entre 6h et 7h45 puis le prix revient dedans → sens inverse du balayage, objectif l'autre bord
    const early = asia.filter(x => x.mins < 6 * 60), late = asia.filter(x => x.mins >= 6 * 60);
    if (early.length > 10 && late.length) {
      const eH = Math.max(...early.map(x => x.high)), eL = Math.min(...early.map(x => x.low)), lH = Math.max(...late.map(x => x.high)), lL = Math.min(...late.map(x => x.low));
      for (const [dir, ok, stop, target] of [[1, lL < eL && entry > eL, lL - 0.1 * (eH - eL), eH], [-1, lH > eH && entry < eH, lH + 0.1 * (eH - eL), eL]]) {
        if (!ok) continue; const risk = Math.abs(entry - stop), rr = Math.abs(target - entry) / risk; if (rr < 1.2) continue;
        add("V2 balayage Asie (tous)", sim(after, dir, entry, stop, target));
        if (dir === both) add("V2 balayage Asie + tendance", sim(after, dir, entry, stop, target));
      }
    }
  }
  res[sym] = R;
  console.log(`\n== ${sym}`);
  for (const [k, v] of Object.entries(R)) { const w = v.filter(x => x > 0).length; console.log(`${k.padEnd(34)} n=${String(v.length).padStart(3)}  gagnants ${Math.round(100 * w / v.length)} %  moyenne ${(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2)} R  total ${v.reduce((a, c) => a + c, 0).toFixed(1)} R`); }
}
console.log("\n== Toutes paires");
const tot = {}; for (const R of Object.values(res)) for (const [k, v] of Object.entries(R)) (tot[k] ||= []).push(...v);
for (const [k, v] of Object.entries(tot)) { const w = v.filter(x => x > 0).length; console.log(`${k.padEnd(34)} n=${String(v.length).padStart(3)}  gagnants ${Math.round(100 * w / v.length)} %  moyenne ${(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2)} R`); }
