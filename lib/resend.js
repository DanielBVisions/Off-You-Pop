// Resend's plain REST API via fetch — no SDK needed, same reasoning as
// lib/supabase.js. https://resend.com/docs/api-reference/emails/send-email

async function sendEmail({ to, subject, html, from, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required env var: RESEND_API_KEY");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from || process.env.RESEND_FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Resend send failed (${res.status}): ${body?.message || "unknown error"}`,
    );
  }
  return body;
}

module.exports = { sendEmail };
