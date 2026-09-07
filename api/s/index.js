// GET /s/:recipientId — the public landing page. vercel.json rewrites
// this to /api/s?id=:id (a query param, not a [id].js path segment — see
// api/dashboard/index.js's comment on why: a rewrite destination's query
// params are documented Vercel behavior, whereas relying on the rewritten
// pathname reaching this function isn't something verifiable from this
// project's build sandbox, and turned out to be wrong in production).
// No login; the unguessable recipient UUID is the access control,
// matching "unique, unguessable landing page URLs" — see
// docs/api-contract.md's note on why this is per-recipient rather than
// per-record (multi-recipient tracking needs it to be).

const { query, sendHtml, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { renderLandingPage } = require("../../lib/landing-template");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const recipientId = query(req).get("id");
  if (!recipientId) return sendHtml(res, 400, "<h1>Missing link id</h1>");

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
