// Local-only stand-ins for Supabase (PostgREST + Storage + Auth), Resend,
// and Figma — used solely by scripts/local-smoke-test.mjs. Never deployed;
// the real backend talks to the real services over HTTPS (lib/supabase.js
// etc). This exists because this sandbox can't reach any of those real
// services (network egress is allowlisted to a handful of hosts — see
// plugin/README.md), so it's the only way to exercise the API layer
// end-to-end here.
//
// The PostgREST stand-in is a real (if narrow) query translator — it only
// supports the exact filter shapes lib/supabase.js actually emits, but
// what it does support runs as real SQL against the real local Postgres
// (via `psql`, using its `:'param'` substitution for safe value
// interpolation — table/column/operator names in these filters are never
// attacker-controlled, they come from this project's own lib/ code).
// Storage is real files on disk; Auth is a fixed test user.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const PGDATABASE = process.env.MOCK_PGDATABASE || "off_you_pop_test";
const STORAGE_DIR = process.env.MOCK_STORAGE_DIR || "/tmp/oyp-mock-storage";
const PORT = Number(process.env.MOCK_PORT || 5555);
const TEST_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "dan@example.com",
  password: "test-password-123",
};
const TEST_ACCESS_TOKEN = "mock-access-token";

mkdirSync(STORAGE_DIR, { recursive: true });

// Runs as the `postgres` OS user directly (uid/gid, no shell) so psql's
// peer auth applies and there's no shell-quoting to get right — args are
// passed as an array, never concatenated into a command string. psql's
// `:'param'` interpolation only fires when reading from a script (-f),
// not from -c, so each call writes a scratch .sql file rather than
// passing the query inline.
let psqlCallCounter = 0;
function psqlJson(sql, params) {
  const args = ["-d", PGDATABASE, "-t", "-A", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(params)) {
    args.push("-v", `${key}=${value === null || value === undefined ? "" : String(value).replace(/\n/g, " ")}`);
  }
  const scratchFile = path.join(os.tmpdir(), `oyp-mock-query-${process.pid}-${psqlCallCounter++}.sql`);
  writeFileSync(scratchFile, sql);
  args.push("-f", scratchFile);
  let out;
  try {
    out = execFileSync("psql", args, {
      encoding: "utf8",
      uid: 102, // postgres
      gid: 104,
      env: { ...process.env, HOME: "/var/lib/postgresql" },
    });
  } finally {
    try {
      unlinkSync(scratchFile);
    } catch {}
  }
  const trimmed = out.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

// --- tiny PostgREST-subset query translator ---------------------------------

function sqlIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

// schema.sql creates everything under off_you_pop, not public — see its
// header comment (lets a real deployment share a Supabase project with
// other apps). Table references need that schema qualifying; column
// references (sqlIdent above) don't.
const DB_SCHEMA = process.env.MOCK_DB_SCHEMA || "off_you_pop";
function sqlTable(name) {
  return `${sqlIdent(DB_SCHEMA)}.${sqlIdent(name)}`;
}

function conditionToSql(column, opValue, params, pIndex) {
  const [op, ...rest] = opValue.split(".");
  const raw = rest.join(".");
  const pName = `p${pIndex.n++}`;
  if (op === "eq") {
    params[pName] = raw;
    return `${sqlIdent(column)} = :'${pName}'`;
  }
  if (op === "is" && raw === "null") {
    return `${sqlIdent(column)} IS NULL`;
  }
  if (op === "ilike") {
    params[pName] = raw.replace(/\*/g, "%");
    return `${sqlIdent(column)} ILIKE :'${pName}'`;
  }
  throw new Error(`Unsupported operator in mock PostgREST: ${op}`);
}

function parseOrClause(value, params, pIndex) {
  const inner = value.replace(/^\(/, "").replace(/\)$/, "");
  const parts = inner.split(",");
  const sqlParts = parts.map((part) => {
    const [column, ...opParts] = part.split(".");
    return conditionToSql(column, opParts.join("."), params, pIndex);
  });
  return `(${sqlParts.join(" OR ")})`;
}

function buildWhereAndOrder(searchParams) {
  const params = {};
  const pIndex = { n: 0 };
  const conditions = [];
  let orderClause = "";
  let limitClause = "";

  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "on_conflict") continue;
    if (key === "order") {
      // e.g. "created_at.desc" or "last_used_at.desc.nullslast"
      const [col, dir, nulls] = value.split(".");
      orderClause = ` ORDER BY ${sqlIdent(col)} ${dir === "desc" ? "DESC" : "ASC"}${nulls === "nullslast" ? " NULLS LAST" : ""}`;
      continue;
    }
    if (key === "limit") {
      limitClause = ` LIMIT ${Number(value) || 100}`;
      continue;
    }
    if (key === "or") {
      conditions.push(parseOrClause(value, params, pIndex));
      continue;
    }
    conditions.push(conditionToSql(key, value, params, pIndex));
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return { where, orderClause, limitClause, params };
}

function jsonLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `ARRAY[${value.map((v) => `'${String(v).replace(/'/g, "''")}'::uuid`).join(",")}]`;
  }
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function handleSelect(table, url, singleRequested) {
  const { where, orderClause, limitClause, params } = buildWhereAndOrder(url.searchParams);
  const sql = `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT * FROM ${sqlTable(table)}${where}${orderClause}${limitClause}) t;`;
  const rows = psqlJson(sql, params);
  if (singleRequested) {
    if (rows.length !== 1) return { status: 406, body: { message: "not exactly one row" } };
    return { status: 200, body: rows[0] };
  }
  return { status: 200, body: rows };
}

function handleInsert(table, url, body, prefer) {
  const rows = Array.isArray(body) ? body : [body];
  const onConflict = url.searchParams.get("on_conflict");
  const isUpsert = onConflict && prefer.includes("resolution=merge-duplicates");

  const results = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const colSql = columns.map(sqlIdent).join(", ");
    const valSql = columns.map((c) => jsonLiteral(row[c])).join(", ");
    let sql = `INSERT INTO ${sqlTable(table)} (${colSql}) VALUES (${valSql})`;
    if (isUpsert) {
      const updateSql = columns
        .filter((c) => c !== onConflict)
        .map((c) => `${sqlIdent(c)} = EXCLUDED.${sqlIdent(c)}`)
        .join(", ");
      sql += ` ON CONFLICT (${sqlIdent(onConflict)}) DO UPDATE SET ${updateSql}`;
    }
    sql = `WITH ins AS (${sql} RETURNING *) SELECT coalesce(json_agg(row_to_json(ins)), '[]'::json) FROM ins;`;
    const inserted = psqlJson(sql, {});
    results.push(...inserted);
  }
  return { status: 201, body: results };
}

function handleUpdate(table, url, patch) {
  const { where, params } = buildWhereAndOrder(url.searchParams);
  const setSql = Object.keys(patch)
    .map((c) => `${sqlIdent(c)} = ${jsonLiteral(patch[c])}`)
    .join(", ");
  const sql = `WITH upd AS (UPDATE ${sqlTable(table)} SET ${setSql}${where} RETURNING *) SELECT coalesce(json_agg(row_to_json(upd)), '[]'::json) FROM upd;`;
  try {
    const rows = psqlJson(sql, params);
    return { status: 200, body: rows };
  } catch (err) {
    return { status: 400, body: { message: err.message } };
  }
}

// --- HTTP server -------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://internal");
  const send = (status, body, headers = {}) => {
    const isBuffer = Buffer.isBuffer(body);
    res.writeHead(status, { "Content-Type": isBuffer ? "application/octet-stream" : "application/json", ...headers });
    res.end(isBuffer ? body : JSON.stringify(body));
  };

  try {
    // --- Auth ---
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (body.email !== TEST_USER.email || body.password !== TEST_USER.password) {
        return send(400, { error_description: "Invalid credentials" });
      }
      return send(200, {
        access_token: TEST_ACCESS_TOKEN,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "mock-refresh",
        user: { id: TEST_USER.id, email: TEST_USER.email },
      });
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${TEST_ACCESS_TOKEN}`) return send(401, { message: "invalid token" });
      return send(200, { id: TEST_USER.id, email: TEST_USER.email });
    }

    // --- Storage ---
    const storageMatch = url.pathname.match(/^\/storage\/v1\/object\/(public\/)?([^/]+)\/(.+)$/);
    if (storageMatch) {
      const [, isPublic, bucket, objectPath] = storageMatch;
      const filePath = path.join(STORAGE_DIR, bucket, objectPath);
      if (req.method === "POST") {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, await readBody(req));
        return send(200, { Key: `${bucket}/${objectPath}` });
      }
      if (req.method === "GET") {
        if (!existsSync(filePath)) return send(404, { message: "not found" });
        return send(200, readFileSync(filePath));
      }
    }

    // --- PostgREST ---
    const restMatch = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (restMatch) {
      const table = restMatch[1];
      const singleRequested = req.headers.accept === "application/vnd.pgrst.object+json";
      if (req.method === "GET") {
        const result = handleSelect(table, url, singleRequested);
        return send(result.status, result.body);
      }
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const prefer = req.headers.prefer || "";
        const result = handleInsert(table, url, body, prefer);
        const wantsSingle = !Array.isArray(body);
        return send(result.status, wantsSingle ? result.body[0] : result.body);
      }
      if (req.method === "PATCH") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const result = handleUpdate(table, url, body);
        return send(result.status, result.body);
      }
    }

    // --- Resend ---
    if (url.pathname === "/emails" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      console.log(`[mock resend] -> ${body.to} :: ${body.subject}`);
      return send(200, { id: crypto.randomUUID() });
    }
    if (url.pathname === "/domains" && req.method === "GET") {
      return send(200, { data: [] }); // lib/resend.js's checkResendKey() just needs a 2xx
    }

    // --- Figma ---
    const figmaMatch = url.pathname.match(/^\/v1\/images\/([^/]+)$/);
    if (figmaMatch && req.method === "GET") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
      const format = url.searchParams.get("format") || "png";
      const images = {};
      for (const id of ids) {
        images[id] = `http://127.0.0.1:${PORT}/mock-figma-asset/${encodeURIComponent(id)}.${format}`;
      }
      return send(200, { err: null, images });
    }
    const figmaAssetMatch = url.pathname.match(/^\/mock-figma-asset\/(.+)$/);
    if (figmaAssetMatch && req.method === "GET") {
      // 1x1 PNG — good enough to prove the export/zip pipeline end-to-end.
      const onePxPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      return send(200, onePxPng, { "Content-Type": "image/png" });
    }

    return send(404, { error: `mock: no handler for ${req.method} ${url.pathname}` });
  } catch (err) {
    console.error("[mock] error:", err);
    return send(500, { message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[mock] external services listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock] test user: ${TEST_USER.email} / ${TEST_USER.password} (id ${TEST_USER.id})`);
});

export { TEST_USER, PORT };
