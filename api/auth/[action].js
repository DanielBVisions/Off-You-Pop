// POST /api/auth/login and POST /api/auth/logout — merged into one
// function file (Vercel counts each file under /api separately against
// the plan's function-count limit; login+logout are simple enough to
// safely share one). URLs and behavior are unchanged from when these
// were api/auth/login.js and api/auth/logout.js.

const { pathSegments, readJsonBody, sendJson, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { signInWithPassword, pgSelect } = require("../../lib/supabase");
const { createSessionCookie, clearSessionCookie } = require("../../lib/session");

async function handleLogin(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { email, password } = await readJsonBody(req);
  if (!email || !password) return sendJson(res, 400, { error: "Email and password are required" });

  let authResult;
  try {
    authResult = await signInWithPassword(email, password);
  } catch (err) {
    // Surface Supabase's actual error text (e.g. "Invalid login
    // credentials" vs "Invalid API key" vs a network error) rather than
    // a generic message that hides misconfiguration behind what looks
    // like a wrong-password error.
    return sendJson(res, 401, { error: `Sign-in failed: ${err.message}` });
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
}

async function handleLogout(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  res.setHeader("Set-Cookie", clearSessionCookie());
  return sendJson(res, 200, { ok: true });
}

module.exports = withErrorHandling(async (req, res) => {
  const action = pathSegments(req)[2]; // ['api','auth', action]
  if (action === "login") return handleLogin(req, res);
  if (action === "logout") return handleLogout(req, res);
  return sendJson(res, 404, { error: `Unknown auth action: ${action}` });
});
