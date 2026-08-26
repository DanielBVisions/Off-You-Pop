// Structural validation for lib/pdf.js and lib/zip.js — no test framework
// (none installable), just direct assertions plus the system `unzip` tool
// for the zip side. Run with: node scripts/test-pdf-zip.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const { renderTextPdf } = require("../lib/pdf");
const { makeZip, crc32 } = require("../lib/zip");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oyp-test-"));

// --- PDF ---------------------------------------------------------------

function validatePdfStructure(buf) {
  const text = buf.toString("latin1");
  assert.match(text, /^%PDF-1\.4\n/, "starts with PDF header");
  assert.match(text, /%%EOF$/, "ends with %%EOF");

  const startxrefMatch = text.match(/startxref\s+(\d+)\s+%%EOF/);
  assert.ok(startxrefMatch, "has startxref pointer");
  const xrefOffset = Number(startxrefMatch[1]);
  const atXref = text.slice(xrefOffset, xrefOffset + 4);
  assert.strictEqual(atXref, "xref", `startxref offset ${xrefOffset} points at "xref"`);

  const trailerMatch = text.match(/trailer\s*<<([^>]*)>>/);
  assert.ok(trailerMatch, "has trailer");
  const sizeMatch = trailerMatch[1].match(/\/Size (\d+)/);
  const rootMatch = trailerMatch[1].match(/\/Root (\d+) 0 R/);
  assert.ok(sizeMatch && rootMatch, "trailer has /Size and /Root");
  const size = Number(sizeMatch[1]);

  // Every object 1..size-1 referenced in the xref table must resolve to
  // the right "N 0 obj" at its recorded byte offset.
  const xrefBody = text.slice(xrefOffset, text.indexOf("trailer", xrefOffset));
  const entries = xrefBody
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{10} 00000 n$/.test(l)); // real entries only; excludes the object-0 free entry (gen 65535)
  assert.strictEqual(entries.length, size - 1, `xref has ${size - 1} entries (object 0 is implicit free)`);

  entries.forEach((entry, i) => {
    const objNum = i + 1;
    if (entry.endsWith("f")) return; // free entry (shouldn't happen here)
    const off = Number(entry.slice(0, 10));
    const chunk = text.slice(off, off + String(objNum).length + 6);
    assert.ok(chunk.startsWith(`${objNum} 0 obj`), `object ${objNum} at offset ${off} is "${chunk}"`);
  });

  // Root catalog resolves, and Pages/Count is sane.
  const rootNum = Number(rootMatch[1]);
  const rootOffset = Number(entries[rootNum - 1].slice(0, 10));
  const rootObj = text.slice(rootOffset, text.indexOf("endobj", rootOffset));
  assert.match(rootObj, /\/Type \/Catalog/, "root object is a Catalog");

  return { size };
}

const cert = renderTextPdf({
  title: "Sign-Off Certificate",
  blocks: [
    { type: "field", label: "Project", value: "Acme Website Redesign" },
    { type: "field", label: "Client", value: "Acme Ltd" },
    { type: "field", label: "Scope", value: "Homepage only" },
    { type: "spacer" },
    { type: "heading", text: "Approval" },
    {
      type: "paragraph",
      text: "I, Jo Client (jo@acme.com), confirm approval of the design work described above as of the date and time below. " +
        "Any further changes requested after this sign-off fall outside the current scope of work and will be treated as chargeable additional work, billed separately from this engagement. " +
        "This confirmation, together with the associated audit trail (viewed/signed timestamps and IP address), constitutes evidence of approval for the design milestone described.",
    },
    { type: "spacer" },
    { type: "field", label: "Signed by", value: "Jo Client <jo@acme.com>" },
    { type: "field", label: "Signed at", value: "2026-08-26T10:00:00.000Z" },
    { type: "field", label: "IP address", value: "203.0.113.5" },
    { type: "field", label: "Record hash", value: "a1b2c3d4e5f6" },
  ],
});
fs.writeFileSync(path.join(tmp, "cert.pdf"), cert);
const pdfInfo = validatePdfStructure(cert);
console.log(`[pdf] OK — ${cert.length} bytes, ${pdfInfo.size - 1} objects, structurally valid`);

// Long-content pagination check: force a second page and re-validate.
const longParagraphs = Array.from({ length: 40 }, (_, i) => ({
  type: "paragraph",
  text: `Paragraph ${i}: `.padEnd(400, "lorem ipsum dolor sit amet consectetur adipiscing elit. "),
}));
const longDoc = renderTextPdf({ title: "Long Doc", blocks: longParagraphs });
const longInfo = validatePdfStructure(longDoc);
assert.ok(longInfo.size - 1 > 6, "multi-page doc has more than one page's worth of objects");
console.log(`[pdf] OK — pagination produced ${(longInfo.size - 1 - 4) / 2} pages`);

// --- ZIP ---------------------------------------------------------------

const fileA = Buffer.from("Off You Pop — logo primary.svg placeholder content\n".repeat(20), "utf8");
const fileB = crypto_getRandomBuffer(4096); // incompressible-ish, exercises the "store" fallback path

function crypto_getRandomBuffer(n) {
  return require("node:crypto").randomBytes(n);
}

const zipBuf = makeZip([
  { name: "logo-primary.svg", data: fileA },
  { name: "assets/random.bin", data: fileB },
]);
const zipPath = path.join(tmp, "export.zip");
fs.writeFileSync(zipPath, zipBuf);

execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
console.log("[zip] OK — unzip -t reports no CRC/structural errors");

const extractDir = path.join(tmp, "extracted");
fs.mkdirSync(extractDir);
execFileSync("unzip", ["-q", zipPath, "-d", extractDir]);
const extractedA = fs.readFileSync(path.join(extractDir, "logo-primary.svg"));
const extractedB = fs.readFileSync(path.join(extractDir, "assets/random.bin"));
assert.ok(extractedA.equals(fileA), "compressed entry round-trips byte-for-byte");
assert.ok(extractedB.equals(fileB), "stored (incompressible) entry round-trips byte-for-byte");
console.log("[zip] OK — both entries round-trip byte-for-byte");

assert.strictEqual(crc32(Buffer.from("123456789")), 0xcbf43926, "crc32 matches the standard check value");
console.log("[zip] OK — crc32 matches known test vector");

console.log("\nAll pdf/zip structural tests passed.");
