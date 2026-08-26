// Server-side validation for creating a sign-off — mirrors the plugin's
// client-side checks (plugin/src/ui.ts computeMissing()) but is the one
// that actually matters: per the brief, "No partial records should be
// creatable via the API either — validate server-side too, not just in
// the plugin UI."

const SCOPE_TYPES = new Set(["single_frame", "multi_frame", "flow", "branding"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * @returns {string[]} validation errors — empty array means valid.
 */
function validateCreateSignoff(data, snapshotCount) {
  const errors = [];

  if (!isNonEmptyString(data.clientName)) errors.push("clientName is required");
  if (!isNonEmptyString(data.projectName)) errors.push("projectName is required");

  if (!SCOPE_TYPES.has(data.scopeType)) {
    errors.push(`scopeType must be one of ${[...SCOPE_TYPES].join(", ")}`);
  }

  if (!Array.isArray(data.recipients) || data.recipients.length === 0) {
    errors.push("at least one recipient is required");
  } else {
    for (const [i, r] of data.recipients.entries()) {
      if (!isNonEmptyString(r?.name)) errors.push(`recipients[${i}].name is required`);
      if (!isNonEmptyString(r?.email) || !EMAIL_RE.test(r.email.trim())) {
        errors.push(`recipients[${i}].email is invalid`);
      }
    }
  }

  if (!Array.isArray(data.snapshots) || data.snapshots.length === 0) {
    errors.push("at least one snapshot (frame in scope) is required");
  } else if (data.scopeType === "single_frame" && data.snapshots.length > 1) {
    errors.push("single_frame scope must have exactly one snapshot");
  }

  if (snapshotCount !== undefined && Array.isArray(data.snapshots) && snapshotCount !== data.snapshots.length) {
    errors.push(
      `expected ${data.snapshots.length} uploaded image(s) to match data.snapshots, got ${snapshotCount}`,
    );
  }

  if (!isNonEmptyString(data.createdBy)) errors.push("createdBy is required");

  if (data.scopeType === "branding" && !isNonEmptyString(data.figmaFileKey)) {
    errors.push("figmaFileKey is required for branding scope (needed for the post-signoff Figma export)");
  }

  return errors;
}

module.exports = { validateCreateSignoff, EMAIL_RE };
