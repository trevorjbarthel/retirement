import { Hono } from "hono";
import type { AppContext } from "./env";
import apiRoutes from "./routes/plan";

const app = new Hono<AppContext>();

// Plan API: POST /api/p, GET /api/p/:id, PUT /api/p/:id.
// No accounts — a plan's secret id+edit-key in the URL are the only credential, so there's
// no session/CSRF surface: a cross-site attacker can't forge an unguessable capability token.
app.route("/api", apiRoutes);

// Unknown API route → JSON 404 (don't fall through to static assets).
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Everything else: serve the static front-end. With run_worker_first scoped to /api/*,
// most asset requests never reach the Worker; SPA fallback serves index.html for /p/<id>.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((_err, c) => c.json({ error: "server_error" }, 500));

export default app;
