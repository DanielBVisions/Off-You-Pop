// Talks to Supabase over its plain REST APIs (PostgREST for Postgres,
// Storage, Auth) with `fetch` — deliberately not the `@supabase/supabase-js`
// SDK. This isn't a stand-in for it: these are Supabase's own documented
// REST interfaces, and using them directly keeps this backend
// dependency-free without losing anything Supabase-specific.
//
// All data access here uses the SERVICE ROLE key, which bypasses Row Level
// Security — this module must never be reachable from browser code. Only
// the Auth helpers use the anon key, matching Supabase's normal login flow.

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function baseUrl() {
  return env("SUPABASE_URL").replace(/\/+$/, "");
}

// Everything lives under this schema, not `public` — see schema.sql's
// header comment for why (lets this share a Supabase project with other
// apps). PostgREST needs telling which schema a request targets: Accept-
// Profile for reads, Content-Profile for writes — sending both on every
// request is harmless, the irrelevant one is just ignored for that verb.
function dbSchema() {
  return process.env.SUPABASE_DB_SCHEMA || "off_you_pop";
}

function serviceHeaders(extra) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Accept-Profile": dbSchema(),
    "Content-Profile": dbSchema(),
    ...extra,
  };
}

async function parseResponse(res) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body && (body.message || body.error_description || body.error)) ||
      `Supabase request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// --- Postgres (PostgREST) ---------------------------------------------------

/**
 * @param {string} table
 * @param {string[]} query - raw PostgREST query fragments, e.g. ["id=eq.123", "select=*"]
 */
async function pgSelect(table, query = [], { single = false } = {}) {
  const qs = query.length ? `?${query.join("&")}` : "";
  const res = await fetch(`${baseUrl()}/rest/v1/${table}${qs}`, {
    headers: serviceHeaders(single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
  });
  return parseResponse(res);
}

async function pgInsert(table, rows, { select = "*", single = false } = {}) {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: `return=representation${single ? ",resolution=merge-duplicates" : ""}`,
    }),
    body: JSON.stringify(rows),
  });
  const body = await parseResponse(res);
  if (single) return Array.isArray(body) ? body[0] : body;
  return body;
}

async function pgUpdate(table, query, patch, { select = "*", single = false } = {}) {
  const params = [...query, `select=${encodeURIComponent(select)}`];
  const res = await fetch(`${baseUrl()}/rest/v1/${table}?${params.join("&")}`, {
    method: "PATCH",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(patch),
  });
  const body = await parseResponse(res);
  if (single) return Array.isArray(body) ? body[0] ?? null : body;
  return body;
}

/** Upsert on a real unique column (see PostgREST docs on_conflict + Prefer: resolution). */
async function pgUpsert(table, row, { onConflict, select = "*" } = {}) {
  const res = await fetch(
    `${baseUrl()}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}&select=${encodeURIComponent(select)}`,
    {
      method: "POST",
      headers: serviceHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates",
      }),
      body: JSON.stringify(row),
    },
  );
  const body = await parseResponse(res);
  return Array.isArray(body) ? body[0] : body;
}

async function pgSelectOne(table, query = []) {
  const rows = await pgSelect(table, [...query, "limit=1"]);
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

/** PostgREST value-escaping for use inside eq./ilike. filters etc. */
function pgValue(value) {
  return encodeURIComponent(String(value));
}

// --- Storage -----------------------------------------------------------------

/**
 * Uploads a buffer to a (public) Storage bucket and returns its public URL.
 * The bucket must already exist and be set to public — see README setup.
 */
async function uploadToStorage(bucket, path, buffer, contentType) {
  const res = await fetch(
    `${baseUrl()}/storage/v1/object/${bucket}/${path}`,
    {
      method: "POST",
      headers: serviceHeaders({
        "Content-Type": contentType,
        "x-upsert": "true",
      }),
      body: buffer,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload failed (${res.status}): ${text}`);
  }
  return `${baseUrl()}/storage/v1/object/public/${bucket}/${path}`;
}

// --- Auth ----------------------------------------------------------------

async function signInWithPassword(email, password) {
  const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  return parseResponse(res);
}

async function getAuthUser(accessToken) {
  const res = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = {
  pgSelect,
  pgSelectOne,
  pgInsert,
  pgUpdate,
  pgUpsert,
  pgValue,
  uploadToStorage,
  signInWithPassword,
  getAuthUser,
};
