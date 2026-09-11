// Loads the real index.html into happy-dom before each test file, so the modules find every
// element they expect by id — the same markup that ships, not a hand-written stand-in.
//
// `fetch` is stubbed to a never-resolving promise: no test here should reach the network, and
// store.js's own timeout (API_TIMEOUT_MS) is what a stalled request is supposed to hit.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, vi } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
const bodyInner = body.slice(body.indexOf(">") + 1).replace(/<script[^>]*><\/script>/g, "");

beforeEach(() => {
  document.body.innerHTML = bodyInner;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  // happy-dom implements <dialog> but not showModal() in every version; the app checks for it.
  const dlg = document.getElementById("appModal") as any;
  if (dlg && typeof dlg.showModal !== "function") {
    dlg.showModal = function () { this.open = true; };
    dlg.close = function (v?: string) { this.returnValue = v ?? ""; this.open = false; this.dispatchEvent(new Event("close")); };
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  }
  if (!("requestAnimationFrame" in globalThis)) {
    (globalThis as any).requestAnimationFrame = (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0);
    (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});
