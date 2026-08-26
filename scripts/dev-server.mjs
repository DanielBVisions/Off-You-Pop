// Local dev/test server for the framework-free /api serverless functions.
// Applies vercel.json's rewrites, then resolves the (rewritten) path to a
// file under /api using the same [param] convention Vercel uses, and
// invokes it as `(req, res)`. Route handlers never receive params from
// this router directly — they re-derive them from req.url themselves (see
// lib/http.js's pathSegments) — so this file only needs to find the right
// module, not thread data through it, which keeps local behavior honest
// to what actually runs on Vercel.

import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "api");
const require = createRequire(import.meta.url);

const vercelConfig = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));

function compileRewrite(rule) {
  const paramNames = [];
  const pattern = rule.source.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), paramNames, destination: rule.destination };
}
const rewrites = (vercelConfig.rewrites || []).map(compileRewrite);

function applyRewrites(pathname) {
  for (const rw of rewrites) {
    const match = rw.regex.exec(pathname);
    if (!match) continue;
    let dest = rw.destination;
    rw.paramNames.forEach((name, i) => {
      dest = dest.replace(`:${name}`, match[i + 1]);
    });
    return dest;
  }
  return pathname;
}

function findBracketEntry(dir, wantFile) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (!entry.startsWith("[") || !entry.includes("]")) continue;
    const full = path.join(dir, entry);
    const isDir = statSync(full).isDirectory();
    if (wantFile && !isDir && entry.endsWith(".js")) return entry;
    if (!wantFile && isDir) return entry;
  }
  return null;
}

function resolveHandlerFile(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return null;
  const rest = segments.slice(1);
  if (rest.length === 0) return null;

  let currentDir = apiDir;
  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i];
    const isLast = i === rest.length - 1;

    if (isLast) {
      const literalFile = path.join(currentDir, `${seg}.js`);
      if (existsSync(literalFile)) return literalFile;

      const bracketFile = findBracketEntry(currentDir, true);
      if (bracketFile) return path.join(currentDir, bracketFile);

      const literalIndex = path.join(currentDir, seg, "index.js");
      if (existsSync(literalIndex)) return literalIndex;

      const bracketDirForIndex = findBracketEntry(currentDir, false);
      if (bracketDirForIndex) {
        const idx = path.join(currentDir, bracketDirForIndex, "index.js");
        if (existsSync(idx)) return idx;
      }
      return null;
    }

    const literalDir = path.join(currentDir, seg);
    if (existsSync(literalDir) && statSync(literalDir).isDirectory()) {
      currentDir = literalDir;
      continue;
    }
    const bracketDir = findBracketEntry(currentDir, false);
    if (bracketDir) {
      currentDir = path.join(currentDir, bracketDir);
      continue;
    }
    return null;
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://internal");
    const rewritten = applyRewrites(url.pathname);
    if (rewritten !== url.pathname) {
      req.url = rewritten + url.search;
    }

    const handlerFile = resolveHandlerFile(new URL(req.url, "http://internal").pathname);
    if (!handlerFile) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }));
      return;
    }

    delete require.cache[require.resolve(handlerFile)];
    // Also clear lib/ modules so edits during a dev session are picked up
    // without restarting the server.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(root, "lib"))) delete require.cache[key];
    }
    const handler = require(handlerFile);
    await handler(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`[dev-server] listening on http://127.0.0.1:${port}`);
});

export { server };
