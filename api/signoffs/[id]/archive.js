// POST /api/signoffs/:id/archive — Admin only. Manual archive/delete per
// the brief's "no auto-expiry, archived/deleted manually from the
// dashboard" rule. Soft-delete (archived_at) rather than a hard delete —
// keeps the audit trail and any certificate intact.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling } = require("../../../lib/http");
const { pgUpdate, pgInsert } = require("../../../lib/supabase");
const { requireAuth } = require("../../../lib/auth-guard");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const auth = await requireAuth(req, res, { role: "admin" });
  if (!auth) return;

  const segments = pathSegments(req); // ['api','signoffs', id, 'archive']
  const id = segments[2];

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
});
