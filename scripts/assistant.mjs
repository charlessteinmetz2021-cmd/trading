// Assistant 24 h/24 : lancé par GitHub Actions toutes les 5 minutes.
// Analyse les marchés, demande à Claude de vérifier les annonces et le graphique,
// enregistre la proposition dans proposals.json et envoie une notification ntfy.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import * as I from "../indicators.js";
import { scoreMarket } from "../signals.js";
import { loadAccount, saveAccount, track, manage, proposalActions, send } from "./suivi.mjs";

const cfg = JSON.parse(readFileSync("assistant-config.json", "utf8"));
const MARKETS = { BTC: { name: "Bitcoin", binance: "BTCUSDT", coinbase: "BTC-USD", dec: 2 }, XAU: { name: "Or", binance: "PAXGUSDT", coinbase: "PAXG-USD", dec: 2 }, NAS: { name: "Nasdaq", yahoo: "NQ=F", dec: 2 } };
const STEP = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };
const CB_GRAN = { "5m": 300, "15m": 900, "1h": 3600, "4h": 21600 };
const state = existsSync("assistant-state.json") ? JSON.parse(readFileSync("assistant-state.json", "utf8")) : { day: "", count: 0, lastSig: {} };
const proposals = existsSync("proposals.json") ? JSON.parse(readFileSync("proposals.json", "utf8")) : [];
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Nasdaq : contrat à terme NQ (Yahoo Finance, gratuit, sans clé)
async function yahoo(sym, interval, range) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) { log("yahoo", host, r.status); continue; }
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
      return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 })).filter(x => x.close != null && x.high != null);
    } catch (e) { log("yahoo", host, e?.message || e); }
  }
  throw new Error("Yahoo indisponible");
}
async function fetchCandles(m, tf) {
  if (m.yahoo) return yahoo(m.yahoo, tf === "4h" ? "1h" : tf, { "5m": "5d", "15m": "5d", "1h": "1mo", "4h": "3mo" }[tf]);
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${m.binance}&interval=${tf}&limit=500`);
      if (!r.ok) continue;
      const rows = await r.json();
      if (rows.length) return rows.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    } catch (e) {}
  }
  const r = await fetch(`https://api.exchange.coinbase.com/products/${m.coinbase}/candles?granularity=${CB_GRAN[tf]}`, { headers: { "User-Agent": "atelier-trading" } });
  const rows = await r.json();
  return rows.map(k => ({ time: k[0], low: +k[1], high: +k[2], open: +k[3], close: +k[4], volume: +k[5] })).sort((a, b) => a.time - b.time);
}

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Calendrier économique gratuit (annonces à fort impact de la semaine)
async function calendar() {
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "atelier-trading" } });
    const ev = await r.json();
    return ev.filter(e => e.impact === "High" && ["USD", "ALL"].includes(e.country)).map(e => ({ title: e.title, t: Date.parse(e.date) }));
  } catch (e) { log("calendrier indisponible", e?.message || e); return null; }
}
const cal = await calendar();
const paris = t => new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" });
function calendarCheck() {
  if (!cal) return { block: false, text: "Calendrier économique indisponible." };
  const now = Date.now();
  const near = cal.filter(e => e.t > now - 30 * 60000 && e.t < now + 60 * 60000);
  const next = cal.filter(e => e.t > now && e.t < now + 24 * 3600000).slice(0, 4);
  return {
    block: near.length > 0,
    text: near.length ? `Annonce importante trop proche : ${near.map(e => `${e.title} (${paris(e.t)})`).join(", ")}.`
      : next.length ? `Prochaines annonces importantes (USD) : ${next.map(e => `${e.title} ${paris(e.t)}`).join(" ; ")}.` : "Aucune annonce importante dans les 24 h.",
  };
}

async function news(name) {
  let messages = [{ role: "user", content: `Cherche les actualités et annonces des dernières 24 heures et des prochaines 24 heures qui peuvent faire bouger ${name} : calendrier économique américain (CPI, NFP, FOMC, PIB…), discours de la Fed, actualités crypto ou géopolitiques. Réponds en 4 lignes maximum en français : les événements importants avec leur heure (heure de Paris), et le risque (faible, moyen, élevé) pour un trade intraday maintenant.` }];
  for (let i = 0; i < 3; i++) {
    const resp = await client.beta.messages.create({
      model: "claude-opus-5-5", max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low" }, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }], messages,
    });
    if (resp.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: resp.content }]; continue; }
    return resp.content.filter(x => x.type === "text").map(x => x.text).join(" ").trim();
  }
  return "Recherche d'actualités incomplète.";
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["take", "direction", "entry", "stop", "target", "confidence", "reason"],
  properties: { take: { type: "boolean" }, direction: { type: "string", enum: ["achat", "vente"] }, entry: { type: "number" }, stop: { type: "number" }, target: { type: "number" },
    confidence: { type: "integer", description: "1 à 10" }, reason: { type: "string", description: "3 phrases max : pourquoi, méthodes qui confirment, risque lié aux annonces" } } };

async function notify(p) {
  const m = MARKETS[p.sym], f = v => v.toFixed(m.dec);
  await send({
    priority: 4, tags: [p.dir === 1 ? "chart_with_upwards_trend" : "chart_with_downwards_trend"],
    title: `${p.dir === 1 ? "Achat" : "Vente"} ${m.name} proposé`,
    message: `Entrée ${f(p.entry)} · SL ${f(p.stop)} · TP ${f(p.target)} (+${Math.round(Math.abs(p.target - p.entry) / ({ BTC: 1, XAU: 0.1, NAS: 1, ...(cfg.pip || {}) })[p.sym])} pips)${p.confidence ? ` · confiance ${p.confidence}/10` : ""}${state.pips ? `\nAujourd'hui : ${state.pips.done >= 0 ? "+" : ""}${state.pips.done} pips sur un objectif de ${(cfg.goalPips || {}).max || 150}` : ""}\n${p.reason}`,
    actions: proposalActions(p, cfg.siteUrl),
  });
}

async function getMinutes(sym) {
  const m = MARKETS[sym];
  if (m.yahoo) return yahoo(m.yahoo, "1m", "1d");
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${m.binance}&interval=1m&limit=1000`);
      if (!r.ok) continue;
      const rows = await r.json();
      if (rows.length) return rows.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    } catch (e) {}
  }
  const r = await fetch(`https://api.exchange.coinbase.com/products/${m.coinbase}/candles?granularity=60`, { headers: { "User-Agent": "atelier-trading" } });
  return (await r.json()).map(k => ({ time: k[0], low: +k[1], high: +k[2], open: +k[3], close: +k[4] })).sort((a, b) => a.time - b.time);
}

// 1) suivre les trades acceptés depuis le téléphone
const acc = loadAccount();
const follow = async () => { try { await track({ acc, state, proposals, markets: MARKETS, getMinutes }); } catch (e) { log("suivi : erreur", e?.stack || e); } saveAccount(acc); };
await follow();
const save = () => {
  writeFileSync("proposals.json", JSON.stringify(proposals.slice(0, 50), null, 1));
  writeFileSync("assistant-state.json", JSON.stringify(state, null, 1));
};

// 2) notification de test : un vrai prix, un vrai stop, que tu peux accepter pour essayer le suivi
if (process.env.TEST_NOTIF === "true") {
  const b = await getMinutes("BTC"), last = b[b.length - 1].close;
  const p = { id: "test-" + Date.now(), sym: "BTC", tf: "1m", dir: 1, entry: last, stop: last * 0.997, target: last * 1.006, score: 0, details: [], news: "", confidence: null, t: Date.now(), source: "github",
    reason: "Notification de test. Tu peux toucher « Accepter » pour essayer le suivi du trade (compte fictif)." };
  await notify(p);
  process.exit(0);
}
// 3) chercher de nouveaux trades
const scores = {};
// Pips : or 0,10 $, Nasdaq 1 point, Bitcoin 1 $ (réglable dans assistant-config.json)
const PIP = { BTC: 1, XAU: 0.1, NAS: 1, ...(cfg.pip || {}) };
const pipsOf = (p, to) => ((to - p.entry) * p.dir) / PIP[p.sym];
const parisNow = () => { const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }); return { day: s.slice(0, 10), hm: s.slice(11, 16), wd: new Date(s.replace(" ", "T")).getDay() }; };
const parisDay = t => new Date(t).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
// Objectif du jour en pips (gagnés sur les trades fermés aujourd'hui) + prudence autour de l'ouverture américaine
async function dayGate() {
  const g = { min: 100, max: 150, stopLoss: 100, ...(cfg.goalPips || {}) }, now = parisNow();
  const done = acc.history.filter(h => parisDay(h.closedAt) === now.day).reduce((s, h) => s + pipsOf(h, h.exit), 0);
  const inPlay = acc.positions.reduce((s, p) => s + Math.max(0, pipsOf(p, p.target)), 0);
  state.pips = { day: now.day, done: Math.round(done), inPlay: Math.round(inPlay) };
  const once = async (key, msg) => { if (state[key] === now.day) return; state[key] = now.day; await send(msg); };
  if (done >= g.min) { await once("goalSent", { title: `🎯 Objectif du jour atteint : +${Math.round(done)} pips`, message: "Je n'envoie plus de propositions aujourd'hui. Mieux vaut garder ce gain que forcer. Reprise demain.", priority: 4, tags: ["trophy"] }); return "objectif du jour atteint"; }
  // perte maximale du jour : 2 % du compte (trades fermés + risque des trades encore ouverts)
  const dayPnl = acc.history.filter(h => parisDay(h.closedAt) === now.day).reduce((s, h) => s + h.pnl, 0), startBal = acc.balance - dayPnl;
  const openRisk = acc.positions.reduce((s, p) => s + Math.max(0, (p.entry - p.stop) * p.dir * p.qty), 0), maxLoss = (cfg.maxDayLossPct ?? 2) / 100 * startBal;
  if (dayPnl <= -maxLoss) { await once("lossSent", { title: `Journée arrêtée : ${dayPnl.toFixed(2)} $ (−${cfg.maxDayLossPct ?? 2} %)`, message: "La perte maximale du jour est atteinte. Je n'envoie plus de propositions aujourd'hui pour protéger ton compte.", priority: 4, tags: ["octagonal_sign"] }); return "perte maximale du jour (2 %) atteinte"; }
  if (dayPnl - openRisk - 0.01 * acc.balance < -maxLoss - 0.01) return "un trade de plus pourrait dépasser 2 % de perte aujourd'hui";
  if (done <= -g.stopLoss) { await once("lossSent", { title: `Journée arrêtée : ${Math.round(done)} pips`, message: "La perte maximale du jour est atteinte. Je n'envoie plus de propositions aujourd'hui pour protéger ton compte.", priority: 4, tags: ["octagonal_sign"] }); return "perte maximale du jour atteinte"; }
  if (done + inPlay >= g.min) return `assez de trades en cours pour l'objectif (${Math.round(done)} gagnés + ${Math.round(inPlay)} en jeu)`;
  const w = cfg.window; // tes heures de trading (heure de Paris)
  if (w && !(now.hm >= w.from && now.hm < w.to)) return `en dehors de tes heures (${w.from}-${w.to})`;
  const us = { from: "15:00", to: "16:15", ...(cfg.usOpen || {}) };
  if (now.wd >= 1 && now.wd <= 5 && now.hm >= us.from && now.hm < us.to) return "ouverture américaine : pas de nouveau trade";
  return null;
}
// Avant l'ouverture américaine (15 h 30 Paris) : les trades en gain passent au point d'entrée, et je te préviens
async function usOpenGuard() {
  const now = parisNow(), at = cfg.usOpenGuard || "15:20";
  if (now.wd < 1 || now.wd > 5 || now.hm < at || now.hm >= "15:30" || state.usGuard === now.day) return;
  state.usGuard = now.day;
  const lines = [];
  for (const p of acc.positions) {
    const pips = p.last != null ? pipsOf(p, p.last) : 0;
    if (pips > 0 && (p.stop - p.entry) * p.dir < 0) { p.stop = p.entry + p.dir * 0.05 * p.R; p.locked = p.locked ?? 0.05; lines.push(`• ${MARKETS[p.sym].name} (+${Math.round(pips)} pips) : stop loss remonté au point d'entrée`); }
    else lines.push(`• ${MARKETS[p.sym].name} (${Math.round(pips)} pips) : à surveiller, ça peut bouger fort`);
  }
  await send({ title: "⚠️ Ouverture américaine dans 10 minutes", message: (lines.length ? lines.join("\n") + "\n" : "") + "Je ne propose aucun nouveau trade jusqu'à 16 h 15, le temps que le marché se calme.", priority: 4, tags: ["us"] });
}
// Démarrage : tes 10 premiers trades sont filtrés plus sévèrement et protégés plus tôt ;
// ensuite, si les résultats sont bons, le lot conseillé augmente (risque 1 % puis 2 % du capital).
function warmup() {
  const w = { trades: 10, since: 0, minScore: 10, breakeven: 0.7, ...(cfg.warmup || {}) };
  const mine = x => !x.isAdd && !String(x.id).startsWith("test") && (x.openedAt || 0) >= w.since;
  const closed = acc.history.filter(mine), open = acc.positions.filter(mine).length;
  const wins = closed.filter(h => h.pnl > 0).length, pnl = closed.reduce((s, h) => s + h.pnl, 0);
  const n = closed.length + open, inWarm = n < w.trades;
  const good = !inWarm && closed.length && wins / closed.length >= 0.6 && pnl > 0;
  return { ...w, n, inWarm, good, wins, closed: closed.length, pnl };
}
function lotAdvice(p, W) {
  const r = { capital: 100, cur: "€", lotUnit: 1, minLot: 0.01, riskWarm: 0.01, riskAfter: 0.02, ...(cfg.real || {}) };
  if (!state.warmBal) state.warmBal = acc.balance;
  const cap = r.capital * (acc.balance / state.warmBal); // ton capital suit les résultats du compte du serveur
  const risk = W.good ? r.riskAfter : r.riskWarm, dist = Math.abs(p.entry - p.stop) * r.lotUnit;
  const lot = Math.floor(((cap * risk) / dist) * 100) / 100;
  if (lot < r.minLot) { const rk = r.minLot * dist, pc = Math.round((rk / cap) * 100);
    return `Lot conseillé : ${r.minLot} (le minimum). Risque ≈ ${rk.toFixed(2)} ${r.cur}, soit ${pc} % de ton capital${rk > cap * risk * 1.5 ? " : c'est plus que conseillé, ne monte surtout pas au-dessus" : ""}.`; }
  return `Lot conseillé : ${lot.toFixed(2)} (risque ≈ ${(lot * dist).toFixed(2)} ${r.cur}, ${Math.round(risk * 100)} % de ton capital ≈ ${cap.toFixed(0)} ${r.cur}).`;
}
// stop au point d'entrée plus tôt pendant le démarrage
const markBe = () => { const W = warmup(); for (const p of acc.positions) if (p.beAt == null) p.beAt = W.inWarm ? W.breakeven : (cfg.manage?.breakeven ?? 1); };
async function scan() {
const today = new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }); // journée à l'heure de Paris
if (state.day !== today) { state.day = today; state.count = 0; }
try { await usOpenGuard(); } catch (e) { log("ouverture US : erreur", e?.message || e); }
const gate = await dayGate();
if (gate) log("pas de nouvelle proposition :", gate);
const W = warmup(), minScore = W.inWarm || !W.good ? Math.max(cfg.minScore, W.minScore) : cfg.minScore;
log(`démarrage : ${W.n}/${W.trades} trades, ${W.wins}/${W.closed} gagnants, score exigé ${minScore}`);
for (const sym of cfg.markets) {
  const m = MARKETS[sym];
  try {
    const all = await fetchCandles(m, cfg.timeframe);
    const b = all.slice(0, -1); // bougies clôturées seulement
    if (b.length < 210) { log(sym, "pas assez de données"); continue; }
    const sc = scoreMarket(b, STEP[cfg.timeframe], 0);
    scores[sym] = sc.score;
    const sig = `${b[b.length - 1].time}:${Math.sign(sc.score)}`;
    log(sym, "score", sc.score, sc.details.map(x => `${x.name}:${x.v}`).join(" "));
    const pending = proposals.some(p => p.sym === sym && !p.id.startsWith("test") && Date.now() - p.t < (cfg.cooldownMin || 60) * 60000); // au plus une proposition par marché et par heure
    if (gate || Math.abs(sc.score) < minScore || state.lastSig[sym] === sig || pending || state.count >= cfg.maxPerDay) continue;
    state.lastSig[sym] = sig;
    const cc = calendarCheck();
    if (cc.block) { log(sym, "signal ignoré :", cc.text); continue; }
    const dir = sc.score > 0 ? 1 : -1;
    if (W.inWarm || !W.good) { // confirmation par la tendance d'une heure
      const h = scoreMarket((await fetchCandles(m, "1h")).slice(0, -1), 3600, 0).score;
      if (Math.sign(h) !== dir || Math.abs(h) < 4) { log(sym, `ignoré : la tendance 1 h ne confirme pas (score ${h})`); continue; }
    }
    let stop = dir === 1 ? Math.min(sc.px - 1.5 * sc.atr, sc.pl ?? Infinity) : Math.max(sc.px + 1.5 * sc.atr, sc.ph ?? -Infinity);
    if (!isFinite(stop) || Math.abs(sc.px - stop) > 4 * sc.atr) stop = sc.px - dir * 1.5 * sc.atr;
    let p = { id: `${sym}-${Date.now()}`, sym, tf: cfg.timeframe, dir, entry: sc.px, stop, target: sc.px + dir * 2 * Math.abs(sc.px - stop), score: sc.score,
      details: sc.details.map(x => ({ name: x.name, v: x.v })), news: cc.text, reason: `${sc.details.filter(x => Math.sign(x.v) === Math.sign(sc.score)).length} méthodes sur ${sc.details.length} vont dans le même sens : ${sc.details.filter(x => Math.sign(x.v) === Math.sign(sc.score)).map(x => x.name).join(", ")}.`, confidence: null, t: Date.now(), source: "github" };
    if (client) {
      const n = (cfg.checkNews ? await news(m.name) : "") + " " + cc.text;
      const bars = b.slice(-80).map(x => `${x.open},${x.high},${x.low},${x.close}`).join("\n");
      const resp = await client.beta.messages.create({
        model: "claude-opus-5-5", max_tokens: 6000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: "Tu es un trader discipliné qui prépare des propositions de trade pour une personne qui s'entraîne sur un simulateur. Tu ne proposes un trade (take = true) que si plusieurs méthodes concordent, que le ratio risque/rendement est d'au moins 1,5 et qu'aucune annonce majeure n'arrive dans l'heure. Sinon take = false.",
        messages: [{ role: "user", content: `Marché ${m.name}, unité ${cfg.timeframe}, prix ${sc.px}.\nSignal : ${dir === 1 ? "achat" : "vente"}, score ${sc.score}.\nMéthodes : ${sc.details.map(x => `${x.name} ${x.v} (${x.why})`).join(" ; ")}.\nBase : entrée ${sc.px}, stop ${stop}, objectif ${p.target}, ATR ${sc.atr}.\nAnnonces : ${n || "non vérifiées"}\n80 bougies (o,h,l,c) :\n${bars}` }],
      });
      if (resp.stop_reason === "refusal") { log(sym, "refus"); continue; }
      const dec = JSON.parse(resp.content.find(x => x.type === "text").text);
      if (!dec.take) { log(sym, "écarté par Claude :", dec.reason); continue; }
      p = { ...p, dir: dec.direction === "achat" ? 1 : -1, entry: dec.entry, stop: dec.stop, target: dec.target, reason: dec.reason, confidence: dec.confidence, news: n.trim() };
    }
    if ((p.stop - p.entry) * p.dir >= 0 || (p.target - p.entry) * p.dir <= 0) { log(sym, "niveaux incohérents, ignoré"); continue; }
    // objectif précis : l'objectif du trade ne dépasse pas ce qu'il reste à faire pour atteindre le haut de l'objectif du jour
    const gp = { min: 100, max: 150, ...(cfg.goalPips || {}) }, left = gp.max - (state.pips?.done || 0) - (state.pips?.inPlay || 0);
    const tpPips = Math.abs(p.target - p.entry) / PIP[sym], slPips = Math.abs(p.stop - p.entry) / PIP[sym];
    if (tpPips > left) { p.target = p.entry + p.dir * left * PIP[sym]; log(sym, `objectif ramené à ${Math.round(left)} pips`); }
    if (Math.abs(p.target - p.entry) / PIP[sym] < 1.5 * slPips) { log(sym, `ignoré : ${Math.round(Math.min(tpPips, left))} pips à gagner pour ${Math.round(slPips)} pips de risque, pas assez`); continue; }
    p.lot = lotAdvice(p, W);
    p.reason = `${W.inWarm ? `Trade ${W.n + 1}/${W.trades} de démarrage (sélection renforcée). ` : ""}${p.reason}\n${p.lot}`;
    proposals.unshift(p); state.count++;
    await notify(p);
    log(sym, "proposition envoyée", JSON.stringify(p));
  } catch (e) { log(sym, "erreur", e?.message || e); }
}
// 4) sécuriser les trades ouverts (stop au point d'entrée, stop suiveur, renfort)
markBe(); try { await manage({ acc, scores, cfg, markets: MARKETS }); } catch (e) { log("gestion : erreur", e?.stack || e); }
saveAccount(acc);
save();
}

// GitHub ne lance le cron qu'environ une fois par heure : le script reste donc allumé (LOOP_MINUTES),
// lit tes boutons toutes les 20 secondes, vérifie les prix et cherche des trades toutes les 5 minutes,
// et enregistre l'état dans le dépôt pour le site.
const LOOP = +(process.env.LOOP_MINUTES || 0), end = Date.now() + LOOP * 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shape = () => JSON.stringify([acc.positions.map(p => [p.id, p.stop, p.target]), acc.history.length]);
let lastScan = 0, lastCommit = 0, lastShape = "";
function commit(force) {
  if (!LOOP) return;
  const s = shape();
  if (!force && s === lastShape && Date.now() - lastCommit < 10 * 60000) return;
  try {
    execSync("git add proposals.json assistant-state.json server-account.json", { stdio: "ignore" });
    try { execSync("git diff --cached --quiet"); return; } catch (e) {}
    execSync('git commit -q -m "Assistant : suivi des trades" && git pull -q --rebase -X theirs origin main && git push -q origin main', { stdio: "inherit" });
    lastCommit = Date.now(); lastShape = s;
  } catch (e) { log("enregistrement impossible", e?.message || e); }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log("arrêt demandé, j'enregistre"); commit(true); process.exit(0); });
do {
  if (Date.now() - lastScan >= 5 * 60000) { lastScan = Date.now(); await scan(); }
  else { await follow(); markBe(); try { await manage({ acc, scores, cfg, markets: MARKETS }); } catch (e) {} saveAccount(acc); save(); }
  commit();
  if (LOOP) await sleep(20000);
} while (Date.now() < end);
commit(true);
