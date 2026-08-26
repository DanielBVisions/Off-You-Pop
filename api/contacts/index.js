// GET /api/contacts?query=<string> — recipient autocomplete (plugin) and,
// once query is empty, the dashboard could reuse this too. Matches
// docs/api-contract.md.

const { query, sendJson, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { requirePluginKey } = require("../../lib/auth-guard");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!requirePluginKey(req, res)) return;

  const q = query(req);
  const term = (q.get("query") || "").trim();
  const filters = ["order=last_used_at.desc.nullslast", "limit=20"];
  if (term) {
    const encoded = encodeURIComponent(term);
    filters.push(`or=(name.ilike.*${encoded}*,email.ilike.*${encoded}*,client_name.ilike.*${encoded}*)`);
  }

  const contacts = await pgSelect("contacts", filters);
  return sendJson(res, 200, {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      clientName: c.client_name,
      lastUsedAt: c.last_used_at,
    })),
  });
});
