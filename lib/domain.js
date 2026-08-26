// Business logic shared across API routes — kept out of the route handlers
// so the rules in here (approval wording, status transitions, hashing)
// have exactly one implementation each, per the brief's "the audit trail
// is only as strong as its weakest logged event" warning: consistency
// across every code path matters more than where the code lives.

const crypto = require("node:crypto");

function buildApprovalText({ signerName, signerEmail, projectName, clientName, scopeLabel, signedAtIso }) {
  return (
    `I, ${signerName} (${signerEmail}), on behalf of ${clientName}, confirm approval of ` +
    `"${scopeLabel}" for the ${projectName} project, as presented on this page as of ${signedAtIso}. ` +
    `This sign-off covers the frames/assets shown above only. Any further changes requested after ` +
    `this approval fall outside the current scope of work and will be treated as chargeable additional ` +
    `work, billed separately from this engagement. This confirmation, together with the associated ` +
    `audit trail (view/sign timestamps and IP address), stands as evidence of approval for this design ` +
    `milestone — it is not a legally notarized signature.`
  );
}

function computeRecordHash({ signoffId, recipientId, signerName, signerEmail, signedAtIso, ipAddress, approvalText, snapshotIds }) {
  const canonical = JSON.stringify({
    signoffId,
    recipientId,
    signerName,
    signerEmail,
    signedAtIso,
    ipAddress,
    approvalText,
    snapshotIds: [...snapshotIds].sort(),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Recomputes a SignoffRecord's status from its recipients' individual
 * statuses. Never itself flips a record that's already 'signed' back to
 * something else — the locking trigger in schema.sql would reject most
 * such changes anyway, but status specifically is left updatable there
 * (for a hypothetical manual dashboard override), so this guard matters.
 */
function computeRecordStatus({ currentStatus, requiresAllRecipients, recipients }) {
  if (currentStatus === "signed" || currentStatus === "locked" || currentStatus === "cancelled") {
    return currentStatus;
  }
  const total = recipients.length;
  const signedCount = recipients.filter((r) => r.status === "signed").length;
  const viewedCount = recipients.filter((r) => r.status === "viewed" || r.status === "signed").length;

  const isFullySigned = requiresAllRecipients ? signedCount === total : signedCount >= 1;
  if (isFullySigned) return "signed";
  if (signedCount > 0) return "partially_signed";
  if (viewedCount > 0) return "partially_viewed";
  return "sent";
}

module.exports = { buildApprovalText, computeRecordHash, computeRecordStatus };
