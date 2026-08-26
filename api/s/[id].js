// GET /s/:recipientId — the public landing page (rewritten from
// /api/s/:id by vercel.json). No login; the unguessable recipient UUID is
// the access control, matching "unique, unguessable landing page URLs" —
// see docs/api-contract.md's note on why this is per-recipient rather
// than per-record (multi-recipient tracking needs it to be).

const { pathSegments, sendHtml, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { renderLandingPage } = require("../../lib/landing-template");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const segments = pathSegments(req); // ['api','s', id]
  const recipientId = segments[2];

  const recipient = await pgSelect("recipients", [`id=eq.${recipientId}`], { single: true }).catch(() => null);
  if (!recipient) return sendHtml(res, 404, "<h1>Not found</h1><p>This link doesn't match a sign-off.</p>");

  const [record, snapshots, certificate] = await Promise.all([
    pgSelect("signoff_records", [`id=eq.${recipient.signoff_id}`], { single: true }),
    pgSelect("frame_snapshots", [`signoff_id=eq.${recipient.signoff_id}`, "order=sequence_order.asc"]),
    recipient.status === "signed"
      ? pgSelect("certificates", [`recipient_id=eq.${recipientId}`], { single: true }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return sendHtml(res, 200, renderLandingPage({ record, recipient, snapshots, certificate }));
});
