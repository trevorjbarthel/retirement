// Best-effort request throttling on the Cloudflare Rate Limiting binding. Shared by the plan
// API and the calendar feed so every read path is throttled the same way — the feed used to
// be the one public read with no limiter at all.

// Warn ONCE per isolate when a limiter we expect to exist isn't bound. `throttled()` fails
// open in three separate ways (dev mode, missing binding, thrown call) and previously
// emitted no signal at all for any of them — so an unprovisioned or renamed binding meant
// silently unlimited writes, indistinguishable from a working limiter.
const warnedLimiters = new Set<string>();
function warnMissingLimiter(name: string) {
  if (warnedLimiters.has(name)) return;
  warnedLimiters.add(name);
  console.warn(`[rate-limit] ${name} is not bound — requests are NOT being throttled. Check unsafe.bindings in wrangler.jsonc.`);
}

// No-op when the given limiter isn't bound (local dev / tests / unprovisioned deploy); never
// blocks on a limiter failure.
//
// `extraKey` lets a route throttle on something other than the IP. Keying writes on the
// PLAN ID as well as the IP matters for this audience specifically: a base network NATs
// thousands of people behind one address, so a purely IP-keyed limit both punishes innocent
// neighbours and lets one attacker with many addresses hammer a single plan.
export async function throttled(c: any, limiter: any, keyPrefix: string, extraKey?: string): Promise<boolean> {
  if (c.env.APP_ENV === "development") return false; // skip in local dev / tests
  if (!limiter) { warnMissingLimiter(keyPrefix.toUpperCase() + "_LIMITER"); return false; }
  const ip = c.req.header("cf-connecting-ip") ?? "ip-unknown";
  const key = extraKey ? `${keyPrefix}:${ip}:${extraKey}` : `${keyPrefix}:${ip}`;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (e) {
    // Swallowed deliberately — a limiter outage must not take the API down — but no longer
    // silently: an operator needs to be able to see it in the logs.
    console.warn(`[rate-limit] ${keyPrefix} limiter threw, failing open:`, (e as Error)?.message ?? e);
    return false;
  }
}
