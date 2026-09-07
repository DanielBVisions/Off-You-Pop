# Off You Pop — Figma plugin

The Figma-side half of the sign-off tool: collects client/project details,
lets the designer pick which frames are in scope, exports static PNG
snapshots, and sends everything to the backend to create a `SignoffRecord`.

This is **only** the plugin. There is no backend yet — see
[`../docs/api-contract.md`](../docs/api-contract.md) for the API it's built
against, and the plugin's Settings panel (⚙) for where to point it once one
exists.

## Load it in Figma (development)

1. `npm install` (installs TypeScript and the official Figma type
   definitions — required, the build won't compile without them).
2. `npm run build`.
3. In the Figma desktop app: **Plugins → Development → Import plugin from
   manifest…**, then select `plugin/manifest.json`.
4. Run it via **Plugins → Development → Off You Pop**.
5. Open the Settings panel (⚙ top right) and set a Backend URL — until one
   is set, **Generate & Send** stays disabled. `http://localhost:3000` is
   pre-allowed in `manifest.json` for local backend development.

Re-run `npm run build` after any source change, then re-run the plugin in
Figma (Figma doesn't hot-reload; **Plugins → Development → Off You Pop**
again picks up the new `dist/` output).

## A note on the build

`scripts/build.mjs` doesn't use a bundler (esbuild, etc.) at all — it
shells out to `tsc` (via `--project tsconfig.build.json`), transpiles each
source file to CommonJS individually, and stitches `ui.ts` + `api.ts`
together with a ~15-line hand-written module loader (the whole runtime
dependency graph is exactly one edge: `ui.ts` → `api.ts`). This works, but
a real bundler would be simpler to extend if the plugin grows more internal
modules — `npm install esbuild` and swap it in if that's ever worth doing.

## Project structure

```
plugin/
  manifest.json           Figma plugin manifest
  tsconfig.json            Editor/typecheck config (`npm run typecheck`)
  tsconfig.build.json       Compiler options for the actual build (see above)
  src/
    code.ts                Main thread: selection, exports, clientStorage
    ui.ts                  UI thread: form, validation, contact search, send
    ui.html / ui.css        UI shell + styles (CSS/JS get inlined at build time)
    api.ts                  fetch wrapper for the backend (POST /api/signoffs, GET /api/contacts)
    types.ts                Shared types + the ui.ts <-> code.ts message protocol
  scripts/build.mjs         Build script (tsc + hand-rolled bundling, see above)
  dist/                     Build output (gitignored) — what manifest.json points at
```

## What's implemented

- Required-field validation exactly per the brief: client name, project
  name, ≥1 recipient (name + valid email), and a scope selection with
  frames actually selected on canvas. **Generate & Send** stays disabled
  with a visible checklist of what's missing until all of it is satisfied
  — matching "no partial records should be creatable" (server-side
  validation is the backend's job — see the contract doc).
- Scope types: single frame / multiple frames / flow / branding, read live
  from the current Figma selection. For "flow", frames get an explicit
  order (↑/↓ controls) that's sent as `sequence_order`.
- Saved-contact search (calls `GET /api/contacts`) to auto-fill a
  recipient's name/email/client — degrades gracefully (manual entry still
  works) if the backend isn't reachable.
- `requires_all_recipients` toggle, optional `follows_signoff_id` (for
  dashboard grouping only — sequencing isn't enforced, per team
  decision), optional notes.
- On send: exports each in-scope frame as a PNG (2x) via the Plugin API,
  then creates the record (JSON only) and uploads each frame's image with
  its own request afterward — see `../docs/api-contract.md`'s "Two-step
  create" note for why (a combined-images request routinely exceeded
  Vercel's 4.5MB body limit on real multi-frame sign-offs).
- Settings panel for the backend URL, an optional API key, and the
  sender's name (defaults to the Figma account name, editable).

## What's deliberately NOT in this phase

Per the brief, this is plugin-only for now. No backend, landing page,
dashboard, email sending, certificate rendering, or branding export exist
yet — those are later build phases. The plugin is built against the
contract in `../docs/api-contract.md` so that work can proceed
independently without the plugin needing changes.
