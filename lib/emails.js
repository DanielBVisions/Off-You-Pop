// Email templates — plain inline-styled HTML (no MJML/react-email, same
// no-npm-registry constraint as everything else). Kept deliberately simple.

const { escapeHtml } = require("./html");

function wrapper(bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr><td style="background:#18a0fb;padding:20px 32px;">
              <span style="color:#fff;font-weight:700;font-size:16px;">Off You Pop</span>
            </td></tr>
            <tr><td style="padding:32px;color:#1e1e1e;font-size:14px;line-height:1.6;">
              ${bodyHtml}
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#18a0fb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(label)}</a>`;
}

function signoffCreatedEmail({ recipientName, projectName, clientName, scopeLabel, landingUrl, notes }) {
  return wrapper(`
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p><strong>${escapeHtml(clientName)}</strong> — <strong>${escapeHtml(projectName)}</strong> is ready for your review.</p>
    <p>Scope: ${escapeHtml(scopeLabel)}</p>
    ${notes ? `<p style="color:#666;">${escapeHtml(notes)}</p>` : ""}
    <p>Please review and confirm sign-off using the link below.</p>
    ${button(landingUrl, "Review & sign off")}
  `);
}

function signoffCompleteEmail({ recipientLabel, projectName, clientName, scopeLabel, signerName, signedAtIso, certificateUrl, isTeamCopy }) {
  const intro = isTeamCopy
    ? `<strong>${escapeHtml(signerName)}</strong> has signed off <strong>${escapeHtml(scopeLabel)}</strong> for ${escapeHtml(clientName)} — ${escapeHtml(projectName)}.`
    : `Thanks — your sign-off for <strong>${escapeHtml(scopeLabel)}</strong> (${escapeHtml(projectName)}) is confirmed.`;
  return wrapper(`
    <p>Hi ${escapeHtml(recipientLabel)},</p>
    <p>${intro}</p>
    <p style="color:#666;">Signed ${escapeHtml(signedAtIso)}</p>
    ${button(certificateUrl, "View certificate")}
  `);
}

module.exports = { signoffCreatedEmail, signoffCompleteEmail };
