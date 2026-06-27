// URL-safe capability tokens. Plan ids and edit keys are high-entropy random bytes; the
// edit key is stored only as its SHA-256 so a DB read can't recover edit capability.
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A random URL-safe token. 12 bytes ≈ 16 chars (96 bits) — unguessable, still short. */
export function randomToken(bytes = 12): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** base64url SHA-256 of a token — what we persist and compare against. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return b64url(new Uint8Array(digest));
}
