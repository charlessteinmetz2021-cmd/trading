// Atelier de trading : simulation, graphique maison, dessins, indicateurs et analyse par Claude.
import * as I from "./indicators.js";
const $ = id => document.getElementById(id);
const LC = window.LightweightCharts;

const MARKETS = {
  BTC: { name: "Bitcoin", tv: "BITSTAMP:BTCUSD", feed: "BTCUSDT", dec: 2, step: 0.001 },
  XAU: { name: "Or", tv: "OANDA:XAUUSD", feed: "PAXGUSDT", dec: 2, step: 0.01 },
  NAS: { name: "Nasdaq 100", tv: "OANDA:NAS100USD", feed: null, dec: 1, step: 0.1 },
};
const TF = [["1s", "1 s", null], ["5s", "5 s", null], ["15s", "15 s", null], ["30s", "30 s", null], ["1m", "1 min", "1"], ["5m", "5 min", "5"], ["15m", "15 min", "15"], ["1h", "1 h", "60"], ["4h", "4 h", "240"], ["1d", "Jour", "D"]];
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
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: css("--line"), rightOffset: 20 },
    rightPriceScale: { borderColor: css("--line") },
    crosshair: { mode: 0 },
    localization: { locale: "fr-FR" },
  });
  candles = chart.addSeries(LC.CandlestickSeries, {
    upColor: "#1f9d5a", downColor: "#d0453a", borderVisible: false, wickUpColor: "#1f9d5a", wickDownColor: "#d0453a",
  });
  setupClicks();
  setupDrag();
  candles.attachPrimitive(overlay);
  candles.attachPrimitive(zones);
}
function setPrecision() {
  const d = MARKETS[cur].dec;
  candles.applyOptions({ priceFormat: { type: "price", precision: d, minMove: 1 / 10 ** d } });
}

let klineWs = null;
const CB = { BTCUSDT: "BTC-USD", PAXGUSDT: "PAXG-USD" };
const CB_GRAN = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 21600, "1d": 86400 };
// Historique : Binance (deux adresses), puis Coinbase si Binance est bloqué chez l'utilisateur
const SEC = { "1s": 1, "5s": 5, "15s": 15, "30s": 30 };
function aggregate(rows, n) {
  const out = [];
  for (const r of rows) {
    const t = r.time - ((r.time - TZ) % n), last = out[out.length - 1];
    if (last && last.time === t) { last.high = Math.max(last.high, r.high); last.low = Math.min(last.low, r.low); last.close = r.close; last.volume += r.volume; }
    else out.push({ ...r, time: t });
  }
  return out;
}
async function fetchSeconds(feed, n) {
  const pages = Math.min(8, Math.ceil((n * 300) / 1000));
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      let end = Date.now(), all = [];
      for (let i = 0; i < pages; i++) {
        const r = await fetch(`${host}/api/v3/klines?symbol=${feed}&interval=1s&limit=1000&endTime=${end}`);
        if (!r.ok) break;
        const rows = await r.json(); if (!rows.length) break;
        all = rows.concat(all); end = rows[0][0] - 1;
      }
      if (all.length) return { src: "Binance", rows: aggregate(all.map(k => ({ time: Math.floor(k[0] / 1000) + TZ, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })), n) };
    } catch (e) {}
  }
  return { src: "Coinbase", rows: [] }; // Coinbase n'a pas de bougies en secondes : on les construit avec les prix en direct
}
async function fetchCandles(feed, frame) {
  if (SEC[frame]) return fetchSeconds(feed, SEC[frame]);
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
  if (res && !res.rows.length && SEC[tf]) { dataSrc = res.src; candleData = []; $("indStatus").textContent = "Bougies en secondes construites avec les prix en direct : elles apparaissent au fur et à mesure."; renderIndicators(); return; }
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
    const sec = SEC[tf];
    klineWs = new WebSocket(`wss://data-stream.binance.vision/ws/${m.feed.toLowerCase()}@kline_${sec ? "1s" : tf}`);
    klineWs.onmessage = ev => {
      const k = JSON.parse(ev.data).k;
      const bar = { time: Math.floor(k.t / 1000) + TZ, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      if (!sec || sec === 1) return onBar(bar);
      const t = bar.time - ((bar.time - TZ) % sec), last = candleData[candleData.length - 1];
      if (last && last.time === t) onBar({ ...last, high: Math.max(last.high, bar.high), low: Math.min(last.low, bar.low), close: bar.close });
      else onBar({ ...bar, time: t });
    };
    klineWs.onclose = () => setTimeout(() => { if (sym === cur && frame === tf) loadCandles(); }, 5000);
  } else {
    if (!SEC[tf]) pollTimer = setInterval(async () => { const r2 = await fetchCandles(m.feed, frame); if (r2 && r2.rows.length) onBar(r2.rows[r2.rows.length - 1]); }, 15000);
  }
}
let pollTimer = 0;

// ---------- indicateurs ----------
const IND = [
  { id: "sma20", name: "Moyenne mobile 20", g: "Sur le graphique", c: "#f5a300", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 20 } } },
  { id: "sma50", name: "Moyenne mobile 50", g: "Sur le graphique", c: "#2962ff", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 50 } } },
  { id: "sma200", name: "Moyenne mobile 200", g: "Sur le graphique", c: "#6d4c41", tv: { id: "MASimple@tv-basicstudies", inputs: { length: 200 } } },
  { id: "ema9", name: "EMA 9", g: "Sur le graphique", c: "#00bcd4", tv: { id: "MAExp@tv-basicstudies", inputs: { length: 9 } } },
  { id: "ema21", name: "EMA 21", g: "Sur le graphique", c: "#9c27b0", tv: { id: "MAExp@tv-basicstudies", inputs: { length: 21 } } },
  { id: "boll", name: "Bandes de Bollinger", g: "Sur le graphique", c: "#7e57c2", tv: "BB@tv-basicstudies" },
  { id: "ichi", name: "Ichimoku (nuage)", g: "Sur le graphique", c: "#ff4081", tv: "IchimokuCloud@tv-basicstudies" },
  { id: "vwap", name: "VWAP (journalier)", g: "Sur le graphique", c: "#ff6d00", tv: "VWAP@tv-basicstudies" },
  { id: "psar", name: "Parabolic SAR", g: "Sur le graphique", c: "#8bc34a", tv: "PSAR@tv-basicstudies" },
  { id: "st", name: "Supertrend", g: "Sur le graphique", c: "#00c853" },
  { id: "piv", name: "Points pivots", g: "Sur le graphique", c: "#607d8b", tv: "PivotPointsStandard@tv-basicstudies" },
  { id: "vol", name: "Volume", g: "Sur le graphique", c: "#90a4ae", tv: "Volume@tv-basicstudies" },
  { id: "fvg", name: "Imbalance (FVG)", g: "Structure du marché", c: "#29b6f6" },
  { id: "swing", name: "Plus hauts / plus bas", g: "Structure du marché", c: "#ffb300" },
  { id: "rsi", name: "RSI 14", g: "Sous le graphique", c: "#7e57c2", tv: "RSI@tv-basicstudies" },
  { id: "macd", name: "MACD 12 26 9", g: "Sous le graphique", c: "#2962ff", tv: "MACD@tv-basicstudies" },
  { id: "stoch", name: "Stochastique 14 3 3", g: "Sous le graphique", c: "#ff6d00", tv: "Stochastic@tv-basicstudies" },
  { id: "atr", name: "ATR 14 (volatilité)", g: "Sous le graphique", c: "#78909c", tv: "ATR@tv-basicstudies" },
];
const IKEY = "atelier-indicateurs-v1";
let active = new Set(["sma50", "rsi"]);
try { const a = JSON.parse(localStorage.getItem(IKEY)); if (Array.isArray(a)) active = new Set(a); } catch (e) {}
let indSeries = [], indLines = [];
const STEP = { "1s": 1, "5s": 5, "15s": 15, "30s": 30, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
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
// Calque de dessin : nuage Ichimoku, remplissage Bollinger, zones d'imbalance, point de prix qui pulse
const overlay = {
  _p: null, clouds: [], boxes: [],
  attached(p) { this._p = p; }, detached() { this._p = null; },
  update() { this._p?.requestUpdate(); },
  paneViews() {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: target => target.useBitmapCoordinateSpace(sc => {
      const ctx = sc.context, W = sc.bitmapSize.width, hr = sc.horizontalPixelRatio, vr = sc.verticalPixelRatio, ts = chart.timeScale();
      for (const cl of this.clouds) {
        for (let i = 1; i < cl.pts.length; i++) {
          const p0 = cl.pts[i - 1], p1 = cl.pts[i];
          const x0 = ts.timeToCoordinate(p0.time), x1 = ts.timeToCoordinate(p1.time);
          if (x0 == null || x1 == null) continue;
          const ya0 = candles.priceToCoordinate(p0.a), yb0 = candles.priceToCoordinate(p0.b), ya1 = candles.priceToCoordinate(p1.a), yb1 = candles.priceToCoordinate(p1.b);
          if ([ya0, yb0, ya1, yb1].some(v => v == null)) continue;
          ctx.fillStyle = cl.color ? cl.color : (p1.a >= p1.b ? "rgba(38,166,154,0.22)" : "rgba(239,83,80,0.22)");
          ctx.beginPath(); ctx.moveTo(x0 * hr, ya0 * vr); ctx.lineTo(x1 * hr, ya1 * vr); ctx.lineTo(x1 * hr, yb1 * vr); ctx.lineTo(x0 * hr, yb0 * vr); ctx.closePath(); ctx.fill();
        }
      }
      for (const bx of this.boxes) {
        const x1 = ts.timeToCoordinate(bx.t1); if (x1 == null) continue;
        const yt = candles.priceToCoordinate(bx.top), yb = candles.priceToCoordinate(bx.bot); if (yt == null || yb == null) continue;
        ctx.fillStyle = bx.fill; ctx.fillRect(x1 * hr, Math.min(yt, yb) * vr, W - x1 * hr, Math.max(1, Math.abs(yb - yt)) * vr);
        ctx.fillStyle = bx.stroke; ctx.font = `${10 * vr}px IBM Plex Mono, monospace`; ctx.fillText(bx.label, x1 * hr + 4 * hr, Math.min(yt, yb) * vr + 11 * vr);
      }
      // point du dernier prix, qui pulse pour montrer que le marché bouge
      const last = candleData[candleData.length - 1];
      if (last && MARKETS[cur].feed) {
        const x = ts.timeToCoordinate(last.time), y = candles.priceToCoordinate(last.close);
        if (x != null && y != null) {
          const ph = (Date.now() % 1400) / 1400, up = last.close >= last.open;
          ctx.fillStyle = up ? `rgba(31,157,90,${0.45 * (1 - ph)})` : `rgba(208,69,58,${0.45 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(x * hr, y * vr, (4 + ph * 12) * hr, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = up ? "#1f9d5a" : "#d0453a"; ctx.beginPath(); ctx.arc(x * hr, y * vr, 3.5 * hr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }) }) }];
  },
};
setInterval(() => { if (!tvMode && !document.hidden) overlay.update(); }, 80);
setInterval(() => { const el = $("tickAge"); if (!el) return; if (!lastTick) { el.textContent = ""; return; } const a = (Date.now() - lastTick) / 1000; el.textContent = a < 2 ? "· mis à jour à l'instant" : `· dernier prix il y a ${Math.round(a)} s`; el.style.color = a > 10 ? "var(--warn)" : ""; }, 500);
let markersApi = null, legendItems = [];
function renderIndicators() {
  if (!chart) return;
  indSeries.forEach(s => chart.removeSeries(s)); indSeries = [];
  indLines.forEach(l => candles.removePriceLine(l)); indLines = [];
  overlay.clouds = []; overlay.boxes = []; legendItems = [];
  if (!markersApi) markersApi = LC.createSeriesMarkers(candles, []);
  markersApi.setMarkers([]);
  for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);
  const b = candleData;
  if (!MARKETS[cur].feed || b.length < 30) { document.querySelector(".chartbox").style.height = ""; renderLegend(); return; }
  const c = b.map(x => x.close), t = b.map(x => x.time), d = MARKETS[cur].dec;
  const lastOf = v => { for (let i = v.length - 1; i >= 0; i--) { const y = v[i] && typeof v[i] === "object" ? v[i].value : v[i]; if (y != null) return y; } return null; };
  const pts = v => v.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y }));
  const add = (def, opts, pane = 0) => { const s = chart.addSeries(def, { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, pane); indSeries.push(s); return s; };
  const line = (v, color, pane = 0, extra = {}) => { const s = add(LC.LineSeries, { color, lineWidth: 2, ...extra }, pane); s.setData(v.length && v[0] && typeof v[0] === "object" ? v.map(p => (p.value == null ? { time: p.time } : p)) : pts(v)); return s; };
  const leg = (name, color, v, dec = d) => legendItems.push({ name, color, value: v == null ? "–" : (+v).toLocaleString("fr-FR", { maximumFractionDigits: dec, minimumFractionDigits: dec }) });
  const col = id => IND.find(x => x.id === id).c;
  let pane = 0;
  for (const [id, n, f] of [["sma20", 20, I.sma], ["sma50", 50, I.sma], ["sma200", 200, I.sma], ["ema9", 9, I.ema], ["ema21", 21, I.ema]]) {
    if (!active.has(id)) continue; const v = f(c, n); line(v, col(id), 0, { lineWidth: id === "sma200" ? 3 : 2 }); leg(IND.find(x => x.id === id).name.replace("Moyenne mobile", "MM"), col(id), lastOf(v));
  }
  if (active.has("boll")) {
    const bb = I.bollinger(c), cc = col("boll");
    line(bb.up, cc, 0, { lineWidth: 1 }); line(bb.mid, cc, 0, { lineWidth: 1, lineStyle: 2 }); line(bb.lo, cc, 0, { lineWidth: 1 });
    overlay.clouds.push({ color: "rgba(126,87,194,0.10)", pts: t.map((tt, i) => ({ time: tt, a: bb.up[i], b: bb.lo[i] })).filter(p => p.a != null) });
    leg("Bollinger", cc, `${fmt(lastOf(bb.lo), d)} – ${fmt(lastOf(bb.up), d)}`, 0);
    legendItems[legendItems.length - 1].value = `${fmt(lastOf(bb.lo), d)} – ${fmt(lastOf(bb.up), d)}`;
  }
  if (active.has("ichi")) {
    const ic = I.ichimoku(b, STEP[tf]);
    line(ic.tenkan, "#ff4081", 0, { lineWidth: 2 }); line(ic.kijun, "#283593", 0, { lineWidth: 2 });
    line(ic.spanA, "#43a047", 0, { lineWidth: 1 }); line(ic.spanB, "#e53935", 0, { lineWidth: 1 });
    line(ic.chikou, "#bdbdbd", 0, { lineWidth: 1, lineStyle: 2 });
    overlay.clouds.push({ pts: ic.spanA.map((p, i) => ({ time: p.time, a: p.value, b: ic.spanB[i].value })).filter(p => p.a != null && p.b != null) });
    leg("Tenkan", "#ff4081", lastOf(ic.tenkan)); leg("Kijun", "#283593", lastOf(ic.kijun));
  }
  if (active.has("vwap")) { const v = I.vwap(b, TZ); line(v, col("vwap"), 0, { lineWidth: 2, lineStyle: 0 }); leg("VWAP", col("vwap"), lastOf(v)); }
  if (active.has("psar")) { const v = I.psar(b); line(v, col("psar"), 0, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 }); leg("SAR", col("psar"), lastOf(v)); }
  if (active.has("st")) { const sp = I.supertrend(b); add(LC.LineSeries, { lineWidth: 2 }).setData(sp.line.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y, color: sp.dir[i] === 1 ? "#00c853" : "#ff1744" }))); leg("Supertrend", sp.dir[sp.dir.length - 1] === 1 ? "#00c853" : "#ff1744", lastOf(sp.line)); }
  if (active.has("piv")) { const p = I.pivots(b, TZ); if (p) for (const [k, v] of Object.entries(p)) indLines.push(candles.createPriceLine({ price: v, color: k === "P" ? "#607d8b" : k[0] === "R" ? "#e53935" : "#43a047", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "Pivot " + k })); }
  if (active.has("vol")) {
    const s = add(LC.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    s.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    s.setData(b.map(x => ({ time: x.time, value: x.volume, color: x.close >= x.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)" })));
  }
  if (active.has("fvg")) {
    const at = I.atr(b), gaps = [];
    for (let i = 2; i < b.length; i++) {
      const min = (at[i] ?? 0) * 0.15;
      if (b[i].low > b[i - 2].high && b[i].low - b[i - 2].high > min) gaps.push({ i, dir: 1, top: b[i].low, bot: b[i - 2].high });
      if (b[i].high < b[i - 2].low && b[i - 2].low - b[i].high > min) gaps.push({ i, dir: -1, top: b[i - 2].low, bot: b[i].high });
    }
    // on garde les imbalances pas encore comblées par le prix
    const open = gaps.filter(g => { for (let j = g.i + 1; j < b.length; j++) { if (g.dir === 1 && b[j].low <= g.bot) return false; if (g.dir === -1 && b[j].high >= g.top) return false; } return true; }).slice(-6);
    overlay.boxes = open.map(g => ({ t1: b[g.i - 1].time, top: g.top, bot: g.bot, fill: g.dir === 1 ? "rgba(41,182,246,0.20)" : "rgba(255,112,67,0.22)", stroke: g.dir === 1 ? "#0288d1" : "#e64a19", label: g.dir === 1 ? "FVG ▲" : "FVG ▼" }));
    legendItems.push({ name: "Imbalances ouvertes", color: col("fvg"), value: String(open.length) });
  }
  if (active.has("swing")) {
    const k = 5, mk = [];
    for (let i = k; i < b.length - k; i++) {
      const L = b.slice(i - k, i), R = b.slice(i + 1, i + k + 1);
      if (L.every(x => x.high < b[i].high) && R.every(x => x.high <= b[i].high)) mk.push({ time: b[i].time, position: "aboveBar", color: "#e53935", shape: "arrowDown", text: "PH" });
      if (L.every(x => x.low > b[i].low) && R.every(x => x.low >= b[i].low)) mk.push({ time: b[i].time, position: "belowBar", color: "#43a047", shape: "arrowUp", text: "PB" });
    }
    markersApi.setMarkers(mk);
  }
  if (active.has("rsi")) { pane++; const v = I.rsi(c); const g = line(v, col("rsi"), pane, { lastValueVisible: true }); [70, 30].forEach(x => g.createPriceLine({ price: x, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); leg("RSI", col("rsi"), lastOf(v), 1); }
  if (active.has("macd")) { pane++; const m = I.macd(c); add(LC.HistogramSeries, {}, pane).setData(m.hist.map((y, i) => (y == null ? { time: t[i] } : { time: t[i], value: y, color: y >= 0 ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)" }))); line(m.line, "#2962ff", pane, { lineWidth: 1 }); line(m.signal, "#ff6d00", pane, { lineWidth: 1 }); leg("MACD", "#2962ff", lastOf(m.line)); }
  if (active.has("stoch")) { pane++; const st = I.stoch(b); const g = line(st.k, "#2962ff", pane, { lastValueVisible: true, lineWidth: 1 }); line(st.d, "#ff6d00", pane, { lineWidth: 1 }); [80, 20].forEach(x => g.createPriceLine({ price: x, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); leg("Stoch %K", "#2962ff", lastOf(st.k), 1); }
  if (active.has("atr")) { pane++; const v = I.atr(b); line(v, col("atr"), pane, { lastValueVisible: true }); leg("ATR", col("atr"), lastOf(v)); }
  document.querySelector(".chartbox").style.height = (window.innerWidth < 600 ? 420 : 580) + pane * 110 + "px";
  chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(100); });
  overlay.update(); renderLegend();
}
function renderLegend() {
  const el = $("indLegend"); if (!el) return;
  el.innerHTML = legendItems.map(x => `<span><i style="background:${x.color}"></i>${x.name} <b>${x.value}</b></span>`).join("");
  el.hidden = !legendItems.length || tvMode;
}
let indTimer = 0;
function refreshIndicatorsSoon() { if (Date.now() - indTimer > (SEC[tf] ? 1000 : 2000)) { indTimer = Date.now(); renderIndicators(); } }
function fvgList() {
  const b = candleData, out = [];
  for (let i = 2; i < b.length; i++) {
    if (b[i].low > b[i - 2].high) out.push({ i, dir: 1, top: b[i].low, bot: b[i - 2].high });
    if (b[i].high < b[i - 2].low) out.push({ i, dir: -1, top: b[i - 2].low, bot: b[i].high });
  }
  const d = MARKETS[cur].dec;
  const open = out.filter(g => !b.slice(g.i + 1).some(x => (g.dir === 1 ? x.low <= g.bot : x.high >= g.top))).slice(-6);
  return open.length ? open.map(g => `${g.dir === 1 ? "haussière" : "baissière"} ${g.bot.toFixed(d)}–${g.top.toFixed(d)}`).join(", ") : "aucune";
}
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
    `Imbalances (FVG) non comblées : ${fvgList()}`,
    `Pivots du jour : ${pv ? Object.entries(pv).map(([k, v]) => `${k} ${r(v)}`).join(", ") : "n/d"}`,
    `RSI14 ${last(I.rsi(c))?.toFixed(1)} ; MACD ${last(m.line)?.toFixed(d)} / signal ${last(m.signal)?.toFixed(d)} / histogramme ${last(m.hist)?.toFixed(d)} ; Stochastique %K ${last(st.k)?.toFixed(1)} %D ${last(st.d)?.toFixed(1)} ; ATR14 ${r(last(I.atr(b)))}`,
  ].join("\n");
}


// ---------- zones colorées des trades (vert vers le TP, rouge vers le SL) ----------
const zones = {
  _p: null,
  attached(p) { this._p = p; }, detached() { this._p = null; },
  update() { this._p?.requestUpdate(); },
  paneViews() {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: target => {
      if (!MARKETS[cur].feed || !candleData.length) return;
      target.useBitmapCoordinateSpace(sc => {
        const ctx = sc.context, W = sc.bitmapSize.width, hr = sc.horizontalPixelRatio, vr = sc.verticalPixelRatio;
        const ts = chart.timeScale(), step = STEP[tf];
        for (const p of S.positions.filter(p => p.sym === cur)) {
          const bt = Math.floor(p.t / 1000) + TZ; const bar = bt - (bt % step);
          let x0 = ts.timeToCoordinate(bar);
          if (x0 == null) { const c = candleData.find(k => k.time >= bar) || candleData[candleData.length - 1]; x0 = bar < candleData[0].time ? 0 : ts.timeToCoordinate(c.time); }
          if (x0 == null) x0 = 0;
          const ye = candles.priceToCoordinate(p.entry); if (ye == null) continue;
          const v = pnl(p, price[cur]);
          const rect = (y2, color) => { if (y2 == null) return; ctx.fillStyle = color; ctx.fillRect(x0 * hr, Math.min(ye, y2) * vr, W - x0 * hr, Math.abs(y2 - ye) * vr); };
          if (p.tp) rect(candles.priceToCoordinate(p.tp), "rgba(31,157,90,0.16)");
          if (p.sl) rect(candles.priceToCoordinate(p.sl), "rgba(208,69,58,0.16)");
          const yc = candles.priceToCoordinate(price[cur] ?? p.entry);
          rect(yc, v >= 0 ? "rgba(31,157,90,0.28)" : "rgba(208,69,58,0.28)");
        }
      });
    } }) }];
  },
};

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
// clics gérés directement (le graphique confond deux clics rapides avec un double-clic)
function setupClicks() {
  const box = $("chart"); let down = null;
  box.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
  box.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    const r = box.getBoundingClientRect();
    onChartClick(e.clientX - r.left, e.clientY - r.top);
  });
}
function xToTime(x) {
  const ts = chart.timeScale(), t = ts.coordinateToTime(x);
  if (t != null) return t;
  const lg = ts.coordinateToLogical(x); if (lg == null || !candleData.length) return null;
  const lastI = candleData.length - 1, step = STEP[tf];
  return lg > lastI ? candleData[lastI].time + Math.round(lg - lastI) * step : candleData[0].time;
}
function onChartClick(x, y) {
  if (tool === "none") return;
  if (!candleData.length) { $("hint").textContent = "Les bougies ne sont pas chargées : impossible de dessiner pour l'instant."; return; }
  const p = candles.coordinateToPrice(y);
  const time = xToTime(x);
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
  zones.update();
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
  zones.update();
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
  document.querySelector(".chartbox").classList.toggle("tvmode", useTv); renderLegend(); $("legend").hidden = useTv; $("dragNote").hidden = useTv;
  $("viewTv").textContent = useTv ? "Voir mes trades et les tracés de Claude" : "Revenir à la vue TradingView";
  $("viewTv").hidden = !MARKETS[cur].feed;
  if (!useTv) return;
  if (!window.TradingView) { $("tv").textContent = "Graphique indisponible : vérifie ta connexion internet puis recharge la page."; return; }
  $("tv").innerHTML = "";
  new TradingView.widget({
    container_id: "tv", symbol: MARKETS[cur].tv, interval: TF.find(t => t[0] === tf)[2] || "1", autosize: true, timezone: "Europe/Paris",
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", style: "1", locale: "fr",
    hide_side_toolbar: false, allow_symbol_change: false, withdateranges: true, details: true,
    studies: IND.filter(x => active.has(x.id) && x.tv).map(x => x.tv),
  });
}

// ---------- barres de contrôle ----------
function renderSymbols() {
  $("symbols").innerHTML = Object.entries(MARKETS).map(([k, m]) =>
    `<button class="chip sym" data-k="${k}" aria-pressed="${k === cur}"><b>${m.name}</b><span id="px_${k}">${fmt(price[k], m.dec)}</span></button>`).join("");
  $("symbols").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.k === cur) return;
    cur = b.dataset.k;
    // le ticket repart à zéro : les SL / TP / prix limite d'un marché n'ont pas de sens sur un autre
    ["sl", "tp", "limitPx"].forEach(i => $(i).value = "");
    $("qty").value = { BTC: "0.01", XAU: "1", NAS: "1" }[cur];
    ["cEntry", "cStop", "cTp"].forEach(i => $(i).value = ""); calc();
    setType("market"); say(""); $("answer").hidden = true; lastIdea = null;
    refreshView();
  });
  $("tfBar").innerHTML = TF.map(([k, l]) => `<button class="chip" data-tf="${k}" aria-pressed="${k === tf}">${l}</button>`).join("");
  $("tfBar").querySelectorAll("button").forEach(b => b.onclick = () => {
    tf = b.dataset.tf;
    if (SEC[tf] && tvMode && MARKETS[cur].feed) { tvMode = false; say("Les secondes s'affichent sur le graphique « mes trades » : TradingView gratuit ne propose que les minutes et plus."); }
    refreshView();
  });
}
function refreshView() {
  setTool("none"); renderSymbols(); renderTicket(); drawTv();
  if (MARKETS[cur].feed) loadCandles(); else { candleData = []; candles.setData([]); clearDrawn(); renderPosLines(); renderIndicators(); }
  renderAll();
}

// ---------- flux de prix pour le moteur ----------
let wsOk = false;
let tickPoll = 0, feedName = "";
// Prix en direct : Binance, sinon Coinbase en WebSocket, sinon interrogation de Coinbase chaque seconde
function connect() {
  let opened = false;
  const ws = new WebSocket("wss://data-stream.binance.vision/stream?streams=btcusdt@trade/paxgusdt@trade");
  const timer = setTimeout(() => { if (!opened) { ws.onclose = null; ws.close(); connectCoinbase(); } }, 5000);
  ws.onopen = () => { opened = true; clearTimeout(timer); wsOk = true; feedName = "Binance"; renderTicket(); };
  ws.onmessage = ev => { try { const d = JSON.parse(ev.data).data; onPrice(d.s === "BTCUSDT" ? "BTC" : "XAU", +d.p); } catch (e) {} };
  ws.onclose = () => { clearTimeout(timer); wsOk = false; renderTicket(); if (opened) setTimeout(connect, 3000); else connectCoinbase(); };
}
function connectCoinbase() {
  let opened = false;
  let ws;
  try { ws = new WebSocket("wss://ws-feed.exchange.coinbase.com"); } catch (e) { return startTickPoll(); }
  const timer = setTimeout(() => { if (!opened) { ws.onclose = null; ws.close(); startTickPoll(); } }, 5000);
  ws.onopen = () => { opened = true; clearTimeout(timer); wsOk = true; feedName = "Coinbase"; clearInterval(tickPoll); tickPoll = 0;
    ws.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD", "PAXG-USD"], channels: ["ticker"] })); renderTicket(); };
  ws.onmessage = ev => { try { const d = JSON.parse(ev.data); if (d.type === "ticker" && d.price) onPrice(d.product_id === "BTC-USD" ? "BTC" : "XAU", +d.price); } catch (e) {} };
  ws.onclose = () => { clearTimeout(timer); wsOk = false; renderTicket(); if (opened) setTimeout(connectCoinbase, 3000); else startTickPoll(); };
}
function startTickPoll() {
  if (tickPoll) return;
  feedName = "Coinbase, mise à jour chaque seconde";
  const run = async () => { await Promise.all([["BTC", "BTC-USD"], ["XAU", "PAXG-USD"]].map(async ([k, id]) => { try { const r = await fetch(`https://api.exchange.coinbase.com/products/${id}/ticker`); const j = await r.json(); if (j.price) { wsOk = true; onPrice(k, +j.price); } } catch (e) {} })); renderTicket(); };
  run(); tickPoll = setInterval(run, 1000);
  setTimeout(() => { clearInterval(tickPoll); tickPoll = 0; connect(); }, 120000); // réessaie le direct toutes les 2 minutes
}
// fait vivre la dernière bougie avec chaque prix reçu
function liveCandle(k, p) {
  if (k !== cur) return;
  const step = STEP[tf], now = Math.floor(Date.now() / 1000) + TZ, start = now - ((now - TZ) % step);
  if (!candleData.length) { if (!SEC[tf]) return; const b0 = { time: start, open: p, high: p, low: p, close: p, volume: 0 }; candleData.push(b0); candles.update(b0); return; }
  const last = candleData[candleData.length - 1];
  let bar;
  if (start > last.time) { bar = { time: start, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p, volume: 0 }; candleData.push(bar); }
  else { bar = { ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p) }; candleData[candleData.length - 1] = bar; }
  candles.update(bar);
}
let prevShown = {};
let lastRender = 0;
let lastTick = 0;
function onPrice(k, p) {
  price[k] = p; if (k === cur) lastTick = Date.now(); check(k);
  if (MARKETS[k].feed) liveCandle(k, p);
  const now = Date.now();
  if (now - lastRender > 250) {
    lastRender = now; renderAll(); if (k === cur) updatePosTitles();
    const el = $("oPrice"), old = prevShown[cur];
    if (old != null && price[cur] !== old) { el.style.color = price[cur] > old ? "var(--gain)" : "var(--loss)"; clearTimeout(el._t); el._t = setTimeout(() => el.style.color = "", 600); }
    prevShown[cur] = price[cur];
  }
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
  if (tvMode && m.feed) { tvMode = false; drawTv(); chart.timeScale().scrollToRealTime(); renderIndicators(); renderPosLines(); say($("msg").textContent + " Ton trade s'affiche sur le graphique « mes trades » : TradingView ne permet pas d'y ajouter nos positions."); }
  if ($("autoReview").checked) reviewTrade({ dir, qty, entry, sl, tp, kind: orderType });
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
  } else $("feed").innerHTML = `<span class="dot ${wsOk ? "on" : ""}"></span>${wsOk ? "Prix en direct" : "Connexion au prix…"} (${feedName || "Binance"}${cur === "XAU" ? ", jeton PAXG adossé à l'or : il peut s'écarter de quelques dollars de l'once" : ""}) <span id="tickAge"></span>`;
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
  const box = document.querySelector(".chartbox"), mp = mine.reduce((a, p) => a + pnl(p, price[p.sym]), 0);
  box.classList.toggle("intrade", mine.length > 0); box.classList.toggle("winning", mine.length > 0 && mp >= 0); box.classList.toggle("losing", mine.length > 0 && mp < 0);
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

// Avis instantané de Claude sur chaque trade pris (effort bas pour répondre en quelques secondes)
async function claudeClient() {
  const key = getKey(); if (!key) return null;
  const { default: Anthropic } = await import("./vendor/anthropic-sdk.js");
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}
const REVIEW_SCHEMA = { type: "object", additionalProperties: false, required: ["verdict", "comment"],
  properties: { verdict: { type: "string", enum: ["bon", "moyen", "risqué"] }, comment: { type: "string", description: "2 à 3 phrases : ce qui va, ce qui ne va pas, quoi ajuster (stop, objectif, taille)" } } };
async function reviewTrade(t) {
  const out = $("toast");
  const client = await claudeClient().catch(() => null);
  if (!client) { out.hidden = false; out.innerHTML = 'Claude peut commenter chaque trade : ajoute ta clé API dans « Analyse de Claude ».'; setTimeout(() => out.hidden = true, 6000); return; }
  if (!candleData.length) return;
  out.hidden = false; out.className = "toast"; out.textContent = "Claude vérifie ton trade…";
  const d = MARKETS[cur].dec, bars = candleData.slice(-60).map(b => `${b.open.toFixed(d)},${b.high.toFixed(d)},${b.low.toFixed(d)},${b.close.toFixed(d)}`).join("\n");
  const risk = t.sl ? Math.abs(t.entry - t.sl) * t.qty : null, gain = t.tp ? Math.abs(t.tp - t.entry) * t.qty : null;
  try {
    const resp = await client.beta.messages.create({
      model: "claude-opus-5-5", max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      system: "Tu es le coach d'une personne qui s'entraîne au trading avec de l'argent fictif. Juge le trade qu'elle vient de prendre, en français simple et bref.",
      messages: [{ role: "user", content: `Trade : ${t.dir === 1 ? "achat" : "vente"} ${t.qty} ${MARKETS[cur].name} (${t.kind === "limit" ? "ordre limite" : "au marché"}) à ${t.entry}, stop ${t.sl ?? "aucun"}, objectif ${t.tp ?? "aucun"}. Unité de temps ${TF.find(x => x[0] === tf)[1]}. Compte ${usd(equity())}. Risque ${risk ? usd(risk) + " (" + fmt(risk / equity() * 100, 2) + " %)" : "illimité, pas de stop"}, gain visé ${gain ? usd(gain) : "non défini"}.
Indicateurs :
${indicatorSnapshot()}
60 dernières bougies (ouverture,haut,bas,clôture) :
${bars}` }],
    });
    const text = resp.content.find(b => b.type === "text")?.text; if (!text) throw new Error("réponse vide");
    const r = JSON.parse(text);
    out.className = "toast " + (r.verdict === "bon" ? "good" : r.verdict === "risqué" ? "bad" : "mid");
    out.innerHTML = `<b>Claude : trade ${r.verdict}.</b> ${r.comment.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])} <button id="toastClose">OK</button>`;
    $("toastClose").onclick = () => out.hidden = true;
  } catch (e) { out.className = "toast"; out.textContent = "Claude n'a pas pu vérifier ce trade : " + (e?.status === 401 ? "clé API refusée." : e?.message || e); setTimeout(() => out.hidden = true, 8000); }
}

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
