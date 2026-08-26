// Branding export: Figma REST API -> PNG/SVG exports -> zip, plus a brand
// guidelines PDF, both uploaded to Storage. Per the brief, this must only
// ever be triggered by the sign-off completion event — never prepared in
// advance — so the only caller is api/recipients/[id]/sign.js, once a
// scope_type='branding' record reaches 'signed'.
//
// Runs inline within the sign request (see that file for why: no queue/
// background-job infra to build this against, and export of a handful of
// nodes comfortably fits Vercel's function time limit). Failure here must
// never fail the sign-off itself — the record is signed and locked
// regardless; a failed export just leaves branding_exports.status='failed'
// for a manual retry.

const { exportNodeImages, fetchImageBytes } = require("./figma");
const { makeZip } = require("./zip");
const { renderTextPdf } = require("./pdf");
const { uploadToStorage, pgInsert, pgUpdate } = require("./supabase");

function extensionFor(format) {
  return format === "svg" ? "svg" : "png";
}

async function runBrandingExport({ record, snapshots }) {
  await pgInsert("branding_exports", {
    signoff_id: record.id,
    status: "processing",
  });

  try {
    if (!record.figma_file_key) {
      throw new Error("Record has no figma_file_key — cannot call the Figma export API");
    }
    const nodeIds = snapshots.map((s) => s.figma_frame_key);

    // Export both PNG (for quick viewing) and SVG (for actual production
    // use as logo files) — the brief's "does the export include every
    // variant/format" question is still open per the plugin README/brief;
    // exporting both formats for every selected node is the safest
    // default until that's resolved with the design team.
    const [pngUrls, svgUrls] = await Promise.all([
      exportNodeImages(record.figma_file_key, nodeIds, "png"),
      exportNodeImages(record.figma_file_key, nodeIds, "svg"),
    ]);

    const zipEntries = [];
    for (const snap of snapshots) {
      const safeName = snap.figma_node_name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || snap.figma_frame_key;
      for (const [format, urls] of [["png", pngUrls], ["svg", svgUrls]]) {
        const url = urls[snap.figma_frame_key];
        if (!url) continue; // Figma returns null for a node it couldn't render
        const bytes = await fetchImageBytes(url);
        zipEntries.push({ name: `${safeName}.${extensionFor(format)}`, data: bytes });
      }
    }

    if (zipEntries.length === 0) {
      throw new Error("Figma returned no exportable images for any node in scope");
    }

    const zipBuffer = makeZip(zipEntries);
    const zipUrl = await uploadToStorage(
      "branding-exports",
      `${record.id}/assets.zip`,
      zipBuffer,
      "application/zip",
    );

    const guidelinesPdf = renderTextPdf({
      title: "Brand Guidelines",
      blocks: [
        { type: "field", label: "Client", value: record.client_name },
        { type: "field", label: "Project", value: record.project_name },
        { type: "field", label: "Scope", value: record.scope_label },
        { type: "spacer" },
        { type: "heading", text: "Included assets" },
        ...snapshots.map((s) => ({ type: "paragraph", text: `- ${s.figma_node_name || s.figma_frame_key} (PNG + SVG)` })),
        { type: "spacer" },
        {
          type: "paragraph",
          text: "This document accompanies the exported logo/brand assets in assets.zip. Usage guidance " +
            "(clear space, minimum size, colour variants, incorrect usage) should be added here once the " +
            "brand guidelines template is finalised — this is a placeholder generated from the sign-off " +
            "record's own data.",
        },
      ],
    });
    const guidelinesUrl = await uploadToStorage(
      "branding-exports",
      `${record.id}/brand-guidelines.pdf`,
      guidelinesPdf,
      "application/pdf",
    );

    await pgUpdate("branding_exports", [`signoff_id=eq.${record.id}`], {
      status: "complete",
      zip_url: zipUrl,
      guidelines_pdf_url: guidelinesUrl,
    });

    return { status: "complete", zipUrl, guidelinesUrl };
  } catch (err) {
    await pgUpdate("branding_exports", [`signoff_id=eq.${record.id}`], {
      status: "failed",
      error_message: err.message,
    });
    throw err;
  }
}

module.exports = { runBrandingExport };
