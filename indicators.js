// Calculs d'indicateurs techniques. Chaque fonction renvoie un tableau aligné sur les bougies (null quand la valeur n'existe pas encore).
export const sma = (v, n) => v.map((_, i) => (i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
export function ema(v, n) {
  const k = 2 / (n + 1), out = []; let prev = null;
  v.forEach((x, i) => {
    if (x == null) { out.push(null); return; }
    if (prev == null) { const start = v.slice(0, i + 1).filter(y => y != null); if (start.length < n) { out.push(null); return; } prev = start.slice(-n).reduce((a, b) => a + b, 0) / n; }
    else prev = x * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}
export function rsi(c, n = 14) {
  const out = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const line = c.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => (x == null || signal[i] == null ? null : x - signal[i])) };
}
export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n);
  const sd = c.map((_, i) => { if (mid[i] == null) return null; const w = c.slice(i - n + 1, i + 1); return Math.sqrt(w.reduce((a, x) => a + (x - mid[i]) ** 2, 0) / n); });
  return { mid, up: mid.map((m, i) => (m == null ? null : m + k * sd[i])), lo: mid.map((m, i) => (m == null ? null : m - k * sd[i])) };
}
export function stoch(b, n = 14, smK = 3, smD = 3) {
  const raw = b.map((_, i) => {
    if (i < n - 1) return null;
    const w = b.slice(i - n + 1, i + 1), hi = Math.max(...w.map(x => x.high)), lo = Math.min(...w.map(x => x.low));
    return hi === lo ? 50 : ((b[i].close - lo) / (hi - lo)) * 100;
  });
  const k = smaNull(raw, smK);
  return { k, d: smaNull(k, smD) };
}
function smaNull(v, n) { return v.map((_, i) => { const w = v.slice(Math.max(0, i - n + 1), i + 1); return w.length < n || w.some(x => x == null) ? null : w.reduce((a, b) => a + b, 0) / n; }); }
export function atr(b, n = 14) {
  const tr = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close))));
  const out = Array(b.length).fill(null); let a = null;
  tr.forEach((t, i) => { if (i === n - 1) a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; else if (i >= n) a = (a * (n - 1) + t) / n; out[i] = a; });
  return out;
}
const mid = (b, i, n) => { if (i < n - 1) return null; const w = b.slice(i - n + 1, i + 1); return (Math.max(...w.map(x => x.high)) + Math.min(...w.map(x => x.low))) / 2; };
// Ichimoku : tenkan 9, kijun 26, nuage décalé de 26 bougies vers le futur, chikou décalée de 26 vers le passé
export function ichimoku(b, step) {
  const tenkan = b.map((_, i) => mid(b, i, 9)), kijun = b.map((_, i) => mid(b, i, 26));
  const spanA = b.map((_, i) => (tenkan[i] == null || kijun[i] == null ? null : (tenkan[i] + kijun[i]) / 2));
  const spanB = b.map((_, i) => mid(b, i, 52));
  const shiftT = i => (i < b.length ? b[i].time : b[b.length - 1].time + (i - b.length + 1) * step);
  return {
    tenkan, kijun,
    spanA: spanA.map((v, i) => ({ time: shiftT(i + 26), value: v })),
    spanB: spanB.map((v, i) => ({ time: shiftT(i + 26), value: v })),
    chikou: b.map((x, i) => ({ time: i >= 26 ? b[i - 26].time : null, value: x.close })).filter(p => p.time != null),
  };
}
// VWAP remis à zéro chaque jour (UTC)
export function vwap(b, tz) {
  let day = null, pv = 0, vol = 0;
  return b.map(x => {
    const d = Math.floor((x.time - tz) / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (x.high + x.low + x.close) / 3; pv += tp * x.volume; vol += x.volume;
    return vol ? pv / vol : null;
  });
}
// Parabolic SAR (0,02 / 0,2)
export function psar(b, st = 0.02, mx = 0.2) {
  if (b.length < 3) return b.map(() => null);
  let up = b[1].close > b[0].close, sar = up ? b[0].low : b[0].high, ep = up ? b[1].high : b[1].low, af = st;
  const out = [null];
  for (let i = 1; i < b.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, b[i - 1].low, i > 1 ? b[i - 2].low : b[i - 1].low);
      if (b[i].low < sar) { up = false; sar = ep; ep = b[i].low; af = st; }
      else if (b[i].high > ep) { ep = b[i].high; af = Math.min(af + st, mx); }
    } else {
      sar = Math.max(sar, b[i - 1].high, i > 1 ? b[i - 2].high : b[i - 1].high);
      if (b[i].high > sar) { up = true; sar = ep; ep = b[i].high; af = st; }
      else if (b[i].low < ep) { ep = b[i].low; af = Math.min(af + st, mx); }
    }
    out.push(sar);
  }
  return out;
}
// Points pivots classiques à partir de la journée précédente (UTC)
export function pivots(b, tz) {
  const days = {};
  for (const x of b) { const d = Math.floor((x.time - tz) / 86400); const o = (days[d] ||= { h: -Infinity, l: Infinity, c: 0 }); o.h = Math.max(o.h, x.high); o.l = Math.min(o.l, x.low); o.c = x.close; }
  const keys = Object.keys(days).map(Number).sort((a, b) => a - b);
  if (keys.length < 2) return null;
  const p = days[keys[keys.length - 2]], P = (p.h + p.l + p.c) / 3;
  return { P, R1: 2 * P - p.l, S1: 2 * P - p.h, R2: P + (p.h - p.l), S2: P - (p.h - p.l), R3: p.h + 2 * (P - p.l), S3: p.l - 2 * (p.h - P) };
}
// Supertrend (10, 3)
export function supertrend(b, n = 10, m = 3) {
  const a = atr(b, n), out = Array(b.length).fill(null), dirs = Array(b.length).fill(null);
  let fu = null, fl = null, dir = 1;
  for (let i = 0; i < b.length; i++) {
    if (a[i] == null) continue;
    const hl = (b[i].high + b[i].low) / 2, bu = hl + m * a[i], bl = hl - m * a[i];
    fu = fu == null || bu < fu || b[i - 1].close > fu ? bu : fu;
    fl = fl == null || bl > fl || b[i - 1].close < fl ? bl : fl;
    if (dir === 1 && b[i].close < fl) dir = -1; else if (dir === -1 && b[i].close > fu) dir = 1;
    out[i] = dir === 1 ? fl : fu; dirs[i] = dir;
  }
  return { line: out, dir: dirs };
}
