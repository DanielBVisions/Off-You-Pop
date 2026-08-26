// Signed dashboard session cookie — HMAC-SHA256 via node:crypto (built in,
// no dependency). The cookie holds the Supabase access token plus its
// expiry; a tampered cookie fails the signature check, an expired one is
// rejected locally without a round trip. No refresh-token flow in v1 — the
// dashboard just asks for a re-login once the ~1hr token expires, which is
// an acceptable tradeoff for an internal tool (documented in README).

const crypto = require("node:crypto");

const COOKIE_NAME = "oyp_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("Missing required env var: SESSION_SECRET");
  return value;
}

function sign(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  return `${b64}.${mac}`;
}

function unsign(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [b64, mac] = token.split(".");
  const expectedMac = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

// Vercel deployments are always HTTPS (VERCEL is set automatically there);
// local dev servers are plain HTTP, where a `Secure` cookie would silently
// never be sent back by the browser.
function secureFlag() {
  return process.env.VERCEL ? "; Secure" : "";
}

function createSessionCookie({ accessToken, expiresAt, userId, email, role }) {
  const token = sign({ accessToken, expiresAt, userId, email, role });
  const maxAge = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly${secureFlag()}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly${secureFlag()}; SameSite=Lax; Path=/; Max-Age=0`;
}

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const session = unsign(raw);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt * 1000 < Date.now()) return null;
  return session;
}

module.exports = {
  COOKIE_NAME,
  createSessionCookie,
  clearSessionCookie,
  readSession,
  parseCookies,
};
