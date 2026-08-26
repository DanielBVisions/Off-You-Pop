# Build Brief: Figma Sign-Off Tool

**For:** Claude Code
**Source spec:** figma-signoff-tech-spec.md (full detail — refer back to it for anything ambiguous here)

---

## What we're building

A Figma plugin + web backend that lets a design team send clients a link to review and formally sign off on design work (homepage, full site, or branding/logo assets), with a full audit trail suitable as evidence of approval, and an internal dashboard to track status.

**Not in scope:** legally binding e-signature in the DocuSign sense. This produces a strong evidentiary record of approval, not a notarized signature.

---

## Confirmed stack

- **Backend:** Node.js / TypeScript
- **Hosting:** Vercel
- **Database + storage:** Supabase (Postgres + Storage + Auth) — free tier
- **Email:** Resend — free tier
- **Dashboard:** Next.js (same Vercel project as backend)
- **PDF generation:** On-demand render, no stored file (e.g. `@react-pdf/renderer` or Puppeteer)
- **Figma export:** Figma REST API via personal/team access token
- **Plugin:** Figma Plugin API (TypeScript)

---

## Core components to build

1. **Figma plugin** — collects sign-off details, exports frame snapshots, calls the backend
2. **Backend API** — creates records, generates landing pages, logs events, handles sign-off, triggers exports/emails
3. **Landing page** (public, no login) — shows the design scope, handles the sign-off confirmation flow
4. **Dashboard** (internal, authed) — status table + audit trail + certificate access
5. **Notification emails** — sent on creation and on sign-off completion

---

## Data model

Build these tables/entities (see full spec for field-by-field detail):

- **SignoffRecord** — one per sign-off (homepage / full site / branding are separate records, linked via `follows_signoff_id`). Locked once signed — never edited after, only superseded by a new record.
- **FrameSnapshot** — one or more per record, static image exports captured at creation time, ordered by `sequence_order`.
- **Recipient** — one per email on a record (supports multiple people per sign-off). Stores its own copy of name/email at time of sending, independent of the linked Contact.
- **Contact** — reusable saved recipient (name, email, client_name), selectable in the plugin to auto-fill instead of retyping.
- **EventLog** — append-only log of every event (created / viewed / signed / resent / archived), with timestamp + IP + metadata. **This must be implemented consistently across every code path that can produce an event** — no scope type or flow should have gaps in this logging, since the audit trail is only as strong as its weakest logged event.
- **Certificate** — one per recipient sign-off. No stored PDF file; rendered on demand from the record's own data (signer info, timestamp, approval text, snapshot references, the "further changes are chargeable" wording).
- **BrandingExport** — only for `scope_type = branding`, created after sign-off completes (never before). Triggers a Figma API export of the relevant nodes into a zip, plus a generated brand guidelines PDF.

---

## Required validation (plugin)

Before the plugin allows a send, it must have:
- Client name
- Project name
- At least one recipient (name + email — either typed or selected from a saved Contact)
- A scope selection (single frame / multiple frames / flow / branding)

The send action stays disabled until all of these are present. No partial records should be creatable via the API either — validate server-side too, not just in the plugin UI.

---

## Key behavioral rules (don't skip these)

- **No link expiry.** Ever. Records are archived/deleted manually from the dashboard, not auto-expired.
- **Locking.** Once a record reaches "signed," it is immutable. Further changes need a brand-new SignoffRecord (referencing the old one via `follows_signoff_id` / `superseded_by`), not an edit.
- **Snapshots, not live embeds.** Default to static image exports of frames rather than live Figma embeds — avoids needing "anyone with the link" sharing permissions and keeps what the client approved fixed in time.
- **Multi-recipient tracking.** Each recipient's viewed/signed status is tracked individually. `requires_all_recipients` on the record controls whether the record only reaches "signed" once everyone has confirmed, or just one person.
- **Branding export ordering.** Export must only be triggered by the sign-off completion event — never allow the zip/PDF to be generated or downloadable before that event has fired.
- **Contact edits don't rewrite history.** Editing a saved Contact's details only affects future sign-offs. Past Recipient rows keep the details as they were at the time they were sent.
- **Two-step confirmation on the landing page.** "Sign-off" click → explicit "are you sure" modal with approval text (including scope + chargeable-changes wording) → only then does the record lock and log the signing event.

---

## Suggested build order

1. Data model + migrations in Supabase
2. Backend API: create record, generate landing page URL, serve record data
3. Landing page: display scope/snapshots, two-step sign-off flow, event logging (view + sign)
4. Figma plugin: form UI with validation, Contact picker, snapshot export, call to backend
5. Email notifications (creation + sign-off complete)
6. Certificate rendering (on-demand PDF)
7. Branding export flow (Figma API export → zip + guidelines PDF, triggered post-signoff)
8. Dashboard: status table, audit trail detail view, role-based access (Viewer/Admin), resend/archive actions

---

## Open questions to flag back to the team (not yet decided)

- Should the tool block sending a "full site" sign-off before "homepage" is signed, or leave that as a manual process convention?
- For branding exports, does the export include every variant/format in the file, or does the designer pick specific nodes when setting up the sign-off?
