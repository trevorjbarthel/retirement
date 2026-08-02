// ===== icons.js =====
// Drop-in replacement for the unpkg `lucide.createIcons()` global.
//
// Same authoring contract as before — write `<i data-lucide="flag" class="w-4 h-4">` and call
// createIcons() — but the path data is bundled (icons.generated.js) instead of fetched from a
// third-party CDN. That removes the last non-'self' entry from the CSP's script-src, drops
// ~93 KB gzipped, and means icons no longer depend on a network round-trip completing before
// the page looks finished.
//
// It also removes the 13 `typeof lucide !== 'undefined' && …` guards that existed only
// because the CDN script might not have loaded yet: this module is part of the module graph,
// so by the time anything calls createIcons() the data is guaranteed to be there.

import { ICON_PATHS } from './icons.generated.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Attributes copied straight from the placeholder onto the generated <svg>, so existing
// markup keeps working (sizing/colour come from the utility classes already in place).
const PASSTHROUGH = ['class', 'style', 'aria-label', 'aria-hidden', 'role', 'title', 'id'];

function buildIcon(name, source) {
  const paths = ICON_PATHS[name];
  if (!paths) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const attr of PASSTHROUGH) {
    const v = source.getAttribute(attr);
    if (v !== null) svg.setAttribute(attr, v);
  }
  // Decorative unless the author said otherwise — these sit beside real text labels
  // everywhere in this app, so announcing them would just double every heading.
  if (!source.hasAttribute('aria-label') && !source.hasAttribute('aria-hidden')) {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.classList.add('lucide', `lucide-${name}`);
  // ICON_PATHS is generated from lucide-static at build time — our own data, never user
  // input — so innerHTML here is not an injection sink.
  svg.innerHTML = paths;
  return svg;
}

/**
 * Replace every `[data-lucide]` placeholder under `root` with an inline SVG.
 * Safe to call repeatedly: elements are consumed as they're replaced.
 * @param {ParentNode} [root]
 */
export function createIcons(root = document) {
  const nodes = root.querySelectorAll('[data-lucide]');
  for (const el of nodes) {
    const name = el.getAttribute('data-lucide');
    if (!name) continue;
    const svg = buildIcon(name, el);
    if (!svg) {
      // A missing icon is a build-time bug (scripts/build-icons.mjs scans for names and
      // errors on unknown ones). Leave the placeholder and say so rather than failing the
      // whole render for one glyph.
      console.warn(`[icons] no path data for "${name}" — run: npm run build:icons`);
      continue;
    }
    el.replaceWith(svg);
  }
}

export { ICON_PATHS };
