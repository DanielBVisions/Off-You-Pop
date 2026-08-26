// GET /api/certificate/:recipientId — renders the certificate PDF on
// demand from stored data (no stored file — see tech-spec.md §4's
// Certificate note). Public via the same unguessable-recipient-id trust
// model as the landing page; every download is logged.

const { pathSegments, sendBuffer, sendJson, methodNotAllowed, withErrorHandling, clientIp } = require("../../lib/http");
const { pgSelect, pgInsert } = require("../../lib/supabase");
const { renderTextPdf } = require("../../lib/pdf");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const segments = pathSegments(req); // ['api','certificate', id]
  const recipientId = segments[2];

  const certificate = await pgSelect("certificates", [`recipient_id=eq.${recipientId}`], { single: true }).catch(() => null);
  if (!certificate) return sendJson(res, 404, { error: "No certificate for this recipient yet" });

  const [record, snapshots] = await Promise.all([
    pgSelect("signoff_records", [`id=eq.${certificate.signoff_id}`], { single: true }),
    pgSelect("frame_snapshots", [`signoff_id=eq.${certificate.signoff_id}`, "order=sequence_order.asc"]),
  ]);

  const pdf = renderTextPdf({
    title: "Sign-Off Certificate",
    blocks: [
      { type: "field", label: "Project", value: record.project_name },
      { type: "field", label: "Client", value: record.client_name },
      { type: "field", label: "Scope", value: record.scope_label },
      { type: "spacer" },
      { type: "heading", text: "Approval" },
      { type: "paragraph", text: certificate.approval_text },
      { type: "spacer" },
      { type: "field", label: "Signed by", value: `${certificate.signer_name} <${certificate.signer_email}>` },
      { type: "field", label: "Signed at", value: certificate.signed_at },
      { type: "field", label: "IP address", value: certificate.ip_address },
      { type: "spacer" },
      { type: "heading", text: "Frames/assets covered" },
      ...snapshots.map((s) => ({ type: "paragraph", text: `${s.sequence_order + 1}. ${s.figma_node_name || s.figma_frame_key}` })),
      { type: "spacer" },
      { type: "field", label: "Certificate ID", value: certificate.id },
      { type: "field", label: "Record hash", value: certificate.record_hash },
    ],
  });

  await pgInsert("event_log", {
    signoff_id: certificate.signoff_id,
    recipient_id: recipientId,
    event_type: "certificate_downloaded",
    ip_address: clientIp(req),
    metadata: {},
  });

  return sendBuffer(res, 200, pdf, "application/pdf", {
    "Content-Disposition": `inline; filename="signoff-certificate-${recipientId}.pdf"`,
  });
});
