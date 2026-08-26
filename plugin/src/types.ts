// Shared types for the plugin. Mirrors the data model in docs/api-contract.md
// (and, upstream of that, the tech spec) for the fields the plugin creates.

export type ScopeType = "single_frame" | "multi_frame" | "flow" | "branding";

export interface SelectedNode {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

export interface RecipientInput {
  name: string;
  email: string;
  contactId: string | null;
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  clientName: string;
  lastUsedAt: string | null;
}

export interface PluginSettings {
  apiBaseUrl: string;
  apiKey: string;
  createdBy: string;
}

export interface SnapshotMeta {
  figmaFrameKey: string;
  figmaNodeName: string;
  sequenceOrder: number;
}

export interface CreateSignoffPayload {
  clientName: string;
  projectName: string;
  scopeType: ScopeType;
  scopeLabel: string;
  requiresAllRecipients: boolean;
  followsSignoffId: string | null;
  notes: string;
  createdBy: string;
  recipients: RecipientInput[];
  snapshots: SnapshotMeta[];
}

export interface CreateSignoffResponse {
  id: string;
  landingUrl: string;
}

// --- postMessage protocol between ui.ts (iframe) and code.ts (main thread) ---

export type UiToMainMessage =
  | { type: "ready" }
  | { type: "get-settings" }
  | { type: "set-settings"; settings: PluginSettings }
  | { type: "request-thumbnails"; nodeIds: string[] }
  | {
      type: "request-full-export";
      nodeIds: string[];
      requestId: string;
    }
  | { type: "resize"; width: number; height: number }
  | { type: "notify"; message: string; error?: boolean }
  | { type: "deselect-node"; nodeId: string }
  | { type: "close" };

export type MainToUiMessage =
  | { type: "selection"; nodes: SelectedNode[] }
  | { type: "settings"; settings: PluginSettings }
  | { type: "current-user"; name: string | null }
  | {
      type: "thumbnails";
      thumbnails: { id: string; bytes: number[] }[];
    }
  | {
      type: "full-export-result";
      requestId: string;
      exports: { id: string; name: string; bytes: number[] }[];
    }
  | { type: "full-export-error"; requestId: string; message: string };
