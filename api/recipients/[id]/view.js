// POST /api/recipients/:id/view — called by the landing page on load.
// Public (possession of the unguessable recipient-id link is the access
// control, same trust model as the rest of the landing-page flow). Logs a
// "viewed" event every time; only flips the recipient into 'viewed'
// status (and stamps first_viewed_at) the first time.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling, clientIp, readJsonBody } = require("../../../lib/http");
const { pgSelect, pgUpdate, pgInsert } = require("../../../lib/supabase");
const { computeRecordStatus } = require("../../../lib/domain");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const segments = pathSegments(req); // ['api','recipients', id, 'view']
  const recipientId = segments[2];
  const body = await readJsonBody(req).catch(() => ({}));

  const recipient = await pgSelect("recipients", [`id=eq.${recipientId}`], { single: true }).catch(() => null);
  if (!recipient) return sendJson(res, 404, { error: "Not found" });

  const isFirstView = recipient.status === "sent";
  if (isFirstView) {
    await pgUpdate("recipients", [`id=eq.${recipientId}`], {
      status: "viewed",
      first_viewed_at: new Date().toISOString(),
    });
  }

  await pgInsert("event_log", {
    signoff_id: recipient.signoff_id,
    recipient_id: recipient.id,
    event_type: "viewed",
    ip_address: clientIp(req),
    metadata: { userAgent: req.headers["user-agent"] || null, referrer: body.referrer || null },
  });

  // Recompute the record's overall status.
  const [record, allRecipients] = await Promise.all([
    pgSelect("signoff_records", [`id=eq.${recipient.signoff_id}`], { single: true }),
    pgSelect("recipients", [`signoff_id=eq.${recipient.signoff_id}`]),
  ]);
  const nextStatus = computeRecordStatus({
    currentStatus: record.status,
    requiresAllRecipients: record.requires_all_recipients,
    recipients: allRecipients.map((r) => (r.id === recipientId && isFirstView ? { ...r, status: "viewed" } : r)),
  });
  if (nextStatus !== record.status) {
    await pgUpdate("signoff_records", [`id=eq.${recipient.signoff_id}`], { status: nextStatus });
  }

  return sendJson(res, 200, { ok: true });
});
