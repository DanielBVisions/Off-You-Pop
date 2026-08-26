const { html, raw, escapeHtml } = require("./html");

const SHELL_STYLES = `
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f5f5f7; color:#1e1e1e; }
  .topbar { background:#1e1e1e; color:#fff; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; }
  .topbar a { color:#fff; text-decoration:none; font-weight:700; }
  .topbar .user { font-size:13px; color:#ccc; }
  .topbar button { background:none; border:1px solid #555; color:#fff; border-radius:6px; padding:5px 12px; font-size:12px; cursor:pointer; margin-left:12px; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 28px 20px 80px; }
  h1 { font-size:20px; }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  th, td { text-align:left; padding:10px 14px; font-size:13px; border-bottom:1px solid #eee; }
  th { color:#666; font-weight:600; background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  tr.row-link { cursor:pointer; }
  tr.row-link:hover { background:#f9fbff; }
  .status-pill { display:inline-block; padding:2px 9px; border-radius:12px; font-size:11px; font-weight:600; }
  .status-sent, .status-partially_viewed { background:#eef1f5; color:#555; }
  .status-partially_signed { background:#fff4d6; color:#8a6a00; }
  .status-signed, .status-locked { background:#e6f7ec; color:#0f7a3d; }
  .status-cancelled { background:#fdeaea; color:#b3261e; }
  .filters { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .filters input, .filters select { padding:7px 10px; border:1px solid #d5d5d5; border-radius:6px; font-size:13px; }
  .card { background:#fff; border-radius:10px; padding:20px 24px; margin-bottom:18px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .card h2 { font-size:14px; margin:0 0 12px; color:#666; text-transform:uppercase; letter-spacing:.03em; }
  .field-row { display:flex; gap:8px; font-size:13px; margin-bottom:6px; }
  .field-row .label { width:140px; color:#888; flex:none; }
  .btn { display:inline-block; padding:8px 16px; border-radius:6px; border:none; font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn-primary { background:#18a0fb; color:#fff; }
  .btn-danger { background:#fdeaea; color:#b3261e; }
  .btn-secondary { background:#f0f0f0; color:#1e1e1e; }
  .btn[disabled] { opacity:.5; cursor:not-allowed; }
  .recipient-row { display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px; }
  .recipient-row:last-child { border-bottom:none; }
  .event-row { display:flex; gap:12px; font-size:12.5px; padding:6px 0; border-bottom:1px solid #f5f5f5; }
  .event-row .t { color:#999; width:170px; flex:none; }
  .event-row .type { font-weight:600; width:130px; flex:none; }
  .login-card { max-width:340px; margin:80px auto; background:#fff; border-radius:12px; padding:32px; box-shadow:0 2px 10px rgba(0,0,0,.08); }
  .login-card input { width:100%; padding:10px 12px; margin-bottom:12px; border:1px solid #d5d5d5; border-radius:6px; font-size:14px; }
  .login-card button { width:100%; }
  .error-text { color:#c0392b; font-size:13px; margin-top:8px; }
  .muted { color:#999; font-size:12px; }
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
            <a href="/dashboard">Off You Pop</a>
            <div class="user">
              ${session.email} · ${session.role}
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
        <h1 style="font-size:18px;margin-top:0;">Sign in</h1>
        <form id="login-form">
          <input type="email" name="email" placeholder="Email" required />
          <input type="password" name="password" placeholder="Password" required />
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
  return html`<span class="status-pill status-${status}">${status.replace(/_/g, " ")}</span>`;
}

function renderStatusTable({ session, records, filters }) {
  const rows = records
    .map(
      (r) => html`
        <tr class="row-link" data-href="/dashboard/${r.id}">
          <td>${r.client_name}</td>
          <td>${r.project_name}</td>
          <td>${r.scope_label}</td>
          <td>${raw(statusPill(r.status))}</td>
          <td class="muted">${new Date(r.created_at).toLocaleDateString("en-GB")}</td>
        </tr>
      `,
    )
    .join("");

  return shell({
    title: "Dashboard",
    session,
    bodyHtml: html`
      <h1>Sign-offs</h1>
      <form class="filters" method="GET" action="/dashboard">
        <input type="text" name="search" placeholder="Search client/project" value="${filters.search || ""}" />
        <select name="status">
          <option value="">All statuses</option>
          ${["sent", "partially_viewed", "partially_signed", "signed", "cancelled"]
            .map((s) => html`<option value="${s}" ${s === filters.status ? raw("selected") : ""}>${s.replace(/_/g, " ")}</option>`)
            .join("")}
        </select>
        <button class="btn btn-secondary" type="submit">Filter</button>
      </form>
      <table>
        <thead><tr><th>Client</th><th>Project</th><th>Scope</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>${raw(rows || `<tr><td colspan="5" class="muted" style="padding:20px;">No sign-offs yet.</td></tr>`)}</tbody>
      </table>
      <script>${raw(`
        document.querySelectorAll('tr.row-link').forEach(function (row) {
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
          <div>${r.name} &lt;${r.email}&gt;</div>
          <div>
            ${raw(statusPill(r.status))}
            ${certByRecipient[r.id]
              ? html` <a class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" href="/api/certificate/${r.id}" target="_blank">Certificate</a>`
              : ""}
          </div>
        </div>
      `,
    )
    .join("");

  const eventRows = events
    .map(
      (e) => html`
        <div class="event-row">
          <div class="t">${new Date(e.occurred_at).toLocaleString("en-GB")}</div>
          <div class="type">${e.event_type}</div>
          <div class="muted">${e.ip_address || ""} ${e.metadata && Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</div>
        </div>
      `,
    )
    .join("");

  return shell({
    title: `${record.client_name} — ${record.project_name}`,
    session,
    bodyHtml: html`
      <p><a href="/dashboard" class="muted">&larr; Back to dashboard</a></p>
      <h1>${record.project_name}</h1>
      <p class="muted">${record.client_name} · ${record.scope_label} · ${raw(statusPill(record.status))}</p>

      <div class="card">
        <h2>Record</h2>
        <div class="field-row"><div class="label">Scope type</div><div>${record.scope_type}</div></div>
        <div class="field-row"><div class="label">Requires all recipients</div><div>${record.requires_all_recipients ? "Yes" : "No"}</div></div>
        <div class="field-row"><div class="label">Created</div><div>${new Date(record.created_at).toLocaleString("en-GB")} by ${record.created_by}</div></div>
        ${record.notes ? html`<div class="field-row"><div class="label">Notes</div><div>${record.notes}</div></div>` : ""}
        ${record.archived_at ? html`<div class="field-row"><div class="label">Archived</div><div>${new Date(record.archived_at).toLocaleString("en-GB")}</div></div>` : ""}
        <div style="margin-top:14px;display:flex;gap:10px;">
          <button class="btn btn-secondary" id="resend-btn" ${isAdmin ? "" : "disabled"}>Resend link</button>
          <button class="btn btn-danger" id="archive-btn" ${isAdmin || record.archived_at ? "" : "disabled"}>${record.archived_at ? "Archived" : "Archive"}</button>
        </div>
        <div class="muted" id="action-result" style="margin-top:8px;"></div>
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
                    <div class="field-row"><div class="label">Status</div><div>${brandingExport.status}</div></div>
                    ${brandingExport.zip_url ? html`<div class="field-row"><div class="label">Assets</div><div><a href="${brandingExport.zip_url}">Download zip</a></div></div>` : ""}
                    ${brandingExport.guidelines_pdf_url ? html`<div class="field-row"><div class="label">Guidelines</div><div><a href="${brandingExport.guidelines_pdf_url}">Download PDF</a></div></div>` : ""}
                    ${brandingExport.error_message ? html`<div class="field-row"><div class="label">Error</div><div>${brandingExport.error_message}</div></div>` : ""}
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
        var archiveBtn = document.getElementById('archive-btn');
        if (resendBtn) resendBtn.addEventListener('click', function () {
          resendBtn.disabled = true;
          fetch('/api/signoffs/' + id + '/resend', { method: 'POST' })
            .then(function (res) { return res.json(); })
            .then(function (body) { resultEl.textContent = 'Resent to ' + body.results.filter(function (r) { return r.sent; }).length + ' recipient(s).'; })
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
