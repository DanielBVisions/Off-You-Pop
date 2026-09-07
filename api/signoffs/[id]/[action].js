// POST /api/signoffs/:id/archive, POST /api/signoffs/:id/resend, and
// POST /api/signoffs/:id/snapshot — merged into one function file (see
// api/auth/[action].js for why). archive/resend are unchanged from when
// they were separate files; snapshot is new (see api/signoffs/index.js's
// header comment — uploads one frame image at a time instead of all of
// them in the original create request, to stay under Vercel's 4.5MB
// request-body limit). archive/resend need dashboard admin auth; snapshot
// needs the plugin's auth instead (same as create) — genuinely different
// trust boundaries, so the dispatcher below picks the right check per
// action rather than applying one check to all three.

const { pathSegments, query, readRawBody, sendJson, methodNotAllowed, withErrorHandling } = require("../../../lib/http");
const { pgSelect, pgUpdate, pgInsert, pgDelete, uploadToStorage } = require("../../../lib/supabase");
const { sendEmail } = require("../../../lib/resend");
const { signoffCreatedEmail } = require("../../../lib/emails");
const { requireAuth, requirePluginKey } = require("../../../lib/auth-guard");

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

// --- reset: Admin only, for testing/re-running a sign-off, not for
// correcting a real client sign-off (the brief's locking rule — "signed is
// immutable, further changes need a brand-new record" — is about the
// latter). Puts every recipient back to 'sent' (clearing first_viewed_at/
// signed_at) and the record back to 'sent', and removes the certificate(s)
// and branding export this sign-off produced — both are re-created fresh
// the next time a recipient signs, and both have a unique-per-signoff
// constraint that a plain re-sign would otherwise violate. The reset
// itself is still logged (event_type 'reset'), so the audit trail shows
// it happened even though the prior signed state it undid isn't kept. ---
async function handleReset(req, res, id, auth) {
  const record = await pgSelect("signoff_records", [`id=eq.${id}`], { single: true }).catch(() => null);
  if (!record) return sendJson(res, 404, { error: "Sign-off not found" });

  await pgDelete("certificates", [`signoff_id=eq.${id}`]);
  if (record.scope_type === "branding") {
    await pgDelete("branding_exports", [`signoff_id=eq.${id}`]);
  }

  await pgUpdate("recipients", [`signoff_id=eq.${id}`], {
    status: "sent",
    first_viewed_at: null,
    signed_at: null,
  });

  const updated = await pgUpdate("signoff_records", [`id=eq.${id}`], { status: "sent" }, { single: true });

  await pgInsert("event_log", {
    signoff_id: id,
    recipient_id: null,
    event_type: "reset",
    ip_address: null,
    metadata: { byUser: auth.email, previousStatus: record.status },
  });

  return sendJson(res, 200, { id, status: updated.status });
}

// image/svg+xml -> .svg, image/png -> .png, etc. — the extension is only
// for a sane-looking Storage path/URL; nothing serves or interprets it,
// the browser goes by the stored Content-Type when it fetches the image.
function extensionForContentType(contentType) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml") return "svg";
  if (type === "image/jpeg") return "jpg";
  return "png";
}

// --- snapshot: called by the plugin once per frame, right after create
// returns. Body is the raw image bytes for one frame_snapshots row (given
// by ?snapshotId=, from create's response) — the plugin currently sends
// JPEG (PNG could still exceed this request's body-size limit on a large
// page even after being split per-frame; an SVG export was also tried and
// reverted, too heavy for Figma to reliably produce on a large frame), but
// this endpoint doesn't assume a format — it uploads whatever Content-Type
// is actually sent. Fills in that row's snapshot_url, which starts empty
// at creation. ---
async function handleSnapshot(req, res, id) {
  const snapshotId = query(req).get("snapshotId");
  if (!snapshotId) return sendJson(res, 400, { error: "snapshotId query param is required" });

  const bytes = await readRawBody(req);
  if (bytes.length === 0) return sendJson(res, 400, { error: "Empty request body — expected image bytes" });

  const contentType = req.headers["content-type"] || "image/png";
  const path = `${id}/${snapshotId}.${extensionForContentType(contentType)}`;
  const url = await uploadToStorage("snapshots", path, bytes, contentType);

  const updated = await pgUpdate(
    "frame_snapshots",
    [`id=eq.${snapshotId}`, `signoff_id=eq.${id}`],
    { snapshot_url: url },
    { single: true },
  );
  if (!updated) return sendJson(res, 404, { error: "Snapshot row not found for this sign-off" });

  return sendJson(res, 200, { id: updated.id, snapshotUrl: url });
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const segments = pathSegments(req); // ['api','signoffs', id, action]
  const id = segments[2];
  const action = segments[3];

  if (action === "snapshot") {
    if (!requirePluginKey(req, res)) return;
    return handleSnapshot(req, res, id);
  }

  const auth = await requireAuth(req, res, { role: "admin" });
  if (!auth) return;
  if (action === "archive") return handleArchive(req, res, id, auth);
  if (action === "resend") return handleResend(req, res, id, auth);
  if (action === "reset") return handleReset(req, res, id, auth);
  return sendJson(res, 404, { error: `Unknown signoff action: ${action}` });
});
