// GET /dashboard/:id (rewritten from /api/dashboard/:id) — detail + full
// audit trail + certificate links + resend/archive actions.

const { pathSegments, sendHtml, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { readSession } = require("../../lib/session");
const { renderLoginPage, renderDetailPage } = require("../../lib/dashboard-template");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const session = readSession(req);
  if (!session) return sendHtml(res, 200, renderLoginPage({}));

  const segments = pathSegments(req); // ['api','dashboard', id]
  const id = segments[2];

  const record = await pgSelect("signoff_records", [`id=eq.${id}`], { single: true }).catch(() => null);
  if (!record) return sendHtml(res, 404, "<h1>Not found</h1>");

  const [recipients, events, certificates, brandingExport] = await Promise.all([
    pgSelect("recipients", [`signoff_id=eq.${id}`]),
    pgSelect("event_log", [`signoff_id=eq.${id}`, "order=occurred_at.desc"]),
    pgSelect("certificates", [`signoff_id=eq.${id}`]),
    record.scope_type === "branding"
      ? pgSelect("branding_exports", [`signoff_id=eq.${id}`], { single: true }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return sendHtml(res, 200, renderDetailPage({ session, record, recipients, events, certificates, brandingExport }));
});
