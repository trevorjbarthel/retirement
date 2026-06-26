// Reset-token utilities. The raw token is high-entropy random bytes (only ever sent in
// the email link); the database stores its SHA-256 so a DB leak yields no usable tokens.
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new URL-safe reset token (256 bits of entropy). */
export function generateResetToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** base64url SHA-256 of the raw token — what we persist and compare against. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return b64url(new Uint8Array(digest));
}
