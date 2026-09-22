const { html, raw, escapeHtml } = require("./html");

const SHELL_STYLES = `
  * { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    --bg: #0a0a0c;
    --bg-elevated: #17171b;
    --bg-elevated-2: #1e1e24;
    --border: #29292f;
    --border-soft: #202026;
    --text: #f2f2f4;
    --text-muted: #98989f;
    --text-faint: #6b6b73;
    --accent: #2fb0ff;
    --accent-ink: #04121c;
    --success: #3ddc97;
    --warning: #f5b942;
    --danger: #ff6b6b;
    --radius-lg: 14px;
    --radius-md: 10px;
    --radius-sm: 7px;
    --shadow: 0 8px 24px rgba(0,0,0,.35);
  }
  html, body { height: 100%; }
  body {
    margin:0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); }
  .topbar {
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    padding: 16px 28px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(10px);
  }
  .topbar a.brand {
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: .01em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .topbar a.brand .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--accent); }
  .topbar .user { display:flex; align-items:center; gap:12px; font-size:13px; color:var(--text-muted); }
  .topbar .role-chip { background:var(--bg-elevated-2); border:1px solid var(--border); color:var(--text-muted); padding:3px 9px; border-radius:999px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .topbar button {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    padding: 6px 13px;
    font-size: 12.5px;
    cursor: pointer;
    transition: border-color .15s, color .15s;
  }
  .topbar button:hover { border-color: var(--text-faint); color: var(--text); }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 24px 100px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -.01em; }
  .back-link { color: var(--text-muted); text-decoration: none; font-size: 13px; display:inline-flex; align-items:center; gap:6px; margin-bottom: 18px; transition: color .15s; }
  .back-link:hover { color: var(--text); }

  .avatar { width:36px; height:36px; border-radius:50%; background:var(--bg-elevated-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:12.5px; font-weight:700; color:var(--text-muted); flex:none; letter-spacing:.02em; }
  .avatar-sm { width:28px; height:28px; font-size:10.5px; }

  /* A quick "shape of the world" strip above the list — total / awaiting /
     signed — rather than making someone scan every row to get a sense of
     where things stand. */
  .stats-row { display:flex; gap:12px; margin-bottom: 22px; }
  .stat-tile { flex:1; background: var(--bg-elevated); border:1px solid var(--border); border-radius: var(--radius-md); padding: 15px 18px; }
  .stat-tile .stat-value { font-size: 24px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stat-tile .stat-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; margin-top: 3px; }
  .stat-tile.accent .stat-value { color: var(--accent); }
  .stat-tile.warn .stat-value { color: var(--warning); }
  .stat-tile.ok .stat-value { color: var(--success); }

  /* Row-list (replaces a plain <table> — reads cleaner on dark, and each
     row can carry its own hover/affordance without table quirks). Each row
     is an avatar + two-line client/project block + status + date, not a
     rigid table grid, so it reads as a list of things rather than a
     spreadsheet. */
  .row-list { border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-elevated); }
  .row-list-row { display:flex; align-items:center; gap:14px; padding: 14px 20px; border-bottom: 1px solid var(--border-soft); cursor: pointer; transition: background .12s; }
  .row-list-row:last-child { border-bottom: none; }
  .row-list-row:hover { background: var(--bg-elevated-2); }
  .row-list-row .info { flex:1; min-width:0; }
  .row-list-row .info .name { font-weight:600; color:var(--text); font-size:14px; }
  .row-list-row .info .meta { font-size:12.5px; color:var(--text-muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row-list-row .right { display:flex; align-items:center; gap:18px; flex:none; }
  .row-list-row .date { font-size:12px; color:var(--text-faint); width:88px; text-align:right; font-variant-numeric: tabular-nums; }
  .row-list-empty { padding: 48px 20px; text-align: center; color: var(--text-faint); font-size: 13.5px; }

  .status-pill { display:inline-flex; align-items:center; gap:6px; padding:3px 10px 3px 8px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.01em; white-space:nowrap; }
  .status-pill .dot { width:6px; height:6px; border-radius:50%; }
  .status-sent, .status-partially_viewed { background:rgba(152,152,159,.14); color:#c2c2c8; }
  .status-sent .dot, .status-partially_viewed .dot { background:#98989f; }
  .status-partially_signed { background:rgba(245,185,66,.14); color:var(--warning); }
  .status-partially_signed .dot { background:var(--warning); }
  .status-signed, .status-locked { background:rgba(61,220,151,.14); color:var(--success); }
  .status-signed .dot, .status-locked .dot { background:var(--success); }
  .status-cancelled { background:rgba(255,107,107,.14); color:var(--danger); }
  .status-cancelled .dot { background:var(--danger); }

  .filters { display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
  .filters input, .filters select {
    padding: 9px 12px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    border-radius: var(--radius-sm);
    font-size: 13px;
    outline: none;
    transition: border-color .15s;
  }
  .filters input:focus, .filters select:focus { border-color: var(--accent); }
  .filters input::placeholder { color: var(--text-faint); }

  .card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px 24px; margin-bottom: 16px; }
  .card h2 { font-size: 12px; margin: 0 0 14px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }

  .field-row { display:flex; gap:8px; font-size:13.5px; padding: 7px 0; border-bottom: 1px solid var(--border-soft); }
  .field-row:last-child { border-bottom: none; }
  .field-row .label { width:170px; color: var(--text-faint); flex:none; }
  .field-row > div:last-child { color: var(--text); }

  /* Detail-page header: title/meta on the left, status + primary actions
     on the right, in one row — the old layout buried the actions inside
     the first card, mixed in with static facts. */
  .detail-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom: 22px; flex-wrap: wrap; }
  .detail-header .titles .subtitle { color: var(--text-muted); font-size: 13.5px; margin-top: 4px; }
  .detail-header .actions { display:flex; align-items:center; gap:10px; flex-wrap: wrap; }
  .detail-header .actions-result { width: 100%; text-align: right; margin-top: 8px; }

  /* A horizontal strip of small facts instead of stacked label:value rows
     — reads as a scannable summary rather than a form. */
  .meta-strip { display:flex; flex-wrap:wrap; gap: 22px; padding-bottom: 18px; margin-bottom: 18px; border-bottom: 1px solid var(--border-soft); }
  .meta-strip:last-child { border-bottom:none; margin-bottom:0; padding-bottom:0; }
  .meta-item .meta-label { font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  .meta-item .meta-value { font-size: 13.5px; color: var(--text); }

  .banner { border-radius: var(--radius-sm); padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }
  .banner:last-child { margin-bottom: 0; }
  .banner-info { background: rgba(47,176,255,.1); color: var(--accent); border: 1px solid rgba(47,176,255,.2); }
  .banner-warn { background: rgba(245,185,66,.1); color: var(--warning); border: 1px solid rgba(245,185,66,.2); }

  .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:var(--radius-sm); border:1px solid transparent; font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; transition: filter .15s, background .15s, border-color .15s; }
  .btn-primary { background: var(--accent); color: var(--accent-ink); }
  .btn-primary:hover { filter: brightness(1.08); }
  .btn-danger { background: rgba(255,107,107,.1); color: var(--danger); border-color: rgba(255,107,107,.25); }
  .btn-danger:hover { background: rgba(255,107,107,.17); }
  .btn-secondary { background: var(--bg-elevated-2); color: var(--text); border-color: var(--border); }
  .btn-secondary:hover { border-color: var(--text-faint); }
  .btn[disabled] { opacity:.4; cursor:not-allowed; filter:none; }
  .btn-sm { padding: 4px 11px; font-size: 11px; }

  .recipient-row { display:flex; align-items:center; gap:12px; padding:11px 0; border-bottom:1px solid var(--border-soft); font-size:13.5px; }
  .recipient-row:last-child { border-bottom:none; }
  .recipient-row .info { flex:1; min-width:0; }
  .recipient-row .info .name { color: var(--text); font-weight: 500; }
  .recipient-row .actions-inline { display:flex; align-items:center; gap:10px; flex:none; }

  /* Audit trail as a timeline (dot + connecting line) rather than a flat
     list of rows — the sequence of what happened is the point, and a
     timeline reads that at a glance instead of requiring you to scan a
     time column. */
  .timeline-item { position: relative; padding-left: 26px; padding-bottom: 20px; }
  .timeline-item:last-child { padding-bottom: 0; }
  .timeline-item::before { content: ''; position: absolute; left: 4px; top: 16px; bottom: -4px; width: 1px; background: var(--border); }
  .timeline-item:last-child::before { display: none; }
  .timeline-dot { position: absolute; left: 0; top: 3px; width: 9px; height: 9px; border-radius: 50%; background: var(--bg-elevated); border: 2px solid var(--accent); }
  .timeline-head { display:flex; align-items:baseline; gap:10px; flex-wrap: wrap; }
  .timeline-type { font-weight: 600; font-size: 13px; color: var(--text); }
  .timeline-time { font-size: 11.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .timeline-detail { font-size: 12.5px; margin-top: 3px; }

  .login-card { width: 100%; max-width:360px; margin: 64px auto 0; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 36px 32px; box-shadow: var(--shadow); }
  .login-card .brand-mark { display:flex; align-items:center; gap:8px; margin-bottom: 24px; }
  .login-card .brand-mark .dot { width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--accent); }
  .login-card .brand-mark span { font-weight:700; font-size:13px; color: var(--text-muted); letter-spacing:.02em; }
  .login-card h1 { margin: 0 0 20px; }
  .login-card input {
    width:100%;
    padding: 11px 13px;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    background: var(--bg-elevated-2);
    color: var(--text);
    border-radius: var(--radius-sm);
    font-size: 14px;
    outline: none;
    transition: border-color .15s;
  }
  .login-card input:focus { border-color: var(--accent); }
  .login-card input::placeholder { color: var(--text-faint); }
  .login-card button { width:100%; justify-content:center; margin-top: 4px; }

  .error-text { color: var(--danger); font-size:13px; margin-top:10px; }
  .muted { color: var(--text-muted); font-size:12px; }
`;

function shell({ title, session, bodyHtml }) {
  return html`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — Off You Pop</title>
    <style>${raw(SHELL_STYLES)}</style>
  </head>
  <body>
    ${session
      ? raw(html`
          <div class="topbar">
            <a href="/dashboard" class="brand"><span class="dot"></span>Off You Pop</a>
            <div class="user">
              ${session.email}
              <span class="role-chip">${session.role}</span>
              <button id="logout-btn">Log out</button>
            </div>
          </div>
        `)
      : ""}
    <div class="wrap">${raw(bodyHtml)}</div>
    ${session
      ? raw(`<script>
          document.getElementById('logout-btn').addEventListener('click', function () {
            fetch('/api/auth/logout', { method: 'POST' }).then(function () { window.location.href = '/dashboard'; });
          });
        </script>`)
      : ""}
  </body>
</html>`;
}

function renderLoginPage({ error } = {}) {
  return shell({
    title: "Sign in",
    session: null,
    bodyHtml: html`
      <div class="login-card">
        <div class="brand-mark"><span class="dot"></span><span>OFF YOU POP</span></div>
        <h1 style="font-size:19px;">Sign in</h1>
        <form id="login-form">
          <input type="email" name="email" placeholder="Email" autocomplete="email" required />
          <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
          <button class="btn btn-primary" type="submit">Sign in</button>
        </form>
        <div class="error-text" id="login-error">${error || ""}</div>
      </div>
      <script>${raw(`
        document.getElementById('login-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var form = e.target;
          var errorEl = document.getElementById('login-error');
          errorEl.textContent = '';
          fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: form.email.value, password: form.password.value }),
          })
            .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
            .then(function (r) {
              if (!r.ok) throw new Error(r.body.error || 'Sign-in failed');
              window.location.href = '/dashboard';
            })
            .catch(function (err) { errorEl.textContent = err.message; });
        });
      `)}</script>
    `,
  });
}

function statusPill(status) {
  return html`<span class="status-pill status-${status}"><span class="dot"></span>${status.replace(/_/g, " ")}</span>`;
}

function formatSnakeCase(type) {
  const label = type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Two-letter initials for the avatar circles in the list/recipients —
// first + last word, or the first two characters of a single-word name.
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A short "Browser on OS" summary instead of the full user-agent string —
// good enough to answer "was this a phone or a desktop" without dumping raw
// UA text into the audit trail. Order matters: e.g. Edge and Chrome both
// contain "Safari" in their UA, so more specific checks have to come first.
function summarizeUserAgent(ua) {
  if (!ua) return null;
  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "";
  if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
}

// Turns each event's raw metadata JSON into one short, readable line
// instead of dumping the object as-is — the audit trail is meant to be
// read by whoever's checking on a sign-off, not just by developers.
function describeEvent(e) {
  const m = e.metadata || {};
  switch (e.event_type) {
    case "created":
      return m.createdBy ? `by ${m.createdBy}` : "";
    case "viewed": {
      const parts = [summarizeUserAgent(m.userAgent)].filter(Boolean);
      if (m.referrer) parts.push(`via ${m.referrer}`);
      return parts.join(" · ");
    }
    case "resent":
      return [m.byUser && `by ${m.byUser}`, typeof m.recipientCount === "number" && `to ${m.recipientCount} recipient${m.recipientCount === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · ");
    case "archived":
      return m.byUser ? `by ${m.byUser}` : "";
    case "reset":
      return [m.byUser && `by ${m.byUser}`, m.previousStatus && `was ${m.previousStatus.replace(/_/g, " ")}`].filter(Boolean).join(" · ");
    case "export_triggered":
      return m.result === "failed" ? `failed${m.error ? ` — ${m.error}` : ""}` : m.result || "";
    default:
      return "";
  }
}

function renderStatusTable({ session, records, filters }) {
  const awaitingCount = records.filter((r) => ["sent", "partially_viewed", "partially_signed"].includes(r.status)).length;
  const signedCount = records.filter((r) => ["signed", "locked"].includes(r.status)).length;

  const rows = records
    .map(
      (r) => html`
        <div class="row-list-row row-link" data-href="/dashboard/${r.id}">
          <div class="avatar">${initials(r.client_name)}</div>
          <div class="info">
            <div class="name">${r.client_name}</div>
            <div class="meta">${r.project_name} · ${r.scope_label}</div>
          </div>
          <div class="right">
            ${raw(statusPill(r.status))}
            <div class="date">${new Date(r.created_at).toLocaleDateString("en-GB")}</div>
          </div>
        </div>
      `,
    )
    .join("");

  return shell({
    title: "Dashboard",
    session,
    bodyHtml: html`
      <h1>Sign-offs</h1>
      <div class="stats-row">
        <div class="stat-tile"><div class="stat-value">${records.length}</div><div class="stat-label">Total</div></div>
        <div class="stat-tile warn"><div class="stat-value">${awaitingCount}</div><div class="stat-label">Awaiting signature</div></div>
        <div class="stat-tile ok"><div class="stat-value">${signedCount}</div><div class="stat-label">Signed</div></div>
      </div>
      <form class="filters" method="GET" action="/dashboard">
        <input type="text" name="search" placeholder="Search client/project" value="${filters.search || ""}" autocomplete="off" />
        <select name="status">
          <option value="">All statuses</option>
          ${["sent", "partially_viewed", "partially_signed", "signed", "cancelled"]
            .map((s) => html`<option value="${s}" ${s === filters.status ? raw("selected") : ""}>${s.replace(/_/g, " ")}</option>`)
            .join("")}
        </select>
        <button class="btn btn-secondary" type="submit">Filter</button>
      </form>
      <div class="row-list">
        ${records.length ? raw(rows) : html`<div class="row-list-empty">No sign-offs yet.</div>`}
      </div>
      <script>${raw(`
        document.querySelectorAll('.row-list-row.row-link').forEach(function (row) {
          row.addEventListener('click', function () { window.location.href = row.dataset.href; });
        });
      `)}</script>
    `,
  });
}

function renderDetailPage({ session, record, recipients, events, certificates, brandingExport }) {
  const isAdmin = session.role === "admin";
  const certByRecipient = Object.fromEntries(certificates.map((c) => [c.recipient_id, c]));

  const recipientRows = recipients
    .map(
      (r) => html`
        <div class="recipient-row">
          <div class="avatar avatar-sm">${initials(r.name)}</div>
          <div class="info">
            <div class="name">${r.name}</div>
            <div class="muted">${r.email}</div>
          </div>
          <div class="actions-inline">
            ${raw(statusPill(r.status))}
            ${certByRecipient[r.id]
              ? html`<a class="btn btn-secondary btn-sm" href="/api/certificate/${r.id}" target="_blank">Certificate</a>`
              : ""}
          </div>
        </div>
      `,
    )
    .join("");

  const eventRows = events
    .map((e) => {
      const detail = [describeEvent(e), e.ip_address].filter(Boolean).join(" · ");
      return html`
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-head">
            <span class="timeline-type">${formatSnakeCase(e.event_type)}</span>
            <span class="timeline-time">${new Date(e.occurred_at).toLocaleString("en-GB")}</span>
          </div>
          ${detail ? html`<div class="timeline-detail muted">${detail}</div>` : ""}
        </div>
      `;
    })
    .join("");

  return shell({
    title: `${record.client_name} — ${record.project_name}`,
    session,
    bodyHtml: html`
      <a href="/dashboard" class="back-link">&larr; Back to dashboard</a>

      <div class="detail-header">
        <div class="titles">
          <h1>${record.project_name}</h1>
          <div class="subtitle">${record.client_name} · ${record.scope_label} · ${raw(statusPill(record.status))}</div>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" id="resend-btn" ${isAdmin ? "" : "disabled"}>Resend link</button>
          <button class="btn btn-secondary" id="reset-btn" ${isAdmin ? "" : "disabled"}>Reset status</button>
          <button class="btn btn-danger" id="archive-btn" ${isAdmin || record.archived_at ? "" : "disabled"}>${record.archived_at ? "Archived" : "Archive"}</button>
          <div class="muted actions-result" id="action-result"></div>
        </div>
      </div>

      <div class="card">
        ${record.archived_at
          ? html`<div class="banner banner-warn">Archived ${new Date(record.archived_at).toLocaleString("en-GB")}</div>`
          : ""}
        ${record.notes ? html`<div class="banner banner-info">${record.notes}</div>` : ""}
        <div class="meta-strip">
          <div class="meta-item"><div class="meta-label">Scope type</div><div class="meta-value">${formatSnakeCase(record.scope_type)}</div></div>
          <div class="meta-item"><div class="meta-label">Requires all recipients</div><div class="meta-value">${record.requires_all_recipients ? "Yes" : "No"}</div></div>
          <div class="meta-item"><div class="meta-label">Created</div><div class="meta-value">${new Date(record.created_at).toLocaleString("en-GB")} by ${record.created_by}</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Recipients</h2>
        ${raw(recipientRows)}
      </div>

      ${record.scope_type === "branding"
        ? html`
            <div class="card">
              <h2>Branding export</h2>
              ${brandingExport
                ? html`
                    ${brandingExport.error_message ? html`<div class="banner banner-warn">${brandingExport.error_message}</div>` : ""}
                    <div class="meta-strip">
                      <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${formatSnakeCase(brandingExport.status)}</div></div>
                    </div>
                    ${brandingExport.zip_url || brandingExport.guidelines_pdf_url
                      ? html`
                          <div style="display:flex;gap:10px;margin-top:16px;">
                            ${brandingExport.zip_url ? html`<a class="btn btn-secondary btn-sm" href="${brandingExport.zip_url}">Download zip</a>` : ""}
                            ${brandingExport.guidelines_pdf_url ? html`<a class="btn btn-secondary btn-sm" href="${brandingExport.guidelines_pdf_url}">Download guidelines PDF</a>` : ""}
                          </div>
                        `
                      : ""}
                  `
                : html`<p class="muted">Not triggered yet — happens automatically once this record is fully signed.</p>`}
            </div>
          `
        : ""}

      <div class="card">
        <h2>Audit trail</h2>
        ${raw(eventRows || `<p class="muted">No events yet.</p>`)}
      </div>

      <script>${raw(`
        var id = ${JSON.stringify(record.id)};
        var resultEl = document.getElementById('action-result');
        var resendBtn = document.getElementById('resend-btn');
        var resetBtn = document.getElementById('reset-btn');
        var archiveBtn = document.getElementById('archive-btn');
        if (resetBtn) resetBtn.addEventListener('click', function () {
          if (!confirm('Reset this sign-off back to unsigned? This deletes the certificate and branding export it produced — use it for re-testing, not for correcting a real client sign-off.')) return;
          resetBtn.disabled = true;
          fetch('/api/signoffs/' + id + '/reset', { method: 'POST' })
            .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
            .then(function (result) {
              if (!result.ok) throw new Error(result.body.error || 'Reset failed');
              window.location.reload();
            })
            .catch(function (err) { resultEl.textContent = err.message; resetBtn.disabled = false; });
        });
        if (resendBtn) resendBtn.addEventListener('click', function () {
          resendBtn.disabled = true;
          fetch('/api/signoffs/' + id + '/resend', { method: 'POST' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
              var succeeded = body.results.filter(function (r) { return r.sent; });
              var failed = body.results.filter(function (r) { return !r.sent; });
              var msg = 'Targeted ' + body.results.length + ' recipient(s), ' + succeeded.length + ' sent successfully.';
              if (failed.length > 0) msg += ' Failed: ' + failed.map(function (r) { return r.email + ' (' + r.error + ')'; }).join('; ');
              resultEl.textContent = msg;
            })
            .catch(function () { resultEl.textContent = 'Resend failed.'; })
            .finally(function () { resendBtn.disabled = false; });
        });
        if (archiveBtn) archiveBtn.addEventListener('click', function () {
          if (!confirm('Archive this sign-off?')) return;
          archiveBtn.disabled = true;
          fetch('/api/signoffs/' + id + '/archive', { method: 'POST' })
            .then(function () { window.location.reload(); })
            .catch(function () { resultEl.textContent = 'Archive failed.'; archiveBtn.disabled = false; });
        });
      `)}</script>
    `,
  });
}

module.exports = { renderLoginPage, renderStatusTable, renderDetailPage };
