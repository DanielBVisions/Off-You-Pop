import type {
  MainToUiMessage,
  PluginSettings,
  SelectedNode,
  UiToMainMessage,
} from "./types";

const EXPORTABLE_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "GROUP",
  "SECTION",
]);

const DEFAULT_SETTINGS: PluginSettings = {
  apiBaseUrl: "",
  apiKey: "",
  createdBy: "",
};

// Nodes currently selected on canvas, keyed by id — kept in sync with
// selectionchange so export requests don't need getNodeByIdAsync lookups
// (documentAccess is "dynamic-page", so those lookups are async/slower).
const selectedNodesById = new Map<string, SceneNode>();

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

function toSelectedNode(node: SceneNode): SelectedNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    width: node.width !== undefined ? Math.round(node.width) : 0,
    height: node.height !== undefined ? Math.round(node.height) : 0,
  };
}

function postToUi(message: MainToUiMessage) {
  figma.ui.postMessage(message);
}

function pushSelection() {
  const exportable = figma.currentPage.selection.filter((n) =>
    EXPORTABLE_TYPES.has(n.type),
  );
  selectedNodesById.clear();
  for (const node of exportable) {
    selectedNodesById.set(node.id, node);
  }
  postToUi({ type: "selection", nodes: exportable.map(toSelectedNode) });
}

async function getSettings(): Promise<PluginSettings> {
  const stored = await figma.clientStorage.getAsync("settings");
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

async function exportNodePng(
  node: SceneNode,
  scale: number,
): Promise<Uint8Array> {
  return node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale },
  });
}

async function exportNodeJpg(
  node: SceneNode,
  scale: number,
): Promise<Uint8Array> {
  return node.exportAsync({
    format: "JPG",
    constraint: { type: "SCALE", value: scale },
  });
}

// Stay comfortably under Vercel's hard 4.5MB request-body limit for a
// single upload — this is what each frame's own upload is checked against,
// not a total across frames (each frame uploads in its own request).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Tried in order until the whole batch fits.
const EXPORT_SCALES = [2, 1, 0.5, 0.25];

// JPG, not PNG: PNG is lossless, and a large, content-heavy page (lots of
// gradients/photos/sections) can produce a multi-frame export that's still
// too big at 2x even after the create flow was split into one upload per
// frame — a real 413 in production, not a theoretical concern (this is the
// second time this exact limit has bitten this project; the first time is
// what motivated the per-frame upload split in the first place). JPG's
// lossy compression is dramatically smaller for this kind of content with
// no visible quality loss at sign-off review size.
//
// All frames in one sign-off are exported at the SAME scale, not each
// independently falling back on its own — a per-frame fallback meant two
// frames of the identical design width could end up at genuinely different
// pixel resolutions (a heavy frame silently shrunk more than a light one),
// which the landing page's native-resolution-capped display then renders
// as visibly different widths even though the design width is the same.
// Every scale in EXPORT_SCALES is tried against the whole batch; only the
// heaviest frame in it needs to be over the limit to drop to the next one.
async function exportNodesForUpload(
  nodes: SceneNode[],
): Promise<Uint8Array[]> {
  let results: Uint8Array[] = [];
  for (const scale of EXPORT_SCALES) {
    results = [];
    for (const node of nodes) {
      results.push(await exportNodeJpg(node, scale));
    }
    const heaviest = Math.max(...results.map((r) => r.length));
    if (heaviest <= MAX_UPLOAD_BYTES) break;
  }
  return results;
}

figma.on("selectionchange", pushSelection);

figma.ui.onmessage = async (msg: UiToMainMessage) => {
  switch (msg.type) {
    case "ready": {
      pushSelection();
      postToUi({ type: "settings", settings: await getSettings() });
      postToUi({
        type: "current-user",
        name: figma.currentUser?.name ?? null,
        fileKey: figma.fileKey ?? null,
      });
      break;
    }

    case "get-settings": {
      postToUi({ type: "settings", settings: await getSettings() });
      break;
    }

    case "set-settings": {
      await figma.clientStorage.setAsync("settings", msg.settings);
      break;
    }

    case "request-thumbnails": {
      const thumbnails: { id: string; bytes: number[] }[] = [];
      for (const id of msg.nodeIds) {
        const node = selectedNodesById.get(id);
        if (!node) continue;
        try {
          const bytes = await exportNodePng(node, 0.5);
          thumbnails.push({ id, bytes: Array.from(bytes) });
        } catch (err) {
          // Skip a node that fails to export a thumbnail (e.g. zero-size) —
          // the full export at send-time will surface a real error if it
          // still can't be exported.
        }
      }
      postToUi({ type: "thumbnails", thumbnails });
      break;
    }

    case "request-full-export": {
      try {
        // JPG, batch-uniform scale (see exportNodesForUpload) — not PNG,
        // not SVG. PNG at 2x looked fine for a simple frame but still hit
        // Vercel's 4.5MB-per-upload limit on a large, content-heavy page (a
        // real 413, not theoretical). SVG (tried in between) fixed the
        // size but was heavy enough to crash Figma outright on that same
        // kind of page. JPG's lossy compression stays small enough for
        // this content with no visible quality loss at review size, and is
        // exactly as stable as PNG (same raster export path, just a
        // different format). The landing page's CSS caps display width at
        // the image's own resolution (no upscaling past native size — see
        // lib/landing-template.js), so 2x is sharp on anything up to a
        // ~2x-density screen at the frame's native design width.
        const nodes = msg.nodeIds.map((id) => {
          const node = selectedNodesById.get(id);
          if (!node) {
            throw new Error(
              `A selected frame ("${id}") is no longer available — it may have been deleted or deselected. Re-select your frames and try again.`,
            );
          }
          return node;
        });
        const allBytes = await exportNodesForUpload(nodes);
        const exports = nodes.map((node, i) => ({
          id: node.id,
          name: node.name,
          bytes: Array.from(allBytes[i]),
        }));
        postToUi({
          type: "full-export-result",
          requestId: msg.requestId,
          exports,
        });
      } catch (err) {
        postToUi({
          type: "full-export-error",
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "deselect-node": {
      // Programmatically shrinking the selection re-fires selectionchange,
      // which re-syncs the UI's frame list — so "remove" in the panel and
      // deselecting on canvas never drift apart.
      figma.currentPage.selection = figma.currentPage.selection.filter(
        (n) => n.id !== msg.nodeId,
      );
      break;
    }

    case "resize": {
      figma.ui.resize(msg.width, msg.height);
      break;
    }

    case "notify": {
      figma.notify(msg.message, { error: msg.error });
      break;
    }

    case "close": {
      figma.closePlugin();
      break;
    }
  }
};
