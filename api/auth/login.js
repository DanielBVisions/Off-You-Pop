// POST /api/auth/login — dashboard sign-in. Verifies credentials against
// Supabase Auth, then requires a matching team_members row (role
// provisioning is manual — see supabase/schema.sql's comment and README
// setup — there's no self-signup for the dashboard).

const { readJsonBody, sendJson, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { signInWithPassword, pgSelect } = require("../../lib/supabase");
const { createSessionCookie } = require("../../lib/session");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { email, password } = await readJsonBody(req);
  if (!email || !password) return sendJson(res, 400, { error: "Email and password are required" });

  let authResult;
  try {
    authResult = await signInWithPassword(email, password);
  } catch (err) {
    return sendJson(res, 401, { error: "Invalid email or password" });
  }

  const member = await pgSelect("team_members", [`id=eq.${authResult.user.id}`], { single: true }).catch(() => null);
  if (!member) {
    return sendJson(res, 403, {
      error: "This account isn't set up as a dashboard user yet — ask an admin to add you to team_members",
    });
  }

  const expiresAt = authResult.expires_at || Math.floor(Date.now() / 1000) + (authResult.expires_in || 3600);
  const cookie = createSessionCookie({
    accessToken: authResult.access_token,
    expiresAt,
    userId: member.id,
    email: member.email,
    role: member.role,
  });

  res.setHeader("Set-Cookie", cookie);
  return sendJson(res, 200, { ok: true, role: member.role, name: member.name });
});
