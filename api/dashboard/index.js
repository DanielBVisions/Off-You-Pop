// GET /dashboard (rewritten from /api/dashboard) — status table, or the
// login form if there's no valid session. Data is fetched server-side
// (this file queries Supabase directly rather than calling
// GET /api/signoffs itself) to keep the page's own auth check as the only
// gate, and avoid an extra internal HTTP hop.

const { query, sendHtml, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { readSession } = require("../../lib/session");
const { renderLoginPage, renderStatusTable } = require("../../lib/dashboard-template");

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const session = readSession(req);
  if (!session) return sendHtml(res, 200, renderLoginPage({}));

  const q = query(req);
  const status = q.get("status") || "";
  const search = q.get("search") || "";

  const filters = ["order=created_at.desc", "archived_at=is.null"];
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  if (search) {
    const term = encodeURIComponent(search);
    filters.push(`or=(project_name.ilike.*${term}*,client_name.ilike.*${term}*)`);
  }

  const records = await pgSelect("signoff_records", filters);
  return sendHtml(res, 200, renderStatusTable({ session, records, filters: { status, search } }));
});
