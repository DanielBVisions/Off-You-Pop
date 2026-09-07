// GET /api/health — diagnostic endpoint for verifying a deployment has the
// right env vars and can actually reach Supabase, without needing to dig
// through Vercel's UI. Never returns secret values, only presence/booleans
// and (if reachable) a trivial Supabase query result.

const { sendJson, methodNotAllowed, withErrorHandling } = require("../lib/http");
const { pgSelect } = require("../lib/supabase");
const { checkResendKey } = require("../lib/resend");

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SESSION_SECRET",
  "SITE_URL",
];
const OPTIONAL_ENV = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "FIGMA_ACCESS_TOKEN", "PLUGIN_API_KEY", "TEAM_NOTIFICATION_EMAIL"];

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const env = {};
  for (const key of REQUIRED_ENV) env[key] = Boolean(process.env[key]);
  for (const key of OPTIONAL_ENV) env[key] = Boolean(process.env[key]);

  const missing = REQUIRED_ENV.filter((key) => !env[key]);

  let supabase = { reachable: false, error: null };
  if (missing.length === 0) {
    try {
      // team_members is small and always exists once schema.sql has run —
      // a cheap way to prove both the URL/keys and the off_you_pop schema
      // exposure are correct, not just present.
      const rows = await pgSelect("team_members", ["limit=1"]);
      supabase = { reachable: true, teamMembersCount: Array.isArray(rows) ? rows.length : null };
    } catch (err) {
      supabase = { reachable: false, error: err.message };
    }
  }

  const resend = await checkResendKey();

  const ok = missing.length === 0 && supabase.reachable;
  return sendJson(res, ok ? 200 : 503, { ok, env, missingEnvVars: missing, supabase, resend });
});
