import { Hono } from "hono";
import type { AppContext } from "./env";
import { csrfGuard } from "./auth/middleware";
import authRoutes from "./routes/auth";
import apiRoutes from "./routes/plan";

const app = new Hono<AppContext>();

// CSRF guard on every state-changing API request.
app.use("/api/*", csrfGuard);

app.route("/api/auth", authRoutes);
app.route("/api", apiRoutes); // /api/me, /api/plan, /api/account

// Unknown API route → JSON 404 (don't fall through to static assets).
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Everything else: serve the static front-end. With run_worker_first scoped to
// /api/*, most asset requests never reach the Worker; this is a safety net.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Last-resort handler so an unexpected throw (e.g. a DB error) returns a clean JSON
// envelope instead of leaking a stack trace in Hono's default 500.
app.onError((_err, c) => c.json({ error: "server_error" }, 500));

export default app;
