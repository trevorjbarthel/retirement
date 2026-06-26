// Self-contained password hashing using Web Crypto (available in the Workers
// runtime). PBKDF2-HMAC-SHA-256 — scrypt/argon2 are NOT available in
// crypto.subtle, so PBKDF2 is the correct self-contained choice.

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export interface PasswordHash {
  hash: string; // base64 of 256-bit derived key
  salt: string; // base64 of 16 random bytes
  iterations: number;
}

export async function hashPassword(password: string, iterations: number): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, iterations);
  return { hash: toB64(bits), salt: toB64(salt), iterations };
}

export async function verifyPassword(
  password: string,
  hashB64: string,
  saltB64: string,
  iterations: number,
): Promise<boolean> {
  const bits = await deriveBits(password, fromB64(saltB64), iterations);
  return timingSafeEqual(bits, fromB64(hashB64));
}

/** Length-independent constant-time comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
