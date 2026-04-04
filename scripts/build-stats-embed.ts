import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WIDGET_DIR = join(ROOT, "widget");

const statsJson = JSON.stringify(JSON.parse(readFileSync(join(WIDGET_DIR, "data", "stats.json"), "utf8")));
const pricingJson = JSON.stringify(JSON.parse(readFileSync(join(WIDGET_DIR, "data", "pricing.json"), "utf8")));
const src = readFileSync(join(WIDGET_DIR, "stats.html"), "utf8");

// Extract the <style> content (without html/body rules)
const styleMatch = src.match(/<style>([\s\S]*?)<\/style>/);
let css = styleMatch ? styleMatch[1] : "";
// Remove html/body rules
css = css.replace(/html,\s*body\s*\{[^}]*\}/g, "");
css = css.replace(/body\s*\{[^}]*\}/g, "");
css = css.replace(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*html,\s*body\s*\{[^}]*\}\s*\}/g, "");
css = css.trim();

// Extract HTML between <body> and first <script>
const htmlMatch = src.match(/<body[^>]*>([\s\S]*?)<script>/);
const html = htmlMatch ? htmlMatch[1].trim() : "";

// Extract the JS
const scriptMatch = src.match(/<script>([\s\S]*?)<\/script>/);
let js = scriptMatch ? scriptMatch[1] : "";

// Inline the data
js = js.replace(
  /\/\*INLINE_DATA_START\*\/[\s\S]*?\/\*INLINE_DATA_END\*\//,
  `var INLINE_STATS = ${statsJson};\nvar INLINE_PRICING = ${pricingJson};`
);

// Replace the fetch fallback with direct boot
js = js.replace(
  /if \(INLINE_STATS && INLINE_PRICING\) \{[\s\S]*?canvas\.parentNode\.insertBefore\(el, canvas\);\s*\}\);/,
  "boot(INLINE_STATS, INLINE_PRICING);"
);

const embed = `<style>
${css}
</style>

${html}

<script>
${js}
</script>`;

const outPath = join(WIDGET_DIR, "stats-embed.html");
writeFileSync(outPath, embed);
console.log(`Wrote ${(embed.length / 1024).toFixed(1)}KB to ${outPath}`);
