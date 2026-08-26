# Tech Spec: Figma Sign-Off Tool

**Status:** Draft for review
**Last updated:** 26 August 2026

---

## 1. Overview

A Figma plugin that lets the team generate a client-facing landing page for design sign-off. The client views the design, reviews sign-off information, and confirms approval through a two-step confirmation flow. Every stage (sent, viewed, signed off) is tracked and logged with enough detail to serve as evidence of approval if it's ever disputed. An internal dashboard gives the team visibility into the status of every sign-off in flight.

**Goals**
- Reduce friction in getting client sign-off on Figma designs
- Provide a clear, auditable trail of who approved what, and when
- Give the team visibility into sign-off status without chasing clients over email

**Non-goals**
- This is not a legally binding e-signature product in the DocuSign sense. It's designed to produce strong evidentiary records of approval for design milestones, not to replace contract-signing tools.

---

## 2. User Flow

1. Designer finishes work in Figma, opens the plugin
2. Plugin captures: client name, recipient email(s), project name, and the relevant frame/link
3. Plugin calls backend API to create a sign-off record
4. Backend generates a unique landing page and snapshots the Figma frame
5. Client receives an email with a link to the landing page
6. Client opens the page (view event logged), reviews the design and sign-off info
7. Client selects "Sign-off" → confirmation modal ("Are you sure?") with explicit approval text
8. Client confirms → record locked, certificate generated, timestamp/IP/name/email logged
9. Team and client both receive a confirmation email with a link to the certificate
10. Team can see the full status of every sign-off (sent/viewed/signed) on the dashboard

---

## 3. System Components

### 3.1 Figma Plugin
- Built with Figma Plugin API (UI panel + main thread)
- Reads current file/frame, exports a preview image
- Collects: client name, project name, recipient email(s), scope selection, any notes
- **Required fields** — the plugin validates before allowing a send: client name, project name, at least one recipient (name + email), and a scope selection (frame/flow/full site/branding). The "Generate & Send" action stays disabled until all required fields are filled — no partial or incomplete records can be created.
- Calls backend API (`POST /signoffs`) with this data + exported image
- Displays confirmation + generated link back to the user once created

### 3.1.1 Saved Contacts
To avoid re-typing the same client details every time (e.g. homepage sign-off, then full site, then branding, all to the same person), the plugin lets the team pick from previously used contacts instead of entering details from scratch:
- After a sign-off is sent, the recipient's name, email, and associated client name are saved as a **Contact**
- Next time the plugin is opened, the team can search/select an existing contact and have name, email, and client name auto-fill — or add a new one if it's someone new
- Contacts are scoped to your team's account, not per-project, so the same person shows up regardless of which project they were first added under
- Editing a contact's details (e.g. their email changed) only affects future sign-offs — past records and certificates keep the details as they were at the time, since those are locked once signed

### 3.2 Backend API
- REST API (or similar) responsible for:
  - Creating sign-off records
  - Generating unique, unguessable landing page URLs (e.g. UUID-based)
  - Serving the landing page data
  - Logging view events
  - Handling the sign-off confirmation and generating certificates
  - Triggering notification emails
  - Serving dashboard data
- Handles auth for the dashboard (internal team only)

### 3.3 Landing Page
- Publicly accessible via unique link (no login required for client)
- Displays: Figma frame snapshot (static image, not live embed), project/client info, sign-off context
- "Sign-off" button → confirmation modal with explicit approval statement + checkbox
- On confirm: submits to backend, then shows a "You're signed off" confirmation screen with a copy of what was approved

### 3.4 Scope: Frame, Flow, Full Site, or Branding
The plugin lets the designer select what's being signed off, rather than assuming a single frame. Three scope types:

- **Single frame** — e.g. just the homepage
- **Multiple frames / full site** — e.g. homepage + inner pages, selected individually or as a set
- **Branding** — logo and brand guidelines, also designed in Figma

For each selected frame, the backend captures a static snapshot at creation time. If a flow is included, the plugin passes through the frame order so the landing page can present them in sequence.

**Staged sign-off (homepage → full site → branding)**
Rather than one record covering everything, each stage is its own sign-off record, since they typically happen at different points in the project and each needs its own clear approval:
- Homepage sign-off → separate record, own link, own certificate
- Full site / inner pages sign-off → separate record, references the homepage record it follows on from (`follows_signoff_id`)
- Branding sign-off → separate record, own link, own certificate

The dashboard groups these under the same project so the team can see the whole sequence at a glance, but each is independently sent, viewed, and signed. When the client signs off, they approve everything included in *that* record in one action — the landing page shows every frame/screen in scope so it's clear what's covered before they confirm.

**Branding sign-off → asset export**
Assets (logo files, etc.) can only be exported *after* sign-off, not before — so the export happens as a side effect of the sign-off event rather than being prepared in advance:
1. Client confirms the branding sign-off
2. Backend calls the Figma REST API to export the relevant nodes (logo variants, etc.) as PNG/SVG
3. Files are zipped and stored alongside the record
4. A brand guidelines PDF is generated (from the same content used to build the sign-off page, or a separate template)
5. Both are attached to the confirmation email / made available as a download from the certificate page

This means the export only ever happens once, triggered by the same event that locks the record — so there's no risk of a download being available before approval exists.

**Locking after sign-off**
Once a record is signed, it's locked — treated as the agreed, final version. Any further changes to that scope (homepage, full site, or branding) are out of scope for the original engagement and would need a new sign-off record (and, per your process, would be chargeable as additional work). The record stores a `follows_signoff_id`/`superseded_by` reference so the dashboard can show the chain if a design is revisited later — but the original signed record and its certificate are never edited, only superseded.

### 3.5 Dashboard (internal)
- Table view of all sign-off records: client, project, status (Sent/Viewed/Signed/Expired), timestamps
- Filter/search by client, project, date, status
- Detail view per record: full audit trail + link to download certificate
- Manual actions: resend link, archive/delete a record
- **Role-based access**: two roles to start —
  - **Viewer** — can see status and audit trail, no destructive actions
  - **Admin** — can also resend, archive, and manage records
  (Can extend later if more granularity is needed, but two roles covers the "some people just need to see it" vs "some people manage it" split for now.)

### 3.6 Notifications
- Email on landing page creation (to client)
- Email on sign-off completion (to both team and client), including certificate link

---

## 4. Data Model

**SignoffRecord**
| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key, also used in landing page URL |
| project_name | string | |
| client_name | string | |
| scope_label | string | e.g. "Homepage only", "Full site — 6 pages", "Branding — logo & guidelines" |
| scope_type | enum | single_frame / multi_frame / flow / branding |
| status | enum | sent / partially_viewed / partially_signed / signed / locked / cancelled |
| requires_all_recipients | boolean | If true, status only reaches "signed" once every recipient has confirmed |
| follows_signoff_id | UUID | nullable — links this record to the one it comes after (e.g. full site follows homepage) |
| superseded_by | UUID | nullable — set if a later record replaces this one after further paid changes |
| created_at | timestamp | |
| created_by | string | Internal user (designer) |
| archived_at | timestamp | nullable — manual archive/delete, no auto-expiry |

**FrameSnapshot** (one-to-many with SignoffRecord)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| signoff_id | UUID | FK |
| figma_frame_key | string | |
| snapshot_url | string | Static image, captured at creation |
| sequence_order | integer | For ordering flows/multi-frame galleries |

**Contact** (saved recipient details, reusable across sign-offs)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| name | string | |
| email | string | |
| client_name | string | Associated client/organisation, for grouping in the picker |
| created_at | timestamp | |
| last_used_at | timestamp | Updated each time selected for a new sign-off |

**Recipient** (one-to-many with SignoffRecord — one row per email, since multiple people may need to individually confirm)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| signoff_id | UUID | FK |
| contact_id | UUID | nullable FK — set if selected from an existing saved contact |
| email | string | Copied at time of sending, not a live reference — see note below |
| name | string | Copied at time of sending |
| status | enum | sent / viewed / signed |
| first_viewed_at | timestamp | nullable |
| signed_at | timestamp | nullable |

Recipient stores its own copy of name/email rather than only pointing to the Contact record — so if a contact's saved details are edited later, past sign-off records still reflect exactly what the client saw and signed at the time.

**EventLog** (one-to-many with SignoffRecord, references Recipient where relevant)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| signoff_id | UUID | FK |
| recipient_id | UUID | FK, nullable (null for record-level events like "created") |
| event_type | enum | created / viewed / signed / resent / archived |
| timestamp | timestamp | |
| ip_address | string | Captured on view + sign events |
| metadata | JSON | e.g. user agent, referrer |

**Certificate** (one per Recipient sign-off — each confirming recipient gets their own certificate, tied to the shared scope/snapshots)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| signoff_id | UUID | FK |
| recipient_id | UUID | FK |
| signer_name | string | |
| signer_email | string | |
| signed_at | timestamp | |
| ip_address | string | |
| approval_text | string | Exact text the client agreed to, including scope approved and the "further changes are chargeable" warning |
| snapshot_ids | array<UUID> | Which FrameSnapshots this approval covers |
| record_hash | string | Hash of the above fields, for tamper-evidence |

Certificates don't need a pre-generated stored PDF file. Since all the underlying data (signer info, timestamp, approval text, snapshots) is already stored, the PDF is generated on demand when someone clicks "Download PDF" — same content every time, just rendered on request rather than stored as a static file. Keeps storage simpler and means there's nothing to regenerate if the certificate template changes later. Each download can still be logged as an event, so there's a record of who accessed it and when.

**BrandingExport** (only created for `scope_type = branding` records, after sign-off)
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| signoff_id | UUID | FK |
| triggered_at | timestamp | Set at the moment sign-off completes |
| zip_url | string | Exported logo files (PNG/SVG), generated post sign-off via Figma API |
| guidelines_pdf_url | string | Brand guidelines document |

---

## 5. Open Questions — Resolved

- **Link expiry** — no automatic expiry. Links stay live indefinitely; team can manually archive/delete a record from the dashboard, and can download a certificate PDF at any point for offline record-keeping.
- **Multiple recipients** — supported. Most sign-offs will have one recipient, but a record can have several emails attached (e.g. client + internal stakeholders). Each recipient is tracked individually. Whether a sign-off requires *all* recipients to confirm or just one is configurable per record (`requires_all_recipients`).
- **Re-sign on design changes** — resolved by the locking model: a signed record is final. Any change to that scope after sign-off is a new piece of work, requiring a new sign-off record (chargeable, per your process) rather than editing or re-triggering the original.
- **Certificate storage** — resolved: no stored PDF file needed. Certificates render on demand from data already in the database (signer info, timestamp, approval text, snapshot references), so there's nothing to retain or regenerate beyond the underlying records themselves, which persist indefinitely (no auto-expiry).
- **Dashboard access control** — role-based: Viewer (see status/audit trail only) and Admin (can also resend, archive, manage records). See Section 3.5.
- **Scope selection UX** — resolved: client approves everything in the record in one action. The landing page shows every frame/screen included so it's clear what's covered before they confirm.

### Still open

- **Figma file permissions** — confirmed direction is the static snapshot approach (avoids needing "anyone with link" sharing), but worth a final sanity check once the plugin is exporting real files that this covers every case you need (e.g. components/variants rendering correctly in exports).
- **Staged sign-off sequencing** — should the tool prevent a "full site" sign-off from being sent before the homepage one is signed, or just leave that as a process convention the team follows manually?
- **Branding export scope** — for the logo zip, is it every exported variant/format in the file, or does the designer pick specific nodes at the time of setting up the sign-off?

---

## 6. Tech Stack

- **Plugin:** Figma Plugin API (TypeScript)
- **Backend:** Node.js/TypeScript API — confirmed
- **Hosting:** Vercel — confirmed (for now)
- **Database:** Supabase (Postgres) — free tier, bundles auth + file storage in one
- **File storage:** Supabase Storage (same free tier) for snapshots and exported logo zips
- **Email:** Resend — solid free tier for transactional email, integrates cleanly with Node/Vercel
- **Dashboard:** Next.js on Vercel, same project as the backend
- **PDF generation:** Rendered on demand with a library (e.g. `@react-pdf/renderer` or Puppeteer) rather than a paid PDF API — free, no per-document cost
- **Figma asset export (branding):** Figma REST API using a personal or team access token — free within Figma's API rate limits

Worth flagging: free tiers come with limits (e.g. a paused project after inactivity, capped monthly email sends). Fine to start with, and cheap to move off if volume grows — not worth over-engineering around now.

---

## 7. Risks / Considerations

- The audit trail is only as strong as its weakest logged event — if any sign-off is missing a piece of data (e.g. IP address, due to a bug or an inconsistency between scope types), that specific record is weaker as evidence. The logging logic needs to work the same way across every scope type and code path, not just be solid on the first version built.
- If sign-off carries real legal/financial weight beyond "client confirmed the design," recommend legal review of the approval wording
- Static snapshots avoid Figma permission issues but mean the client isn't looking at a live, interactive file — worth confirming this is acceptable for your use case
- The "further changes are chargeable" language needs to be worded carefully in the approval text (Section 3.4) so it's unambiguous to the client at the moment they sign — worth a quick pass with whoever owns client contracts/wording
