// One-shot codemod: rewrite every STATIC style="..." attribute in index.html / app.js to a
// semantic class, and emit the matching CSS. Run once; kept in-tree so the mapping is
// auditable and the migration is reproducible rather than a 128-site hand edit.
//
// Dynamic styles (those interpolating a value) are left alone — they're converted by hand to
// the data-attribute + CSSOM pattern, which CSP permits.
//
// Usage: node scripts/inline-style-codemod.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";

// value  ->  class name. Every static value in the source must appear here; an unmapped one
// aborts the run rather than silently leaving an inline style behind.
const MAP = {
  "color:#c9a227;": "t-gold",
  "color: #c9a227;": "t-gold",
  "color:#a6841e;": "t-gold-dark",
  "color:#b91c1c;": "t-danger",
  "color:#ef4444;": "t-danger-bright",
  "color:#f59e0b;": "t-warn",
  "color:#047857;": "t-success",
  "color:#10b981;": "t-success-bright",
  "color:#3b82f6;": "t-info",
  "color:#1e40af;": "t-info-dark",
  "color:#3730a3;": "t-indigo",
  "color:#f5e199;": "t-gold-light",
  "color:#c9a227; font-weight:500;": "t-gold t-medium",

  "border-color:rgba(26,39,68,0.08);": "rule-soft",
  "border-color: rgba(26,39,68,0.08);": "rule-soft",
  "border-color:rgba(26,39,68,0.1);": "rule",
  "border-color:rgba(166,132,30,0.25);": "rule-gold",

  "background:#a6841e;": "btn-gold",
  "background:#1e40af;": "btn-blue",
  "background:#3730a3;": "btn-indigo",
  "background:#1a2744;": "swatch-navy",
  "background:#c9a227;": "swatch-gold",
  "background:#3468b0;": "swatch-sb",
  "background:#836616;": "swatch-ptdy",
  "background:#2d6a4f;": "swatch-leave",
  "background:#b91c1c;": "swatch-sep",
  "background:#f0f2f6;": "surface-muted",
  "background:#e9ecef;": "surface-track",
  "background:#fdf9ed;": "surface-gold",
  "background:#d1fae5;": "surface-success",
  "background:rgba(0,0,0,0.08);": "surface-scrim",

  "background:#dbeafe; color:#1e40af;": "chip-info",
  "background:#d1fae5; color:#047857;": "chip-success",
  "background:#fee2e2; color:#b91c1c;": "chip-danger",
  "background:#fef3c7; color:#92400e;": "chip-warn",
  "background:white; color:#047857;": "chip-success-inverse",
  "background:#e2e8f0; color:#475569;": "chip-neutral",
  "width:100%; background:#e2e8f0; color:#475569;": "chip-neutral w-full",

  "background:#fdf9ed; border:1px solid #f0d266;": "note-gold",
  "background:#fdf9ed; color:#92400e; border:1px solid #f0d266;": "note-gold note-gold-text",
  "background:#fef3c7; color:#b45309; border:1px solid #fcd34d;": "note-warn note-warn-alt",
  "background:#fef3c7; color:#92400e; border:1px solid #fcd34d;": "note-warn",
  "background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;": "note-danger",
  "background:#fee2e2; color:#991b1b; border:1px solid #fca5a5;": "note-danger note-danger-deep",
  "background:#dbeafe; border:1px solid #93c5fd;": "note-info",
  "background:#dbeafe; color:#1e40af; border:1px solid #93c5fd;": "note-info note-info-text",
  "background:#e0e7ff; border:1px solid #a5b4fc;": "note-indigo",
  "margin-bottom:0; background:#f8fafc; border:1px solid #e2e8f0;": "note-plain",
  "background:#f7f8fb; border:1px solid rgba(26,39,68,0.08); border-left:3px solid #c9a227;": "note-quote",

  "background: linear-gradient(135deg, #1a2744 0%, #2e3f66 100%); color: white;": "panel-navy",
  "background: linear-gradient(135deg, #1a2744 0%, #2e3f66 100%);": "panel-navy-plain",
  "background: linear-gradient(135deg, #c9a227 0%, #a6841e 100%);": "btn-gold-gradient",
  "background: #1a2744; color: #c9a227;": "btn-navy-gold",
  "width:0%; background: linear-gradient(90deg, #c9a227, #f5e199);": "meter-fill-gold",

  "padding:0; overflow:hidden;": "card-flush",
  "padding:8px 12px;": "pad-sm",
  "flex:1; min-width:150px;": "flex-card",
  "display:none;": "is-hidden",
  "font-family:monospace;": "mono",
  "width:300px;": "tip-300",
  "width:280px;": "tip-280",
  "width:0%;": "w-0",
  "max-width:110px;": "max-w-110",
  "background:#f0f2f6; grid-column: 1 / -1;": "surface-muted span-full",
  "max-width:640px;margin:2rem auto;padding:1rem 1.25rem;border:1px solid #c9a227;border-radius:12px;background:#fff;color:#1a2744;font-family:sans-serif;text-align:center;":
    "noscript-card",
};

const CSS = `
/* ===== Palette utilities =====
   These exist so no style="..." attribute is written into markup or into an innerHTML
   template. That is what lets the CSP drop \`style-src 'unsafe-inline'\`: with it enabled,
   any HTML an attacker manages to inject can also carry its own styling — enough to hide a
   warning banner or overlay a convincing fake dialog. Values are unchanged from the inline
   styles they replace; this is a mechanical migration (scripts/inline-style-codemod.mjs). */
.t-gold { color: #c9a227; }
.t-gold-dark { color: #a6841e; }
.t-gold-light { color: #f5e199; }
.t-danger { color: #b91c1c; }
.t-danger-bright { color: #ef4444; }
.t-warn { color: #f59e0b; }
.t-success { color: #047857; }
.t-success-bright { color: #10b981; }
.t-info { color: #3b82f6; }
.t-info-dark { color: #1e40af; }
.t-indigo { color: #3730a3; }
.t-medium { font-weight: 500; }

.rule-soft { border-color: rgba(26,39,68,0.08); }
.rule { border-color: rgba(26,39,68,0.1); }
.rule-gold { border-color: rgba(166,132,30,0.25); }

.btn-gold { background: #a6841e; }
.btn-blue { background: #1e40af; }
.btn-indigo { background: #3730a3; }
.btn-gold-gradient { background: linear-gradient(135deg, #c9a227 0%, #a6841e 100%); }
.btn-navy-gold { background: #1a2744; color: #c9a227; }

.swatch-navy { background: #1a2744; }
.swatch-gold { background: #c9a227; }
.swatch-sb { background: #3468b0; }
.swatch-ptdy { background: #836616; }
.swatch-leave { background: #2d6a4f; }
.swatch-sep { background: #b91c1c; }

.surface-muted { background: #f0f2f6; }
.surface-track { background: #e9ecef; }
.surface-gold { background: #fdf9ed; }
.surface-success { background: #d1fae5; }
.surface-scrim { background: rgba(0,0,0,0.08); }

.chip-info { background: #dbeafe; color: #1e40af; }
.chip-success { background: #d1fae5; color: #047857; }
.chip-success-inverse { background: #fff; color: #047857; }
.chip-danger { background: #fee2e2; color: #b91c1c; }
.chip-warn { background: #fef3c7; color: #92400e; }
.chip-neutral { background: #e2e8f0; color: #475569; }

.note-gold { background: #fdf9ed; border: 1px solid #f0d266; }
.note-gold-text { color: #92400e; }
.note-warn { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.note-warn-alt { color: #b45309; }
.note-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.note-danger-deep { color: #991b1b; }
.note-info { background: #dbeafe; border: 1px solid #93c5fd; }
.note-info-text { color: #1e40af; }
.note-indigo { background: #e0e7ff; border: 1px solid #a5b4fc; }
.note-plain { margin-bottom: 0; background: #f8fafc; border: 1px solid #e2e8f0; }
.note-quote { background: #f7f8fb; border: 1px solid rgba(26,39,68,0.08); border-left: 3px solid #c9a227; }

.panel-navy { background: linear-gradient(135deg, #1a2744 0%, #2e3f66 100%); color: #fff; }
.panel-navy-plain { background: linear-gradient(135deg, #1a2744 0%, #2e3f66 100%); }
.meter-fill-gold { width: 0%; background: linear-gradient(90deg, #c9a227, #f5e199); }

.card-flush { padding: 0; overflow: hidden; }
.pad-sm { padding: 8px 12px; }
.flex-card { flex: 1; min-width: 150px; }
.is-hidden { display: none; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.tip-300 { width: 300px; }
.tip-280 { width: 280px; }
.w-0 { width: 0%; }
.max-w-110 { max-width: 110px; }
.span-full { grid-column: 1 / -1; }
.noscript-card {
  max-width: 640px; margin: 2rem auto; padding: 1rem 1.25rem;
  border: 1px solid #c9a227; border-radius: 12px; background: #fff;
  color: #1a2744; font-family: sans-serif; text-align: center;
}
`;

const DRY = process.argv.includes("--dry");
const files = ["public/index.html", "public/js/app.js"];
let total = 0;
const unmapped = new Set();

for (const file of files) {
  let src = readFileSync(file, "utf8");
  src = src.replace(/(\s*)(class="([^"]*)"\s+)?style="([^"]*)"/g, (full, ws, classPart, existing, value) => {
    if (value.includes("${") || value.includes("' +") || value.includes('" +')) return full; // dynamic
    const cls = MAP[value];
    if (!cls) { unmapped.add(value); return full; }
    total++;
    return classPart ? `${ws}class="${existing} ${cls}"` : `${ws}class="${cls}"`;
  });
  // A style="" that PRECEDES class="" on the element needs the mirrored pass.
  src = src.replace(/style="([^"]*)"(\s+)class="([^"]*)"/g, (full, value, ws, existing) => {
    if (value.includes("${") || value.includes("' +") || value.includes('" +')) return full;
    const cls = MAP[value];
    if (!cls) { unmapped.add(value); return full; }
    total++;
    return `class="${cls} ${existing}"`;
  });
  // Anything left with no adjacent class attribute at all.
  src = src.replace(/style="([^"]*)"/g, (full, value) => {
    if (value.includes("${") || value.includes("' +") || value.includes('" +')) return full;
    const cls = MAP[value];
    if (!cls) { unmapped.add(value); return full; }
    total++;
    return `class="${cls}"`;
  });
  if (!DRY) writeFileSync(file, src, "utf8");
}

if (unmapped.size) {
  console.error("Unmapped static style values — add them to MAP before rerunning:");
  for (const v of unmapped) console.error("  " + v);
  process.exit(1);
}

if (!DRY) {
  const cssPath = "public/css/app.css";
  const css = readFileSync(cssPath, "utf8");
  if (!css.includes("===== Palette utilities =====")) {
    writeFileSync(cssPath, css.trimEnd() + "\n" + CSS, "utf8");
  }
}
console.log(`${DRY ? "[dry] " : ""}rewrote ${total} static style attributes.`);
