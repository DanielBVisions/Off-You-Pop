const { sendJson, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { clearSessionCookie } = require("../../lib/session");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  res.setHeader("Set-Cookie", clearSessionCookie());
  return sendJson(res, 200, { ok: true });
});
