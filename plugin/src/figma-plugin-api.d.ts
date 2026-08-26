// Minimal hand-written ambient types for the Figma Plugin API surface this
// plugin actually uses.
//
// Why this exists: the real `@figma/plugin-typings` package is listed in
// package.json's devDependencies and should be used instead — but this repo
// was built in a sandbox with no network access to the npm registry, so it
// couldn't be installed. Once `npm install` can reach the registry, delete
// this file; the real package's ambient types will take over and nothing
// else needs to change (this stub deliberately mirrors the same global
// shape: `figma`, `__html__`, `SceneNode`, etc.)

interface ExportSettingsImage {
  format: "PNG" | "JPG" | "SVG" | "PDF";
  constraint?: { type: "SCALE" | "WIDTH" | "HEIGHT"; value: number };
}

interface BaseNode {
  readonly id: string;
  name: string;
  readonly type: string;
}

interface LayoutMixin {
  readonly width: number;
  readonly height: number;
}

interface ExportMixin {
  exportAsync(settings: ExportSettingsImage): Promise<Uint8Array>;
}

type SceneNode = BaseNode & Partial<LayoutMixin> & ExportMixin;

interface PageNode {
  selection: SceneNode[];
}

interface UiAPI {
  postMessage(message: unknown): void;
  onmessage: ((message: any) => void) | undefined;
  resize(width: number, height: number): void;
}

interface ClientStorageAPI {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
}

interface ShowUIOptions {
  width?: number;
  height?: number;
  themeColors?: boolean;
  title?: string;
}

interface NotificationOptions {
  error?: boolean;
  timeout?: number;
}

interface PluginAPI {
  readonly currentPage: PageNode;
  readonly ui: UiAPI;
  readonly clientStorage: ClientStorageAPI;
  readonly currentUser: { id: string; name: string } | null;
  showUI(html: string, options?: ShowUIOptions): void;
  on(event: "selectionchange", callback: () => void): void;
  notify(message: string, options?: NotificationOptions): void;
  closePlugin(message?: string): void;
}

declare const figma: PluginAPI;
declare const __html__: string;
