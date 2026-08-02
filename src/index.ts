import { Hono } from "hono";
import type { AppContext } from "./env";
import apiRoutes from "./routes/plan";
import calendarRoutes from "./routes/calendar";

const app = new Hono<AppContext>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error" }, 500);
});

// `public/_headers` applies to STATIC ASSET responses only — it does not touch responses
// the Worker generates, so every API response was previously served with no cache directive
// at all. GET /api/p/:id returns a complete personal plan (name, rank, dates, location, TSP
// balance, VA rating); on a shared or kiosk machine an intermediary or the browser's back/
// forward cache could retain it. Belt and braces on the whole API surface.
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
  c.header("Pragma", "no-cache");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
});

// Plan API: POST /api/p, GET /api/p/:id, PUT /api/p/:id, DELETE /api/p/:id.
// No accounts: a plan's secret id+edit-key in the URL are the only credential, so
// there's no session/CSRF surface for cross-site requests to forge.
app.route("/api", apiRoutes);

// Subscribable calendar feed for a plan. Deliberately outside /api so it can be handed to a
// calendar client as a webcal:// URL. Read-only, keyed on the same public id as /p/<id>.
app.route("/p", calendarRoutes);

// Unknown API route -> JSON 404 (don't fall through to static assets).
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Everything else: serve the static front-end. With run_worker_first scoped to /api/*,
// most asset requests never reach the Worker; SPA fallback serves index.html for /p/<id>.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
