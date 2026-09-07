const { html, raw, escapeHtml } = require("./html");

const PAGE_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background: #f5f5f7; color: #1e1e1e; overflow-x: hidden; }
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
  /* Full-bleed: break out of .wrap's max-width so the frame genuinely
     fills the screen edge to edge, like Figma's own Present mode, rather
     than sitting in a small card inside the page's text column. The image
     is sized by width alone (no fixed-height box, no object-fit) so it
     scales to fill that full width at its own aspect ratio — a fixed vh
     height here forced letterboxing (huge dead space either side) on any
     frame that isn't roughly as wide as the screen is tall, which was
     worse than the problem it was meant to fix. */
  .carousel { width:100vw; position:relative; left:50%; transform:translateX(-50%); margin-bottom:28px; }
  .carousel-viewport { position:relative; background:#1e1e1e; overflow:hidden; }
  .carousel-slide { display:none; }
  .carousel-slide.is-active { display:block; }
  .carousel-slide img { width:100%; display:block; }
  .carousel-frame-tag { position:absolute; top:14px; left:14px; background:rgba(20,20,20,0.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); color:#fff; font-size:12px; padding:5px 11px; border-radius:7px; pointer-events:none; }
  .carousel-nav-bar { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); background:rgba(20,20,20,0.8); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border-radius:22px; padding:4px; display:flex; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.3); }
  .carousel-nav-btn { width:30px; height:30px; border:none; border-radius:50%; background:transparent; color:#fff; font-size:17px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .carousel-nav-btn:hover { background:rgba(255,255,255,0.16); }
  .carousel-counter { color:#fff; font-size:12.5px; padding:0 10px; font-variant-numeric:tabular-nums; user-select:none; }
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

// A Figma-presentation-style "one frame at a time" carousel: a dark canvas
// with the frame's name floating top-left and a translucent prev/counter/
// next pill floating bottom-center — modeled directly on Figma's own
// Present-mode chrome, rather than a separate row of controls below the
// image. See renderPageScript for the prev/next/keyboard/swipe wiring.
// Each slide is built via a nested `html` call so the frame name still goes
// through escapeHtml; the surrounding structural markup is plain string
// concatenation, and the caller (renderLandingPage) wraps the whole return
// value in raw() at the call site.
function renderSnapshots(snapshots) {
  if (snapshots.length === 0) return "";

  const slides = snapshots
    .map(
      (s, i) => html`
        <div class="carousel-slide${i === 0 ? " is-active" : ""}" data-index="${i}">
          <img src="${s.snapshot_url}" alt="${s.figma_node_name || "Frame"}" loading="lazy" />
          ${s.figma_node_name ? html`<div class="carousel-frame-tag">${s.figma_node_name}</div>` : ""}
        </div>
      `,
    )
    .join("");

  const navBar =
    snapshots.length > 1
      ? `
        <div class="carousel-nav-bar">
          <button class="carousel-nav-btn" id="carousel-prev" type="button" aria-label="Previous frame">‹</button>
          <span class="carousel-counter" id="carousel-counter-text">1 / ${snapshots.length}</span>
          <button class="carousel-nav-btn" id="carousel-next" type="button" aria-label="Next frame">›</button>
        </div>
      `
      : "";

  return `
    <div class="carousel"${snapshots.length > 1 ? ` id="frame-carousel"` : ""}>
      <div class="carousel-viewport">${slides}${navBar}</div>
    </div>
  `;
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
        if (counterEl) counterEl.textContent = (currentSlide + 1) + ' / ' + slideEls.length;
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
