// Guards the CSP. `script-src 'self'; style-src 'self'` only holds while the shipped HTML and
// JS contain no inline <script>, no inline <style>, no style="..." attribute, and no
// third-party origin. Any one of those reappearing would break the page in production while
// working fine in a dev server that doesn't apply _headers — the worst possible failure mode.
//
// This runs in `npm run typecheck`, so CI catches it before deploy.
import { readFileSync } from "node:fs";

const FILES = ["public/index.html", "public/js/app.js", "public/css/app.css"];
const failures = [];

// Blank out comment bodies (keeping newlines so line numbers stay correct) before scanning.
// Comments in these files legitimately DESCRIBE the rules below — a doc comment saying
// 'no style="" attributes' must not be reported as a style attribute.
function stripComments(src) {
  const keepNewlines = (m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines) // /* block */
    .replace(/<!--[\s\S]*?-->/g, keepNewlines) // <!-- html -->
    .replace(/^[ \t]*\/\/.*$/gm, keepNewlines); // // line
}

function check(file, re, message) {
  const src = stripComments(readFileSync(file, "utf8"));
  src.split("\n").forEach((line, i) => {
    if (!re.test(line)) return;
    failures.push(`${file}:${i + 1}  ${message}\n    ${line.trim().slice(0, 140)}`);
  });
}

// 1. No inline style attributes anywhere (markup or JS template strings).
for (const f of FILES) check(f, /style="/, "inline style attribute — use a class, or a data-css-* hint applied by paintDynamicStyles()");

// 2. No inline <script> or <style> element in the HTML.
check("public/index.html", /<script(?![^>]*\bsrc=)[^>]*>/, "inline <script> — move it into public/js/");
check("public/index.html", /<style[\s>]/, "inline <style> — move it into public/css/app.css");

// 3. No third-party origins. Everything must be same-origin for default-src 'none' to hold.
const THIRD_PARTY = /^(https?:)?\/\/(?!localhost)[a-z0-9.-]+\.[a-z]{2,}/i;
for (const f of ["public/index.html", "public/css/app.css"]) {
  const src = stripComments(readFileSync(f, "utf8"));
  src.split("\n").forEach((line, i) => {
    // Anchors to external documentation are fine — they are navigations, not subresource
    // loads, and are constrained by form-action / frame-ancestors instead. Only flag what
    // the browser would FETCH. `data:` URIs are same-document by definition (img-src allows
    // them explicitly) — the favicon is one, and it embeds an xmlns URL that is a namespace
    // identifier, not a request.
    const attrs = line.match(/(?:src|href)="([^"]+)"/g) || [];
    for (const attr of attrs) {
      const url = attr.slice(attr.indexOf('"') + 1, -1);
      if (url.startsWith("data:")) continue;
      if (!THIRD_PARTY.test(url)) continue;
      if (/<a\s/i.test(line)) continue; // user-facing link, not a subresource
      failures.push(`${f}:${i + 1}  third-party subresource — self-host it\n    ${url}`);
    }
  });
  // url(...) in CSS is always a fetch, so it has no anchor exemption.
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
      if (m[1].startsWith("data:")) continue;
      if (THIRD_PARTY.test(m[1])) failures.push(`${f}:${i + 1}  third-party CSS url() — self-host it\n    ${m[1]}`);
    }
  });
}

if (failures.length) {
  console.error("CSP guard failed — these would break under `script-src 'self'; style-src 'self'`:\n");
  for (const f of failures) console.error("  " + f + "\n");
  process.exit(1);
}
console.log("CSP guard: no inline scripts/styles and no third-party subresources.");
