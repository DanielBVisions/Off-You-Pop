# Plugin → Backend API contract

This is the contract the Figma plugin (`/plugin`) is built against. The
backend doesn't exist yet — this is the spec for it, written from the
plugin side, so implementation can follow it exactly rather than the
plugin and backend drifting apart. Sourced from `figma-signoff-tech-spec.md`
§4 and the build brief.

The plugin's **Settings** panel stores an `apiBaseUrl` (per-user, via
`figma.clientStorage`). All paths below are relative to that base URL.
Until it's set, the plugin disables sending.

---

## `POST /api/signoffs`

Creates a `SignoffRecord`, its `Recipient` rows, and its `FrameSnapshot`
rows in one call, uploading the exported frame images at the same time.

**Request:** `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `data` | JSON string (see below) | All non-file fields |
| `snapshot_0`, `snapshot_1`, … | file (PNG) | One per entry in `data.snapshots`, indexed positionally — `snapshot_N` corresponds to `data.snapshots[N]` |

`data` JSON shape:

```jsonc
{
  "clientName": "Acme Ltd",
  "projectName": "Acme Website Redesign",
  "scopeType": "single_frame", // "single_frame" | "multi_frame" | "flow" | "branding"
  "scopeLabel": "Homepage only",
  "requiresAllRecipients": true,
  "followsSignoffId": null, // UUID string, or null — optional, for dashboard grouping only, not enforced
  "notes": "",
  "createdBy": "Dan", // figma.currentUser.name at time of send
  "recipients": [
    { "name": "Jo Client", "email": "jo@acme.com", "contactId": null }
  ],
  "snapshots": [
    { "figmaFrameKey": "1:23", "figmaNodeName": "Homepage", "sequenceOrder": 0 }
  ]
}
```

**Server responsibilities (not the plugin's):**
- Validate all required fields server-side too (client name, project name,
  ≥1 recipient with name+email, a scope type, ≥1 snapshot) — the plugin
  validates client-side, but per the brief this must not be trusted alone.
- Generate the `SignoffRecord.id` (UUID) and the landing page URL.
- Store each uploaded PNG in Supabase Storage and create the matching
  `FrameSnapshot` row (`snapshot_url`, `sequence_order`).
- For each recipient: upsert a `Contact` (by email, scoped to the team)
  with the given name/email/clientName and `last_used_at = now()`, but
  store the `Recipient` row with its own **copied** name/email — never a
  live reference to the Contact. If `contactId` is present, link
  `Recipient.contact_id` to it but still copy the fields.
- Write an `EventLog` row with `event_type = "created"` (record-level,
  `recipient_id = null`).
- Send the "landing page created" notification email (Resend) to each
  recipient.
- If `followsSignoffId` is present, verify it exists and belongs to the
  same client — but do **not** block creation if the referenced record
  isn't signed yet. Sequencing is a manual team convention, not enforced
  (confirmed decision — see brief's "still open" questions).

**Response:** `201 Created`

```json
{ "id": "b3c1...", "landingUrl": "https://off-you-pop.vercel.app/s/b3c1..." }
```

**Errors:** `400` with `{ "error": "..." }` for validation failures —
plugin surfaces `error` verbatim to the user.

---

## `GET /api/contacts?query=<string>`

Used by the recipient autocomplete. Searches by name/email/client name,
scoped to the team's account (auth: see below).

**Response:**

```json
{
  "contacts": [
    {
      "id": "c1...",
      "name": "Jo Client",
      "email": "jo@acme.com",
      "clientName": "Acme Ltd",
      "lastUsedAt": "2026-08-20T09:00:00Z"
    }
  ]
}
```

Empty `query` returns the most recently used contacts (suggest capping at
~20, most-recent first).

---

## `GET /api/signoffs?client_name=<string>` (planned — not yet built)

Not called by the plugin yet. The "this follows an earlier sign-off" field
was pulled from the plugin UI (see brief/tech spec §3.4, `follows_signoff_id`)
because asking someone to paste a raw record ID isn't a workable
interaction, and there's nothing to build a working version against until
this endpoint exists. `followsSignoffId` is still sent as `null` in every
`POST /api/signoffs` payload in the meantime — the field itself isn't
going away, just the broken input for it.

The intended UX, once this exists, mirrors the contact search exactly:
type the client name, get back that client's prior sign-off records, pick
one (or leave it unpicked — this is always optional, and per the "staged
sign-off" decision below, never required even when a project clearly has
an earlier stage).

**Response (proposed):**

```json
{
  "signoffs": [
    {
      "id": "a1...",
      "projectName": "Acme Website Redesign",
      "scopeLabel": "Homepage only",
      "status": "signed",
      "createdAt": "2026-08-01T09:00:00Z"
    }
  ]
}
```

Only records for the given client, most recent first. Whether to also
filter to `status = "signed"` (you can only follow on from something
that's actually done) is a call for whoever builds this — either is
defensible, and it's a cheap change either way.

**A project doesn't need a homepage-stage record to exist at all.** The
staged pattern (homepage → full site → branding) in the tech spec is one
way teams can work, not a requirement the tool enforces — see "Sequencing"
in the root README. A team going straight to "homepage + inner pages" as
one combined sign-off just creates a single `multi_frame` record with
`followsSignoffId: null`, same as any record with nothing before it.
Nothing about that path is a special case.

---

## Auth (open item)

The plugin currently sends no auth header — it's assumed the backend's
`/api/signoffs` and `/api/contacts` endpoints are reachable from the
plugin's network context without a login flow (Figma plugins can't do
interactive OAuth redirects easily). Once the backend exists, decide
between:

- A long-lived API key pasted into the plugin's Settings panel
  (`Authorization: Bearer <key>`), issued from the dashboard per team
  member — simplest, fits Figma's constraints.
- Something tied to Figma's own OAuth, if ever needed.

The plugin's `api.ts` already sends `Authorization: Bearer <apiKey>` if
a key is present in settings, so wiring this up later is a small change,
not a redesign.

---

## CORS / network access

`manifest.json`'s `networkAccess.allowedDomains` must include the
backend's real domain once deployed (Figma requires exact domains or
subdomain wildcards, e.g. `https://*.vercel.app`) — the plugin will fail
to send with a network error otherwise, and Figma won't prompt for new
domains at runtime. Update the manifest and re-publish/reinstall the
plugin when the backend's production URL is known.
