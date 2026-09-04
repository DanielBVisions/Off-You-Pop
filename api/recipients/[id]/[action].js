// POST /api/recipients/:id/view and POST /api/recipients/:id/sign —
// merged into one function file (see api/auth/[action].js for why: each
// file under /api counts separately against Vercel's plan function
// limit). URLs and behavior are unchanged from when these were
// api/recipients/[id]/view.js and api/recipients/[id]/sign.js.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling, clientIp, readJsonBody } = require("../../../lib/http");
const { pgSelect, pgUpdate, pgInsert } = require("../../../lib/supabase");
const { buildApprovalText, computeRecordHash, computeRecordStatus } = require("../../../lib/domain");
const { sendEmail } = require("../../../lib/resend");
const { signoffCompleteEmail } = require("../../../lib/emails");
const { runBrandingExport } = require("../../../lib/branding-export");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// --- view: called by the landing page on load. Public (possession of the
// unguessable recipient-id link is the access control). Logs a "viewed"
// event every time; only flips the recipient into 'viewed' status (and
// stamps first_viewed_at) the first time. ---
async function handleView(req, res, recipientId) {
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
}

// --- sign: the landing page's final confirm step. The one function
// everything else in the brief hinges on: locks the record, creates the
// Certificate, writes the 'signed' EventLog entry, sends completion
// emails, and — only from here, only after all of that — kicks off the
// branding export for branding-scope records. ---
async function handleSign(req, res, recipientId) {
  await readJsonBody(req).catch(() => ({})); // body currently unused, but read+drain regardless

  const recipient = await pgSelect("recipients", [`id=eq.${recipientId}`], { single: true }).catch(() => null);
  if (!recipient) return sendJson(res, 404, { error: "Not found" });
  if (recipient.status === "signed") {
    return sendJson(res, 409, { error: "This recipient has already signed off" });
  }

  const [record, snapshots] = await Promise.all([
    pgSelect("signoff_records", [`id=eq.${recipient.signoff_id}`], { single: true }),
    pgSelect("frame_snapshots", [`signoff_id=eq.${recipient.signoff_id}`, "order=sequence_order.asc"]),
  ]);
  if (record.archived_at) {
    return sendJson(res, 409, { error: "This sign-off has been archived" });
  }

  const signedAtIso = new Date().toISOString();
  const ipAddress = clientIp(req) || "unknown";
  const snapshotIds = snapshots.map((s) => s.id);

  const approvalText = buildApprovalText({
    signerName: recipient.name,
    signerEmail: recipient.email,
    projectName: record.project_name,
    clientName: record.client_name,
    scopeLabel: record.scope_label,
    signedAtIso,
  });
  const recordHash = computeRecordHash({
    signoffId: record.id,
    recipientId: recipient.id,
    signerName: recipient.name,
    signerEmail: recipient.email,
    signedAtIso,
    ipAddress,
    approvalText,
    snapshotIds,
  });

  await pgInsert("certificates", {
    signoff_id: record.id,
    recipient_id: recipient.id,
    signer_name: recipient.name,
    signer_email: recipient.email,
    signed_at: signedAtIso,
    ip_address: ipAddress,
    approval_text: approvalText,
    snapshot_ids: snapshotIds,
    record_hash: recordHash,
  });

  await pgUpdate("recipients", [`id=eq.${recipientId}`], {
    status: "signed",
    signed_at: signedAtIso,
  });

  await pgInsert("event_log", {
    signoff_id: record.id,
    recipient_id: recipient.id,
    event_type: "signed",
    ip_address: ipAddress,
    metadata: {},
  });

  const allRecipients = await pgSelect("recipients", [`signoff_id=eq.${record.id}`]);
  const nextStatus = computeRecordStatus({
    currentStatus: record.status,
    requiresAllRecipients: record.requires_all_recipients,
    recipients: allRecipients,
  });
  if (nextStatus !== record.status) {
    await pgUpdate("signoff_records", [`id=eq.${record.id}`], { status: nextStatus });
  }

  const certificateUrl = `${siteUrl()}/api/certificate/${recipient.id}`;

  try {
    await sendEmail({
      to: recipient.email,
      subject: `You're signed off — ${record.project_name}`,
      html: signoffCompleteEmail({
        recipientLabel: recipient.name,
        projectName: record.project_name,
        clientName: record.client_name,
        scopeLabel: record.scope_label,
        signerName: recipient.name,
        signedAtIso,
        certificateUrl,
        isTeamCopy: false,
      }),
    });
  } catch (err) {
    console.error("Failed to send client confirmation email:", err.message);
  }

  const teamEmails = (process.env.TEAM_NOTIFICATION_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const teamEmail of teamEmails) {
    try {
      await sendEmail({
        to: teamEmail,
        subject: `Signed: ${record.project_name} — ${record.scope_label}`,
        html: signoffCompleteEmail({
          recipientLabel: "team",
          projectName: record.project_name,
          clientName: record.client_name,
          scopeLabel: record.scope_label,
          signerName: recipient.name,
          signedAtIso,
          certificateUrl,
          isTeamCopy: true,
        }),
      });
    } catch (err) {
      console.error(`Failed to send team notification to ${teamEmail}:`, err.message);
    }
  }

  let brandingExport = null;
  if (record.scope_type === "branding" && nextStatus === "signed" && record.status !== "signed") {
    try {
      brandingExport = await runBrandingExport({ record, snapshots });
      await pgInsert("event_log", {
        signoff_id: record.id,
        recipient_id: null,
        event_type: "export_triggered",
        ip_address: null,
        metadata: { result: "complete" },
      });
    } catch (err) {
      console.error("Branding export failed:", err.message);
      await pgInsert("event_log", {
        signoff_id: record.id,
        recipient_id: null,
        event_type: "export_triggered",
        ip_address: null,
        metadata: { result: "failed", error: err.message },
      });
    }
  }

  return sendJson(res, 200, {
    signedAt: signedAtIso,
    certificateUrl,
    approvalText,
    recordStatus: nextStatus,
    brandingExport,
  });
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const segments = pathSegments(req); // ['api','recipients', id, action]
  const recipientId = segments[2];
  const action = segments[3];
  if (action === "view") return handleView(req, res, recipientId);
  if (action === "sign") return handleSign(req, res, recipientId);
  return sendJson(res, 404, { error: `Unknown recipient action: ${action}` });
});
