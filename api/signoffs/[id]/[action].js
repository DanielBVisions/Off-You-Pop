// POST /api/signoffs/:id/archive and POST /api/signoffs/:id/resend —
// merged into one function file (see api/auth/[action].js for why). URLs
// and behavior are unchanged from when these were
// api/signoffs/[id]/archive.js and api/signoffs/[id]/resend.js.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling, query } = require("../../../lib/http");
const { pgSelect, pgUpdate, pgInsert } = require("../../../lib/supabase");
const { sendEmail } = require("../../../lib/resend");
const { signoffCreatedEmail } = require("../../../lib/emails");
const { requireAuth } = require("../../../lib/auth-guard");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// --- archive: Admin only. Manual archive/delete per the brief's "no
// auto-expiry, archived/deleted manually from the dashboard" rule.
// Soft-delete (archived_at) rather than a hard delete — keeps the audit
// trail and any certificate intact. ---
async function handleArchive(req, res, id, auth) {
  const updated = await pgUpdate("signoff_records", [`id=eq.${id}`], { archived_at: new Date().toISOString() }, { single: true });
  if (!updated) return sendJson(res, 404, { error: "Sign-off not found" });

  await pgInsert("event_log", {
    signoff_id: id,
    recipient_id: null,
    event_type: "archived",
    ip_address: null,
    metadata: { byUser: auth.email },
  });

  return sendJson(res, 200, { id, archivedAt: updated.archived_at });
}

// --- resend: Admin only. Re-emails the landing link to every recipient
// who hasn't signed yet (or all, if ?all=1). ---
async function handleResend(req, res, id, auth) {
  const record = await pgSelect("signoff_records", [`id=eq.${id}`], { single: true }).catch(() => null);
  if (!record) return sendJson(res, 404, { error: "Sign-off not found" });

  const includeAll = query(req).has("all");
  const recipients = await pgSelect("recipients", [`signoff_id=eq.${id}`]);
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
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const auth = await requireAuth(req, res, { role: "admin" });
  if (!auth) return;

  const segments = pathSegments(req); // ['api','signoffs', id, action]
  const id = segments[2];
  const action = segments[3];
  if (action === "archive") return handleArchive(req, res, id, auth);
  if (action === "resend") return handleResend(req, res, id, auth);
  return sendJson(res, 404, { error: `Unknown signoff action: ${action}` });
});
