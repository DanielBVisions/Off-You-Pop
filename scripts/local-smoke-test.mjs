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
  // Supabase projects always have these three roles built in; a vanilla
  // Postgres doesn't, so schema.sql's grants (added after hitting
  // "permission denied for schema off_you_pop" against a real project —
  // service_role bypasses RLS but not schema-level grants) need them
  // stubbed here to apply locally at all.
  psql(`do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;`);
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

  log("GET /api/health...");
  const healthRes = await fetch(`${base}/api/health`);
  const healthBody = await healthRes.json();
  assert.strictEqual(healthBody.supabase.reachable, true, JSON.stringify(healthBody));
  assert.strictEqual(healthBody.resend.ok, true, JSON.stringify(healthBody));
  pass("health check reports Supabase + Resend both reachable");

  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  // Mirrors the plugin's two-step flow (see api/signoffs/index.js's header
  // comment): JSON-only create, then one raw-bytes upload per frame,
  // targeting the snapshot row ids the create response hands back.
  async function createSignoffTwoStep(payload, images) {
    const createRes = await fetch(`${base}/api/signoffs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 201, `create status 201, got ${createRes.status}: ${JSON.stringify(createBody)}`);
    assert.strictEqual(createRes.headers.get("access-control-allow-origin"), "*", "create response carries CORS header");
    assert.ok(createBody.id && createBody.landingUrl, "response has id + landingUrl");
    assert.strictEqual(createBody.snapshots.length, images.length, "response returns one snapshot row per image");

    const bySequence = createBody.snapshots.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    for (let i = 0; i < bySequence.length; i++) {
      const uploadRes = await fetch(`${base}/api/signoffs/${createBody.id}/snapshot?snapshotId=${bySequence[i].id}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: images[i],
      });
      const uploadBody = await uploadRes.json();
      assert.strictEqual(uploadRes.status, 200, `snapshot upload ${i} status 200, got ${JSON.stringify(uploadBody)}`);
    }
    return createBody;
  }

  // --- 0. CORS — the actual bug found via the Figma plugin console: its
  // UI runs in an origin "null" iframe, and a browser blocks any
  // cross-origin fetch without an explicit Access-Control-Allow-Origin,
  // failing silently before the request even reaches the server (nothing
  // in Vercel's logs). Verify both the preflight and the real response
  // carry it, not just assume the header is there. ---
  log("CORS preflight + headers on /api/signoffs...");
  const preflightRes = await fetch(`${base}/api/signoffs`, {
    method: "OPTIONS",
    headers: { Origin: "null", "Access-Control-Request-Method": "POST" },
  });
  assert.strictEqual(preflightRes.status, 204, "OPTIONS preflight returns 204");
  assert.strictEqual(preflightRes.headers.get("access-control-allow-origin"), "*", "preflight allows any origin");
  pass("CORS preflight handled correctly");

  // --- 1. Create a single_frame sign-off (plugin flow) ---
  log("POST /api/signoffs (create) + snapshot upload...");
  const createBody = await createSignoffTwoStep(
    {
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
      snapshots: [{ figmaFrameKey: "1:23", figmaNodeName: "Homepage", sequenceOrder: 0, figmaFrameWidth: 1440, figmaFrameHeight: 900 }],
    },
    [onePxPng],
  );
  pass(`created ${createBody.id}`);

  // The plugin now exports SVG, not PNG (see plugin/src/code.ts) — the
  // snapshot endpoint has to actually honor whatever Content-Type it's
  // given rather than hardcoding .png, or every real upload from the
  // rebuilt plugin would get mislabeled in Storage. Re-upload onto the
  // same already-created row with an SVG body and confirm the extension
  // follows the real content type.
  const svgSnapshotId = createBody.snapshots[0].id;
  const svgUploadRes = await fetch(`${base}/api/signoffs/${createBody.id}/snapshot?snapshotId=${svgSnapshotId}`, {
    method: "POST",
    headers: { "Content-Type": "image/svg+xml" },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
  });
  const svgUploadBody = await svgUploadRes.json();
  assert.strictEqual(svgUploadRes.status, 200, `SVG snapshot upload status 200, got ${JSON.stringify(svgUploadBody)}`);
  assert.match(svgUploadBody.snapshotUrl, /\.svg$/, "SVG upload is stored with a .svg extension, not hardcoded .png");
  pass("SVG snapshot upload stores with the correct extension");

  const recipientId = createBody.landingUrl.split("/").pop();

  // --- 2. Landing page shows the sign form ---
  log("GET landing page (before signing)...");
  const landingRes1 = await fetch(createBody.landingUrl);
  const landingHtml1 = await landingRes1.text();
  assert.strictEqual(landingRes1.status, 200);
  assert.match(landingHtml1, /Acme Website Redesign/);
  assert.match(landingHtml1, /Sign off/);
  assert.match(landingHtml1, /style="width:1440px"/, "frame displays at its recorded Figma design width, not the exported image's own pixel size");
  pass("landing page renders scope + sign button");

  // --- 2b. Regression test for the nested-html`` double-escaping bug: the
  // sign-off confirmation modal (rendered via a nested html`` call inside
  // renderSignOffModal) must appear as real markup, not as escaped entities
  // sitting visibly in the page body. Also checks the sticky top bar (the
  // project-info + Sign off button that replaced the old light-colored
  // header block above the carousel) renders correctly. ---
  assert.match(landingHtml1, /<h2>Confirm sign-off<\/h2>/, "sign-off modal renders as real markup, not escaped");
  assert.doesNotMatch(landingHtml1, /&lt;h2&gt;Confirm sign-off/, "sign-off modal is not double-escaped");
  assert.match(landingHtml1, /<span class="stage-bar-title">Acme Website Redesign<\/span>/, "stage bar shows the project name");
  assert.match(landingHtml1, /id="signoff-btn"/, "sign-off button renders in the stage bar");
  pass("nested modal markup is not double-escaped, and the stage bar renders correctly");

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

  // Regression check for the exact bug reported live: the recipient row's
  // certificate link (built via a nested html`` call not wrapped in raw())
  // rendered as visible literal tag text next to the status pill instead
  // of an actual link.
  assert.match(detailHtml, /<a class="btn btn-secondary"[^>]*>Certificate<\/a>/, "certificate link renders as a real link, not escaped tag text");
  assert.doesNotMatch(detailHtml, /&lt;a class=&quot;btn/, "certificate link markup is not double-escaped");
  pass("dashboard recipient certificate link is not double-escaped");

  // --- 12. Archive (admin action) ---
  const archiveRes = await fetch(`${base}/api/signoffs/${createBody.id}/archive`, { method: "POST", headers: { Cookie: cookie } });
  assert.strictEqual(archiveRes.status, 200);
  const dashAfterArchive = await (await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } })).text();
  assert.doesNotMatch(dashAfterArchive, /Acme Website Redesign/, "archived record no longer in the default list");
  pass("archive works, record hidden from default dashboard list");

  // --- 13. Branding scope end-to-end (export triggered by sign only) ---
  log("Branding scope: create -> upload -> sign -> export...");
  const brandCreateBody = await createSignoffTwoStep(
    {
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
        { figmaFrameKey: "10:1", figmaNodeName: "Logo Primary", sequenceOrder: 0, figmaFrameWidth: 800, figmaFrameHeight: 800 },
        { figmaFrameKey: "10:2", figmaNodeName: "Logo Mono", sequenceOrder: 1, figmaFrameWidth: 400, figmaFrameHeight: 400 },
      ],
    },
    [onePxPng, onePxPng],
  );
  const brandRecipientId = brandCreateBody.landingUrl.split("/").pop();

  // Multi-frame carousel: nav arrows and the "name · 1 / N" counter pill
  // should only appear once there's more than one frame to flick through.
  const brandLandingHtml = await (await fetch(brandCreateBody.landingUrl)).text();
  assert.match(brandLandingHtml, /<div class="carousel-slide is-active" data-index="0">/, "first frame starts active");
  assert.match(brandLandingHtml, /id="carousel-prev"/, "carousel has a prev button for multi-frame sign-offs");
  assert.match(brandLandingHtml, /id="carousel-next"/, "carousel has a next button for multi-frame sign-offs");
  assert.match(brandLandingHtml, /Logo Primary · 1 \/ 2/, "counter pill shows the first frame's name alongside 1 / 2");
  assert.match(brandLandingHtml, /style="width:800px"/, "first frame uses its own recorded design width");
  assert.match(brandLandingHtml, /style="width:400px"/, "second frame uses its own (different) recorded design width, independent of the first");
  pass("multi-frame carousel renders nav + name-and-counter pill, each frame at its own design width");

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

  // --- 14. Reset (testing helper): puts a signed record back to unsigned
  // so it can be re-signed — for QA re-runs, not for correcting a real
  // client sign-off. The certificate/branding-export rows it deletes carry
  // real unique constraints (one certificate per recipient, one export per
  // sign-off), so if the delete didn't actually happen, re-signing would
  // 500 on a duplicate key rather than succeed. ---
  log("Reset a signed branding sign-off and re-sign it...");
  const resetRes = await fetch(`${base}/api/signoffs/${brandCreateBody.id}/reset`, { method: "POST", headers: { Cookie: cookie } });
  const resetBody = await resetRes.json();
  assert.strictEqual(resetRes.status, 200, `reset status 200, got ${JSON.stringify(resetBody)}`);
  assert.strictEqual(resetBody.status, "sent", "record status back to 'sent' after reset");
  pass("reset returns record to 'sent'");

  const brandSignAgainRes = await fetch(`${base}/api/recipients/${brandRecipientId}/sign`, { method: "POST", body: "{}" });
  const brandSignAgainBody = await brandSignAgainRes.json();
  assert.strictEqual(brandSignAgainRes.status, 200, `re-sign after reset status 200, got ${JSON.stringify(brandSignAgainBody)}`);
  assert.strictEqual(brandSignAgainBody.brandingExport.status, "complete", "branding export re-triggers on the post-reset sign");
  pass("re-signing after reset succeeds (old certificate/export were actually cleared, not left dangling)");

  const brandDetailHtml = await (await fetch(`${base}/dashboard/${brandCreateBody.id}`, { headers: { Cookie: cookie } })).text();
  assert.match(brandDetailHtml, />reset</, "audit trail includes the 'reset' event");
  pass("reset is recorded in the audit trail");

  console.log("\n\x1b[32mAll smoke-test steps passed.\x1b[0m");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n\x1b[31mSMOKE TEST FAILED:\x1b[0m", err);
  process.exit(1);
});
