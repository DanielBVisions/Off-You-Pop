// Hand-rolled build: no esbuild (this repo was set up in a sandbox with no
// network access to the npm registry, so bundler deps couldn't be
// installed). Instead: the globally-available `tsc` transpiles each source
// file to CommonJS individually, and this script stitches the handful of
// resulting files together with a tiny module loader — the whole runtime
// dependency graph is exactly two edges (ui.ts -> api.ts; code.ts and
// api.ts are leaves), so a real bundler is overkill anyway.
//
// If/when npm registry access is available, swap this for esbuild (see
// package.json's devDependencies) — nothing else about the source needs to
// change.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const cjsDir = path.join(dist, "cjs");

mkdirSync(dist, { recursive: true });
rmSync(cjsDir, { recursive: true, force: true });
mkdirSync(cjsDir, { recursive: true });

function tsc() {
  console.log("[build] tsc -> dist/cjs");
  execFileSync(
    "tsc",
    [
      "--ignoreConfig",
      "--module",
      "commonjs",
      "--target",
      "es2017",
      "--lib",
      "ES2017,DOM",
      "--moduleResolution",
      "bundler",
      "--esModuleInterop",
      "--skipLibCheck",
      "--outDir",
      cjsDir,
      "--rootDir",
      path.join(root, "src"),
      path.join(root, "src/code.ts"),
      path.join(root, "src/ui.ts"),
      path.join(root, "src/api.ts"),
      path.join(root, "src/types.ts"),
      path.join(root, "src/figma-plugin-api.d.ts"),
    ],
    { stdio: "inherit", cwd: root },
  );
}

function read(name) {
  return readFileSync(path.join(cjsDir, name), "utf8");
}

function buildCode() {
  // code.ts has no runtime imports of its own (only `import type`, fully
  // elided by tsc) — it just needs `exports`/`module` to exist so the
  // CommonJS boilerplate tsc emits doesn't throw in Figma's plugin sandbox,
  // which executes this as a bare global script, not a module.
  const body = read("code.js");
  const out = `(function () {\n"use strict";\nvar module = { exports: {} };\nvar exports = module.exports;\n${body}\n})();\n`;
  writeFileSync(path.join(dist, "code.js"), out);
  console.log("[build] wrote dist/code.js");
}

function buildUi() {
  // ui.ts requires "./api" at runtime. Wrap both compiled files in a
  // minimal CommonJS-style loader keyed by that same specifier string, so
  // the `require("./api")` call tsc emitted resolves correctly.
  const apiBody = read("api.js");
  const uiBody = read("ui.js");
  const out = `(function () {
"use strict";
var __modules = {};
function __define(id, factory) {
  var mod = { exports: {} };
  __modules[id] = mod;
  factory(mod, mod.exports, function (name) { return __modules[name].exports; });
}
__define("./api", function (module, exports, require) {\n${apiBody}\n});
__define("./ui", function (module, exports, require) {\n${uiBody}\n});
})();
`;
  writeFileSync(path.join(dist, "ui.js"), out);
  console.log("[build] wrote dist/ui.js");
}

function inlineUiHtml() {
  const template = readFileSync(path.join(root, "src/ui.html"), "utf8");
  // Defensive: a literal "</script>" anywhere in the bundled JS would
  // terminate the inline <script> tag early and corrupt the HTML.
  const script = readFileSync(path.join(dist, "ui.js"), "utf8").replace(
    /<\/script/gi,
    "<\\/script",
  );
  const css = readFileSync(path.join(root, "src/ui.css"), "utf8");
  const html = template
    .replace("/*__CSS__*/", () => css)
    .replace("/*__SCRIPT__*/", () => script);
  writeFileSync(path.join(dist, "ui.html"), html);
  console.log("[build] wrote dist/ui.html");
}

tsc();
buildCode();
buildUi();
inlineUiHtml();
console.log("[build] done");
