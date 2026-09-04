# Off You Pop

A Figma plugin + web backend for client design sign-off: send a client a
link to review and formally approve design work (homepage, full site, or
branding/logo assets), with a full audit trail suitable as evidence of
approval, and an internal dashboard to track status.

Not a legally binding e-signature product (not DocuSign) — it produces a
strong evidentiary record of approval, not a notarized signature.

Full detail: [`docs/api-contract.md`](docs/api-contract.md) (backend
contract), [`docs/build-brief.md`](docs/build-brief.md) and
[`docs/tech-spec.md`](docs/tech-spec.md) (the original spec this was built
from).

## Status

Everything in the brief's suggested build order is implemented:

1. ✅ [Figma plugin](plugin/)
2. ✅ Data model + migrations — [`supabase/schema.sql`](supabase/schema.sql)
3. ✅ Backend API — [`api/`](api/), contract in [`docs/api-contract.md`](docs/api-contract.md)
4. ✅ Landing page — [`api/s/[id].js`](api/s/[id].js) + [`lib/landing-template.js`](lib/landing-template.js)
5. ✅ Email notifications — [`lib/resend.js`](lib/resend.js) + [`lib/emails.js`](lib/emails.js)
6. ✅ Certificate rendering — [`api/certificate/[id].js`](api/certificate/[id].js) + [`lib/pdf.js`](lib/pdf.js)
7. ✅ Branding export — [`lib/branding-export.js`](lib/branding-export.js)
8. ✅ Dashboard — [`api/dashboard/`](api/dashboard/) + [`lib/dashboard-template.js`](lib/dashboard-template.js)

**Not yet done, on you:** actually provisioning Supabase/Resend/Figma and
deploying to Vercel (see below), and trying it against real client data.
Everything here has been tested against a real local Postgres and a full
mocked-service run (`npm run test:smoke`), but never against the real
Supabase/Resend/Figma APIs — this environment's network access is locked
down to a handful of hosts, so it physically couldn't reach them (see "Why
no dependencies" below). That's the one gap between "built" and "proven in
production."

## Why no dependencies

This whole backend — API, landing page, dashboard, PDF certs, ZIP export —
has **zero npm dependencies**, deliberately. It was built in a sandbox
with no network access to the npm registry (same constraint noted in
`plugin/README.md`), so nothing installable — Next.js, `@supabase/supabase-js`,
`resend`, `@react-pdf/renderer` — could be used. Rather than write dead
code the sandbox couldn't run, it uses only Node's built-ins:

- **No Next.js** — plain [Vercel Node.js serverless functions](https://vercel.com/docs/functions)
  (`api/**/*.js`, each exporting `(req, res) => {}`), which is a first-class
  zero-dependency way to deploy on Vercel, not a workaround. `vercel.json`
  adds a few rewrites so `/s/:id` and `/dashboard` are the public URLs
  instead of `/api/s/:id`.
- **No Supabase or Resend SDKs** — both have plain REST APIs; `lib/supabase.js`
  and `lib/resend.js` call them with `fetch`. Documented, supported, and
  arguably *better* here (smaller cold-start bundle) — not a lesser
  substitute.
- **No PDF/ZIP libraries** — `lib/pdf.js` and `lib/zip.js` *are* genuine
  stand-ins: hand-rolled writers (plain-text certificates via the standard
  Helvetica font, no embedded images; ZIP via Node's built-in `zlib`).
  Both produce spec-correct output (verified — see Testing below) but
  `@react-pdf/renderer`/`archiver` would give nicer output if you ever
  install them.

None of this needs undoing to work correctly in production — only the PDF
layout and lack of a richer framework are things you'd improve later, not
fix.

## Testing

Two local test scripts, no external accounts needed:

```
npm run test:pdf-zip   # structural validation of the hand-rolled PDF/ZIP writers
npm run test:smoke     # full create -> view -> sign -> certificate -> branding-export ->
                        # dashboard-login -> audit-trail -> archive flow, over real HTTP
```

`test:smoke` spins up a throwaway local Postgres database (real
`schema.sql`, real triggers — the locking and append-only-audit-log rules
are actually exercised, not assumed), plus `scripts/mock-external-services.mjs`
standing in for Supabase/Resend/Figma, plus `scripts/dev-server.mjs`
serving `api/` the same way Vercel would. See those three files' header
comments for how each works. This is dev/test-only infrastructure — it's
never part of what deploys.

To poke around manually: `npm run dev` starts the same dev server on
`:3000` (you'll need to export the env vars below, pointed at either the
mocks or real provisioned services).

## Environment variables

| Variable | Used for |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Postgres/Storage access (bypasses RLS — never expose this to a browser) |
| `SUPABASE_ANON_KEY` | Auth token exchange only (`lib/supabase.js`'s sign-in/get-user calls) |
| `RESEND_API_KEY` | Sending emails |
| `RESEND_FROM_EMAIL` | The "from" address (needs to be on a domain verified in Resend) |
| `FIGMA_ACCESS_TOKEN` | Personal or team access token, for the branding-export Figma API calls |
| `SESSION_SECRET` | Any long random string — signs the dashboard session cookie |
| `SITE_URL` | Your deployed URL (e.g. `https://off-you-pop.vercel.app`) — used to build landing/certificate links |
| `PLUGIN_API_KEY` | Optional — see `docs/api-contract.md`'s "Auth" section. Unset = plugin endpoints are open |
| `TEAM_NOTIFICATION_EMAIL` | Optional, comma-separated — who gets the internal "signed" notification |
| `SUPABASE_DB_SCHEMA` | Optional, default `off_you_pop` — see "Provisioning Supabase" below. Only change this if you deliberately renamed the schema in `schema.sql` |

Set these in Vercel's Project Settings → Environment Variables.

## Provisioning Supabase

**You don't need a dedicated/new Supabase project.** Everything here lives
in its own `off_you_pop` Postgres schema, not `public` — so this installs
cleanly into a project you're already using for something else, with zero
risk to your existing tables (handy if you're on the free tier's 2-project
limit).

1. Open an existing project, or create one at [supabase.com](https://supabase.com) (free tier is fine either way).
2. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql) in full.
3. **Settings → API → "Exposed schemas"** → add `off_you_pop` to the list.
   This step is easy to miss and required — PostgREST only serves `public`
   by default, so without this every API call 404s/406s even though the
   tables exist and the URL/keys are right.
4. Storage → create two **public** buckets: `snapshots` and `branding-exports`.
   (If those names collide with buckets an existing project already uses
   for something else, rename them here and update the bucket names in
   `lib/branding-export.js` and `api/signoffs/index.js` to match.)
5. Authentication → add a user (email/password) for each dashboard teammate.
6. SQL Editor → for each of those users, insert their `team_members` row:
   ```sql
   insert into off_you_pop.team_members (id, email, name, role)
   values ('<their auth.users id>', 'dan@example.com', 'Dan', 'admin');
   -- role is 'viewer' or 'admin' — see tech-spec.md §3.5
   ```
   There's no self-signup for the dashboard by design — a Supabase Auth
   account alone isn't enough to log in; the `team_members` row is what
   grants dashboard access at all, and its `role` decides what they can do.
7. Settings → API → copy the Project URL, `anon` key, and `service_role`
   key into your env vars above.

## Deploying

Point Vercel at this repo (project root, not `plugin/` — that's a
separate, unrelated deploy target you load into Figma, not Vercel). No
build command needed (no framework, no dependencies to install). Set the
env vars above, deploy, then:

- Update `plugin/manifest.json`'s `networkAccess.allowedDomains` to your
  real deployed domain, rebuild the plugin (`cd plugin && npm run build`),
  and redistribute it — see `plugin/README.md`.
- Point the plugin's Settings panel at your deployed URL.

## Confirmed stack

- **Backend:** Node.js, hosted on Vercel (plain serverless functions, no framework)
- **Database + storage:** Supabase (Postgres + Storage + Auth), free tier, via its REST APIs
- **Email:** Resend, free tier, via its REST API
- **Dashboard:** server-rendered HTML from the same Vercel project as the backend
- **PDF generation:** on-demand render, no stored file, hand-rolled writer
- **Figma export:** Figma REST API (branding assets, post sign-off only)
- **Plugin:** Figma Plugin API (TypeScript)

## Decisions made so far (not yet in the original spec)

- **Branding scope selection:** the designer selects the specific
  nodes/assets in scope directly in the plugin (not "export everything in
  the file") — same selection mechanism as the other scope types.
- **Sequencing:** not enforced. Homepage / full site / branding sign-offs
  are fully independent records; `follows_signoff_id` is for dashboard
  grouping only, never a blocker.
- **Public links are per-recipient, not per-record** — see
  `docs/api-contract.md`'s "Public link scheme" section for why.
- **Isolated Supabase schema (`off_you_pop`), not `public`** — added after
  hitting the free tier's project limit while testing. Lets this share an
  existing Supabase project with anything else already in it, rather than
  needing a dedicated one. See "Provisioning Supabase" above.
- **Plugin auth**: an optional `PLUGIN_API_KEY` — see `docs/api-contract.md`'s
  "Auth" section.
- **Branding export formats:** exports both PNG and SVG for every
  node/frame in scope, since the "does the export include every
  variant/format, or does the designer pick" question is still genuinely
  open (per the brief) — safest default until that's settled with the
  team. `lib/branding-export.js` has the detail.

## Known gaps / next things to tighten

- **No refresh-token flow** for the dashboard session — it just asks for a
  re-login once the ~1hr Supabase access token expires. Fine for an
  internal tool; a proper refresh flow is a small addition if it's ever
  annoying in practice.
- **Branding export runs inline** within the sign request rather than via
  a background job/queue (no queue infrastructure to build this against
  in this environment) — fine for a handful of exported nodes within
  Vercel's function time limit, but worth revisiting if export volume/size
  grows a lot.
- **Certificate PDFs are plain text** (see "Why no dependencies") — no
  embedded snapshot thumbnails, no branding. Swap in a real PDF library
  once you have normal npm access if you want richer output; the data
  going into it is already correct.
- **Never tested against real Supabase/Resend/Figma** (see "Status") —
  the REST calls are written correctly per each service's documented API,
  but "written correctly" and "verified against the real thing" aren't
  the same claim. Worth a careful first real run before relying on it for
  an actual client.
