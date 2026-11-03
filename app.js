// Atelier de trading : simulation, graphique maison, dessins, indicateurs et analyse par Claude.
import * as I from "./indicators.js";
const $ = id => document.getElementById(id);
const LC = window.LightweightCharts;

const MARKETS = {
  BTC: { name: "Bitcoin", tv: "BITSTAMP:BTCUSD", feed: "BTCUSDT", dec: 2, step: 0.001 },
  XAU: { name: "Or", tv: "OANDA:XAUUSD", feed: "PAXGUSDT", dec: 2, step: 0.01 },
  NAS: { name: "Nasdaq 100", tv: "OANDA:NAS100USD", feed: null, dec: 1, step: 0.1 },
};
const TF = [["1m", "1 min", "1"], ["5m", "5 min", "5"], ["15m", "15 min", "15"], ["1h", "1 h", "60"], ["4h", "4 h", "240"], ["1d", "Jour", "D"]];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const TZ = -new Date().getTimezoneOffset() * 60; // affichage à l'heure locale

const usd = v => (v < 0 ? "−" : "") + Math.abs(v).toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const sgn = v => (v > 0 ? "+" : "") ;
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "–" : (+v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const signCls = v => (v > 0 ? "gain" : v < 0 ? "loss" : "");
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const price = { BTC: null, XAU: null, NAS: null };
let cur = "BTC", tf = "15m", orderType = "market", tool = "none", pending = null, tvMode = true;

// ---------- état sauvegardé dans le navigateur ----------
const KEY = "atelier-trading-v1";
const fresh = cap => ({ start: cap, balance: cap, positions: [], orders: [], history: [], nasPrice: null, nextId: 1 });
let S = null;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
if (!S || !Array.isArray(S.positions)) S = fresh(10000);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
price.NAS = S.nasPrice;

const DKEY = "atelier-dessins-v1";
let D = {};
try { D = JSON.parse(localStorage.getItem(DKEY)) || {}; } catch (e) {}
const saveD = () => { try { localStorage.setItem(DKEY, JSON.stringify(D)); } catch (e) {} };
const drawings = () => (D[cur] ||= { mine: [], claude: [] });

// ---------- graphique maison (Lightweight Charts) ----------
let chart, candles, candleData = [];
let drawnLines = [], drawnSeries = [], posLines = [];
function makeChart() {
  chart = LC.createChart($("chart"), {
    autoSize: true,
    layout: { background: { color: css("--panel") }, textColor: css("--muted"), fontFamily: "IBM Plex Mono, monospace" },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: css("--line") },
    rightPriceScale: { borderColor: css("--line") },
    crosshair: { mode: 0 },
    localization: { locale: "fr-FR" },
  });
  candles = chart.addSeries(LC.CandlestickSeries, {
    upColor: "#1f9d5a", downColor: "#d0453a", borderVisible: false, wickUpColor: "#1f9d5a", wickDownColor: "#d0453a",
  });
  chart.subscribeClick(onChartClick);
  setupDrag();
}
function setPrecision() {
  const d = MARKETS[cur].dec;
  candles.applyOptions({ priceFormat: { type: "price", precision: d, minMove: 1 / 10 ** d } });
}

let klineWs = null;
const CB = { BTCUSDT: "BTC-USD", PAXGUSDT: "PAXG-USD" };
const CB_GRAN = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 21600, "1d": 86400 };
// Historique : Binance (deux adresses), puis Coinbase si Binance est bloqué chez l'utilisateur
async function fetchCandles(feed, frame) {
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${feed}&interval=${frame}&limit=500`);
      if (!r.ok) continue;
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return { src: "Binance", rows: rows.map(k => ({ time: Math.floor(k[0] / 1000) + TZ, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })) };
    } catch (e) {}
  }
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${CB[feed]}/candles?granularity=${CB_GRAN[frame]}`);
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) return { src: "Coinbase", rows: rows.map(k => ({ time: k[0] + TZ, low: +k[1], high: +k[2], open: +k[3], close: +k[4], volume: +k[5] })).sort((a, b) => a.time - b.time) };
  } catch (e) {}
  return null;
}
let dataSrc = null;
async function loadCandles() {
  if (klineWs) { klineWs.onclose = null; klineWs.close(); klineWs = null; }
  clearInterval(pollTimer);
  candleData = [];
  candles.setData([]);
  const m = MARKETS[cur];
  if (!m.feed) return;
  setPrecision();
  const sym = cur, frame = tf;
  const res = await fetchCandles(m.feed, tf);
  if (sym !== cur || frame !== tf) return;
  if (!res) { dataSrc = null; $("indStatus").textContent = "Les prix ne se chargent pas sur ta connexion (Binance et Coinbase injoignables). Les indicateurs restent disponibles sur la vue TradingView."; renderIndicators(); return; }
  dataSrc = res.src; candleData = res.rows;
  $("indStatus").textContent = `Données : ${res.src}, ${candleData.length} bougies.`;
  candles.setData(candleData);
  chart.timeScale().scrollToRealTime();
  renderDrawings(); renderPosLines(); renderIndicators();
  const onBar = bar => {
    if (sym !== cur || frame !== tf) return;
    const last = candleData[candleData.length - 1];
    if (last && last.time === bar.time) candleData[candleData.length - 1] = bar; else if (!last || bar.time > last.time) candleData.push(bar);
    candles.update(bar); refreshIndicatorsSoon();
  };
  if (res.src === "Binance") {
    klineWs = new WebSocket(`wss://data-stream.binance.vision/ws/${m.feed.toLowerCase()}@kline_${tf}`);
    klineWs.onmessage = ev => { const k = JSON.parse(ev.data).k; onBar({ time: Math.floor(k.t / 1000) + TZ, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }); };
    klineWs.onclose = () => setTimeout(() => { if (sym === cur && frame === tf) loadCandles(); }, 5000);
  } else {
    pollTimer = setInterval(async () => { const r2 = await fetchCandles(m.feed, frame); if (r2) onBar(r2.rows[r2.rows.length - 1]); }, 15000);
  }
}
let pollTimer = 0;

// ---------- indicateurs ----------
const IND = [
  { id: "sma20", name: "Moyenne mobile 20", g: "Sur le graphique", c: "#e0a944", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 20 } } },
  { id: "sma50", name: "Moyenne mobile 50", g: "Sur le graphique", c: "#3b82f6", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 50 } } },
  { id: "sma200", name: "Moyenne mobile 200", g: "Sur le graphique", c: "#ef4444", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 200 } } },
  { id: "ema9", name: "EMA 9", g: "Sur le graphique", c: "#14b8a6", tv: { id: "MAExp@tv-basicstudies", inputs: { length: 9 } } },
  { id: "ema21", name: "EMA 21", g: "Sur le graphique", c: "#a855f7", tv: { id: "MAExp@tv-basicstudies", inputs: { length: 21 } } },
  { id: "boll", name: "Bandes de Bollinger", g: "Sur le graphique", c: "#64748b", tv: "BB@tv-basicstudies" },
  { id: "ichi", name: "Ichimoku", g: "Sur le graphique", c: "#0ea5e9", tv: "IchimokuCloud@tv-basicstudies" },
  { id: "vwap", name: "VWAP (journalier)", g: "Sur le graphique", c: "#f97316", tv: "VWAP@tv-basicstudies" },
  { id: "psar", name: "Parabolic SAR", g: "Sur le graphique", c: "#84cc16", tv: "PSAR@tv-basicstudies" },
  { id: "st", name: "Supertrend", g: "Sur le graphique", c: "#22c55e" },
  { id: "piv", name: "Points pivots", g: "Sur le graphique", c: "#94a3b8", tv: "PivotPointsStandard@tv-basicstudies" },
  { id: "vol", name: "Volume", g: "Sur le graphique", c: "#94a3b8", tv: "Volume@tv-basicstudies" },
  { id: "rsi", name: "RSI 14", g: "Sous le graphique", c: "#a855f7", tv: "RSI@tv-basicstudies" },
  { id: "macd", name: "MACD 12 26 9", g: "Sous le graphique", c: "#3b82f6", tv: "MACD@tv-basicstudies" },
  { id: "stoch", name: "Stochastique 14 3 3", g: "Sous le graphique", c: "#f97316", tv: "Stochastic@tv-basicstudies" },
  { id: "atr", name: "ATR 14 (volatilité)", g: "Sous le graphique", c: "#64748b", tv: "ATR@tv-basicstudies" },
];
const IKEY = "atelier-indicateurs-v1";
let active = new Set(["sma50", "rsi"]);
try { const a = JSON.parse(localStorage.getItem(IKEY)); if (Array.isArray(a)) active = new Set(a); } catch (e) {}
let indSeries = [], indLines = [];
const STEP = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
function renderIndList() {
  const groups = [...new Set(IND.map(x => x.g))];
  $("indList").innerHTML = groups.map(g => `<h3>${g}</h3>` + IND.filter(x => x.g === g).map(x =>
    `<label><input type="checkbox" data-ind="${x.id}" ${active.has(x.id) ? "checked" : ""}><i style="background:${x.c}"></i>${x.name}${x.tv ? "" : ' <small style="color:var(--muted)">(vue mes trades)</small>'}</label>`).join("")).join("");
  $("indList").querySelectorAll("input").forEach(cb => cb.onchange = () => {
    cb.checked ? active.add(cb.dataset.ind) : active.delete(cb.dataset.ind);
    try { localStorage.setItem(IKEY, JSON.stringify([...active])); } catch (e) {}
    renderIndicators();
    if (tvMode || !MARKETS[cur].feed) drawTv();
  });
}
function renderIndicators() {
  if (!chart) return;
  indSeries.forEach(s => chart.removeSeries(s)); indSeries = [];
  indLines.forEach(l => candles.removePriceLine(l)); indLines = [];
  for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);
  const b = candleData;
  if (!MARKETS[cur].feed || b.length < 30) { document.querySelector(".chartbox").style.height = ""; return; }
  const c = b.map(x => x.close), t = b.map(x => x.time);
  const pts = v => v.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y }));
  const add = (def, opts, pane = 0) => { const s = chart.addSeries(def, { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, pane); indSeries.push(s); return s; };
  const line = (v, color, pane = 0, extra = {}) => add(LC.LineSeries, { color, lineWidth: 1, ...extra }, pane).setData(Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" ? v.map(p => (p.value == null ? { time: p.time } : p)) : pts(v));
  const col = id => IND.find(x => x.id === id).c;
  let pane = 0;
  if (active.has("sma20")) line(I.sma(c, 20), col("sma20"));
  if (active.has("sma50")) line(I.sma(c, 50), col("sma50"));
  if (active.has("sma200")) line(I.sma(c, 200), col("sma200"), 0, { lineWidth: 2 });
  if (active.has("ema9")) line(I.ema(c, 9), col("ema9"));
  if (active.has("ema21")) line(I.ema(c, 21), col("ema21"));
  if (active.has("boll")) { const bb = I.bollinger(c); line(bb.up, col("boll")); line(bb.mid, col("boll"), 0, { lineStyle: 2 }); line(bb.lo, col("boll")); }
  if (active.has("ichi")) {
    const ic = I.ichimoku(b, STEP[tf]);
    line(ic.tenkan, "#0ea5e9"); line(ic.kijun, "#be123c");
    line(ic.spanA, "#22c55e", 0, { lineWidth: 1 }); line(ic.spanB, "#ef4444", 0, { lineWidth: 1 });
    line(ic.chikou, "#a3a3a3", 0, { lineStyle: 1 });
  }
  if (active.has("vwap")) line(I.vwap(b, TZ), col("vwap"), 0, { lineWidth: 2 });
  if (active.has("psar")) line(I.psar(b), col("psar"), 0, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 });
  if (active.has("st")) { const sp = I.supertrend(b); add(LC.LineSeries, { lineWidth: 2 }).setData(sp.line.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y, color: sp.dir[i] === 1 ? "#22c55e" : "#ef4444" }))); }
  if (active.has("piv")) { const p = I.pivots(b, TZ); if (p) for (const [k, v] of Object.entries(p)) indLines.push(candles.createPriceLine({ price: v, color: k === "P" ? "#64748b" : k[0] === "R" ? "#ef444499" : "#22c55e99", lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: k })); }
  if (active.has("vol")) {
    const s = add(LC.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    s.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    s.setData(b.map(x => ({ time: x.time, value: x.volume, color: x.close >= x.open ? "#1f9d5a55" : "#d0453a55" })));
  }
  if (active.has("rsi")) { pane++; line(I.rsi(c), col("rsi"), pane, { lastValueVisible: true }); const g = indSeries[indSeries.length - 1]; [70, 30].forEach(v => g.createPriceLine({ price: v, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); }
  if (active.has("macd")) { pane++; const m = I.macd(c); add(LC.HistogramSeries, {}, pane).setData(m.hist.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y, color: y >= 0 ? "#1f9d5a88" : "#d0453a88" }))); line(m.line, "#3b82f6", pane); line(m.signal, "#f97316", pane); }
  if (active.has("stoch")) { pane++; const st = I.stoch(b); line(st.k, "#f97316", pane, { lastValueVisible: true }); line(st.d, "#3b82f6", pane); const g = indSeries[indSeries.length - 2]; [80, 20].forEach(v => g.createPriceLine({ price: v, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); }
  if (active.has("atr")) { pane++; line(I.atr(b), col("atr"), pane, { lastValueVisible: true }); }
  document.querySelector(".chartbox").style.height = (window.innerWidth < 600 ? 420 : 560) + pane * 110 + "px";
  chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(100); });
}
let indTimer = 0;
function refreshIndicatorsSoon() { if (Date.now() - indTimer > 3000) { indTimer = Date.now(); renderIndicators(); } }
// Valeurs actuelles de tous les indicateurs, pour Claude
function indicatorSnapshot() {
  const b = candleData, c = b.map(x => x.close), last = a => a[a.length - 1], d = MARKETS[cur].dec, r = v => (v == null ? "n/d" : (+v).toFixed(d));
  const bb = I.bollinger(c), m = I.macd(c), st = I.stoch(b), ic = I.ichimoku(b, STEP[tf]), sp = I.supertrend(b), pv = I.pivots(b, TZ);
  const idx = b.length - 1;
  const spanAnow = ic.spanA[idx - 26]?.value, spanBnow = ic.spanB[idx - 26]?.value;
  return [
    `Moyennes mobiles : SMA20 ${r(last(I.sma(c, 20)))}, SMA50 ${r(last(I.sma(c, 50)))}, SMA200 ${r(last(I.sma(c, 200)))}, EMA9 ${r(last(I.ema(c, 9)))}, EMA21 ${r(last(I.ema(c, 21)))}`,
    `Bollinger 20/2 : haute ${r(last(bb.up))}, milieu ${r(last(bb.mid))}, basse ${r(last(bb.lo))}`,
    `Ichimoku : tenkan ${r(last(ic.tenkan))}, kijun ${r(last(ic.kijun))}, nuage actuel entre ${r(spanAnow)} et ${r(spanBnow)}, nuage futur (dans 26 bougies) entre ${r(last(ic.spanA).value)} et ${r(last(ic.spanB).value)}, chikou ${r(c[idx])} comparée au prix d'il y a 26 bougies ${r(c[idx - 26])}`,
    `VWAP du jour ${r(last(I.vwap(b, TZ)))} ; Parabolic SAR ${r(last(I.psar(b)))} ; Supertrend ${r(last(sp.line))} (${last(sp.dir) === 1 ? "haussier" : "baissier"})`,
    `Pivots du jour : ${pv ? Object.entries(pv).map(([k, v]) => `${k} ${r(v)}`).join(", ") : "n/d"}`,
    `RSI14 ${last(I.rsi(c))?.toFixed(1)} ; MACD ${last(m.line)?.toFixed(d)} / signal ${last(m.signal)?.toFixed(d)} / histogramme ${last(m.hist)?.toFixed(d)} ; Stochastique %K ${last(st.k)?.toFixed(1)} %D ${last(st.d)?.toFixed(1)} ; ATR14 ${r(last(I.atr(b)))}`,
  ].join("\n");
}

// ---------- dessins ----------
function addLine(priceVal, color, title, style = 0, width = 1) {
  return candles.createPriceLine({ price: priceVal, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title });
}
function clearDrawn() {
  drawnLines.forEach(l => candles.removePriceLine(l)); drawnLines = [];
  drawnSeries.forEach(s => chart.removeSeries(s)); drawnSeries = [];
}
function drawShape(d, color, prefix) {
  if (d.type === "h") drawnLines.push(addLine(d.price, color, prefix + (d.note || ""), 0, 2));
  if (d.type === "t" && d.p1.time !== d.p2.time) {
    const s = chart.addSeries(LC.LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const pts = [d.p1, d.p2].sort((a, b) => a.time - b.time).map(p => ({ time: p.time, value: p.price }));
    s.setData(pts); drawnSeries.push(s);
  }
  if (d.type === "fib") {
    const lo = d.p1.price, hi = d.p2.price;
    FIB.forEach(f => drawnLines.push(addLine(hi - (hi - lo) * f, color, `${prefix}Fibo ${(f * 100).toFixed(1)} %`, 2, 1)));
  }
}
function renderDrawings() {
  clearDrawn();
  if (!MARKETS[cur].feed) return;
  const dr = drawings();
  dr.mine.forEach(d => drawShape(d, css("--warn"), ""));
  dr.claude.forEach(d => drawShape(d, css("--claude"), "Claude · "));
}
function setTool(t) {
  tool = t; pending = null;
  $("drawBar").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t));
  const hints = { h: "Clique sur le graphique pour placer la ligne", t: "Clique sur la première bougie", fib: "Clique sur le point de départ (plus bas ou plus haut)" };
  $("hint").hidden = !hints[t]; $("hint").textContent = hints[t] || "";
}
function onChartClick(param) {
  if (tool === "none" || !param.point) return;
  const p = candles.coordinateToPrice(param.point.y);
  const time = param.time ?? (candleData.length ? candleData[candleData.length - 1].time : null);
  if (p == null || time == null) return;
  const pt = { time, price: +p.toFixed(MARKETS[cur].dec) };
  if (tool === "h") { drawings().mine.push({ type: "h", price: pt.price }); finishDraw(); return; }
  if (!pending) { pending = pt; $("hint").textContent = "Clique sur le deuxième point"; return; }
  drawings().mine.push({ type: tool, p1: pending, p2: pt });
  finishDraw();
}
function finishDraw() { saveD(); renderDrawings(); setTool("none"); }

// ---------- lignes des positions (entrée, SL, TP) ----------
function renderPosLines() {
  posLines.forEach(l => candles.removePriceLine(l.line)); posLines = [];
  if (!MARKETS[cur].feed) return;
  const px = price[cur];
  for (const p of S.positions.filter(p => p.sym === cur)) {
    const v = pnl(p, px);
    posLines.push({ kind: "entry", id: p.id, line: addLine(p.entry, css("--entry"), `${p.dir === 1 ? "Achat" : "Vente"} ${p.qty} · ${sgn(v)}${usd(v)}`, 0, 2) });
    if (p.sl) posLines.push({ kind: "sl", id: p.id, line: addLine(p.sl, css("--loss"), `SL ${usd(pnl(p, p.sl))}`, 2, 2) });
    if (p.tp) posLines.push({ kind: "tp", id: p.id, line: addLine(p.tp, css("--gain"), `TP +${usd(pnl(p, p.tp))}`, 2, 2) });
  }
  for (const o of S.orders.filter(o => o.sym === cur)) {
    posLines.push({ kind: "order", id: o.id, line: addLine(o.limit, css("--muted"), `Limite ${o.dir === 1 ? "achat" : "vente"} ${o.qty}`, 1, 1) });
  }
}
function updatePosTitles() {
  const px = price[cur];
  for (const l of posLines) if (l.kind === "entry") {
    const p = S.positions.find(x => x.id === l.id); if (!p) continue;
    const v = pnl(p, px);
    l.line.applyOptions({ title: `${p.dir === 1 ? "Achat" : "Vente"} ${p.qty} · ${sgn(v)}${usd(v)}` });
  }
}
// glisser les SL / TP à la souris ou au doigt
function setupDrag() {
  const box = $("chart");
  let drag = null;
  const yOf = e => { const r = box.getBoundingClientRect(); return (e.touches ? e.touches[0].clientY : e.clientY) - r.top; };
  const start = e => {
    if (tool !== "none") return;
    const y = yOf(e);
    for (const l of posLines) {
      if (l.kind !== "sl" && l.kind !== "tp") continue;
      const c = candles.priceToCoordinate(l.line.options().price);
      if (c != null && Math.abs(c - y) < 8) {
        drag = l; chart.applyOptions({ handleScroll: false, handleScale: false });
        e.preventDefault(); e.stopPropagation(); return;
      }
    }
  };
  const move = e => {
    if (!drag) {
      if (tool !== "none") return;
      const y = yOf(e);
      box.style.cursor = posLines.some(l => (l.kind === "sl" || l.kind === "tp") && Math.abs((candles.priceToCoordinate(l.line.options().price) ?? -99) - y) < 8) ? "ns-resize" : "";
      return;
    }
    const p = candles.coordinateToPrice(yOf(e));
    if (p != null) drag.line.applyOptions({ price: p });
    e.preventDefault();
  };
  const end = () => {
    if (!drag) return;
    const p = S.positions.find(x => x.id === drag.id);
    const np = +drag.line.options().price.toFixed(MARKETS[cur].dec);
    if (p) {
      const px = price[cur] ?? p.entry;
      const ok = drag.kind === "sl" ? (p.dir === 1 ? np < px : np > px) : (p.dir === 1 ? np > px : np < px);
      if (ok) { p[drag.kind] = np; save(); say(`${drag.kind === "sl" ? "Stop loss" : "Take profit"} déplacé à ${fmt(np, MARKETS[cur].dec)}.`); }
      else say(drag.kind === "sl" ? "Le stop doit rester du côté perdant du prix actuel." : "L'objectif doit rester du côté gagnant du prix actuel.");
    }
    drag = null; chart.applyOptions({ handleScroll: true, handleScale: true });
    renderAll(); renderPosLines();
  };
  box.addEventListener("mousedown", start, true);
  box.addEventListener("touchstart", start, { capture: true, passive: false });
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("mouseup", end);
  window.addEventListener("touchend", end);
}

// ---------- vue TradingView (et Nasdaq) ----------
function drawTv() {
  const useTv = tvMode || !MARKETS[cur].feed;
  $("tv").hidden = !useTv; $("chart").hidden = useTv;
  ["drawBar", "undo", "clearDraw", "seps"].forEach(i => { if ($(i)) $(i).hidden = useTv; });
  document.querySelector(".chartbox").classList.toggle("tvmode", useTv); $("legend").hidden = useTv; $("dragNote").hidden = useTv;
  $("viewTv").textContent = useTv ? "Voir mes trades et les tracés de Claude" : "Revenir à la vue TradingView";
  $("viewTv").hidden = !MARKETS[cur].feed;
  if (!useTv) return;
  if (!window.TradingView) { $("tv").textContent = "Graphique indisponible : vérifie ta connexion internet puis recharge la page."; return; }
  $("tv").innerHTML = "";
  new TradingView.widget({
    container_id: "tv", symbol: MARKETS[cur].tv, interval: TF.find(t => t[0] === tf)[2], autosize: true, timezone: "Europe/Paris",
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", style: "1", locale: "fr",
    hide_side_toolbar: false, allow_symbol_change: false, withdateranges: true, details: true,
    studies: IND.filter(x => active.has(x.id) && x.tv).map(x => x.tv),
  });
}

// ---------- barres de contrôle ----------
function renderSymbols() {
  $("symbols").innerHTML = Object.entries(MARKETS).map(([k, m]) =>
    `<button class="chip sym" data-k="${k}" aria-pressed="${k === cur}"><b>${m.name}</b><span id="px_${k}">${fmt(price[k], m.dec)}</span></button>`).join("");
  $("symbols").querySelectorAll("button").forEach(b => b.onclick = () => { cur = b.dataset.k; refreshView(); });
  $("tfBar").innerHTML = TF.map(([k, l]) => `<button class="chip" data-tf="${k}" aria-pressed="${k === tf}">${l}</button>`).join("");
  $("tfBar").querySelectorAll("button").forEach(b => b.onclick = () => { tf = b.dataset.tf; refreshView(); });
}
function refreshView() {
  setTool("none"); renderSymbols(); renderTicket(); drawTv();
  if (MARKETS[cur].feed) loadCandles(); else { candleData = []; candles.setData([]); clearDrawn(); renderPosLines(); renderIndicators(); }
  renderAll();
}

// ---------- flux de prix pour le moteur ----------
let wsOk = false;
let tickPoll = 0;
function connect() {
  const ws = new WebSocket("wss://data-stream.binance.vision/stream?streams=btcusdt@miniTicker/paxgusdt@miniTicker");
  let opened = false;
  ws.onopen = () => { opened = true; wsOk = true; clearInterval(tickPoll); tickPoll = 0; renderTicket(); };
  ws.onmessage = ev => { try { const d = JSON.parse(ev.data).data; onPrice(d.s === "BTCUSDT" ? "BTC" : "XAU", +d.c); } catch (e) {} };
  ws.onclose = () => { wsOk = false; if (!opened) startTickPoll(); renderTicket(); setTimeout(connect, opened ? 5000 : 30000); };
}
// secours : prix Coinbase toutes les 3 secondes
function startTickPoll() {
  if (tickPoll) return;
  const run = async () => { for (const [k, id] of [["BTC", "BTC-USD"], ["XAU", "PAXG-USD"]]) { try { const r = await fetch(`https://api.exchange.coinbase.com/products/${id}/ticker`); const j = await r.json(); if (j.price) { wsOk = true; onPrice(k, +j.price); } } catch (e) {} } renderTicket(); };
  run(); tickPoll = setInterval(run, 3000);
}
let lastRender = 0;
function onPrice(k, p) {
  price[k] = p; check(k);
  const now = Date.now();
  if (now - lastRender > 400) { lastRender = now; renderAll(); if (k === cur) updatePosTitles(); }
}

// ---------- moteur de simulation ----------
const pnl = (p, px) => (px == null ? 0 : (px - p.entry) * p.qty * p.dir);
const margin = p => (p.entry * p.qty) / p.lev;
const equity = () => S.balance + S.positions.reduce((a, p) => a + pnl(p, price[p.sym]), 0);
const usedMargin = () => S.positions.reduce((a, p) => a + margin(p), 0);
const freeMargin = () => equity() - usedMargin();
function check(k) {
  const px = price[k]; if (px == null) return;
  let changed = false;
  for (const o of S.orders.filter(o => o.sym === k)) {
    if ((o.dir === 1 && px <= o.limit) || (o.dir === -1 && px >= o.limit)) {
      S.orders = S.orders.filter(x => x !== o); openPos(k, o.dir, o.qty, o.limit, o.lev, o.sl, o.tp, true); changed = true;
    }
  }
  for (const p of S.positions.filter(p => p.sym === k)) {
    if (p.sl && ((p.dir === 1 && px <= p.sl) || (p.dir === -1 && px >= p.sl))) { closePos(p, p.sl, "Stop loss", true); changed = true; }
    else if (p.tp && ((p.dir === 1 && px >= p.tp) || (p.dir === -1 && px <= p.tp))) { closePos(p, p.tp, "Take profit", true); changed = true; }
  }
  if (S.positions.length && equity() <= 0) { for (const p of [...S.positions]) closePos(p, price[p.sym] ?? p.entry, "Liquidation", true); changed = true; }
  if (changed) { save(); renderAll(); renderPosLines(); }
}
function openPos(sym, dir, qty, entry, lev, sl, tp, quiet) {
  S.positions.push({ id: S.nextId++, sym, dir, qty, entry, lev, sl, tp, t: Date.now() });
  if (!quiet) { save(); renderAll(); renderPosLines(); }
}
function closePos(p, px, reason, quiet) {
  const v = pnl(p, px); S.balance += v; S.positions = S.positions.filter(x => x.id !== p.id);
  S.history.unshift({ sym: p.sym, dir: p.dir, qty: p.qty, entry: p.entry, exit: px, reason, pnl: v, t: Date.now() });
  if (!quiet) { save(); renderAll(); renderPosLines(); say(`Position clôturée : ${sgn(v)}${usd(v)}.`); }
}
const say = t => { $("msg").textContent = t; };
function place(dir) {
  const m = MARKETS[cur], px = price[cur], qty = +$("qty").value, lev = +$("lev").value;
  const sl = +$("sl").value || null, tp = +$("tp").value || null;
  if (px == null) return say(cur === "NAS" ? "Entre d'abord le prix actuel du Nasdaq." : "Le prix n'est pas encore arrivé, patiente quelques secondes.");
  if (!(qty > 0)) return say("Indique une quantité supérieure à 0.");
  const entry = orderType === "limit" ? +$("limitPx").value : px;
  if (!(entry > 0)) return say("Indique un prix limite.");
  if (orderType === "limit" && ((dir === 1 && entry >= px) || (dir === -1 && entry <= px))) return say(dir === 1 ? "Un achat limite se place sous le prix actuel." : "Une vente limite se place au-dessus du prix actuel.");
  if (sl && ((dir === 1 && sl >= entry) || (dir === -1 && sl <= entry))) return say(dir === 1 ? "Pour un achat, le stop doit être sous l'entrée." : "Pour une vente, le stop doit être au-dessus de l'entrée.");
  if (tp && ((dir === 1 && tp <= entry) || (dir === -1 && tp >= entry))) return say("L'objectif est du mauvais côté de l'entrée.");
  const need = (entry * qty) / lev;
  if (need > freeMargin()) return say(`Marge insuffisante : il faut ${usd(need)}, tu as ${usd(freeMargin())} de libre. Baisse la quantité ou monte le levier.`);
  if (orderType === "limit") { S.orders.push({ id: S.nextId++, sym: cur, dir, qty, limit: entry, lev, sl, tp }); save(); renderAll(); renderPosLines(); say("Ordre limite enregistré, il s'exécutera quand le prix l'atteindra."); }
  else { openPos(cur, dir, qty, px, lev, sl, tp); say(`${dir === 1 ? "Achat" : "Vente"} de ${qty} ${m.name} à ${fmt(px, m.dec)} exécuté.`); }
}

// calcul en direct dans le ticket
function ticketCalc() {
  const px = price[cur], qty = +$("qty").value, lev = +$("lev").value, sl = +$("sl").value, tp = +$("tp").value;
  const entry = orderType === "limit" ? +$("limitPx").value : px;
  ["tRisk", "tGain", "tRR", "tNeed"].forEach(i => $(i).textContent = "–");
  if (!(entry > 0 && qty > 0)) return;
  $("tNeed").textContent = usd((entry * qty) / lev);
  const risk = sl > 0 ? Math.abs(entry - sl) * qty : null, gain = tp > 0 ? Math.abs(tp - entry) * qty : null;
  if (risk) $("tRisk").textContent = `−${usd(risk)} (${fmt((risk / equity()) * 100, 2)} %)`;
  if (gain) $("tGain").textContent = `+${usd(gain)}`;
  if (risk && gain) $("tRR").textContent = "1 : " + fmt(gain / risk, 2);
}
["qty", "lev", "sl", "tp", "limitPx"].forEach(i => $(i).addEventListener("input", ticketCalc));

// ---------- affichage ----------
function renderTicket() {
  const m = MARKETS[cur];
  $("oSym").textContent = m.name; $("oPrice").textContent = fmt(price[cur], m.dec);
  $("qty").step = m.step;
  $("manualWrap").hidden = !!m.feed;
  if (!m.feed) {
    $("feed").innerHTML = '<span class="dot"></span>Pas de flux de prix gratuit pour le Nasdaq : saisis le prix lu sur le graphique. Les stops et ordres limite sont vérifiés à chaque saisie. Claude ne peut pas analyser ce marché.';
    if (S.nasPrice && !$("manual").value) $("manual").value = S.nasPrice;
  } else $("feed").innerHTML = `<span class="dot ${wsOk ? "on" : ""}"></span>${wsOk ? "Prix en direct" : "Connexion au prix…"} (${tickPoll ? "Coinbase" : "Binance"}${cur === "XAU" ? ", jeton PAXG adossé à l'or : il peut s'écarter de quelques dollars de l'once" : ""})`;
}
const side = d => (d === 1 ? '<span class="gain">Achat</span>' : '<span class="loss">Vente</span>');
function renderAll() {
  for (const k in MARKETS) { const e = $("px_" + k); if (e) e.textContent = fmt(price[k], MARKETS[k].dec); }
  $("oPrice").textContent = fmt(price[cur], MARKETS[cur].dec);
  const eq = equity(), up = eq - S.balance;
  $("aBal").textContent = usd(S.balance); $("aEq").textContent = usd(eq);
  $("aPnl").textContent = sgn(up) + usd(up); $("aPnl").className = signCls(up);
  $("aFree").textContent = usd(freeMargin()); $("aMargin").textContent = usd(usedMargin());
  ticketCalc();

  // petit encart sur le graphique
  const mine = S.positions.filter(p => p.sym === cur);
  $("hud").innerHTML = `<div>Marge libre ${usd(freeMargin())} · P&amp;L <b class="${signCls(up)}">${sgn(up)}${usd(up)}</b></div>` +
    mine.map(p => { const v = pnl(p, price[p.sym]); return `<div>${p.dir === 1 ? "Achat" : "Vente"} ${p.qty} @ ${fmt(p.entry, MARKETS[p.sym].dec)} <b class="${signCls(v)}">${sgn(v)}${usd(v)}</b><button data-close="${p.id}">Sortir</button></div>`; }).join("");

  $("posBody").innerHTML = S.positions.length ? S.positions.map(p => {
    const m = MARKETS[p.sym], v = pnl(p, price[p.sym]);
    return `<tr><td>${m.name}</td><td>${side(p.dir)}</td><td>${p.qty}</td><td>${fmt(p.entry, m.dec)}</td><td>${fmt(price[p.sym], m.dec)}</td><td>${p.sl ? fmt(p.sl, m.dec) : "–"}</td><td>${p.tp ? fmt(p.tp, m.dec) : "–"}</td><td class="${signCls(v)}">${sgn(v)}${usd(v)}</td><td><button data-close="${p.id}">Clôturer</button></td></tr>`;
  }).join("") : '<tr><td colspan="9" class="empty">Aucune position. Choisis un marché, puis clique sur Acheter ou Vendre.</td></tr>';
  $("ordBody").innerHTML = S.orders.length ? S.orders.map(o => {
    const m = MARKETS[o.sym];
    return `<tr><td>${m.name}</td><td>${side(o.dir)}</td><td>${o.qty}</td><td>${fmt(o.limit, m.dec)}</td><td>${o.sl ? fmt(o.sl, m.dec) : "–"}</td><td>${o.tp ? fmt(o.tp, m.dec) : "–"}</td><td><button data-cancel="${o.id}">Annuler</button></td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty">Aucun ordre en attente.</td></tr>';

  const H = S.history, wins = H.filter(h => h.pnl > 0), losses = H.filter(h => h.pnl <= 0);
  const gw = wins.reduce((a, h) => a + h.pnl, 0), gl = -losses.reduce((a, h) => a + h.pnl, 0), tot = gw - gl;
  $("stats").innerHTML = [
    ["Trades clôturés", H.length],
    ["Taux de réussite", H.length ? fmt((wins.length / H.length) * 100, 0) + " %" : "–"],
    ["Résultat total", `<span class="${signCls(tot)}">${sgn(tot)}${usd(tot)}</span>`],
    ["Performance", `<span class="${signCls(S.balance - S.start)}">${fmt((S.balance / S.start - 1) * 100, 2)} %</span>`],
    ["Gain moyen", wins.length ? usd(gw / wins.length) : "–"],
    ["Perte moyenne", losses.length ? usd(-gl / losses.length) : "–"],
    ["Profit factor", gl > 0 ? fmt(gw / gl, 2) : "–"],
  ].map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join("");
  $("histBody").innerHTML = H.length ? H.slice(0, 50).map(h => {
    const m = MARKETS[h.sym];
    return `<tr><td>${m.name}</td><td>${side(h.dir)}</td><td>${fmt(h.entry, m.dec)}</td><td>${fmt(h.exit, m.dec)}</td><td>${h.reason}</td><td class="${signCls(h.pnl)}">${sgn(h.pnl)}${usd(h.pnl)}</td></tr>`;
  }).join("") : '<tr><td colspan="6" class="empty">L\'historique se remplit quand tu clôtures un trade.</td></tr>';
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-close]");
  if (c) { const p = S.positions.find(x => x.id == c.dataset.close); if (p && price[p.sym] != null) closePos(p, price[p.sym], "Manuel"); }
  const x = e.target.closest("[data-cancel]");
  if (x) { S.orders = S.orders.filter(o => o.id != x.dataset.cancel); save(); renderAll(); renderPosLines(); }
});

// ---------- calculateur ----------
function calc() {
  const r = +$("cRisk").value / 100, e = +$("cEntry").value, s = +$("cStop").value, t = +$("cTp").value;
  ["cQty", "cLoss", "cGain", "cRR", "cBE"].forEach(i => $(i).textContent = "–");
  if (!(r > 0 && e > 0 && s > 0 && e !== s)) return null;
  const dir = s < e ? 1 : -1, dist = Math.abs(e - s), q = (equity() * r) / dist;
  $("cQty").textContent = fmt(q, 4) + (dir === 1 ? " (achat)" : " (vente)"); $("cLoss").textContent = usd(-q * dist);
  if (t > 0 && (t - e) * dir > 0) { const g = q * Math.abs(t - e), rr = g / (q * dist); $("cGain").textContent = usd(g); $("cRR").textContent = "1 : " + fmt(rr, 2); $("cBE").textContent = fmt(100 / (1 + rr), 1) + " %"; }
  return { q, s, t: t > 0 ? t : null };
}
["cRisk", "cEntry", "cStop", "cTp"].forEach(i => $(i).addEventListener("input", calc));
$("cUse").onclick = () => {
  const c = calc(); if (!c) return say("Remplis l'entrée et le stop dans le calculateur.");
  $("qty").value = +c.q.toPrecision(4); $("sl").value = c.s; $("tp").value = c.t || ""; say("Quantité, stop et objectif reportés dans le ticket.");
};
$("sizeBtn").onclick = () => {
  const px = price[cur], sl = +$("sl").value;
  if (px == null || !(sl > 0) || sl === px) return say("Renseigne d'abord un stop loss : la quantité se calcule à partir de la distance entre le prix et le stop.");
  $("qty").value = +((equity() * 0.01) / Math.abs(px - sl)).toPrecision(4); say("Avec cette quantité, tu perds 1 % du compte si le stop est touché.");
};

// ---------- Claude ----------
const AKEY = "atelier-cle-claude";
const getKey = () => { try { return localStorage.getItem(AKEY) || ""; } catch (e) { return ""; } };
$("apiKey").value = getKey() ? "••••••••" : "";
$("saveKey").onclick = () => { const v = $("apiKey").value.trim(); if (!v.startsWith("sk-ant-")) { $("claudeMsg").textContent = "La clé doit commencer par sk-ant-."; return; } try { localStorage.setItem(AKEY, v); } catch (e) {} $("apiKey").value = "••••••••"; $("claudeMsg").textContent = "Clé enregistrée dans ce navigateur."; };
$("delKey").onclick = () => { try { localStorage.removeItem(AKEY); } catch (e) {} $("apiKey").value = ""; $("claudeMsg").textContent = "Clé supprimée."; };

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "trend", "signals", "levels", "trendlines", "trade_idea", "answer"],
  properties: {
    signals: { type: "array", description: "Lecture de chaque indicateur fourni : Moyennes mobiles, Bollinger, Ichimoku, VWAP, Parabolic SAR, Supertrend, Pivots, RSI, MACD, Stochastique, ATR", items: { type: "object", additionalProperties: false, required: ["indicator", "bias", "reading"],
      properties: { indicator: { type: "string" }, bias: { type: "string", enum: ["haussier", "baissier", "neutre"] }, reading: { type: "string", description: "Une phrase courte" } } } },
    summary: { type: "string", description: "Lecture du graphique en 3 à 5 phrases, en français simple." },
    trend: { type: "string", enum: ["haussière", "baissière", "range"] },
    answer: { type: "string", description: "Réponse à la question de l'utilisateur, ou chaîne vide s'il n'en a pas posé." },
    levels: { type: "array", description: "2 à 6 niveaux clés", items: { type: "object", additionalProperties: false, required: ["price", "kind", "note"],
      properties: { price: { type: "number" }, kind: { type: "string", enum: ["support", "resistance"] }, note: { type: "string", description: "3 à 6 mots" } } } },
    trendlines: { type: "array", description: "0 à 3 lignes de tendance, reliant deux bougies par leur index", items: { type: "object", additionalProperties: false,
      required: ["from_index", "from_price", "to_index", "to_price"],
      properties: { from_index: { type: "integer" }, from_price: { type: "number" }, to_index: { type: "integer" }, to_price: { type: "number" } } } },
    trade_idea: { type: "object", additionalProperties: false, required: ["direction", "entry", "stop", "target", "rationale"],
      properties: { direction: { type: "string", enum: ["achat", "vente", "aucun"] }, entry: { type: "number" }, stop: { type: "number" }, target: { type: "number" },
        rationale: { type: "string", description: "Pourquoi, et ce qui invaliderait l'idée" } } },
  },
};
async function analyze() {
  const msg = $("claudeMsg");
  const key = getKey();
  if (!key) { msg.textContent = "Ajoute d'abord ta clé API Claude dans le réglage ci-dessous."; $("keyBox").open = true; return; }
  if (!MARKETS[cur].feed) { msg.textContent = "Claude ne peut analyser que le Bitcoin et l'or pour l'instant : il n'y a pas de données gratuites pour le Nasdaq."; return; }
  if (candleData.length < 30) { msg.textContent = "Les bougies ne sont pas encore chargées, patiente quelques secondes."; return; }
  const btn = $("analyze"); btn.disabled = true; btn.textContent = "Claude analyse…"; msg.textContent = "";
  const bars = candleData.slice(-200), base = candleData.length - bars.length, d = MARKETS[cur].dec;
  const csv = bars.map((b, i) => `${i},${new Date((b.time - TZ) * 1000).toISOString().slice(0, 16)},${b.open.toFixed(d)},${b.high.toFixed(d)},${b.low.toFixed(d)},${b.close.toFixed(d)},${Math.round(b.volume)}`).join("\n");
  const mine = drawings().mine.map(x => x.type === "h" ? `ligne horizontale à ${x.price}` : `${x.type === "t" ? "tendance" : "Fibonacci"} de ${x.p1.price} à ${x.p2.price}`);
  const pos = S.positions.filter(p => p.sym === cur).map(p => `${p.dir === 1 ? "achat" : "vente"} ${p.qty} à ${p.entry}, SL ${p.sl ?? "aucun"}, TP ${p.tp ?? "aucun"}`);
  const prompt = `Marché : ${MARKETS[cur].name}${cur === "XAU" ? " (jeton PAXG/USDT, suit l'once d'or)" : " (BTC/USDT)"}. Unité de temps : ${TF.find(t => t[0] === tf)[1]}. Prix actuel : ${price[cur] ?? bars[bars.length - 1].close}.
Solde du compte d'entraînement : ${usd(equity())}.
Traits dessinés par l'utilisateur : ${mine.length ? mine.join(" ; ") : "aucun"}.
Positions ouvertes sur ce marché : ${pos.length ? pos.join(" ; ") : "aucune"}.
Question de l'utilisateur : ${$("question").value.trim() || "(aucune)"}

Indicateurs calculés sur les 500 dernières bougies :
${indicatorSnapshot()}

Bougies (index,heure UTC,ouverture,haut,bas,clôture,volume) :
${csv}`;
  try {
    const { default: Anthropic } = await import("./vendor/anthropic-sdk.js");
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const resp = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "Tu aides une personne qui apprend le trading sur un simulateur avec de l'argent fictif. Analyse le graphique fourni comme un trader expérimenté et pédagogue : structure du marché, supports et résistances, tendances. Écris en français simple, sans jargon non expliqué. Les niveaux et lignes doivent correspondre à des prix réellement visibles dans les bougies. Pour l'idée de trade, donne un stop logique et un objectif avec un ratio risque/rendement d'au moins 1,5, ou réponds « aucun » s'il n'y a pas de configuration claire. Si l'utilisateur a des positions ou des traits, commente-les.",
      messages: [{ role: "user", content: prompt }],
    });
    if (resp.stop_reason === "refusal") throw new Error("Claude a refusé cette demande.");
    const text = resp.content.find(b => b.type === "text")?.text;
    if (!text) throw new Error("Réponse vide.");
    showAnalysis(JSON.parse(text), base);
  } catch (e) {
    const s = e?.status;
    msg.textContent = s === 401 ? "Clé API refusée : vérifie-la dans le réglage." : s === 429 ? "Trop de demandes ou crédit épuisé : réessaie dans un moment ou vérifie ton crédit." : s === 400 && /credit/i.test(e.message) ? "Crédit API insuffisant sur ton compte Claude." : "L'analyse a échoué : " + (e?.message || e);
  } finally { btn.disabled = false; btn.textContent = "Analyser le graphique"; }
}
let lastIdea = null;
function showAnalysis(a, base) {
  const dr = drawings(), d = MARKETS[cur].dec;
  dr.claude = a.levels.map(l => ({ type: "h", price: l.price, note: `${l.kind === "support" ? "Support" : "Résistance"} · ${l.note}` }));
  for (const t of a.trendlines) {
    const i1 = base + t.from_index, i2 = base + t.to_index;
    if (candleData[i1] && candleData[i2]) dr.claude.push({ type: "t", p1: { time: candleData[i1].time, price: t.from_price }, p2: { time: candleData[i2].time, price: t.to_price } });
  }
  saveD(); renderDrawings();
  const t = a.trade_idea; lastIdea = t.direction === "aucun" ? null : t;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  $("answer").hidden = false;
  $("answer").innerHTML = `<p><b>Tendance ${esc(a.trend)}.</b> ${esc(a.summary)}</p>` +
    (a.answer ? `<p><b>Ta question :</b> ${esc(a.answer)}</p>` : "") +
    `<div class="scroll"><table class="signals"><thead><tr><th>Indicateur</th><th>Signal</th><th style="text-align:left">Lecture</th></tr></thead><tbody>${a.signals.map(x => `<tr><td>${esc(x.indicator)}</td><td class="${x.bias === "haussier" ? "gain" : x.bias === "baissier" ? "loss" : ""}">${esc(x.bias)}</td><td style="text-align:left;white-space:normal;font-family:var(--body)">${esc(x.reading)}</td></tr>`).join("")}</tbody></table></div>` +
    (lastIdea ? `<div class="idea"><b>Idée : ${esc(t.direction)}</b><span>Entrée ${fmt(t.entry, d)}</span><span class="loss">Stop ${fmt(t.stop, d)}</span><span class="gain">Objectif ${fmt(t.target, d)}</span><span>R/R 1 : ${fmt(Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop), 2)}</span></div><p>${esc(t.rationale)}</p><button class="link" id="useIdea">Préparer ce trade dans le ticket (risque 1 %)</button>`
      : `<p><b>Pas d'idée de trade pour l'instant.</b> ${esc(t.rationale)}</p>`) +
    `<p class="small">Analyse pédagogique sur un compte fictif, pas un conseil financier.</p>`;
  if (lastIdea) $("useIdea").onclick = () => {
    const px = price[cur];
    const limit = Math.abs(t.entry - px) / px > 0.001;
    setType(limit ? "limit" : "market"); if (limit) $("limitPx").value = t.entry;
    $("sl").value = t.stop; $("tp").value = t.target;
    $("qty").value = +((equity() * 0.01) / Math.abs(t.entry - t.stop)).toPrecision(4);
    say(`Ticket prêt (${limit ? "ordre limite" : "au marché"}). Vérifie puis clique sur ${t.direction === "achat" ? "Acheter" : "Vendre"}.`);
    $("tOrder").scrollIntoView({ behavior: "smooth", block: "center" });
  };
}
$("analyze").onclick = analyze;
$("clearClaude").onclick = () => { drawings().claude = []; saveD(); renderDrawings(); $("answer").hidden = true; };

// ---------- contrôles ----------
function setType(t) { orderType = t; $("tMarket").setAttribute("aria-pressed", t === "market"); $("tLimit").setAttribute("aria-pressed", t === "limit"); $("limitWrap").hidden = t !== "limit"; }
$("tMarket").onclick = () => setType("market"); $("tLimit").onclick = () => setType("limit");
$("buy").onclick = () => place(1); $("sell").onclick = () => place(-1);
$("qBuy").onclick = () => place(1); $("qSell").onclick = () => place(-1);
$("drawBar").querySelectorAll("button").forEach(b => b.onclick = () => setTool(b.dataset.tool));
$("undo").onclick = () => { drawings().mine.pop(); saveD(); renderDrawings(); };
$("clearDraw").onclick = () => { drawings().mine = []; saveD(); renderDrawings(); };
$("viewTv").onclick = () => { tvMode = !tvMode; drawTv(); if (!tvMode) { chart.timeScale().scrollToRealTime(); renderIndicators(); } };
$("manual").addEventListener("change", () => { const v = +$("manual").value; if (v > 0) { S.nasPrice = v; save(); onPrice("NAS", v); renderAll(); } });
$("resetBtn").onclick = () => { $("resetConfirm").hidden = false; };
$("resetNo").onclick = () => { $("resetConfirm").hidden = true; };
$("resetYes").onclick = () => { S = fresh(+$("startCap").value || 10000); price.NAS = null; $("manual").value = ""; save(); $("resetConfirm").hidden = true; renderAll(); renderPosLines(); };
$("startCap").value = S.start;
document.addEventListener("keydown", e => { if (e.key === "Escape") setTool("none"); });

makeChart(); renderIndList(); refreshView(); connect();

// accès pour les tests
window.__atelier = { onPrice, price, S: () => S, candleData: () => candleData, showAnalysis, setCandles: rows => { candleData = rows; candles.setData(rows); renderDrawings(); renderPosLines(); renderIndicators(); }, indicatorSnapshot };
