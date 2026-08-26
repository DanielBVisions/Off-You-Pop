// Small framework-free helpers for Vercel's plain Node.js serverless
// functions. Deliberately doesn't rely on the request-shimming
// (req.query/req.cookies/auto body parsing) that `@vercel/node` normally
// adds at deploy time — using only raw Node req/url/Buffer APIs instead
// means the same code runs identically here and under
// scripts/dev-server.mjs's local dev server, so local testing actually
// proves something about the deployed behavior.

function getUrl(req) {
  return new URL(req.url, "http://internal");
}

function pathSegments(req) {
  return getUrl(req).pathname.split("/").filter(Boolean);
}

function query(req) {
  return getUrl(req).searchParams;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

/**
 * Minimal multipart/form-data parser (RFC 2388) for the plugin's
 * POST /api/signoffs payload: one JSON "data" field plus N image files.
 * No streaming — payloads here are a handful of PNG snapshots, small
 * enough to buffer in memory (well under Vercel's serverless body limit).
 *
 * @returns {{ fields: Record<string, string>, files: Array<{ field: string, filename: string, contentType: string, data: Buffer }> }}
 */
function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || "");
  if (!boundaryMatch) {
    const err = new Error("Missing multipart boundary");
    err.status = 400;
    throw err;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`, "utf8");
  const fields = {};
  const files = [];

  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    const partStart = start + boundary.length;
    const nextBoundary = buffer.indexOf(boundary, partStart);
    if (nextBoundary === -1) break;
    // Trim the leading CRLF after the boundary and trailing CRLF before the next one.
    let part = buffer.slice(partStart, nextBoundary);
    if (part.slice(0, 2).toString("latin1") === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString("latin1") === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("utf8");
      const body = part.slice(headerEnd + 4);

      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/.exec(headerText);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      const name = nameMatch ? nameMatch[1] : "";

      if (filenameMatch) {
        files.push({
          field: name,
          filename: filenameMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
          data: body,
        });
      } else if (name) {
        fields[name] = body.toString("utf8");
      }
    }

    start = nextBoundary;
    // "--boundary--" marks the end.
    if (buffer.slice(nextBoundary + boundary.length, nextBoundary + boundary.length + 2).toString("latin1") === "--") {
      break;
    }
  }

  return { fields, files };
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...extraHeaders });
  res.end(html);
}

function sendBuffer(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": buffer.length, ...extraHeaders });
  res.end(buffer);
}

function notFound(res, message = "Not found") {
  sendJson(res, 404, { error: message });
}

function methodNotAllowed(res, allowed) {
  res.writeHead(405, { Allow: allowed.join(", "), "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `Method not allowed — use ${allowed.join(", ")}` }));
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

/** Wraps a handler so thrown errors (with an optional .status) become JSON error responses. */
function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      sendJson(res, err.status || 500, { error: err.message || "Internal server error" });
    }
  };
}

module.exports = {
  getUrl,
  pathSegments,
  query,
  readRawBody,
  readJsonBody,
  parseMultipart,
  sendJson,
  sendHtml,
  sendBuffer,
  notFound,
  methodNotAllowed,
  clientIp,
  withErrorHandling,
};
