// Construit atelier-trading-autonome.html (un seul fichier, sans serveur) à partir de index.html :
// Lightweight Charts et app.js (avec formation.js et le SDK Anthropic) sont intégrés dans la page.
// Utilisation : npx esbuild@0.25.0 --version (une fois), puis node scripts/build-autonome.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");
const lw = readFileSync("vendor/lightweight-charts.standalone.production.js", "utf8");
const bundle = execFileSync("npx", ["--yes", "esbuild@0.25.0", "app.js", "--bundle", "--format=iife", "--minify", "--charset=utf8"], { maxBuffer: 64 << 20 }).toString();
const safe = s => s.replace(/<\/script/gi, "<\\/script");
const head = html.slice(0, html.indexOf('<script src="vendor/lightweight-charts'));
const out = head + "<script>" + safe(lw) + "</script>\n" +
  '<script src="https://s3.tradingview.com/tv.js"></script>\n' +
  "<script>" + safe(bundle) + "</script>\n</body></html>\n";
writeFileSync("atelier-trading-autonome.html", out);
console.log("atelier-trading-autonome.html", out.length, "octets");
