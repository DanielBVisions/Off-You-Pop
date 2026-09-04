// End-to-end smoke test: create -> view -> sign -> certificate ->
// (branding) export -> dashboard login -> status table -> audit trail ->
// archive, all over real HTTP against scripts/dev-server.mjs, backed by
// scripts/mock-external-services.mjs (which itself runs real SQL against
// a real local Postgres — see that file's header comment for why this is
// more than an in-memory fake).
//
// Run: node scripts/local-smoke-test.mjs

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const APP_PORT = 3100;
const MOCK_PORT = 5556;
const PGDATABASE = "off_you_pop_smoketest";

process.env.SUPABASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
process.env.SUPABASE_ANON_KEY = "mock-anon-key";
process.env.RESEND_API_KEY = "mock-resend-key";
process.env.RESEND_FROM_EMAIL = "noreply@example.com";
process.env.SESSION_SECRET = "smoke-test-secret";
process.env.SITE_URL = `http://127.0.0.1:${APP_PORT}`;
process.env.FIGMA_ACCESS_TOKEN = "mock-figma-token";
process.env.MOCK_PGDATABASE = PGDATABASE;
process.env.MOCK_PORT = String(MOCK_PORT);
process.env.MOCK_STORAGE_DIR = "/tmp/oyp-smoke-storage";
process.env.PORT = String(APP_PORT);
delete process.env.PLUGIN_API_KEY; // keep plugin endpoints open for this run
delete process.env.TEAM_NOTIFICATION_EMAIL;

// Patch the mock's Resend/Auth base URLs: lib/resend.js and lib/figma.js
// hardcode the real api.resend.com / api.figma.com hosts. For the smoke
// test we point Resend calls at the mock too, via a tiny fetch shim —
// simplest is to override fetch globally to redirect those two hosts.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const isUrlInstance = input instanceof URL;
  let url = typeof input === "string" ? input : isUrlInstance ? input.toString() : input.url;
  if (url.startsWith("https://api.resend.com/")) url = url.replace("https://api.resend.com", `http://127.0.0.1:${MOCK_PORT}`);
  if (url.startsWith("https://api.figma.com/")) url = url.replace("https://api.figma.com", `http://127.0.0.1:${MOCK_PORT}`);
  if (typeof input === "string" || isUrlInstance) return realFetch(url, init);
  return realFetch(new Request(url, input));
};

function log(msg) {
  console.log(`\x1b[36m[smoke]\x1b[0m ${msg}`);
}
function pass(msg) {
  console.log(`\x1b[32m  ✓ ${msg}\x1b[0m`);
}

function psql(sql) {
  execFileSync("psql", ["-d", PGDATABASE, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    uid: 102,
    gid: 104,
    env: { ...process.env, HOME: "/var/lib/postgresql" },
    stdio: "pipe",
  });
}
function psqlAsRoot(sql) {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", sql], { uid: 102, gid: 104, env: { ...process.env, HOME: "/var/lib/postgresql" } });
}

async function main() {
  log("Setting up fresh Postgres test database + schema...");
  try {
    psqlAsRoot(`DROP DATABASE IF EXISTS ${PGDATABASE};`);
  } catch {}
  psqlAsRoot(`CREATE DATABASE ${PGDATABASE};`);
  psql(`create schema if not exists auth; create table if not exists auth.users (id uuid primary key);`);
  execFileSync("psql", ["-d", PGDATABASE, "-v", "ON_ERROR_STOP=1", "-f", path.join(root, "supabase/schema.sql")], {
    uid: 102,
    gid: 104,
    env: { ...process.env, HOME: "/var/lib/postgresql" },
  });
  pass("schema applied");

  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  psql(`insert into auth.users (id) values ('${TEST_USER_ID}');`);
  psql(`insert into off_you_pop.team_members (id, email, name, role) values ('${TEST_USER_ID}', 'dan@example.com', 'Dan', 'admin');`);
  pass("seeded admin team member");

  log("Starting mock external services + dev server...");
  await import("./mock-external-services.mjs");
  await new Promise((r) => setTimeout(r, 150));
  await import("./dev-server.mjs");
  await new Promise((r) => setTimeout(r, 150));

  const base = `http://127.0.0.1:${APP_PORT}`;
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  // --- 1. Create a single_frame sign-off (plugin flow) ---
  log("POST /api/signoffs (create)...");
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      clientName: "Acme Ltd",
      projectName: "Acme Website Redesign",
      figmaFileKey: null,
      scopeType: "single_frame",
      scopeLabel: "Homepage only",
      requiresAllRecipients: true,
      followsSignoffId: null,
      notes: "First cut of the homepage.",
      createdBy: "Dan",
      recipients: [{ name: "Jo Client", email: "jo@acme.com", contactId: null }],
      snapshots: [{ figmaFrameKey: "1:23", figmaNodeName: "Homepage", sequenceOrder: 0 }],
    }),
  );
  form.append("snapshot_0", new Blob([onePxPng], { type: "image/png" }), "homepage.png");
  const createRes = await fetch(`${base}/api/signoffs`, { method: "POST", body: form });
  const createBody = await createRes.json();
  assert.strictEqual(createRes.status, 201, `create status 201, got ${createRes.status}: ${JSON.stringify(createBody)}`);
  assert.ok(createBody.id && createBody.landingUrl, "response has id + landingUrl");
  pass(`created ${createBody.id}`);

  const recipientId = createBody.landingUrl.split("/").pop();

  // --- 2. Landing page shows the sign form ---
  log("GET landing page (before signing)...");
  const landingRes1 = await fetch(createBody.landingUrl);
  const landingHtml1 = await landingRes1.text();
  assert.strictEqual(landingRes1.status, 200);
  assert.match(landingHtml1, /Acme Website Redesign/);
  assert.match(landingHtml1, /Sign off/);
  pass("landing page renders scope + sign button");

  // --- 3. View event ---
  log("POST view event...");
  const viewRes = await fetch(`${base}/api/recipients/${recipientId}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.strictEqual(viewRes.status, 200);
  pass("view logged");

  // --- 4. Sign ---
  log("POST sign...");
  const signRes = await fetch(`${base}/api/recipients/${recipientId}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const signBody = await signRes.json();
  assert.strictEqual(signRes.status, 200, `sign status 200, got ${JSON.stringify(signBody)}`);
  assert.ok(signBody.certificateUrl, "sign response has certificateUrl");
  assert.strictEqual(signBody.recordStatus, "signed");
  pass("signed — record status is 'signed'");

  // --- 5. Signing again is rejected (locking, end-to-end through the API) ---
  const signAgainRes = await fetch(`${base}/api/recipients/${recipientId}/sign`, { method: "POST", body: "{}" });
  assert.strictEqual(signAgainRes.status, 409, "re-signing an already-signed recipient is rejected");
  pass("re-sign correctly rejected (409)");

  // --- 6. Certificate PDF ---
  log("GET certificate PDF...");
  const certRes = await fetch(signBody.certificateUrl);
  const certBytes = Buffer.from(await certRes.arrayBuffer());
  assert.strictEqual(certRes.status, 200);
  assert.strictEqual(certRes.headers.get("content-type"), "application/pdf");
  assert.strictEqual(certBytes.subarray(0, 5).toString("latin1"), "%PDF-", "certificate starts with a PDF header");
  pass(`certificate PDF OK (${certBytes.length} bytes)`);

  // --- 7. Landing page now shows signed state ---
  const landingRes2 = await fetch(createBody.landingUrl);
  const landingHtml2 = await landingRes2.text();
  assert.match(landingHtml2, /signed off/i);
  assert.doesNotMatch(landingHtml2, /id="signoff-btn"/);
  pass("landing page shows signed confirmation, sign button gone");

  // --- 8. Contact was upserted ---
  const contactsRes = await fetch(`${base}/api/contacts?query=jo@acme.com`);
  const contactsBody = await contactsRes.json();
  assert.strictEqual(contactsBody.contacts.length, 1, "recipient was upserted into contacts");
  assert.strictEqual(contactsBody.contacts[0].clientName, "Acme Ltd");
  pass("contact upserted from sign-off recipient");

  // --- 9. Dashboard login ---
  log("Dashboard login...");
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dan@example.com", password: "test-password-123" }),
  });
  assert.strictEqual(loginRes.status, 200, `login status 200, got ${JSON.stringify(await loginRes.clone().json())}`);
  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie, "login sets a session cookie");
  const cookie = setCookie.split(";")[0];
  pass("logged in, session cookie issued");

  // --- 10. Status table shows the record ---
  const dashRes = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } });
  const dashHtml = await dashRes.text();
  assert.strictEqual(dashRes.status, 200);
  assert.match(dashHtml, /Acme Website Redesign/);
  assert.match(dashHtml, /status-signed/);
  pass("dashboard status table shows the signed record");

  // --- 11. Detail page shows audit trail ---
  const detailRes = await fetch(`${base}/dashboard/${createBody.id}`, { headers: { Cookie: cookie } });
  const detailHtml = await detailRes.text();
  assert.strictEqual(detailRes.status, 200);
  for (const eventType of ["created", "viewed", "signed", "certificate_downloaded"]) {
    assert.ok(detailHtml.includes(eventType), `audit trail includes '${eventType}' event`);
  }
  assert.match(detailHtml, /jo@acme\.com/);
  pass("detail page shows full audit trail + recipient");

  // --- 12. Archive (admin action) ---
  const archiveRes = await fetch(`${base}/api/signoffs/${createBody.id}/archive`, { method: "POST", headers: { Cookie: cookie } });
  assert.strictEqual(archiveRes.status, 200);
  const dashAfterArchive = await (await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } })).text();
  assert.doesNotMatch(dashAfterArchive, /Acme Website Redesign/, "archived record no longer in the default list");
  pass("archive works, record hidden from default dashboard list");

  // --- 13. Branding scope end-to-end (export triggered by sign only) ---
  log("Branding scope: create -> sign -> export...");
  const brandingForm = new FormData();
  brandingForm.append(
    "data",
    JSON.stringify({
      clientName: "Acme Ltd",
      projectName: "Acme Rebrand",
      figmaFileKey: "mockfile123",
      scopeType: "branding",
      scopeLabel: "Logo & guidelines",
      requiresAllRecipients: true,
      followsSignoffId: null,
      notes: "",
      createdBy: "Dan",
      recipients: [{ name: "Jo Client", email: "jo@acme.com", contactId: null }],
      snapshots: [
        { figmaFrameKey: "10:1", figmaNodeName: "Logo Primary", sequenceOrder: 0 },
        { figmaFrameKey: "10:2", figmaNodeName: "Logo Mono", sequenceOrder: 1 },
      ],
    }),
  );
  brandingForm.append("snapshot_0", new Blob([onePxPng], { type: "image/png" }), "logo-primary.png");
  brandingForm.append("snapshot_1", new Blob([onePxPng], { type: "image/png" }), "logo-mono.png");
  const brandCreateRes = await fetch(`${base}/api/signoffs`, { method: "POST", body: brandingForm });
  const brandCreateBody = await brandCreateRes.json();
  assert.strictEqual(brandCreateRes.status, 201, JSON.stringify(brandCreateBody));
  const brandRecipientId = brandCreateBody.landingUrl.split("/").pop();

  const brandSignRes = await fetch(`${base}/api/recipients/${brandRecipientId}/sign`, { method: "POST", body: "{}" });
  const brandSignBody = await brandSignRes.json();
  assert.strictEqual(brandSignRes.status, 200, JSON.stringify(brandSignBody));
  assert.ok(brandSignBody.brandingExport, "sign response includes branding export result");
  assert.strictEqual(brandSignBody.brandingExport.status, "complete", JSON.stringify(brandSignBody.brandingExport));
  pass("branding export completed synchronously with the sign request");

  const zipRes = await fetch(brandSignBody.brandingExport.zipUrl);
  const zipBytes = Buffer.from(await zipRes.arrayBuffer());
  assert.strictEqual(zipBytes.subarray(0, 2).toString("latin1"), "PK", "exported zip starts with a ZIP header");
  const zipTmp = "/tmp/oyp-smoke-export.zip";
  await import("node:fs/promises").then((fs) => fs.writeFile(zipTmp, zipBytes));
  execFileSync("unzip", ["-t", zipTmp]);
  pass(`branding zip is valid (${zipBytes.length} bytes, unzip -t passed)`);

  const guidelinesRes = await fetch(brandSignBody.brandingExport.guidelinesUrl);
  const guidelinesBytes = Buffer.from(await guidelinesRes.arrayBuffer());
  assert.strictEqual(guidelinesBytes.subarray(0, 5).toString("latin1"), "%PDF-");
  pass("brand guidelines PDF is valid");

  console.log("\n\x1b[32mAll smoke-test steps passed.\x1b[0m");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n\x1b[31mSMOKE TEST FAILED:\x1b[0m", err);
  process.exit(1);
});
