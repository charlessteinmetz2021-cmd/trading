// Assistant 24 h/24 : lancé par GitHub Actions toutes les 5 minutes.
// Analyse les marchés, demande à Claude de vérifier les annonces et le graphique,
// enregistre la proposition dans proposals.json et envoie une notification ntfy.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import * as I from "../indicators.js";
import { scoreMarket } from "../signals.js";

const cfg = JSON.parse(readFileSync("assistant-config.json", "utf8"));
const MARKETS = { BTC: { name: "Bitcoin", binance: "BTCUSDT", coinbase: "BTC-USD", dec: 2 }, XAU: { name: "Or", binance: "PAXGUSDT", coinbase: "PAXG-USD", dec: 2 } };
const STEP = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };
const CB_GRAN = { "5m": 300, "15m": 900, "1h": 3600, "4h": 21600 };
const state = existsSync("assistant-state.json") ? JSON.parse(readFileSync("assistant-state.json", "utf8")) : { day: "", count: 0, lastSig: {} };
const proposals = existsSync("proposals.json") ? JSON.parse(readFileSync("proposals.json", "utf8")) : [];
const today = new Date().toISOString().slice(0, 10);
if (state.day !== today) { state.day = today; state.count = 0; }
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function fetchCandles(m, tf) {
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
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { log("NTFY_TOPIC absent : pas de notification envoyée"); return; }
  const m = MARKETS[p.sym], f = v => v.toFixed(m.dec);
  const enc = encodeURIComponent(JSON.stringify({ id: p.id, sym: p.sym, dir: p.dir, entry: p.entry, stop: p.stop, target: p.target }));
  const body = {
    topic, priority: 4, tags: [p.dir === 1 ? "chart_with_upwards_trend" : "chart_with_downwards_trend"],
    title: `${p.dir === 1 ? "Achat" : "Vente"} ${m.name} proposé`,
    message: `Entrée ${f(p.entry)} · SL ${f(p.stop)} · TP ${f(p.target)}${p.confidence ? ` · confiance ${p.confidence}/10` : ""}\n${p.reason}`,
    actions: [
      { action: "view", label: "Accepter", url: `${cfg.siteUrl}#accept=${enc}`, clear: true },
      { action: "view", label: "Refuser", url: `${cfg.siteUrl}#refuse=${encodeURIComponent(p.id)}`, clear: true },
    ],
  };
  const r = await fetch("https://ntfy.sh/", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  log("notification", r.status);
}

if (process.env.TEST_NOTIF === "true") {
  await notify({ id: "test-" + Date.now(), sym: "BTC", dir: 1, entry: 100000, stop: 99000, target: 102000, confidence: null, reason: "Notification de test : si tu la vois, tout fonctionne. N'accepte pas ce faux trade." });
  process.exit(0);
}
for (const sym of cfg.markets) {
  const m = MARKETS[sym];
  try {
    const all = await fetchCandles(m, cfg.timeframe);
    const b = all.slice(0, -1); // bougies clôturées seulement
    if (b.length < 210) { log(sym, "pas assez de données"); continue; }
    const sc = scoreMarket(b, STEP[cfg.timeframe], 0);
    const sig = `${b[b.length - 1].time}:${Math.sign(sc.score)}`;
    log(sym, "score", sc.score, sc.details.map(x => `${x.name}:${x.v}`).join(" "));
    const pending = proposals.some(p => p.sym === sym && Date.now() - p.t < 15 * 60000);
    if (Math.abs(sc.score) < cfg.minScore || state.lastSig[sym] === sig || pending || state.count >= cfg.maxPerDay) continue;
    state.lastSig[sym] = sig;
    const cc = calendarCheck();
    if (cc.block) { log(sym, "signal ignoré :", cc.text); continue; }
    const dir = sc.score > 0 ? 1 : -1;
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
    proposals.unshift(p); state.count++;
    await notify(p);
    log(sym, "proposition envoyée", JSON.stringify(p));
  } catch (e) { log(sym, "erreur", e?.message || e); }
}
writeFileSync("proposals.json", JSON.stringify(proposals.slice(0, 50), null, 1));
writeFileSync("assistant-state.json", JSON.stringify(state, null, 1));
