// Input validation helpers — kept dependency-free so they're trivially testable.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Pragmatic email check: one @, no spaces, a dot in the domain, length-capped.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Returns a human-readable problem with the password, or null if acceptable.
 * Self-contained accounts → enforce a meaningful minimum (12 chars) without
 * being annoying about composition.
 */
export function passwordIssue(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (pw.length > 200) return "Password must be 200 characters or fewer.";
  if (/^(.)\1+$/.test(pw)) return "Please choose a less predictable password.";
  return null;
}
