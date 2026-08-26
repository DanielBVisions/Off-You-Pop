// POST /api/signoffs/:id/resend — Admin only. Re-emails the landing link
// to every recipient who hasn't signed yet (or all, if ?all=1). Logs a
// record-level "resent" event per brief's dashboard "resend link" action.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling, query } = require("../../../lib/http");
const { pgSelect, pgInsert } = require("../../../lib/supabase");
const { sendEmail } = require("../../../lib/resend");
const { signoffCreatedEmail } = require("../../../lib/emails");
const { requireAuth } = require("../../../lib/auth-guard");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const auth = await requireAuth(req, res, { role: "admin" });
  if (!auth) return;

  const segments = pathSegments(req); // ['api','signoffs', id, 'resend']
  const id = segments[2];

  const record = await pgSelect("signoff_records", [`id=eq.${id}`], { single: true }).catch(() => null);
  if (!record) return sendJson(res, 404, { error: "Sign-off not found" });

  const includeAll = query(req).has("all");
  const recipientFilter = [`signoff_id=eq.${id}`];
  const recipients = await pgSelect("recipients", recipientFilter);
  const targets = includeAll ? recipients : recipients.filter((r) => r.status !== "signed");

  const results = [];
  for (const recipient of targets) {
    const landingUrl = `${siteUrl()}/s/${recipient.id}`;
    try {
      await sendEmail({
        to: recipient.email,
        subject: `Reminder: ${record.project_name} — ready for your sign-off`,
        html: signoffCreatedEmail({
          recipientName: recipient.name,
          projectName: record.project_name,
          clientName: record.client_name,
          scopeLabel: record.scope_label,
          landingUrl,
          notes: record.notes,
        }),
      });
      results.push({ recipientId: recipient.id, email: recipient.email, sent: true });
    } catch (err) {
      results.push({ recipientId: recipient.id, email: recipient.email, sent: false, error: err.message });
    }
  }

  await pgInsert("event_log", {
    signoff_id: id,
    recipient_id: null,
    event_type: "resent",
    ip_address: null,
    metadata: { byUser: auth.email, recipientCount: targets.length },
  });

  return sendJson(res, 200, { results });
});
