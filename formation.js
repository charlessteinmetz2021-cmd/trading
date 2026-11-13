// Formation : fiches de cours, méthode d'analyse A→Z, outils (lot avec spread + commission,
// niveaux MT5, règle des 30, paliers de drawdown) et quiz.
// Synthèse personnelle des vidéos et PDF de formation (structure, offre/demande, liquidité,
// order blocks, blocs institutionnels, gestion du risque). Tout est enregistré dans le navigateur.

const FKEY = "atelier-formation-v1";
let F = {};
try { F = JSON.parse(localStorage.getItem(FKEY)) || {}; } catch (e) { F = {}; }
const fsave = () => { try { localStorage.setItem(FKEY, JSON.stringify(F)); } catch (e) {} };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const x = parseFloat(String(v).replace(",", ".")); return Number.isFinite(x) ? x : NaN; };
const fx = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–";

// ---------------------------------------------------------------- fiches de cours
const FICHES = [
  { id: "structure", t: "1. Structure de marché : lire le biais", h: `
<p>La structure sert à fixer le <b>biais</b> (la direction probable) et la phase du marché. Chaque unité de temps (UT) a sa propre structure ; les grandes UT donnent l'élan et priment sur les petites.</p>
<ul>
<li><b>Haussier (bullish)</b> : sommets et creux de plus en plus hauts (HH / HL).</li>
<li><b>Baissier (bearish)</b> : sommets et creux de plus en plus bas (LH / LL).</li>
<li>Un <b>HL n'est validé que quand le HH précédent est cassé</b> ; un LH n'est validé que quand le LL précédent est cassé. Tant que ce n'est pas cassé, le creux / sommet n'est qu'un candidat.</li>
<li><b>BOS</b> (break of structure) : cassure du dernier sommet (haussier) ou du dernier creux (baissier) dans le sens de la tendance. C'est la confirmation de continuation.</li>
<li><b>Orderflow</b> : le dernier sommet (en tendance haussière) ou le dernier creux (en baissière) à casser. C'est l'objectif minimal d'une continuation et le niveau où l'on remonte son stop.</li>
<li>Le mouvement alterne <b>expansion</b> (impulsion dans le sens du biais) et <b>retracement</b>. Les ordres pris pendant le retracement, à l'inverse du biais, sont « en négatif » : ils seront refermés quand le prix reviendra sur la zone (la <b>mitigation</b>).</li>
<li>Sommets et creux au même niveau = <b>range / consolidation</b> : pas de position dans l'UT qui consolide.</li>
</ul>
<p class="small">Astuce : trace la structure de la plus grande UT vers la plus petite, et ne passe à la suite qu'une fois le biais clair.</p>` },
  { id: "fractal", t: "2. Fractalité et règle des 30", h: `
<p>Le marché est <b>fractal</b> : il y a des tendances dans les tendances. Les petites UT construisent les grandes (4 bougies M15 = 1 bougie H1). On peut être baissier en H4 et haussier en M15.</p>
<ul>
<li>3 phases : haussière, consolidation, baissière. 2 composantes : impulsion et retracement.</li>
<li>Un BOS haussier en M15 dans une tendance baissière H1 permet deux lectures : trader le <b>retracement H1</b> ou la <b>continuation M15</b>. Le choix fixe l'objectif.</li>
<li><b>Règle des 30</b> : quand le prix entre dans un POI d'une UT, on cherche le signal d'entrée dans l'UT ≈ <b>UT du POI ÷ 30</b>. POI H1 → signal en M2 ; POI M15 → S30 ; POI H4 → M8 ; POI Daily → M48 (≈ H1).</li>
<li><b>Proportionnalité</b> : la zone et le stop doivent être proportionnés au mouvement qu'on trade. Une zone énorme pour un petit mouvement, ou l'inverse, est suspecte.</li>
<li>L'analyse multi-UT ajoute de la confluence et permet de viser des objectifs de grande UT avec une entrée de petite UT : c'est là que viennent les gros ratios risque / rendement.</li>
</ul>
<p class="small">Calcul automatique dans l'onglet « Outils ».</p>` },
  { id: "sd", t: "3. Offre et demande, POI et imbalance", h: `
<ul>
<li><b>Order block</b> = le concept ; <b>POI</b> (point of interest) = la zone qu'on va trader ; <b>Demand</b> = POI haussier ; <b>Supply</b> = POI baissier.</li>
<li>Les institutions reviennent presque toujours sur leurs anciennes zones pour refermer les ordres « en négatif » avant de pousser le prix dans le sens du biais. Ce retour, c'est la <b>mitigation</b>. Une zone ne tient pas dans 100 % des cas.</li>
</ul>
<p><b>Un POI valable :</b></p>
<ol>
<li>contient de l'<b>imbalance</b> (gap / FVG) non comblée, donc la zone est encore <i>unmitigated</i> ;</li>
<li>est en <b>confluence avec le biais</b> de la structure ;</li>
<li>a une <b>taille proportionnelle</b> au mouvement ;</li>
<li>est <b>cohérent avec la création de liquidité</b> (des ordres ont été piégés avant le départ).</li>
</ol>
<p><b>L'imbalance</b> traduit un déséquilibre (sur-extension) qui sera amené à être rempli. Scanne les UT supérieures pour la trouver : une imbalance de grande UT compte plus qu'une de petite UT. Sois sur la bonne UT : la même zone peut paraître vide en petite UT et évidente en grande.</p>
<p><b>Raffiner une zone :</b> par la fractalité (zone d'UT inférieure dedans), par le niveau 50 % (Fibonacci), par le volume, par les mèches, en remontant d'UT pour plus d'imbalance, sans utiliser toute la supply. <b>Raffiner, mais pas trop</b> : plus la zone est petite, meilleur est le ratio, mais moins elle a de chances d'être atteinte.</p>` },
  { id: "liq", t: "4. Liquidité : où sont les stops", h: `
<p>Tout mouvement est un <b>transfert entre la main forte et la main faible</b>. Avant de partir, le prix va chercher la liquidité (les stops et les ordres d'entrée des particuliers) : c'est un mouvement <b>nécessaire et obligatoire</b>. Le biais ne s'exécute donc jamais en ligne droite.</p>
<ul>
<li><b>$$$</b> au-dessus des <b>sommets égaux</b> et sous les <b>creux égaux</b> (double top / bottom, range).</li>
<li>Zones de liquidité classiques : supports / résistances, canaux ascendants / descendants, biseaux, épaule-tête-épaule, lignes de tendance.</li>
<li>Configurations de chandeliers qui attirent les particuliers : englobante, étoile du matin / du soir, doji, tweezer top / bottom.</li>
<li><b>Inducement</b> : un petit sommet / creux évident juste avant ton POI, qui sert d'appât. Un POI avec un inducement non pris devant lui est moins fiable ; un POI dont l'inducement vient d'être pris est plus fiable.</li>
<li><b>Liquidity pool / liquidation</b> : la mèche qui balaie un niveau puis revient (sweep) est souvent le signal qu'on attend, pas une cassure.</li>
</ul>
<p class="small">Règle pratique : ne place pas ton stop exactement là où tout le monde le met (juste sous le creux évident). Mets-le derrière la structure qui invalide vraiment l'idée.</p>` },
  { id: "ob", t: "5. Order block (OB) et OB 2.0", h: `
<p><b>Définition</b> : l'OB est la dernière bougie de sens inverse juste avant l'expansion qui a fait un BOS. Bullish OB = dernière bougie baissière avant l'impulsion haussière ; bearish OB = dernière bougie haussière avant la chute.</p>
<p><b>Repérer un OB en 3 étapes</b> : 1) trouver une expansion qui a cassé la structure ; 2) identifier la dernière bougie inverse avant cette expansion ; 3) tracer la zone sur cette bougie. Le plus important est de bien repérer le <b>début</b> de l'expansion.</p>
<p><b>Filtrer l'OB</b> (plus précis = meilleur ratio, mais moins souvent déclenché) :</p>
<ul><li>le niveau 50 % de l'OB (les institutions referment à l'équilibre) ;</li>
<li>la confluence avec du gap à combler juste au-dessus (OB haussier) ou en dessous (OB baissier) ;</li>
<li>un OB d'UT inférieure à l'intérieur de l'OB.</li></ul>
<p><b>Entrer</b> : ordre limite sur le haut de l'OB, ou sur le niveau raffiné, ou attendre que le prix soit dans l'OB pour chercher une entrée sur un nouvel OB en micro-UT.</p>
<p><b>OB 2.0</b> : OB formé dans un throwback (correction d'une tendance haussière) ou un pullback (correction d'une tendance baissière), dans le même sens que l'OB initial. Il sert à <b>renforcer</b> (scaler) une position déjà prise.</p>` },
  { id: "bloc", t: "6. Blocs institutionnels", h: `
<p>Un bloc institutionnel est un « bloc » d'ordres de la smart money : une lecture plus globale du prix qui réunit en un seul concept la structure, l'offre / demande, la proportionnalité, les confirmations et la fractalité. C'est l'idée de l'OB, poussée beaucoup plus loin.</p>
<ul>
<li>Ils sont <b>omniprésents</b> et <b>chaque ordre fait partie de plusieurs blocs</b> (fractalité).</li>
<li>Lecture : les grands blocs (en rose dans le cours) donnent la <b>structure</b> ; les blocs gris donnent les zones d'<b>offre / demande</b>.</li>
<li>Après un BOS, le bloc compris entre le sommet et le creux du mouvement qui a cassé est une zone d'entrée. Le prix revient parfois seulement sur ce bloc, sans aller jusqu'à l'OB.</li>
<li>Entrée sur le bloc : plutôt en <b>exécution immédiate</b> (le prix y revient vite). Avantage : déclenché plus souvent. Inconvénient : stop plus large, donc ratio plus faible.</li>
<li>Second BOS : si le gap du premier BOS a été comblé, un second BOS confirme le retournement ; on peut entrer sur le bloc de ce second BOS, stop juste au-delà de son extrémité.</li>
</ul>` },
  { id: "wyckoff", t: "7. Signaux d'entrée : accumulation, distribution, BOS", h: `
<p>Une fois dans le POI de la grande UT, on attend un signal dans la petite UT (règle des 30). Trois signaux sont retenus :</p>
<ul>
<li><b>Accumulation</b> (POI haussier) : entrée sur le <b>Test</b> / sur un POI de la petite UT, souvent en phase D après le BOS haussier.</li>
<li><b>Distribution</b> (POI baissier) : entrée sur le <b>LPSY</b> (dernier sommet plus bas) / sur un POI de la petite UT. Attention à l'UTAD (fausse cassure du haut du range) : si elle arrive après ton entrée, tu sors souvent au point mort, et tu peux revenir après le BOS baissier suivant.</li>
<li><b>BOS</b> dans le sens du POI en petite UT, idéalement avec une micro-accumulation ou micro-distribution à sa base.</li>
</ul>
<p>Liquidité, manipulation (la mèche qui piège), puis BOS : c'est la séquence à voir avant d'entrer.</p>` },
  { id: "hp", t: "8. Setup à haute probabilité (5 critères)", h: `
<ol>
<li><b>Structure clairement identifiable</b> : tu sais dire en une phrase si c'est haussier ou baissier, et sur quelle UT.</li>
<li><b>POI qui a délivré un mouvement impulsif</b> et qui est le POI de la tendance (celui qui a lancé le BOS).</li>
<li><b>Confluence de plusieurs UT</b> : le POI de la petite UT est dans celui de la grande, les biais concordent.</li>
<li><b>Présence de forte liquidité</b> prise avant ou autour du POI (sommets / creux égaux balayés, inducement pris).</li>
<li><b>Qualité de la manipulation</b> : une mèche nette qui piège puis un départ franc, pas un prix qui traîne dans la zone.</li>
</ol>
<p class="small">Moins de 4 critères sur 5 : on passe son tour ou on réduit le risque. Le score est calculé dans l'onglet « Méthode A→Z ».</p>` },
  { id: "gestion", t: "9. Entrée, stop et objectifs", h: `
<p><b>Entrer</b> :</p>
<ul><li><b>Ordre limite</b> sur un POI de la petite UT après le BOS (buy limit pour un POI haussier, sell limit pour un baissier). Possible en phase D d'une accumulation / distribution, après un BOS simple avec une micro-accu / distri à sa base, ou après un double BOS s'il ne reste pas de gap à combler.</li>
<li><b>Exécution directe</b> juste après le BOS en phase D, sur le bloc institutionnel, pour être sûr d'être déclenché.</li></ul>
<p><b>Gérer le stop</b> : quand le prix casse l'orderflow de l'UT d'entrée, remonte le stop sur le dernier creux (achat) ou le dernier sommet (vente) <b>s'il ne reste pas de gap</b> derrière. Tu te rapproches du point mort sans couper le trade trop tôt.</p>
<p><b>Objectifs</b> :</p>
<ul><li>Tu trades une <b>continuation</b> → objectif sur l'<b>orderflow</b> de l'UT.</li>
<li>Tu trades un <b>retracement</b> → objectif sur un <b>POI</b> de l'UT.</li>
<li>Prends des <b>partiels</b> (ex. 50 % au premier objectif) et laisse courir le reste vers l'objectif de grande UT selon ton profil.</li>
<li><b>Objectifs souples</b> : sur une zone d'objectif, on ne sort que si le prix réagit contre toi ; sinon on laisse aller vers la zone suivante.</li></ul>
<p class="small">Ton profil décide : intraday prudent = un seul objectif proche et sûr ; swing ambitieux = partiels puis objectif lointain, ratio énorme mais probabilité plus faible.</p>` },
  { id: "sl", t: "10. Stop loss et préservation du capital", h: `
<ul>
<li><b>Stop = niveau d'invalidation.</b> Il se place là où la structure change et où la raison d'entrer n'existe plus. Jamais un pourcentage fixe identique pour tous les trades.</li>
<li>Avant d'entrer, il faut le <b>trident</b> : un déclencheur d'entrée, un niveau d'invalidation (stop) et une zone d'objectif.</li>
<li><b>Taille de position = montant risqué ÷ distance au stop.</b> Exemple : 100 000 $, risque 1 % = 1 000 $, stop à 4 % → position de 25 000 $. Le levier sert à immobiliser moins de marge, pas à risquer plus.</li>
<li>N'entre pas au milieu d'un range : en bas pour acheter, en haut pour vendre. Cherche la confluence (plusieurs raisons au même endroit).</li>
<li>Laisse un peu de marge sous l'invalidation pour éviter la chasse aux stops par les mèches.</li>
<li>Ne te précipite pas pour mettre le stop au point mort : remonte-le selon la structure (orderflow cassé, creux sans gap).</li>
<li>Couper une perte = sortir quand la structure change. Si le marché repart dans ton sens, tu pourras revenir. Espérer n'est pas une stratégie.</li>
</ul>
<table class="ftab"><thead><tr><th>Perte du compte</th><th>Gain nécessaire pour revenir</th></tr></thead><tbody>
<tr><td>-10 %</td><td>+11,1 %</td></tr><tr><td>-20 %</td><td>+25 %</td></tr><tr><td>-30 %</td><td>+42,9 %</td></tr>
<tr><td>-50 %</td><td>+100 %</td></tr><tr><td>-70 %</td><td>+233 %</td></tr><tr><td>-90 %</td><td>+900 %</td></tr></tbody></table>` },
  { id: "dd", t: "11. Gestion du drawdown par paliers", h: `
<p>But : piloter ses pertes et gains pour avoir une belle courbe de capital, devenir un investisseur « safe » et verrouiller ses gains. Le risque par trade change par <b>paliers</b>, qui s'adaptent à l'évolution du compte.</p>
<ul>
<li><b>Départ</b> : risque de base (ex. 1 %).</li>
<li><b>DD1</b> : après une perte de 4 fois le risque de base, le risque est divisé par 2 (0,5 %).</li>
<li><b>DD2</b> : après une nouvelle perte de 4 fois le risque DD1, encore divisé par 2 (0,25 %). Puis DD3, etc.</li>
<li><b>DU1</b> (drawup) : après un gain de 20 fois le risque de base, le risque de base est doublé.</li>
</ul>
<p>Exemple : 100 000 $ à 1 % → DD1 à 96 000 $ (0,5 %) → DD2 à 94 080 $ (0,25 %). Les pertes ralentissent fortement, il faut beaucoup plus de trades perdants pour vider le compte.</p>
<p class="small">Calculateur de paliers dans l'onglet « Outils ».</p>` },
  { id: "spread", t: "12. Spread, commission et niveaux MT5", h: `
<ul>
<li>Le spread = écart entre le prix d'achat et de vente ; il paie le broker, comme la commission et le swap. Il varie selon l'actif, l'heure et les conditions du marché.</li>
<li><b>Lot</b> : ajoute le spread au stop (stop 5,5 pips + spread 0,8 = 6,3 pips) puis intègre la commission par lot pour risquer pile le montant voulu. Formule exacte : <b>lots = risque ÷ (pips × valeur du pip + commission par lot)</b>.</li>
<li>Commission sur une paire : additionne celle des deux devises si le broker la facture par devise (ex. AUD 3,5 $ + USD 3,5 $ = 7 $ par lot).</li>
<li><b>Graphique TradingView (prix bid) → niveaux MT5</b> :
  <ul><li>Achat : entrée = niveau + spread ; stop et objectif = mêmes niveaux.</li>
  <li>Vente : entrée = même niveau ; stop = niveau + spread ; objectif = niveau + spread.</li></ul></li>
<li>Sans ça, un ordre d'achat limite peut ne jamais être déclenché, et un stop de vente part trop tôt (de la taille du spread).</li>
</ul>
<p class="small">Calculateurs dans l'onglet « Outils ».</p>` },
  { id: "psy", t: "13. Price action et psychologie", h: `
<ul>
<li>Le prix ne dépend pas des nouvelles elles-mêmes mais de la <b>perception</b> qu'en ont les participants. C'est pour ça que les prix font des tendances.</li>
<li>Un marché est toujours soit en <b>tendance</b>, soit en <b>range</b>. Naissance d'une tendance : cassure, pullback, base, puis canal (qui finit en range).</li>
<li>Bougies de tendance (grand corps) contre bougies de range (doji, petites, mèches des deux côtés). Outside bar : englobe la précédente. Inside bar : contenue dans la précédente.</li>
<li>L'émotion principale qui ruine un compte, c'est l'<b>espoir</b> : espérer que ça reparte au lieu de respecter l'invalidation.</li>
<li>Plan d'entrée et de sortie fixé avant le trade. Si tu as peur ou que tu ne le suis pas, c'est que tu n'as pas assez préparé.</li>
<li>Backteste : analyse un actif dans le passé, cherche les entrées selon la méthode, puis compare. Prends des notes, c'est comme ça que les concepts deviennent automatiques.</li>
</ul>` },
  { id: "fisc", t: "14. Fiscalité (France, à vérifier)", h: `
<p>Repères donnés dans la formation (vidéo de 2021), valables seulement pour une personne résidant fiscalement en France. Les règles changent : vérifie sur impots.gouv.fr ou avec un comptable avant de déclarer.</p>
<ul>
<li><b>Le trading n'est pas ton activité principale</b> : les gains se déclarent en <b>BNC</b> (bénéfices non commerciaux) et sont imposés selon ta tranche.</li>
<li><b>Le trading est ton activité principale</b> : il faut déclarer une entreprise (CFE / guichet unique), plusieurs régimes possibles (entreprise individuelle, etc.).</li>
<li>Un compte chez un broker à l'étranger se déclare chaque année (formulaire 3916).</li>
</ul>` },
];

// ---------------------------------------------------------------- méthode A→Z
const STEPS = [
  { t: "1. Tendance des UT d'analyse (structure)", items: [
    "J'ai choisi mes UT d'analyse (ex. Daily, H4, M15, et l'UT d'entrée)",
    "Pour chaque UT : haussière, baissière ou range (HH/HL ou LH/LL confirmés)",
    "J'ai repéré l'orderflow (dernier sommet / creux à casser) de chaque UT",
  ] },
  { t: "2. POI des grandes UT, puis attendre le prix", items: [
    "POI dans le sens du biais (demand si haussier, supply si baissier)",
    "Le POI contient de l'imbalance non comblée",
    "Taille proportionnelle au mouvement, liquidité créée avant le départ",
    "Je ne fais rien tant que le prix n'est pas entré dans le POI",
  ] },
  { t: "3. Signal dans l'UT du POI ÷ 30", items: [
    "Le prix est dans le POI de la grande UT",
    "Je suis passé dans l'UT d'entrée (règle des 30)",
    "Signal présent : accumulation (Test), distribution (LPSY) ou BOS dans le sens du POI",
  ] },
  { t: "4. Entrée en position", items: [
    "Ordre limite sur un POI de la petite UT après le BOS, ou exécution directe sur le bloc institutionnel",
    "Stop derrière la structure (niveau d'invalidation), spread compris",
    "Lot calculé avec spread + commission pour le risque prévu",
  ] },
  { t: "5. Gestion du stop", items: [
    "Quand l'orderflow de l'UT d'entrée casse : stop sur le dernier creux / sommet sans gap derrière",
  ] },
  { t: "6. Objectifs", items: [
    "Continuation → orderflow de l'UT ; retracement → POI de l'UT",
    "Partiels prévus (ex. 50 %) selon mon profil, objectif final choisi",
  ] },
];
const HP = ["Structure clairement identifiable", "POI qui a délivré un mouvement impulsif (POI de tendance)", "Confluence de plusieurs UT", "Présence de forte liquidité", "Qualité de la manipulation"];

// ---------------------------------------------------------------- actifs (valeur d'un pip pour 1 lot, devise du compte)
// Valeurs par défaut approximatives pour un compte en dollars : à vérifier dans MT5
// (clic droit sur le symbole > Spécification) ou sur un calculateur de pip, et à mettre à jour.
const ASSETS = [
  { n: "EURUSD / GBPUSD / AUDUSD / NZDUSD (XXX/USD)", pip: 0.0001, v: 10, spread: 0.8 },
  { n: "XXX/JPY (USDJPY, EURJPY…)", pip: 0.01, v: 6.5, spread: 1 },
  { n: "XXX/CHF (USDCHF, EURCHF…)", pip: 0.0001, v: 12.5, spread: 1 },
  { n: "XXX/CAD (USDCAD, EURCAD…)", pip: 0.0001, v: 7.2, spread: 1.2 },
  { n: "XXX/GBP (EURGBP…)", pip: 0.0001, v: 13.2, spread: 1.2 },
  { n: "XXX/AUD (EURAUD, GBPAUD…)", pip: 0.0001, v: 6.5, spread: 1.5 },
  { n: "XXX/NZD (EURNZD, GBPNZD…)", pip: 0.0001, v: 5.8, spread: 2 },
  { n: "XAUUSD (or, 1 lot = 100 onces)", pip: 0.01, v: 1, spread: 20 },
  { n: "BTCUSD (1 lot = 1 BTC)", pip: 1, v: 1, spread: 15 },
  { n: "NAS100 / US100", pip: 1, v: 1, spread: 1.5 },
  { n: "US30", pip: 1, v: 1, spread: 2 },
  { n: "XTIUSD (pétrole, 1 lot = 1 000 barils)", pip: 0.01, v: 10, spread: 3 },
];
const allAssets = () => {
  const over = F.assetOver || {};
  return [...ASSETS.map((a, i) => ({ ...a, ...(over[i] || {}), id: "p" + i })),
    ...(F.custom || []).map((a, i) => ({ ...a, id: "c" + i, custom: true }))];
};

// ---------------------------------------------------------------- quiz
const QUIZ = [
  { q: "En tendance haussière, quand un HL (higher low) est-il validé ?", a: ["Dès que le prix rebondit", "Quand le HH précédent est cassé", "Après trois bougies vertes"], ok: 1, why: "Le creux ne devient un HL qu'une fois le sommet précédent cassé (BOS)." },
  { q: "Un POI H1 est touché. Dans quelle UT cherche-t-on le signal d'entrée ?", a: ["M15", "M5", "M2"], ok: 2, why: "Règle des 30 : 60 min ÷ 30 = 2 min." },
  { q: "Qu'est-ce qu'un bullish order block ?", a: ["La dernière bougie baissière avant l'expansion haussière qui casse la structure", "La plus grande bougie verte de la tendance", "Un sommet égal à un autre"], ok: 0, why: "C'est la dernière bougie inverse avant l'expansion qui fait le BOS." },
  { q: "Pourquoi le prix revient-il sur une zone d'offre ou de demande ?", a: ["Par hasard", "Pour refermer les ordres « en négatif » pris à l'inverse du biais (mitigation)", "Parce que les indicateurs le demandent"], ok: 1, why: "Les institutions referment les positions qui ont servi à créer la liquidité : c'est la mitigation." },
  { q: "Où se trouve la liquidité la plus évidente ?", a: ["Au milieu d'un range", "Au-dessus des sommets égaux et sous les creux égaux", "Sur la moyenne mobile 200"], ok: 1, why: "Les stops et ordres d'entrée s'y accumulent ($$$)." },
  { q: "Tu trades une continuation de tendance M15. Où mets-tu l'objectif minimum ?", a: ["Sur l'orderflow M15", "Sur un POI M15", "À 1 % du prix d'entrée"], ok: 0, why: "Continuation → orderflow ; retracement → POI." },
  { q: "Quand remonter le stop selon la méthode ?", a: ["Dès +5 pips", "Quand l'orderflow de l'UT d'entrée casse, sur le dernier creux / sommet sans gap derrière", "Jamais"], ok: 1, why: "On se rapproche du point mort quand la structure le justifie." },
  { q: "Capital 10 000 $, risque 1 %, stop 6,3 pips (spread compris), pip à 10 $/lot, commission 7 $/lot. Combien de lots ?", a: ["1,59", "1,42", "1,00"], ok: 1, why: "100 ÷ (6,3 × 10 + 7) = 100 ÷ 70 ≈ 1,42 lot." },
  { q: "Vente sur MT5, spread 0,6 pip, stop voulu à 110,663 sur TradingView. Quel stop entrer ?", a: ["110,663", "110,657", "110,669"], ok: 2, why: "En vente, stop et objectif = niveau TradingView + spread." },
  { q: "Ton compte perd 50 %. Quel gain faut-il pour revenir ?", a: ["+50 %", "+100 %", "+75 %"], ok: 1, why: "La moitié du capital doit doubler." },
  { q: "Gestion par paliers (base 1 %) : tu as perdu 4 fois ton risque de base. Nouveau risque ?", a: ["2 %", "1 %", "0,5 %"], ok: 2, why: "Palier DD1 : le risque est divisé par deux." },
  { q: "Que vaut une zone raffinée au maximum ?", a: ["Meilleur ratio mais moins de chances d'être touchée", "Plus de chances d'être touchée", "Aucune différence"], ok: 0, why: "Raffiner, mais pas trop : on gagne en ratio et on perd en probabilité." },
];

// ---------------------------------------------------------------- styles
const css = `
.formation h2{color:var(--accent)}
.ftabs{display:flex;gap:6px;flex-wrap:wrap}
.fpanel{display:grid;gap:12px}
.fiches details{border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:var(--bg)}
.fiches details[open]{background:var(--panel)}
.fiches summary{font-weight:600;color:var(--fg);font-size:.95rem}
.fiches p,.fiches li{max-width:80ch}
.fiches ul,.fiches ol{padding-left:20px;margin:6px 0}
.fiches li{margin:3px 0}
.ftab{width:auto;min-width:280px}
.ftab td,.ftab th{text-align:left}
.fsteps{display:grid;gap:10px}
.fstep{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px}
.fstep.done{border-color:var(--gain)}
.fstep h3{margin:0;font-size:.92rem}
.fcheck{display:flex;gap:8px;align-items:flex-start;color:var(--fg);font-size:.88rem;cursor:pointer}
.fcheck input{width:auto;margin-top:3px;accent-color:var(--accent)}
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:start}
.fbox{border:1px solid var(--line);border-radius:8px;padding:12px;display:grid;gap:10px;min-width:0}
.fbox h3{margin:0;font-size:.95rem}
.fres{display:grid;gap:0}
.fbig{font-family:var(--mono);font-size:1.5rem;font-weight:700}
.fverdict{font-weight:600;padding:6px 10px;border-radius:6px;border:1px solid currentColor}
.fq{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px}
.fq p{margin:0}
.fq .opts{display:flex;flex-wrap:wrap;gap:6px}
.fq .opts button{font:inherit;font-size:.85rem;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;text-align:left}
.fq .opts button.good{border-color:var(--gain);background:color-mix(in srgb,var(--gain) 18%,transparent)}
.fq .opts button.bad{border-color:var(--loss);background:color-mix(in srgb,var(--loss) 18%,transparent)}
.atab input{width:90px;padding:4px 6px}
.atab td:first-child{white-space:normal;min-width:180px}
.atab tr.sel td{background:color-mix(in srgb,var(--accent) 12%,transparent)}
@media (max-width:600px){.fields.f3{grid-template-columns:1fr 1fr}}
.fields.f3{grid-template-columns:1fr 1fr 1fr}
`;

// ---------------------------------------------------------------- rendu
function render(root) {
  if (!document.getElementById("formationCss")) { const st = document.createElement("style"); st.id = "formationCss"; st.textContent = css; document.head.appendChild(st); }
  root.innerHTML = `
<h2 id="tForm">Formation : méthode, fiches et outils</h2>
<p class="small">Synthèse des vidéos et PDF de ta formation (structure, offre et demande, liquidité, order blocks, blocs institutionnels, risque). Coche, calcule, révise : tout reste dans ce navigateur.</p>
<div class="ftabs" role="tablist">
  <button class="chip" data-ft="method">Méthode A→Z</button>
  <button class="chip" data-ft="fiches">Fiches de cours</button>
  <button class="chip" data-ft="tools">Outils</button>
  <button class="chip" data-ft="quiz">Quiz</button>
</div>

<div class="fpanel" data-fp="method">
  <div class="fields f3">
    <label>Actif<input id="fmAsset" type="text" placeholder="ex. XAUUSD"></label>
    <label>UT d'analyse<input id="fmTf" type="text" placeholder="ex. D1 / H4 / M15"></label>
    <label>Profil<select id="fmProfile"><option value="">–</option><option>Scalper (minutes)</option><option>Intraday (max 24 h)</option><option>Intraweek</option><option>Swing (plusieurs jours)</option></select></label>
  </div>
  <div class="fgrid">
    <div class="fsteps" id="fmSteps"></div>
    <div class="fbox">
      <h3>Setup à haute probabilité</h3>
      <div id="fmHp"></div>
      <div class="fverdict" id="fmVerdict">–</div>
      <label>Notes du trade<textarea id="fmNotes" placeholder="Biais, POI, signal attendu, stop, objectifs…"></textarea></label>
      <div class="bar"><button class="chip" id="fmCopy">Copier le plan</button><button class="link" id="fmReset">Nouvelle analyse</button></div>
      <p class="msg" id="fmMsg"></p>
    </div>
  </div>
</div>

<div class="fpanel fiches" data-fp="fiches" hidden>
  ${FICHES.map(f => `<details data-fid="${f.id}"><summary>${f.t}</summary>${f.h}</details>`).join("")}
</div>

<div class="fpanel" data-fp="tools" hidden>
  <div class="fgrid">
    <div class="fbox" style="grid-column:1/-1">
      <h3>Taille de lot avec spread et commission</h3>
      <div class="fields f3">
        <label>Capital<input id="flCap" type="number" min="0" step="any"></label>
        <label>Risque (%)<input id="flRisk" type="number" min="0" step="0.05"></label>
        <label>Commission par lot (aller-retour)<input id="flCom" type="number" min="0" step="any"></label>
        <label>Actif<select id="flAsset"></select></label>
        <label>Stop (pips / points)<input id="flSl" type="number" min="0" step="any"></label>
        <label>Spread (pips / points)<input id="flSpread" type="number" min="0" step="any"></label>
        <label>ou prix d'entrée<input id="flEntry" type="number" step="any"></label>
        <label>et prix du stop<input id="flStop" type="number" step="any"></label>
        <label>Pas de lot<select id="flStep"><option value="0.01">0,01</option><option value="0.1">0,1</option><option value="1">1</option></select></label>
      </div>
      <div class="fgrid">
        <div class="fres">
          <div class="row"><span>Montant risqué</span><b id="flAmt">–</b></div>
          <div class="row"><span>Stop + spread</span><span id="flPips">–</span></div>
          <div class="row"><span>Lots sans spread ni commission</span><span id="flRaw">–</span></div>
          <div class="row"><span>Lots avec spread</span><span id="flTheo">–</span></div>
          <div class="row"><span>Commission</span><span id="flComAmt">–</span></div>
        </div>
        <div class="fres">
          <span class="small">Lot à entrer dans MT5</span>
          <span class="fbig" id="flLots">–</span>
          <div class="row"><span>Risque réel (stop + spread + commission)</span><span class="loss" id="flReal">–</span></div>
          <p class="small" id="flNote"></p>
        </div>
      </div>
      <details><summary>Mes actifs : valeur d'un pip pour 1 lot (à vérifier dans MT5)</summary>
        <p class="small">Valeur en devise de ton compte. Sur MT5 : clic droit sur le symbole &gt; Spécification (taille du contrat × taille du pip), ou un calculateur de valeur du pip. Les paires XXX/JPY, CHF, CAD, GBP, AUD, NZD changent avec le taux de change : mets-les à jour de temps en temps.</p>
        <div class="scroll"><table class="atab"><thead><tr><th>Actif</th><th>Taille du pip</th><th>Valeur pip / lot</th><th>Spread habituel</th><th></th></tr></thead><tbody id="flTable"></tbody></table></div>
        <div class="fields f3" style="margin-top:10px">
          <label>Nouvel actif<input id="faName" type="text" placeholder="ex. USDMXN"></label>
          <label>Taille du pip<input id="faPip" type="number" step="any" placeholder="0.0001"></label>
          <label>Valeur pip / lot<input id="faVal" type="number" step="any" placeholder="0.48"></label>
        </div>
        <div class="bar"><button class="chip" id="faAdd">Ajouter l'actif</button><span class="msg" id="faMsg"></span></div>
      </details>
    </div>

    <div class="fbox">
      <h3>Niveaux TradingView → MT5 (spread)</h3>
      <div class="seg" id="fmtDir"><button data-d="1" aria-pressed="true">Achat</button><button data-d="-1" aria-pressed="false">Vente</button></div>
      <div class="fields">
        <label>Spread (en prix, ex. 0.00010)<input id="fmtSpread" type="number" step="any"></label>
        <label>Entrée (TradingView)<input id="fmtEntry" type="number" step="any"></label>
        <label>Stop (TradingView)<input id="fmtSl" type="number" step="any"></label>
        <label>Objectif (TradingView)<input id="fmtTp" type="number" step="any"></label>
      </div>
      <div class="fres">
        <div class="row"><span>Entrée à saisir</span><b id="fmtE">–</b></div>
        <div class="row"><span>Stop à saisir</span><b id="fmtS">–</b></div>
        <div class="row"><span>Objectif à saisir</span><b id="fmtT">–</b></div>
      </div>
      <p class="small">Achat : entrée + spread, stop et objectif inchangés. Vente : entrée inchangée, stop et objectif + spread.</p>
    </div>

    <div class="fbox">
      <h3>Règle des 30 : UT du signal</h3>
      <label>UT du POI<select id="f30"></select></label>
      <div class="fres"><span class="small">Cherche le signal d'entrée en</span><span class="fbig" id="f30Out">–</span><p class="small" id="f30Note"></p></div>
    </div>

    <div class="fbox">
      <h3>Paliers de drawdown</h3>
      <div class="fields">
        <label>Capital de départ du palier<input id="fdStart" type="number" step="any"></label>
        <label>Risque de base (%)<input id="fdRisk" type="number" step="0.05"></label>
        <label>Capital actuel<input id="fdNow" type="number" step="any"></label>
        <label>Seuils (R) DD / DU<input id="fdK" type="text" value="4 / 20"></label>
      </div>
      <button class="link" id="fdSim">Prendre les chiffres du simulateur</button>
      <div class="fres"><span class="small">Risque à appliquer maintenant</span><span class="fbig" id="fdOut">–</span></div>
      <div class="scroll"><table class="ftab"><thead><tr><th>Palier</th><th>À partir de</th><th>Risque</th></tr></thead><tbody id="fdTable"></tbody></table></div>
    </div>
  </div>
</div>

<div class="fpanel" data-fp="quiz" hidden>
  <p class="small">Clique sur une réponse. Score : <b id="fqScore">0 / ${QUIZ.length}</b> <button class="link" id="fqReset">Recommencer</button></p>
  <div id="fqList" class="fsteps"></div>
</div>`;

  const $ = id => root.querySelector("#" + id);
  // onglets
  const tabs = root.querySelectorAll("[data-ft]");
  const show = t => {
    tabs.forEach(b => b.setAttribute("aria-pressed", b.dataset.ft === t ? "true" : "false"));
    root.querySelectorAll("[data-fp]").forEach(p => p.hidden = p.dataset.fp !== t);
    F.tab = t; fsave();
  };
  tabs.forEach(b => b.onclick = () => show(b.dataset.ft));
  show(F.tab || "method");

  // ---- méthode
  F.m = F.m || {};
  const m = F.m;
  ["fmAsset", "fmTf", "fmProfile", "fmNotes"].forEach(id => { $(id).value = m[id] || ""; $(id).addEventListener("input", () => { m[id] = $(id).value; fsave(); }); });
  const renderSteps = () => {
    $("fmSteps").innerHTML = STEPS.map((s, i) => {
      const done = s.items.every((_, j) => m["s" + i + "_" + j]);
      return `<div class="fstep${done ? " done" : ""}"><h3>${s.t}${done ? " ✓" : ""}</h3>${s.items.map((it, j) =>
        `<label class="fcheck"><input type="checkbox" data-s="s${i}_${j}" ${m["s" + i + "_" + j] ? "checked" : ""}>${esc(it)}</label>`).join("")}</div>`;
    }).join("");
    $("fmHp").innerHTML = HP.map((h, i) => `<label class="fcheck"><input type="checkbox" data-s="hp${i}" ${m["hp" + i] ? "checked" : ""}>${esc(h)}</label>`).join("");
    const n = HP.filter((_, i) => m["hp" + i]).length;
    const v = $("fmVerdict");
    v.textContent = n === 5 ? "5 / 5 : setup à haute probabilité, risque normal." : n === 4 ? "4 / 5 : correct, tu peux réduire le risque." : `${n} / 5 : on passe son tour.`;
    v.style.color = n === 5 ? "var(--gain)" : n === 4 ? "var(--warn)" : "var(--loss)";
  };
  root.querySelector('[data-fp="method"]').addEventListener("change", e => {
    const k = e.target?.dataset?.s; if (!k) return; m[k] = e.target.checked; fsave(); renderSteps();
  });
  renderSteps();
  $("fmReset").onclick = () => { F.m = {}; fsave(); render(root); };
  $("fmCopy").onclick = async () => {
    const n = HP.filter((_, i) => m["hp" + i]).length;
    const lines = [`Plan de trade ${m.fmAsset || ""} (${m.fmTf || "UT ?"}) ${m.fmProfile ? "· " + m.fmProfile : ""}`.trim(),
      ...STEPS.map((s, i) => `${s.t} : ${s.items.filter((_, j) => m["s" + i + "_" + j]).length}/${s.items.length}`),
      `Setup HP : ${n}/5`, m.fmNotes ? "Notes : " + m.fmNotes : ""].filter(Boolean);
    try { await navigator.clipboard.writeText(lines.join("\n")); $("fmMsg").textContent = "Plan copié."; } catch (e) { $("fmMsg").textContent = "Copie impossible dans ce navigateur."; }
  };

  // ---- calculateur de lot
  const L = F.lot = Object.assign({ cap: "", risk: 1, com: 7, asset: "p0", sl: "", spread: "", step: "0.01" }, F.lot || {});
  try { const s = JSON.parse(localStorage.getItem("atelier-trading-v1")); if (!L.cap && s?.balance) L.cap = Math.round(s.balance); } catch (e) {}
  if (!L.cap) L.cap = 10000;
  const fillAssets = () => {
    const list = allAssets();
    $("flAsset").innerHTML = list.map(a => `<option value="${a.id}">${esc(a.n)}</option>`).join("");
    if (!list.find(a => a.id === L.asset)) L.asset = "p0";
    $("flAsset").value = L.asset;
    $("flTable").innerHTML = list.map(a => `<tr class="${a.id === L.asset ? "sel" : ""}"><td>${esc(a.n)}</td>
      <td><input type="number" step="any" data-a="${a.id}" data-k="pip" value="${a.pip}"></td>
      <td><input type="number" step="any" data-a="${a.id}" data-k="v" value="${a.v}"></td>
      <td><input type="number" step="any" data-a="${a.id}" data-k="spread" value="${a.spread ?? ""}"></td>
      <td>${a.custom ? `<button data-del="${a.id}">Retirer</button>` : ""}</td></tr>`).join("");
  };
  const cur = () => allAssets().find(a => a.id === L.asset) || allAssets()[0];
  const lotCalc = () => {
    const a = cur();
    const cap = num(L.cap), risk = num(L.risk), com = num(L.com) || 0, spread = num(L.spread) || 0;
    let sl = num(L.sl);
    const e = num($("flEntry").value), s = num($("flStop").value);
    if (Number.isFinite(e) && Number.isFinite(s) && e !== s && a.pip > 0) { sl = Math.abs(e - s) / a.pip; $("flSl").value = +sl.toFixed(2); L.sl = $("flSl").value; }
    const amt = cap * risk / 100, pips = sl + spread, step = num(L.step) || 0.01;
    $("flAmt").textContent = Number.isFinite(amt) ? fx(amt) : "–";
    if (!(amt > 0) || !(sl > 0) || !(a.v > 0)) {
      ["flPips", "flRaw", "flTheo", "flComAmt", "flLots", "flReal"].forEach(i => $(i).textContent = "–");
      $("flNote").textContent = "Renseigne le capital, le risque et le stop (en pips, ou avec les prix d'entrée et de stop)."; return;
    }
    const raw = amt / (sl * a.v), theo = amt / (pips * a.v), real = amt / (pips * a.v + com);
    const lots = Math.floor(real / step + 1e-9) * step;
    $("flPips").textContent = fx(pips, 2) + " pips";
    $("flRaw").textContent = fx(raw, 2);
    $("flTheo").textContent = fx(theo, 2);
    $("flComAmt").textContent = fx(theo * com) + " pour " + fx(theo, 2) + " lot";
    $("flLots").textContent = lots > 0 ? fx(lots, step < 0.1 ? 2 : step < 1 ? 1 : 0) : "0";
    $("flReal").textContent = lots > 0 ? fx(lots * (pips * a.v + com)) + " (" + fx(lots * (pips * a.v + com) / cap * 100, 2) + " %)" : "–";
    $("flNote").textContent = lots > 0 ? `Arrondi vers le bas au pas de ${String(step).replace(".", ",")} lot pour ne jamais dépasser le risque prévu.` : "Le lot minimal dépasse ton risque : élargis le risque ou réduis le stop.";
  };
  const bindL = (id, k) => { $(id).value = L[k]; $(id).addEventListener("input", () => { L[k] = $(id).value; fsave(); lotCalc(); }); };
  bindL("flCap", "cap"); bindL("flRisk", "risk"); bindL("flCom", "com"); bindL("flSl", "sl"); bindL("flSpread", "spread"); bindL("flStep", "step");
  ["flEntry", "flStop"].forEach(id => $(id).addEventListener("input", lotCalc));
  fillAssets();
  $("flAsset").addEventListener("change", () => {
    L.asset = $("flAsset").value; const a = cur();
    if (a.spread != null && a.spread !== "") { L.spread = a.spread; $("flSpread").value = a.spread; }
    fsave(); fillAssets(); lotCalc();
  });
  $("flTable").addEventListener("change", e => {
    const t = e.target; if (!t.dataset?.a) return;
    const id = t.dataset.a, k = t.dataset.k, v = num(t.value);
    if (!Number.isFinite(v)) return;
    if (id[0] === "p") { F.assetOver = F.assetOver || {}; const i = +id.slice(1); F.assetOver[i] = { ...(F.assetOver[i] || {}), [k]: v }; }
    else { const i = +id.slice(1); F.custom[i][k] = v; }
    fsave(); lotCalc();
  });
  $("flTable").addEventListener("click", e => {
    const id = e.target?.dataset?.del; if (!id) return;
    F.custom.splice(+id.slice(1), 1); if (L.asset === id) L.asset = "p0"; fsave(); fillAssets(); lotCalc();
  });
  $("faAdd").onclick = () => {
    const n = $("faName").value.trim(), pip = num($("faPip").value), v = num($("faVal").value);
    if (!n || !(pip > 0) || !(v > 0)) { $("faMsg").textContent = "Nom, taille du pip et valeur du pip sont nécessaires."; return; }
    F.custom = F.custom || []; F.custom.push({ n, pip, v, spread: "" });
    L.asset = "c" + (F.custom.length - 1); fsave(); fillAssets(); lotCalc();
    $("faMsg").textContent = n + " ajouté."; ["faName", "faPip", "faVal"].forEach(i => $(i).value = "");
  };
  lotCalc();

  // ---- niveaux MT5
  let dir = 1;
  root.querySelectorAll("#fmtDir button").forEach(b => b.onclick = () => {
    dir = +b.dataset.d; root.querySelectorAll("#fmtDir button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); mt();
  });
  const dec = v => { const s = String(v); return s.includes(".") ? s.split(".")[1].length : 0; };
  const mt = () => {
    const sp = num($("fmtSpread").value) || 0, vals = ["fmtEntry", "fmtSl", "fmtTp"].map(i => num($(i).value));
    const d = Math.max(dec($("fmtSpread").value), ...["fmtEntry", "fmtSl", "fmtTp"].map(i => dec($(i).value)));
    const out = (v, add) => Number.isFinite(v) ? (v + (add ? sp : 0)).toFixed(d) : "–";
    $("fmtE").textContent = out(vals[0], dir === 1);
    $("fmtS").textContent = out(vals[1], dir === -1);
    $("fmtT").textContent = out(vals[2], dir === -1);
  };
  ["fmtSpread", "fmtEntry", "fmtSl", "fmtTp"].forEach(i => $(i).addEventListener("input", mt));

  // ---- règle des 30
  const TFS = [["Mensuel", 43200], ["Hebdo", 10080], ["Daily", 1440], ["H12", 720], ["H4", 240], ["H1", 60], ["M30", 30], ["M15", 15], ["M5", 5], ["M1", 1]];
  $("f30").innerHTML = TFS.map(([n, v]) => `<option value="${v}">${n}</option>`).join("");
  $("f30").value = F.tf30 || 60;
  const nice = min => {
    const s = min * 60;
    if (s < 60) return Math.round(s) + " secondes (S" + Math.round(s) + ")";
    if (min < 60) return (Math.round(min * 10) / 10).toString().replace(".", ",") + " minutes (M" + Math.round(min) + ")";
    if (min < 1440) return (Math.round(min / 6) / 10).toString().replace(".", ",") + " heure(s) (" + Math.round(min) + " min)";
    return (Math.round(min / 144) / 10).toString().replace(".", ",") + " jour(s)";
  };
  const r30 = () => {
    const v = +$("f30").value; F.tf30 = v; fsave();
    $("f30Out").textContent = nice(v / 30);
    $("f30Note").textContent = "Sur TradingView, tu peux créer cette unité de temps personnalisée (menu des UT > ajouter). Si elle n'existe pas sur ton broker, prends la plus proche.";
  };
  $("f30").addEventListener("change", r30); r30();

  // ---- paliers de drawdown
  const D = F.dd = Object.assign({ start: 10000, risk: 1, now: "", k: "4 / 20" }, F.dd || {});
  const bindD = (id, k) => { $(id).value = D[k]; $(id).addEventListener("input", () => { D[k] = $(id).value; fsave(); dd(); }); };
  bindD("fdStart", "start"); bindD("fdRisk", "risk"); bindD("fdNow", "now"); bindD("fdK", "k");
  $("fdSim").onclick = () => {
    try { const s = JSON.parse(localStorage.getItem("atelier-trading-v1")); if (s?.balance) { D.start = Math.round(s.start); D.now = Math.round(s.balance); $("fdStart").value = D.start; $("fdNow").value = D.now; fsave(); dd(); } }
    catch (e) {}
  };
  const dd = () => {
    const c0 = num(D.start), r0 = num(D.risk) / 100, now = num(D.now);
    const [kdd, kdu] = String(D.k).split(/[\/;]/).map(num);
    if (!(c0 > 0) || !(r0 > 0)) { $("fdTable").innerHTML = ""; $("fdOut").textContent = "–"; return; }
    const KD = kdd > 0 ? kdd : 4, KU = kdu > 0 ? kdu : 20;
    const rows = [{ n: "DU1", from: c0 * (1 + KU * r0), r: r0 * 2, up: true }, { n: "Départ", from: c0, r: r0 }];
    let c = c0, r = r0;
    for (let i = 1; i <= 4; i++) { c = c * (1 - KD * r); r = r / 2; rows.push({ n: "DD" + i, from: c, r }); }
    $("fdTable").innerHTML = rows.map(x => `<tr><td>${x.n}</td><td>${x.up ? "≥ " : x.n === "Départ" ? "" : "≤ "}${fx(x.from, 0)}</td><td>${fx(x.r * 100, 3).replace(/0+$/, "").replace(/,$/, "")} %</td></tr>`).join("");
    if (!(now > 0)) { $("fdOut").textContent = fx(r0 * 100, 2) + " %"; return; }
    let pick = rows[1];
    if (now >= rows[0].from) pick = rows[0];
    else for (const x of rows.slice(2)) if (now <= x.from) pick = x;
    $("fdOut").textContent = fx(pick.r * 100, 3).replace(/0+$/, "").replace(/,$/, "") + " % (" + pick.n + ")";
  };
  dd();

  // ---- quiz
  F.q = F.q || {};
  const rq = () => {
    $("fqList").innerHTML = QUIZ.map((q, i) => {
      const ans = F.q[i];
      return `<div class="fq"><p><b>${i + 1}.</b> ${esc(q.q)}</p><div class="opts">${q.a.map((a, j) =>
        `<button data-q="${i}" data-j="${j}" class="${ans == null ? "" : j === q.ok ? "good" : j === ans ? "bad" : ""}">${esc(a)}</button>`).join("")}</div>
        ${ans != null ? `<p class="small">${ans === q.ok ? "Juste." : "Pas tout à fait."} ${esc(q.why)}</p>` : ""}</div>`;
    }).join("");
    $("fqScore").textContent = QUIZ.filter((q, i) => F.q[i] === q.ok).length + " / " + QUIZ.length;
  };
  $("fqList").addEventListener("click", e => {
    const b = e.target.closest("button[data-q]"); if (!b) return;
    const i = +b.dataset.q; if (F.q[i] != null) return;
    F.q[i] = +b.dataset.j; fsave(); rq();
  });
  $("fqReset").onclick = () => { F.q = {}; fsave(); rq(); };
  rq();
}

const mount = () => { const root = document.getElementById("formation"); if (root) render(root); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
