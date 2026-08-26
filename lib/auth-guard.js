// Shared dashboard-auth check for API routes. Sends the error response
// itself and returns null on failure so callers can just
// `const auth = await requireAuth(req, res); if (!auth) return;`

const { readSession } = require("./session");
const { sendJson } = require("./http");

async function requireAuth(req, res, { role } = {}) {
  const session = readSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Not signed in" });
    return null;
  }
  if (role === "admin" && session.role !== "admin") {
    sendJson(res, 403, { error: "Admin role required" });
    return null;
  }
  return session;
}

/**
 * Gates the plugin-facing endpoints (POST /api/signoffs, GET
 * /api/contacts). See docs/api-contract.md's "Auth" section: this was an
 * open item at plugin build time (the plugin already sends
 * `Authorization: Bearer <apiKey>` from its Settings panel whenever a key
 * is configured there, in anticipation of this). Resolution: if
 * PLUGIN_API_KEY is set on the backend, it's required; if unset, these
 * endpoints stay open (useful for local dev before you've provisioned
 * one). Set PLUGIN_API_KEY once real users other than you start sending —
 * see README "Environment variables".
 */
function requirePluginKey(req, res) {
  const configured = process.env.PLUGIN_API_KEY;
  if (!configured) return true; // not configured -> open (see comment above)
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== configured) {
    sendJson(res, 401, { error: "Missing or invalid API key — set one in the plugin's Settings panel" });
    return false;
  }
  return true;
}

function hasPluginKey(req) {
  const configured = process.env.PLUGIN_API_KEY;
  if (!configured) return true;
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token === configured;
}

/**
 * GET /api/signoffs is shared by the dashboard (session cookie) and, per
 * docs/api-contract.md's planned "follows an earlier sign-off" picker, will
 * eventually also be called by the plugin (API key) — accepts either.
 */
function requireAuthOrPluginKey(req, res) {
  const session = readSession(req);
  if (session) return true;
  if (hasPluginKey(req)) return true;
  sendJson(res, 401, { error: "Not signed in and no valid plugin API key" });
  return false;
}

module.exports = { requireAuth, requirePluginKey, requireAuthOrPluginKey };
