// Score multi-méthodes partagé par le site et par le script GitHub (assistant 24 h/24)
import * as I from "./indicators.js";

// Toutes les méthodes notées de -2 à +2 ; le total donne la force du signal (positif = achat, négatif = vente)
export function scoreMarket(b, step, TZ = 0) {
  const c = b.map(x => x.close), n = b.length - 1, px = c[n], L = a => a[a.length - 1], P = a => a[a.length - 2];
  const out = [];
  const add = (name, v, why) => { if (v) out.push({ name, v, why }); };
  const s50 = I.sma(c, 50), s200 = I.sma(c, 200), e9 = I.ema(c, 9), e21 = I.ema(c, 21);
  add("Tendance (MM 50/200)", L(s50) && L(s200) ? (L(s50) > L(s200) ? 1 : -1) : 0, L(s50) > L(s200) ? "MM50 au-dessus de la MM200" : "MM50 sous la MM200");
  add("EMA 9/21", L(e9) > L(e21) && P(e9) <= P(e21) ? 2 : L(e9) < L(e21) && P(e9) >= P(e21) ? -2 : L(e9) > L(e21) ? 1 : -1, "croisement ou position des EMA 9 et 21");
  const ic = I.ichimoku(b, step), sa = ic.spanA[n - 26]?.value, sb = ic.spanB[n - 26]?.value;
  if (sa != null && sb != null) add("Ichimoku", px > Math.max(sa, sb) && L(ic.tenkan) > L(ic.kijun) ? 2 : px < Math.min(sa, sb) && L(ic.tenkan) < L(ic.kijun) ? -2 : px > Math.max(sa, sb) ? 1 : px < Math.min(sa, sb) ? -1 : 0, "prix par rapport au nuage et tenkan/kijun");
  const m = I.macd(c);
  add("MACD", L(m.hist) > 0 && P(m.hist) <= 0 ? 2 : L(m.hist) < 0 && P(m.hist) >= 0 ? -2 : L(m.hist) > 0 ? 1 : -1, "histogramme MACD");
  const r = I.rsi(c), rv = L(r);
  add("RSI", rv < 30 ? 1 : rv > 70 ? -1 : rv > 55 ? 1 : rv < 45 ? -1 : 0, `RSI ${rv?.toFixed(0)}`);
  const st = I.stoch(b);
  add("Stochastique", L(st.k) > L(st.d) && P(st.k) <= P(st.d) && L(st.k) < 30 ? 2 : L(st.k) < L(st.d) && P(st.k) >= P(st.d) && L(st.k) > 70 ? -2 : 0, "croisement %K/%D en zone extrême");
  const bb = I.bollinger(c);
  add("Bollinger", px < L(bb.lo) ? 1 : px > L(bb.up) ? -1 : 0, "prix hors des bandes (retour probable)");
  const sp = I.supertrend(b);
  add("Supertrend", L(sp.dir) !== P(sp.dir) ? 2 * L(sp.dir) : L(sp.dir), "direction du Supertrend");
  const sar = I.psar(b);
  add("Parabolic SAR", px > L(sar) ? 1 : -1, "position du SAR");
  const vw = I.vwap(b, TZ);
  add("VWAP", px > L(vw) ? 1 : -1, "prix par rapport au VWAP");
  // structure : cassure du dernier plus haut / plus bas
  const k = 5; let ph = null, pl = null;
  for (let i = n - k - 1; i > k && (ph == null || pl == null); i--) {
    const w = b.slice(i - k, i + k + 1);
    if (ph == null && b[i].high === Math.max(...w.map(x => x.high))) ph = b[i].high;
    if (pl == null && b[i].low === Math.min(...w.map(x => x.low))) pl = b[i].low;
  }
  add("Structure", ph && px > ph ? 2 : pl && px < pl ? -2 : 0, "cassure du dernier plus haut / plus bas");
  // imbalance : prix qui revient dans une FVG non comblée
  for (let i = n - 1; i > n - 60 && i > 2; i--) {
    if (b[i].low > b[i - 2].high && px <= b[i].low && px >= b[i - 2].high) { add("Imbalance", 1, "retour dans une FVG haussière"); break; }
    if (b[i].high < b[i - 2].low && px >= b[i].high && px <= b[i - 2].low) { add("Imbalance", -1, "retour dans une FVG baissière"); break; }
  }
  const atrv = L(I.atr(b));
  return { score: out.reduce((a, x) => a + x.v, 0), details: out, atr: atrv, ph, pl, px };
}

