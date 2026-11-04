// Suivi des trades acceptés depuis la notification du téléphone (compte fictif sur le serveur).
// « Accepter » dans la notification publie un message sur le sujet ntfy de contrôle ;
// chaque passage du script lit ces messages, ouvre le trade, surveille le stop loss et le take profit,
// et envoie le gain ou la perte sur le téléphone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const START = 10000, RISK = 0.01, LEV = 10, PNL_EVERY = 30 * 60000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

export function loadAccount() {
  return existsSync("server-account.json") ? JSON.parse(readFileSync("server-account.json", "utf8"))
    : { start: START, balance: START, positions: [], history: [], updated: 0 };
}
export const saveAccount = acc => writeFileSync("server-account.json", JSON.stringify(acc, null, 1));
export const ctlTopic = () => (process.env.NTFY_TOPIC ? process.env.NTFY_TOPIC + "-ctl" : null);

const money = v => (v >= 0 ? "+" : "−") + Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const px = v => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnlOf = (p, price) => (price - p.entry) * p.dir * p.qty;

// Boutons à mettre sur une notification de proposition
export function proposalActions(p, siteUrl) {
  const t = ctlTopic(), data = { id: p.id, sym: p.sym, dir: p.dir, entry: p.entry, stop: p.stop, target: p.target };
  return [
    { action: "http", label: "Accepter", url: `https://ntfy.sh/${t}`, method: "POST", body: JSON.stringify({ act: "accept", ...data }), clear: true },
    { action: "http", label: "Refuser", url: `https://ntfy.sh/${t}`, method: "POST", body: JSON.stringify({ act: "refuse", id: p.id }), clear: true },
    { action: "view", label: "Voir le site", url: siteUrl },
  ];
}

export async function send(msg) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { log("NTFY_TOPIC absent : pas de notification"); return; }
  const r = await fetch("https://ntfy.sh/", { method: "POST", body: JSON.stringify({ topic, ...msg }), headers: { "Content-Type": "application/json" } });
  log("notification", msg.title, r.status);
}

// Messages envoyés par les boutons depuis le dernier passage
async function readControl(state) {
  const t = ctlTopic(); if (!t) return [];
  const since = state.ctlSince || "12h";
  try {
    const r = await fetch(`https://ntfy.sh/${t}/json?poll=1&since=${since}`);
    if (!r.ok) { log("lecture du contrôle", r.status); return []; }
    const msgs = (await r.text()).split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === "message");
    if (msgs.length) state.ctlSince = msgs[msgs.length - 1].id;
    return msgs.map(m => { try { return { ...JSON.parse(m.message), at: m.time * 1000 }; } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { log("lecture du contrôle impossible", e?.message || e); return []; }
}

const closeActions = id => [{ action: "http", label: "Fermer le trade", url: `https://ntfy.sh/${ctlTopic()}`, method: "POST", body: JSON.stringify({ act: "close", id }), clear: false }];

function close(acc, p, price, why, at) {
  const pnl = pnlOf(p, price);
  acc.balance += pnl;
  acc.positions = acc.positions.filter(x => x !== p);
  acc.history.unshift({ ...p, exit: price, pnl, why, closedAt: at });
  acc.history = acc.history.slice(0, 100);
  return pnl;
}

// getMinutes(sym, sinceSec) → bougies 1 min [{time, open, high, low, close}]
export async function track({ acc, state, proposals, markets, getMinutes }) {
  const now = Date.now();
  const cmds = await readControl(state);
  const cache = {};
  const minutes = async sym => (cache[sym] ||= await getMinutes(sym));

  for (const c of cmds) {
    if (c.act === "refuse") {
      const p = proposals.find(x => x.id === c.id); if (p) p.status = "refused";
      log("proposition refusée", c.id); continue;
    }
    if (c.act === "close") {
      const p = acc.positions.find(x => x.id === c.id); if (!p) continue;
      const b = await minutes(p.sym), last = b[b.length - 1].close;
      const pnl = close(acc, p, last, "fermé à la main", c.at);
      await send({ title: `${markets[p.sym].name} fermé : ${money(pnl)}`, message: `Fermé à ${px(last)}. Solde du compte : ${px(acc.balance)} $`, priority: 4, tags: [pnl >= 0 ? "white_check_mark" : "x"] });
      continue;
    }
    if (c.act !== "accept") continue;
    if (acc.positions.some(x => x.id === c.id) || acc.history.some(x => x.id === c.id)) continue;
    const m = markets[c.sym]; if (!m) continue;
    const prop = proposals.find(x => x.id === c.id) || c;
    const b = await minutes(c.sym);
    // prix au moment où tu as touché « Accepter »
    const bar = [...b].reverse().find(x => x.time * 1000 <= c.at) || b[b.length - 1];
    const entry = bar.close, dir = prop.dir, stop = prop.stop, target = prop.target;
    if ((entry - stop) * dir <= 0 || (target - entry) * dir <= 0) {
      if (proposals.includes(prop)) prop.status = "missed";
      await send({ title: `${m.name} : trade non ouvert`, message: `Le prix (${px(entry)}) a déjà dépassé le ${(entry - stop) * dir <= 0 ? "stop loss" : "take profit"} prévu. Rien n'a été ouvert.`, priority: 3, tags: ["warning"] });
      continue;
    }
    const qty = (acc.balance * RISK) / Math.abs(entry - stop);
    const p = { id: c.id, sym: c.sym, dir, qty, entry, stop, target, lev: LEV, openedAt: bar.time * 1000, checkedTo: bar.time, lastPnlNotif: now };
    acc.positions.push(p);
    if (proposals.includes(prop)) prop.status = "accepted";
    log("trade ouvert", JSON.stringify(p));
    await send({
      title: `${dir === 1 ? "Achat" : "Vente"} ${m.name} ouvert à ${px(entry)}`,
      message: `SL ${px(stop)} (${money(-acc.balance * RISK)}) · TP ${px(target)} (${money(pnlOf(p, target))})\nJe te préviens au stop loss ou au take profit, et je t'envoie le gain ou la perte toutes les 30 minutes.`,
      priority: 4, tags: ["rocket"], actions: closeActions(p.id),
    });
  }

  // surveillance du SL et du TP sur les bougies d'une minute
  for (const p of [...acc.positions]) {
    const m = markets[p.sym], b = await minutes(p.sym);
    let hit = null;
    for (const x of b) {
      if (x.time <= p.checkedTo) continue;
      const slHit = p.dir === 1 ? x.low <= p.stop : x.high >= p.stop;
      const tpHit = p.dir === 1 ? x.high >= p.target : x.low <= p.target;
      if (slHit) { hit = { price: p.stop, why: "stop loss", at: x.time * 1000 }; break; } // si les deux dans la même minute : on compte le stop (prudent)
      if (tpHit) { hit = { price: p.target, why: "take profit", at: x.time * 1000 }; break; }
      p.checkedTo = x.time;
    }
    if (hit) {
      const pnl = close(acc, p, hit.price, hit.why, hit.at);
      log("trade fermé", p.id, hit.why, pnl);
      await send({
        title: `${hit.why === "take profit" ? "🎯 Take profit" : "🛑 Stop loss"} touché sur ${m.name} : ${money(pnl)}`,
        message: `${p.dir === 1 ? "Achat" : "Vente"} de ${px(p.entry)} fermé à ${px(hit.price)}. Solde du compte : ${px(acc.balance)} $`,
        priority: 5, tags: [pnl >= 0 ? "white_check_mark" : "x"],
      });
      continue;
    }
    const last = b[b.length - 1].close, pnl = pnlOf(p, last);
    p.last = last; p.pnl = pnl;
    if (now - p.lastPnlNotif >= PNL_EVERY) {
      p.lastPnlNotif = now;
      const toSl = Math.abs(last - p.stop), toTp = Math.abs(p.target - last);
      await send({
        title: `${m.name} ${p.dir === 1 ? "achat" : "vente"} : ${money(pnl)}`,
        message: `Prix ${px(last)} · entrée ${px(p.entry)}\nReste ${px(toTp)} jusqu'au TP et ${px(toSl)} jusqu'au SL.`,
        priority: 2, tags: [pnl >= 0 ? "green_circle" : "red_circle"], actions: closeActions(p.id),
      });
    }
  }
  acc.updated = now;
}
