const { html, raw, escapeHtml } = require("./html");

const PAGE_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background: #f5f5f7; color: #1e1e1e; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  .header { display:flex; align-items:center; gap:10px; margin-bottom: 28px; }
  .header .badge { background:#18a0fb; color:#fff; font-weight:700; font-size:13px; padding:4px 10px; border-radius:6px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color:#666; font-size:14px; margin-bottom: 24px; }
  .banner { padding:12px 16px; border-radius:8px; font-size:13px; margin-bottom:20px; }
  .banner.info { background:#e7f4ff; color:#0a5ba6; }
  .banner.success { background:#e6f7ec; color:#0f7a3d; }
  .banner.warn { background:#fff4e5; color:#8a5a00; }
  .snapshot { background:#fff; border-radius:10px; overflow:hidden; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
  .snapshot img { width:100%; display:block; }
  .snapshot .caption { padding:10px 16px; font-size:13px; color:#666; border-top:1px solid #eee; }
  .actions { margin-top: 32px; text-align:center; }
  .btn { display:inline-block; padding:12px 28px; border-radius:8px; border:none; font-size:15px; font-weight:600; cursor:pointer; }
  .btn-primary { background:#18a0fb; color:#fff; }
  .btn-primary:disabled { background:#ccc; cursor:not-allowed; }
  .btn-secondary { background:#fff; color:#1e1e1e; border:1px solid #d5d5d5; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; padding:20px; z-index:10; }
  .modal { background:#fff; border-radius:12px; padding:28px; max-width:480px; width:100%; }
  .modal h2 { margin-top:0; font-size:18px; }
  .modal .approval-text { background:#f5f5f7; border-radius:8px; padding:14px; font-size:12.5px; line-height:1.5; color:#444; max-height:220px; overflow-y:auto; margin: 16px 0; }
  .modal label { display:flex; gap:8px; align-items:flex-start; font-size:13px; margin-bottom:20px; }
  .modal .modal-actions { display:flex; gap:10px; }
  .modal .modal-actions button { flex:1; }
  .footer-note { margin-top: 40px; font-size:11px; color:#999; text-align:center; }
  .error-text { color:#c0392b; font-size:13px; margin-top:12px; text-align:center; }
`;

function scopeNoun(scopeType) {
  return scopeType === "branding" ? "branding assets" : "design";
}

function renderSnapshots(snapshots) {
  return snapshots
    .map(
      (s) => html`
        <div class="snapshot">
          <img src="${s.snapshot_url}" alt="${s.figma_node_name || "Frame"}" loading="lazy" />
          ${s.figma_node_name ? html`<div class="caption">${s.figma_node_name}</div>` : ""}
        </div>
      `,
    )
    .join("");
}

function renderSignedState({ record, recipient, certificateUrl, approvalText }) {
  return html`
    <div class="banner success">You're signed off. A confirmation has been sent to ${recipient.email}.</div>
    <div class="modal-overlay" style="display:none;"></div>
    <div class="snapshot" style="padding:20px;">
      <p style="margin:0 0 12px;"><strong>${recipient.name}</strong> signed off on behalf of <strong>${record.client_name}</strong> on ${new Date(recipient.signed_at).toLocaleString("en-GB")}.</p>
      <p style="font-size:12.5px;color:#666;line-height:1.5;">${approvalText}</p>
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="${certificateUrl}" style="text-decoration:none;">Download certificate (PDF)</a>
    </div>
  `;
}

function renderSignForm({ record, recipient }) {
  return html`
    <div class="actions" id="sign-actions">
      <button class="btn btn-primary" id="signoff-btn">Sign off</button>
    </div>
    <div class="error-text" id="sign-error" style="display:none;"></div>

    <div class="modal-overlay" id="modal-overlay" style="display:none;">
      <div class="modal">
        <h2>Confirm sign-off</h2>
        <div class="approval-text" id="approval-preview">
          I, ${recipient.name} (${recipient.email}), on behalf of ${record.client_name}, confirm approval of
          "${record.scope_label}" for the ${record.project_name} project, as presented above. This sign-off
          covers the ${scopeNoun(record.scope_type)} shown on this page only. Any further changes requested
          after this approval fall outside the current scope of work and will be treated as chargeable
          additional work, billed separately from this engagement.
        </div>
        <label>
          <input type="checkbox" id="confirm-checkbox" />
          <span>I understand and confirm the above.</span>
        </label>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm" disabled>Confirm sign-off</button>
        </div>
      </div>
    </div>
  `;
}

function renderPageScript({ recipientId, alreadySigned }) {
  // Plain vanilla JS, no bundler — this whole project avoids build tooling
  // by design (see plugin/README.md and the root README for why).
  return raw(`
    (function () {
      var recipientId = ${JSON.stringify(recipientId)};
      var alreadySigned = ${JSON.stringify(alreadySigned)};

      if (!alreadySigned) {
        fetch('/api/recipients/' + recipientId + '/view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referrer: document.referrer || null }),
        }).catch(function () {});
      }

      var signBtn = document.getElementById('signoff-btn');
      var overlay = document.getElementById('modal-overlay');
      var checkbox = document.getElementById('confirm-checkbox');
      var confirmBtn = document.getElementById('modal-confirm');
      var cancelBtn = document.getElementById('modal-cancel');
      var errorEl = document.getElementById('sign-error');

      if (signBtn) {
        signBtn.addEventListener('click', function () {
          overlay.style.display = 'flex';
        });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          overlay.style.display = 'none';
        });
      }
      if (checkbox) {
        checkbox.addEventListener('change', function () {
          confirmBtn.disabled = !checkbox.checked;
        });
      }
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Signing…';
          fetch('/api/recipients/' + recipientId + '/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then(function (res) {
              return res.json().then(function (body) { return { ok: res.ok, body: body }; });
            })
            .then(function (result) {
              if (!result.ok) throw new Error(result.body.error || 'Something went wrong');
              window.location.reload();
            })
            .catch(function (err) {
              overlay.style.display = 'none';
              errorEl.textContent = err.message;
              errorEl.style.display = 'block';
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Confirm sign-off';
            });
        });
      }
    })();
  `);
}

function renderLandingPage({ record, recipient, snapshots, certificate }) {
  const isSigned = recipient.status === "signed";
  const certificateUrl = `/api/certificate/${recipient.id}`;

  return html`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${record.project_name} — ${record.scope_label}</title>
    <style>${raw(PAGE_STYLES)}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="header"><span class="badge">Off You Pop</span></div>
      <h1>${record.project_name}</h1>
      <div class="meta">${record.client_name} · ${record.scope_label}</div>

      ${record.archived_at
        ? html`<div class="banner warn">This sign-off has been archived by the team.</div>`
        : ""}
      ${record.notes ? html`<div class="banner info">${record.notes}</div>` : ""}

      ${raw(renderSnapshots(snapshots))}

      ${isSigned
        ? raw(
            renderSignedState({
              record,
              recipient,
              certificateUrl,
              approvalText: certificate ? certificate.approval_text : "",
            }),
          )
        : record.archived_at
          ? ""
          : raw(renderSignForm({ record, recipient }))}

      <div class="footer-note">This is a record of design sign-off, not a legally notarized signature.</div>
    </div>
    <script>${renderPageScript({ recipientId: recipient.id, alreadySigned: isSigned })}</script>
  </body>
</html>`;
}

module.exports = { renderLandingPage };
