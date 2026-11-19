// Affiche les dernières bougies d'un marché (Yahoo Finance) pour une analyse : node scripts/prix.mjs EURUSD=X
const sym = process.argv[2] || "EURUSD=X";
const paris = t => new Date(t * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", hour: "2-digit", minute: "2-digit" });
for (const [interval, range, n] of [["1d", "1y", 120], ["1h", "3mo", 400], ["1h", "1mo", 120], ["15m", "5d", 96], ["5m", "1d", 72]]) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
  const rows = res.timestamp.map((t, i) => [t, q.open[i], q.high[i], q.low[i], q.close[i]]).filter(x => x[4] != null).slice(-n);
  console.log(`== ${sym} ${interval} (heure de Paris) : ouverture haut bas clôture`);
  for (const [t, o, h, l, c] of rows) console.log(paris(t), [o, h, l, c].map(v => v.toFixed(5)).join(" "));
}
