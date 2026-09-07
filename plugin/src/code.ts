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

// Vector, not raster: a PNG at any fixed scale is only ever crisp up to the
// pixel density it was exported at, and the landing page displays a frame
// at whatever width the client's browser window happens to be — no single
// scale is guaranteed to still look sharp there. SVG has no fixed
// resolution, so it stays crisp at full-bleed on any screen, any zoom.
// svgOutlineText converts text to paths at export time (Figma's own
// default), so the design doesn't depend on the viewer's browser having
// the same fonts installed.
async function exportNodeSvg(node: SceneNode): Promise<Uint8Array> {
  return node.exportAsync({
    format: "SVG",
    svgOutlineText: true,
  });
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
        // SVG, not PNG: the landing page displays each frame full-bleed at
        // whatever width the client's browser happens to be, and no single
        // fixed-scale raster export stays crisp across every possible
        // screen size/pixel density (tried 1x, tried 2x — both eventually
        // looked blurry somewhere). SVG has no fixed resolution, so this
        // sidesteps the problem rather than tuning a scale number forever.
        // The per-frame upload step (not one combined request) still keeps
        // each upload well under Vercel's body-size limit even for a
        // complex, vector-heavy frame.
        const exports: { id: string; name: string; bytes: number[] }[] = [];
        for (const id of msg.nodeIds) {
          const node = selectedNodesById.get(id);
          if (!node) {
            throw new Error(
              `A selected frame ("${id}") is no longer available — it may have been deleted or deselected. Re-select your frames and try again.`,
            );
          }
          const bytes = await exportNodeSvg(node);
          exports.push({ id, name: node.name, bytes: Array.from(bytes) });
        }
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
