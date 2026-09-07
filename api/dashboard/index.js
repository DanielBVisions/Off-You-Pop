// GET /dashboard and GET /dashboard/:id (both rewritten here — see
// vercel.json's `?id=:id` note below) — status table, detail view, or the
// login form if there's no valid session. Data is fetched server-side
// (this file queries Supabase directly rather than calling the JSON API)
// to keep the page's own auth check as the only gate, and avoid an extra
// internal HTTP hop. Merged into one file with list/detail branching on
// `?id` presence — see the id-extraction note below for why, and because
// it also drops the function count by one.

const { query, sendHtml, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgSelect } = require("../../lib/supabase");
const { readSession } = require("../../lib/session");
const { renderLoginPage, renderStatusTable, renderDetailPage } = require("../../lib/dashboard-template");

// vercel.json rewrites /dashboard/:id to /api/dashboard?id=:id — the id
// comes through the query string, not a [id].js path segment. A
// path-based dynamic segment relies on Vercel preserving the rewritten
// pathname all the way into the invoked function, which isn't something
// this project could actually verify from its build sandbox (no network
// access to a real Vercel deployment — see plugin/README.md); a rewrite
// destination's query params, by contrast, are documented Vercel
// behavior and don't depend on that assumption.
async function handleDetail(req, res, session, id) {
  const record = await pgSelect("signoff_records", [`id=eq.${id}`], { single: true }).catch(() => null);
  if (!record) return sendHtml(res, 404, "<h1>Not found</h1>");

  const [recipients, events, certificates, brandingExport] = await Promise.all([
    pgSelect("recipients", [`signoff_id=eq.${id}`]),
    pgSelect("event_log", [`signoff_id=eq.${id}`, "order=occurred_at.desc"]),
    pgSelect("certificates", [`signoff_id=eq.${id}`]),
    record.scope_type === "branding"
      ? pgSelect("branding_exports", [`signoff_id=eq.${id}`], { single: true }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return sendHtml(res, 200, renderDetailPage({ session, record, recipients, events, certificates, brandingExport }));
}

async function handleList(req, res, session, q) {
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
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const session = readSession(req);
  if (!session) return sendHtml(res, 200, renderLoginPage({}));

  const q = query(req);
  const id = q.get("id");
  if (id) return handleDetail(req, res, session, id);
  return handleList(req, res, session, q);
});
