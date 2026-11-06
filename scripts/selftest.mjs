// Vérification de bout en bout des ordres (accepter, accepter 2 fois, refuser, fermer, SL, TP, sécurisation)
// sur un sujet ntfy jetable et un compte de test : ne touche pas au vrai compte.
import { track, manage, proposalActions } from "./suivi.mjs";
process.env.NTFY_TOPIC = "atelier-selftest-" + Math.random().toString(36).slice(2, 10);
const T = process.env.NTFY_TOPIC;
let fails = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "ÉCHEC") + " · " + msg); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MK = { BTC: { name: "Bitcoin", binance: "BTCUSDT" }, XAU: { name: "Or", binance: "PAXGUSDT" }, NAS: { name: "Nasdaq", yahoo: "NQ=F" } };
async function getMinutes(sym) {
  const m = MK[sym];
  if (m.yahoo) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.yahoo)}?interval=1m&range=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
    return res.timestamp.map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] })).filter(x => x.close != null);
  }
  const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${m.binance}&interval=1m&limit=200`);
  return (await r.json()).map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
}
const post = body => fetch("https://ntfy.sh/" + T, { method: "POST", body, headers: { Tags: "white_check_mark" } }).then(r => r.status);
const acc = { start: 10000, balance: 10000, positions: [], history: [] }, state = {}, proposals = [];
const run = () => track({ acc, state, proposals, markets: MK, getMinutes });
await run(); // initialise la lecture

const last = {};
for (const s of ["BTC", "XAU", "NAS"]) { const b = await getMinutes(s); last[s] = b[b.length - 1].close; ok(b.length > 10 && last[s] > 0, `prix ${s} disponible (${last[s]})`); }
const mk = (sym, dir) => ({ id: `${sym}-test${Date.now()}${dir}`, sym, dir, entry: last[sym], stop: last[sym] * (1 - dir * 0.01), target: last[sym] * (1 + dir * 0.02) });
const pB = mk("BTC", 1), pX = mk("XAU", -1), pN = mk("NAS", 1), pR = mk("BTC", -1);
proposals.push(pB, pX, pR); // pN volontairement absent : l'ordre doit suffire
const body = (p, i) => proposalActions(p, "x")[i].body;

// 1) Accepter depuis le téléphone (deux fois la même), depuis le PC, refuser
ok(await post(body(pB, 0)) === 200, "bouton Accepter (téléphone) publié");
ok(await post(body(pB, 0)) === 200, "deuxième Accepter sur la même proposition publié");
ok(await post(body(pX, 0).replace(" [", " (depuis le PC) [")) === 200, "Accepter depuis le PC publié");
await post(body(pN, 0)); await post(body(pR, 1));
await sleep(3000); await run();
const ids = acc.positions.map(p => p.id);
ok(ids.includes(pB.id) && ids.includes(pB.id + "#2"), "deux trades ouverts pour la même proposition BTC");
ok(ids.includes(pX.id) && acc.positions.find(p => p.id === pX.id).dir === -1, "vente or ouverte depuis le PC");
ok(ids.includes(pN.id), "achat Nasdaq ouvert même sans la proposition en mémoire");
ok(pR.status === "refused" && !ids.includes(pR.id), "proposition refusée : rien d'ouvert");
ok(acc.positions.every(p => Math.abs(Math.abs(p.entry - p.stop) * p.qty - 100) < 1), "risque de 1 % (100 $) par trade");

// 2) Fermer à la main (bouton de la notification et bouton du site)
ok(await post(`Reçu, je ferme le trade. [close:${pB.id}]`) === 200, "bouton Fermer publié");
await post(`Reçu (depuis le PC) [close:${pX.id}]`);
await sleep(3000); await run();
ok(!acc.positions.some(p => p.id === pB.id) && acc.history.some(h => h.id === pB.id && h.why === "fermé à la main"), "trade BTC fermé à la main");
ok(!acc.positions.some(p => p.id === pX.id) && acc.history.some(h => h.id === pX.id), "trade or fermé depuis le PC");
ok(Math.abs(acc.balance - 10000 - acc.history.reduce((s, h) => s + h.pnl, 0)) < 1e-6, "solde = départ + gains/pertes fermés");

// 3) Stop loss et take profit touchés
const p2 = acc.positions.find(p => p.id === pB.id + "#2");
p2.stop = last.BTC * 1.5; p2.checkedTo = 0; // stop au-dessus du prix : forcément touché
const pn = acc.positions.find(p => p.id === pN.id);
pn.target = 1; pn.stop = 0.5; pn.checkedTo = 0; // objectif sous le prix : forcément touché
await run();
ok(acc.history.some(h => h.id === p2.id && h.why === "stop loss"), "stop loss détecté et trade fermé");
ok(acc.history.some(h => h.id === pn.id && h.why === "take profit"), "take profit détecté et trade fermé");

// 4) Sécurisation : stop au point d'entrée puis renfort
const pS = mk("BTC", 1); proposals.push(pS);
await post(body(pS, 0)); await sleep(3000); await run();
const s = acc.positions.find(p => p.id === pS.id);
ok(!!s, "trade de sécurisation ouvert");
if (s) {
  s.entry = s.last - 2 * s.R; s.stop = s.entry - s.R; // on fait comme si le trade gagnait déjà 2R
  await manage({ acc, scores: { BTC: 8 }, cfg: { minScore: 6 }, markets: MK });
  ok(s.locked != null && (s.stop - s.entry) * s.dir > 0, "stop loss remonté au-dessus du point d'entrée");
  ok(acc.positions.some(p => p.parent === s.id), "trade de renfort ajouté quand les méthodes confirment");
}
// 5) Tout clôturer
const before = acc.positions.length;
await post("Reçu, je ferme tous les trades en cours. (depuis le PC) [closeall:tout]"); await sleep(3000); await run();
ok(before > 0 && acc.positions.length === 0 && acc.history.filter(h => h.why === "tout clôturé").length === before, `tout clôturer : ${before} trades fermés`);
console.log(fails ? `${fails} vérification(s) en échec` : "Tout fonctionne.");
process.exit(fails ? 1 : 0);
