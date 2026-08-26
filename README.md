# Off You Pop

A Figma plugin + web backend for client design sign-off: send a client a
link to review and formally approve design work (homepage, full site, or
branding/logo assets), with a full audit trail suitable as evidence of
approval, and an internal dashboard to track status.

Not a legally binding e-signature product (not DocuSign) — it produces a
strong evidentiary record of approval, not a notarized signature.

Full detail: [`docs/api-contract.md`](docs/api-contract.md) (backend
contract) and the original brief/tech spec this was built from.

## Status

**Phase 1 only: the Figma plugin.** See [`plugin/`](plugin/). Nothing else
(backend, landing page, dashboard, emails, certificates, branding export)
exists yet — those are separate, later phases per the build brief's
suggested order:

1. ~~Figma plugin~~ ← you are here
2. Data model + migrations (Supabase)
3. Backend API: create record, generate landing page URL, serve record data
4. Landing page: scope/snapshots, two-step sign-off flow, event logging
5. Email notifications (creation + sign-off complete)
6. Certificate rendering (on-demand PDF)
7. Branding export flow (Figma API export → zip + guidelines PDF)
8. Dashboard: status table, audit trail, role-based access, resend/archive

## Confirmed stack

- **Backend:** Node.js / TypeScript, hosted on Vercel
- **Database + storage:** Supabase (Postgres + Storage + Auth), free tier
- **Email:** Resend, free tier
- **Dashboard:** Next.js, same Vercel project as the backend
- **PDF generation:** on-demand render, no stored file
- **Figma export:** Figma REST API (branding assets, post sign-off)
- **Plugin:** Figma Plugin API (TypeScript)

## Decisions made so far (not yet in the original spec)

- **Branding scope selection:** the designer selects the specific
  nodes/assets in scope directly in the plugin (not "export everything in
  the file") — same selection mechanism as the other scope types.
- **Sequencing:** not enforced. Homepage / full site / branding sign-offs
  are fully independent records; `follows_signoff_id` is for dashboard
  grouping only, never a blocker.
