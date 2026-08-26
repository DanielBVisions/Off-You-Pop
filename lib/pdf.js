// Hand-rolled minimal PDF writer — no @react-pdf/renderer or Puppeteer
// (couldn't be installed in the build sandbox; see plugin/README.md's note
// on the same constraint for the plugin). Unlike the fetch-based
// Supabase/Resend/Figma clients, this genuinely is a stand-in: it does
// plain single-column text layout with the standard Helvetica font (one of
// the 14 PDF base fonts, so no font embedding is needed), no embedded
// images, and only WinAnsi (Latin-1-ish) characters — non-Latin-1
// characters are replaced with "?". Swapping in a real PDF library later
// for richer layout is a reasonable upgrade, not a requirement — the
// output here is a valid, standards-compliant PDF, just plain-looking.
//
// Verified against `qpdf --check` and `pdftotext` locally (see
// scripts/local-smoke-test.mjs) — not just "should work in theory".

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const AVG_CHAR_WIDTH_RATIO = { regular: 0.5, bold: 0.56 };

function toLatin1(str) {
  return String(str ?? "").replace(/[^\x00-\xFF]/g, "?");
}

function escapePdfText(str) {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(text, maxWidth, size, style = "regular") {
  const clean = toLatin1(text).replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  const charWidth = size * AVG_CHAR_WIDTH_RATIO[style];
  const maxChars = Math.max(4, Math.floor(maxWidth / charWidth));
  const words = clean.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// --- low-level PDF object writer --------------------------------------------

function buildPdf(pageContentStreams) {
  const numPages = pageContentStreams.length;
  const pageObjNums = Array.from({ length: numPages }, (_, i) => 5 + i);
  const contentObjNums = Array.from({ length: numPages }, (_, i) => 5 + numPages + i);
  const maxObjNum = 4 + numPages * 2;

  const objStrings = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${numPages} >>`,
    3: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    4: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  };
  pageObjNums.forEach((pageNum, i) => {
    objStrings[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
  });

  const chunks = [];
  const xref = {};
  let offset = 0;
  function push(str) {
    const buf = Buffer.from(str, "latin1");
    chunks.push(buf);
    offset += buf.length;
  }

  push("%PDF-1.4\n");

  for (let n = 1; n <= 4; n++) {
    xref[n] = offset;
    push(`${n} 0 obj\n${objStrings[n]}\nendobj\n`);
  }
  for (const n of pageObjNums) {
    xref[n] = offset;
    push(`${n} 0 obj\n${objStrings[n]}\nendobj\n`);
  }
  contentObjNums.forEach((n, i) => {
    const streamBuf = Buffer.from(pageContentStreams[i], "latin1");
    xref[n] = offset;
    push(`${n} 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n`);
    chunks.push(streamBuf);
    offset += streamBuf.length;
    push(`\nendstream\nendobj\n`);
  });

  const xrefOffset = offset;
  let xrefSection = `xref\n0 ${maxObjNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObjNum; n++) {
    xrefSection += `${String(xref[n]).padStart(10, "0")} 00000 n \n`;
  }
  push(xrefSection);
  push(`trailer\n<< /Size ${maxObjNum + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat(chunks);
}

// --- page layout -------------------------------------------------------------

/**
 * @param {{title: string, blocks: Array<
 *   {type: 'heading', text: string} |
 *   {type: 'paragraph', text: string} |
 *   {type: 'field', label: string, value: string} |
 *   {type: 'spacer'}
 * >}} doc
 */
function renderTextPdf(doc) {
  const pages = [];
  let lines = [];
  let y = PAGE_HEIGHT - MARGIN;

  function newPageIfNeeded(needed) {
    if (y - needed < MARGIN) {
      pages.push(lines);
      lines = [];
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function emit(text, font, size, gap) {
    lines.push({ text, font, size, x: MARGIN, y });
    y -= gap;
  }

  newPageIfNeeded(28);
  emit(doc.title, "F2", 18, 28);

  for (const block of doc.blocks) {
    if (block.type === "spacer") {
      y -= 10;
      continue;
    }
    if (block.type === "heading") {
      newPageIfNeeded(22);
      emit(block.text, "F2", 13, 22);
      continue;
    }
    if (block.type === "field") {
      newPageIfNeeded(16);
      lines.push({ text: `${block.label}:`, font: "F2", size: 10.5, x: MARGIN, y });
      lines.push({ text: block.value, font: "F1", size: 10.5, x: MARGIN + 130, y });
      y -= 16;
      continue;
    }
    if (block.type === "paragraph") {
      const wrapped = wrapText(block.text, CONTENT_WIDTH, 10.5, "regular");
      for (const line of wrapped) {
        newPageIfNeeded(14);
        emit(line, "F1", 10.5, 14);
      }
      continue;
    }
  }
  pages.push(lines);

  const contentStreams = pages.map((pageLines) => {
    let s = "";
    for (const line of pageLines) {
      s += `BT /${line.font} ${line.size} Tf ${line.x} ${line.y.toFixed(2)} Td (${escapePdfText(toLatin1(line.text))}) Tj ET\n`;
    }
    return s;
  });

  return buildPdf(contentStreams);
}

module.exports = { renderTextPdf, wrapText };
