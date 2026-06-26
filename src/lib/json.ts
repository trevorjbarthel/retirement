import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Uniform JSON error envelope: { error: "<code>", message?: "..." }. */
export function jsonError(
  c: Context,
  code: string,
  status: ContentfulStatusCode,
  message?: string,
) {
  return c.json(message ? { error: code, message } : { error: code }, status);
}
