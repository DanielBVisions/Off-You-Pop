const { html, raw, escapeHtml } = require("./html");

const PAGE_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background: #f5f5f7; color: #1e1e1e; overflow-x: hidden; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  .banner { padding:12px 16px; border-radius:8px; font-size:13px; margin-bottom:20px; }
  .banner.info { background:#e7f4ff; color:#0a5ba6; }
  .banner.success { background:#e6f7ec; color:#0f7a3d; }
  .banner.warn { background:#fff4e5; color:#8a5a00; }
  .snapshot { background:#fff; border-radius:10px; overflow:hidden; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
  /* A persistent dark bar across the top — project name, client/scope, and
     the sign-off action — sticky so it stays on screen while scrolling
     through a frame taller than the viewport (a multi-page mockup can be
     many screens tall; without this, the name and the Sign off button
     were only reachable after scrolling past the whole thing). Kept as a
     sibling of .stage, not nested inside it, so it isn't affected by
     .stage's overflow/transform. */
  .stage-bar { position:sticky; top:0; z-index:20; background:#1e1e1e; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 20px; }
  .stage-bar-info { display:flex; align-items:center; gap:10px; min-width:0; flex-wrap:wrap; }
  .stage-bar-badge { background:#18a0fb; color:#fff; font-weight:700; font-size:11px; padding:4px 9px; border-radius:5px; flex:none; }
  .stage-bar-title { color:#fff; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .stage-bar-meta { color:#aaa; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .stage-bar-actions { position:relative; flex:none; display:flex; align-items:center; gap:10px; }
  .stage-bar-status { color:#aaa; font-size:12.5px; }
  #sign-error { position:absolute; top:100%; right:0; margin-top:8px; background:#3a1212; color:#ffb4b4; padding:6px 12px; border-radius:6px; font-size:12px; white-space:nowrap; }
  /* The stage: a full-bleed, near-full-viewport-height dark canvas right
     below the bar, modeled on Figma's own Present mode. Display width
     comes from each frame's actual Figma design width (an inline
     style="width:Npx" set per <img> — see renderSnapshots), not from the
     exported bitmap's own pixel size: two frames the designer made the
     same width on the artboard need to display the same width here too,
     even if one of them happened to export at a lower resolution to fit
     the upload size limit. max-width:100% still shrinks it (proportionally
     with every other frame, since it's a plain percentage) to fit a
     narrower viewport — this is also what stops a frame from being
     stretched past its own resolution and looking blurry. Centered via
     margin:auto when the stage is wider than the frame itself, matching
     Figma's own letterboxed-on-a-dark-canvas look, and vertically centered
     within the stage via flex if it's shorter than the stage's min-height.
     A frame with no recorded design width (shouldn't happen for anything
     created after this was added) falls back to width:auto — its own
     intrinsic bitmap size. */
  .stage { width:100vw; position:relative; left:50%; transform:translateX(-50%); }
  .carousel-viewport { position:relative; background:#1e1e1e; overflow:hidden; display:flex; align-items:center; justify-content:center; min-height:max(320px, 76vh); }
  .carousel-slide { display:none; width:100%; }
  .carousel-slide.is-active { display:block; }
  .carousel-slide img { display:block; width:auto; max-width:100%; height:auto; margin:0 auto; }
  /* Fixed to the actual browser viewport (a sibling of .stage, not nested
     in it — position:fixed inside a transformed ancestor would anchor to
     that ancestor instead of the viewport), so it's reachable at any
     scroll position, not just when a tall frame happens to have scrolled
     past. */
  .carousel-nav-bar { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:20; background:rgba(20,20,20,0.85); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border-radius:22px; padding:4px 6px; display:flex; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.3); max-width:min(90vw, 640px); }
  .carousel-nav-btn { width:30px; height:30px; border:none; border-radius:50%; background:transparent; color:#fff; font-size:17px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; flex:none; }
  .carousel-nav-btn:hover { background:rgba(255,255,255,0.16); }
  .carousel-counter { color:#fff; font-size:12.5px; padding:0 10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; user-select:none; }
  .actions { margin-top: 32px; text-align:center; }
  .btn { display:inline-block; padding:12px 28px; border-radius:8px; border:none; font-size:15px; font-weight:600; cursor:pointer; }
  .btn-primary { background:#18a0fb; color:#fff; }
  .btn-primary:disabled { background:#ccc; cursor:not-allowed; }
  .btn-secondary { background:#fff; color:#1e1e1e; border:1px solid #d5d5d5; }
  .btn-compact { padding:7px 16px; font-size:13px; text-decoration:none; }
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

// The slides that go inside the stage's .carousel-viewport (see
// renderLandingPage — the viewport itself is page-level, not per-snapshot,
// so it's assembled there). The nav pill is a separate function
// (renderNavBar) because it now lives outside .stage entirely — see the
// .carousel-nav-bar comment in PAGE_STYLES for why. Each slide is built via
// a nested `html` call, and the caller wraps this function's return value
// in raw() at the call site.
function renderSnapshots(snapshots) {
  return snapshots
    .map(
      (s, i) => html`
        <div class="carousel-slide${i === 0 ? " is-active" : ""}" data-index="${i}">
          <img
            src="${s.snapshot_url}"
            alt="${s.figma_node_name || "Frame"}"
            loading="lazy"
            ${s.figma_frame_width ? html`style="width:${s.figma_frame_width}px"` : ""}
          />
        </div>
      `,
    )
    .join("");
}

// Fixed prev/counter/next pill — only rendered for more than one frame. The
// frame name is folded into the counter text ("Homepage · 1 / 2") rather
// than a separate tag, so there's just the one piece of floating chrome.
function renderNavBar(snapshots) {
  if (snapshots.length <= 1) return "";
  const firstName = snapshots[0].figma_node_name ? `${escapeHtml(snapshots[0].figma_node_name)} · ` : "";
  return `
    <div class="carousel-nav-bar">
      <button class="carousel-nav-btn" id="carousel-prev" type="button" aria-label="Previous frame">‹</button>
      <span class="carousel-counter" id="carousel-counter-text">${firstName}1 / ${snapshots.length}</span>
      <button class="carousel-nav-btn" id="carousel-next" type="button" aria-label="Next frame">›</button>
    </div>
  `;
}

function renderSignedState({ record, recipient, certificateUrl, approvalText }) {
  return html`
    <div class="banner success">You're signed off. A confirmation has been sent to ${recipient.email}.</div>
    <div class="snapshot" style="padding:20px;">
      <p style="margin:0 0 12px;"><strong>${recipient.name}</strong> signed off on behalf of <strong>${record.client_name}</strong> on ${new Date(recipient.signed_at).toLocaleString("en-GB")}.</p>
      <p style="font-size:12.5px;color:#666;line-height:1.5;">${approvalText}</p>
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="${certificateUrl}" style="text-decoration:none;">Download certificate (PDF)</a>
    </div>
  `;
}

// The Sign off button + its inline error text — lives in the sticky
// .stage-bar now, not buried in .wrap below a potentially very tall frame.
function renderSignOffButton() {
  return html`
    <button class="btn btn-primary btn-compact" id="signoff-btn">Sign off</button>
    <div class="error-text" id="sign-error" style="display:none;"></div>
  `;
}

// The confirmation modal itself is unaffected by where its trigger button
// lives — it's a fixed, full-viewport overlay regardless of DOM position.
function renderSignOffModal({ record, recipient }) {
  return html`
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

function renderPageScript({ recipientId, alreadySigned, frameNames }) {
  // Plain vanilla JS, no bundler — this whole project avoids build tooling
  // by design (see plugin/README.md and the root README for why).
  return raw(`
    (function () {
      var recipientId = ${JSON.stringify(recipientId)};
      var alreadySigned = ${JSON.stringify(alreadySigned)};
      var frameNames = ${JSON.stringify(frameNames)};

      var slideEls = document.querySelectorAll('#frame-carousel .carousel-slide');
      var counterEl = document.getElementById('carousel-counter-text');
      var prevBtn = document.getElementById('carousel-prev');
      var nextBtn = document.getElementById('carousel-next');
      var currentSlide = 0;

      function showSlide(index) {
        if (!slideEls.length) return;
        currentSlide = (index + slideEls.length) % slideEls.length;
        for (var i = 0; i < slideEls.length; i++) {
          slideEls[i].classList.toggle('is-active', i === currentSlide);
        }
        if (counterEl) {
          var name = frameNames[currentSlide];
          counterEl.textContent = (name ? name + ' · ' : '') + (currentSlide + 1) + ' / ' + slideEls.length;
        }
      }

      if (prevBtn) prevBtn.addEventListener('click', function () { showSlide(currentSlide - 1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { showSlide(currentSlide + 1); });

      if (slideEls.length > 1) {
        document.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft') showSlide(currentSlide - 1);
          if (e.key === 'ArrowRight') showSlide(currentSlide + 1);
        });

        var carouselEl = document.getElementById('frame-carousel');
        var touchStartX = null;
        carouselEl.addEventListener('touchstart', function (e) {
          touchStartX = e.touches[0].clientX;
        }, { passive: true });
        carouselEl.addEventListener('touchend', function (e) {
          if (touchStartX === null) return;
          var dx = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(dx) > 40) showSlide(dx < 0 ? currentSlide + 1 : currentSlide - 1);
          touchStartX = null;
        });
      }

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
    <div class="stage-bar">
      <div class="stage-bar-info">
        <span class="stage-bar-badge">Off You Pop</span>
        <span class="stage-bar-title">${record.project_name}</span>
        <span class="stage-bar-meta">${record.client_name} · ${record.scope_label}</span>
      </div>
      <div class="stage-bar-actions">
        ${isSigned
          ? html`<a class="btn btn-secondary btn-compact" href="${certificateUrl}">Download certificate</a>`
          : record.archived_at
            ? html`<span class="stage-bar-status">Archived</span>`
            : raw(renderSignOffButton())}
      </div>
    </div>

    <div class="stage">
      <div class="carousel-viewport" id="frame-carousel">${raw(renderSnapshots(snapshots))}</div>
    </div>
    ${raw(renderNavBar(snapshots))}

    ${!isSigned && !record.archived_at ? raw(renderSignOffModal({ record, recipient })) : ""}

    <div class="wrap">
      ${record.archived_at
        ? html`<div class="banner warn">This sign-off has been archived by the team.</div>`
        : ""}
      ${record.notes ? html`<div class="banner info">${record.notes}</div>` : ""}

      ${isSigned
        ? raw(
            renderSignedState({
              record,
              recipient,
              certificateUrl,
              approvalText: certificate ? certificate.approval_text : "",
            }),
          )
        : ""}

      <div class="footer-note">This is a record of design sign-off, not a legally notarized signature.</div>
    </div>
    <script>${renderPageScript({
      recipientId: recipient.id,
      alreadySigned: isSigned,
      frameNames: snapshots.map((s) => s.figma_node_name || ""),
    })}</script>
  </body>
</html>`;
}

module.exports = { renderLandingPage };
