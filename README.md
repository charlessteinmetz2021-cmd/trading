# Atelier de trading

Site d'entraînement au trading, en simulation avec de l'argent fictif.

- Graphiques en temps réel (TradingView) : Bitcoin, or, Nasdaq 100, avec outils de dessin et indicateurs
- Ticket d'ordre : achat / vente au marché ou limite, stop loss, take profit, levier
- Compte fictif, positions ouvertes, ordres en attente, historique et statistiques (enregistrés dans le navigateur)
- Graphique maison (Lightweight Charts) pour le Bitcoin et l'or, avec outils de dessin (ligne horizontale, tendance, Fibonacci)
- Lignes colorées entrée / stop / objectif, SL et TP déplaçables à la souris
- Panneau d'indicateurs : moyennes mobiles, EMA, Bollinger, Ichimoku, VWAP, Parabolic SAR, Supertrend, pivots, volume, RSI, MACD, stochastique, ATR
- Analyse par Claude (clé API personnelle, stockée dans le navigateur) : lecture de chaque indicateur, niveaux tracés sur le graphique, idée de trade
- Calculateur de taille de position et de ratio risque / rendement

## Utilisation

Site en ligne : https://charlessteinmetz2021-cmd.github.io/trading/

Pour l'utiliser sans connexion au site, télécharge `atelier-trading-autonome.html` (tout est dans un seul fichier) et ouvre-le dans un navigateur. `index.html` seul ne marche pas en double-cliquant dessus, car il charge `app.js`.

Prix en direct : Bitcoin et or (jeton PAXG) via le flux public de Binance. Le prix du Nasdaq se saisit à la main.

> Simulation uniquement : aucun ordre réel n'est passé.

## Fichiers

- `index.html` : la page
- `app.js` : simulation, graphique, dessins, appel à Claude
- `indicators.js` : calcul des indicateurs
- `vendor/` : Lightweight Charts 5.2.1 (licence Apache 2.0) et le SDK Anthropic 1.4.0 empaqueté pour le navigateur
