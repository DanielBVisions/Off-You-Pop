// POST /api/recipients/:id/sign — the landing page's final confirm step
// (after the "are you sure" modal). Public, same trust model as view.js.
//
// This is the one function everything else in the brief hinges on:
// locks the record (via the DB trigger, once status flips to 'signed'),
// creates the Certificate, writes the 'signed' EventLog entry with
// IP/timestamp, sends completion emails, and — only from here, only after
// all of that — kicks off the branding export for branding-scope records.

const { pathSegments, sendJson, methodNotAllowed, withErrorHandling, clientIp, readJsonBody } = require("../../../lib/http");
const { pgSelect, pgUpdate, pgInsert } = require("../../../lib/supabase");
const { buildApprovalText, computeRecordHash, computeRecordStatus } = require("../../../lib/domain");
const { sendEmail } = require("../../../lib/resend");
const { signoffCompleteEmail } = require("../../../lib/emails");
const { runBrandingExport } = require("../../../lib/branding-export");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const segments = pathSegments(req); // ['api','recipients', id, 'sign']
  const recipientId = segments[2];
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

  // Best-effort notifications — a failed send doesn't undo the sign-off.
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

  // Branding export: only from here, only for a record that just reached
  // 'signed', and only once (guarded by branding_exports.signoff_id being
  // unique — a second sign on an already-fully-signed record won't
  // re-trigger this because nextStatus would already have been 'signed').
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
});
