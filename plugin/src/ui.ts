import { createSignoff, searchContacts, ApiError } from "./api";
import type {
  ContactRecord,
  CreateSignoffPayload,
  MainToUiMessage,
  PluginSettings,
  RecipientInput,
  ScopeType,
  SelectedNode,
  UiToMainMessage,
} from "./types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type View = "form" | "settings" | "success";

interface AppState {
  view: View;
  clientName: string;
  projectName: string;
  scopeType: ScopeType;
  scopeLabel: string;
  notes: string;
  requiresAllRecipients: boolean;
  recipients: RecipientInput[];
  orderedNodes: SelectedNode[];
  thumbnails: Record<string, string>;
  settings: PluginSettings;
  contactQuery: string;
  contactResults: ContactRecord[];
  contactSearchLoading: boolean;
  contactSearchError: string;
  sending: boolean;
  sendError: string;
  successUrl: string;
}

const state: AppState = {
  view: "form",
  clientName: "",
  projectName: "",
  scopeType: "single_frame",
  scopeLabel: "",
  notes: "",
  requiresAllRecipients: true,
  recipients: [],
  orderedNodes: [],
  thumbnails: {},
  settings: { apiBaseUrl: "", apiKey: "", createdBy: "" },
  contactQuery: "",
  contactResults: [],
  contactSearchLoading: false,
  contactSearchError: "",
  sending: false,
  sendError: "",
  successUrl: "",
};

// ---------------------------------------------------------------------------
// Main-thread messaging
// ---------------------------------------------------------------------------

function send(message: UiToMainMessage) {
  parent.postMessage({ pluginMessage: message }, "*");
}

let exportRequestCounter = 0;
const pendingExports = new Map<
  string,
  {
    resolve: (exports: { id: string; name: string; bytes: number[] }[]) => void;
    reject: (err: Error) => void;
  }
>();

function requestFullExport(
  nodeIds: string[],
): Promise<{ id: string; name: string; bytes: number[] }[]> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++exportRequestCounter}`;
    pendingExports.set(requestId, { resolve, reject });
    send({ type: "request-full-export", nodeIds, requestId });
  });
}

function bytesToDataUrl(bytes: number[]): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as MainToUiMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "selection":
      reconcileSelection(msg.nodes);
      break;

    case "settings":
      state.settings = msg.settings;
      if (state.view === "settings") renderSettingsView();
      updateSendButtonState();
      break;

    case "current-user":
      if (msg.name && !state.settings.createdBy.trim()) {
        state.settings.createdBy = msg.name;
      }
      break;

    case "thumbnails":
      for (const t of msg.thumbnails) {
        state.thumbnails[t.id] = bytesToDataUrl(t.bytes);
      }
      renderFrames();
      break;

    case "full-export-result": {
      const pending = pendingExports.get(msg.requestId);
      if (pending) {
        pending.resolve(msg.exports);
        pendingExports.delete(msg.requestId);
      }
      break;
    }

    case "full-export-error": {
      const pending = pendingExports.get(msg.requestId);
      if (pending) {
        pending.reject(new Error(msg.message));
        pendingExports.delete(msg.requestId);
      }
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validRecipients(): RecipientInput[] {
  return state.recipients.filter(
    (r) => r.name.trim() && EMAIL_RE.test(r.email.trim()),
  );
}

function computeMissing(): string[] {
  const missing: string[] = [];
  if (!state.clientName.trim()) missing.push("Client name");
  if (!state.projectName.trim()) missing.push("Project name");
  if (validRecipients().length === 0) {
    missing.push("At least one recipient (name + a valid email)");
  }
  if (state.orderedNodes.length === 0) {
    missing.push(
      state.scopeType === "branding"
        ? "Select the asset(s) to include on the canvas"
        : "Select the frame(s) to include on the canvas",
    );
  } else if (state.scopeType === "single_frame" && state.orderedNodes.length > 1) {
    missing.push(
      `"Single frame" scope needs exactly one frame selected (currently ${state.orderedNodes.length})`,
    );
  }
  if (!state.settings.apiBaseUrl.trim()) {
    missing.push("Backend URL — set it in Settings (⚙) first");
  }
  return missing;
}

function computeScopeLabel(): string {
  const n = state.orderedNodes.length;
  switch (state.scopeType) {
    case "single_frame":
      return state.orderedNodes[0]?.name || "Single frame";
    case "multi_frame":
      return `Multiple frames — ${n} page${n === 1 ? "" : "s"}`;
    case "flow":
      return `Flow — ${n} step${n === 1 ? "" : "s"}`;
    case "branding":
      return `Branding — ${n} asset${n === 1 ? "" : "s"}`;
  }
}

function updateSendButtonState() {
  const missing = computeMissing();
  const sendBtn = document.getElementById("send-btn") as HTMLButtonElement | null;
  const missingList = document.getElementById("missing-list");
  if (sendBtn) sendBtn.disabled = missing.length > 0 || state.sending;
  if (missingList) {
    missingList.innerHTML =
      missing.length === 0
        ? ""
        : `<ul class="missing-list">${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`;
  }
  const labelInput = document.getElementById("scope-label") as HTMLInputElement | null;
  if (labelInput) labelInput.placeholder = computeScopeLabel();
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Selection reconciliation
// ---------------------------------------------------------------------------

function reconcileSelection(nodes: SelectedNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kept = state.orderedNodes
    .filter((n) => byId.has(n.id))
    .map((n) => byId.get(n.id)!);
  const keptIds = new Set(kept.map((n) => n.id));
  const added = nodes.filter((n) => !keptIds.has(n.id));
  state.orderedNodes = [...kept, ...added];
  renderFrames();
  updateSendButtonState();
  if (added.length > 0) {
    send({ type: "request-thumbnails", nodeIds: added.map((n) => n.id) });
  }
}

function removeNode(nodeId: string) {
  send({ type: "deselect-node", nodeId });
  // The main thread will fire selectionchange, which reconciles the list —
  // but drop it locally too so the UI feels instant rather than waiting
  // on the round trip.
  state.orderedNodes = state.orderedNodes.filter((n) => n.id !== nodeId);
  renderFrames();
  updateSendButtonState();
}

function moveNode(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= state.orderedNodes.length) return;
  const copy = state.orderedNodes.slice();
  [copy[index], copy[target]] = [copy[target], copy[index]];
  state.orderedNodes = copy;
  renderFrames();
}

// ---------------------------------------------------------------------------
// Rendering — static shell built once, dynamic sections re-rendered
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;

function renderShell() {
  app.innerHTML = `
    <div class="header">
      <h1>Off You Pop</h1>
      <button class="icon-btn" id="settings-btn" title="Settings">⚙</button>
    </div>
    <div id="body"></div>
  `;
  document.getElementById("settings-btn")!.onclick = () => {
    state.view = state.view === "settings" ? "form" : "settings";
    renderBody();
  };
  renderBody();
}

function renderBody() {
  const body = document.getElementById("body")!;
  if (state.view === "settings") {
    body.innerHTML = `<div class="scroll"><div class="settings-view" id="settings-view"></div></div>`;
    renderSettingsView();
  } else if (state.view === "success") {
    body.innerHTML = `<div class="success-view" id="success-view"></div>`;
    renderSuccessView();
  } else {
    body.innerHTML = `
      <div class="scroll">
        <div id="banner-slot"></div>
        <div class="field">
          <label for="client-name">Client name</label>
          <input type="text" id="client-name" placeholder="e.g. Acme Ltd" />
        </div>
        <div class="field">
          <label for="project-name">Project name</label>
          <input type="text" id="project-name" placeholder="e.g. Acme Website Redesign" />
        </div>
        <div class="field">
          <label>Scope</label>
          <div class="segmented" id="scope-segmented">
            <button type="button" data-scope="single_frame">Single frame</button>
            <button type="button" data-scope="multi_frame">Multiple frames</button>
            <button type="button" data-scope="flow">Flow</button>
            <button type="button" data-scope="branding">Branding</button>
          </div>
          <div class="hint">Select the frame(s)/asset(s) on the canvas — the list below follows your Figma selection live.</div>
        </div>
        <div class="field">
          <label>Frames in scope</label>
          <div class="node-list" id="node-list"></div>
        </div>
        <div class="field">
          <label for="scope-label">Scope label <span style="font-weight:400;color:var(--figma-color-text-tertiary,#999)">(optional — auto-filled if left blank)</span></label>
          <input type="text" id="scope-label" placeholder="Homepage only" />
        </div>
        <div class="field">
          <label>Recipients</label>
          <div class="contact-search">
            <input type="text" id="contact-search" placeholder="Search saved contacts…" />
            <div id="contact-results"></div>
          </div>
          <div id="recipient-list"></div>
          <button type="button" class="secondary-btn" id="add-recipient-btn">+ Add recipient manually</button>
        </div>
        <div class="field checkbox-row">
          <input type="checkbox" id="requires-all" />
          <label for="requires-all">Require every recipient to confirm before this counts as signed off</label>
        </div>
        <div class="field">
          <label for="notes">Notes <span style="font-weight:400;color:var(--figma-color-text-tertiary,#999)">(optional)</span></label>
          <textarea id="notes" placeholder="Anything worth flagging to the client alongside this"></textarea>
        </div>
      </div>
      <div class="footer">
        <div id="missing-list"></div>
        <button class="primary-btn" id="send-btn" disabled>Generate &amp; Send</button>
      </div>
    `;
    wireFormView();
    renderFrames();
    renderRecipients();
    updateSendButtonState();
  }
}

function wireFormView() {
  const clientInput = document.getElementById("client-name") as HTMLInputElement;
  clientInput.value = state.clientName;
  clientInput.oninput = () => {
    state.clientName = clientInput.value;
    updateSendButtonState();
  };

  const projectInput = document.getElementById("project-name") as HTMLInputElement;
  projectInput.value = state.projectName;
  projectInput.oninput = () => {
    state.projectName = projectInput.value;
    updateSendButtonState();
  };

  const scopeLabelInput = document.getElementById("scope-label") as HTMLInputElement;
  scopeLabelInput.value = state.scopeLabel;
  scopeLabelInput.oninput = () => {
    state.scopeLabel = scopeLabelInput.value;
  };

  const notesInput = document.getElementById("notes") as HTMLTextAreaElement;
  notesInput.value = state.notes;
  notesInput.oninput = () => {
    state.notes = notesInput.value;
  };

  const requiresAll = document.getElementById("requires-all") as HTMLInputElement;
  requiresAll.checked = state.requiresAllRecipients;
  requiresAll.onchange = () => {
    state.requiresAllRecipients = requiresAll.checked;
  };

  const scopeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#scope-segmented button"),
  );
  const syncScopeButtons = () => {
    for (const btn of scopeButtons) {
      btn.classList.toggle("active", btn.dataset.scope === state.scopeType);
    }
  };
  for (const btn of scopeButtons) {
    btn.onclick = () => {
      state.scopeType = btn.dataset.scope as ScopeType;
      syncScopeButtons();
      renderFrames();
      updateSendButtonState();
    };
  }
  syncScopeButtons();

  document.getElementById("add-recipient-btn")!.addEventListener("click", () => {
    state.recipients.push({ name: "", email: "", contactId: null });
    renderRecipients();
    updateSendButtonState();
    const rows = document.querySelectorAll<HTMLInputElement>(".recipient-row input");
    rows[rows.length - 2]?.focus();
  });

  const contactSearch = document.getElementById("contact-search") as HTMLInputElement;
  let searchTimer: number | undefined;
  contactSearch.oninput = () => {
    state.contactQuery = contactSearch.value;
    window.clearTimeout(searchTimer);
    if (!state.contactQuery.trim()) {
      state.contactResults = [];
      renderContactResults();
      return;
    }
    searchTimer = window.setTimeout(runContactSearch, 250);
  };

  document.getElementById("send-btn")!.addEventListener("click", handleSend);
}

function renderFrames() {
  const container = document.getElementById("node-list");
  if (!container) return;
  if (state.orderedNodes.length === 0) {
    container.innerHTML = `<div class="empty-state">Nothing selected yet — select frame(s) on the canvas.</div>`;
    return;
  }
  const showReorder = state.scopeType === "flow" && state.orderedNodes.length > 1;
  container.innerHTML = state.orderedNodes
    .map((node, i) => {
      const thumb = state.thumbnails[node.id];
      const thumbHtml = thumb
        ? `<img class="node-thumb" src="${thumb}" alt="" />`
        : `<div class="node-thumb placeholder"></div>`;
      return `
        <div class="node-row" data-id="${node.id}">
          ${thumbHtml}
          <div class="node-info">
            <div class="name">${escapeHtml(node.name)}</div>
            <div class="dims">${node.width}×${node.height}${showReorder ? ` · step ${i + 1}` : ""}</div>
          </div>
          <div class="node-actions">
            ${
              showReorder
                ? `<button type="button" data-action="up" data-index="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
                   <button type="button" data-action="down" data-index="${i}" ${i === state.orderedNodes.length - 1 ? "disabled" : ""}>↓</button>`
                : ""
            }
            <button type="button" data-action="remove" data-id="${node.id}">✕</button>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll<HTMLButtonElement>('[data-action="remove"]').forEach((btn) => {
    btn.onclick = () => removeNode(btn.dataset.id!);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-action="up"]').forEach((btn) => {
    btn.onclick = () => moveNode(Number(btn.dataset.index), -1);
  });
  container.querySelectorAll<HTMLButtonElement>('[data-action="down"]').forEach((btn) => {
    btn.onclick = () => moveNode(Number(btn.dataset.index), 1);
  });
}

function renderRecipients() {
  const container = document.getElementById("recipient-list");
  if (!container) return;
  if (state.recipients.length === 0) {
    container.innerHTML = `<div class="empty-state">No recipients yet — search a saved contact above or add one manually.</div>`;
    return;
  }
  container.innerHTML = state.recipients
    .map(
      (_, i) => `
        <div class="recipient-row" data-index="${i}">
          <input type="text" placeholder="Name" data-field="name" data-index="${i}" />
          <input type="email" placeholder="Email" data-field="email" data-index="${i}" />
          <button type="button" class="remove" data-index="${i}" title="Remove">✕</button>
        </div>
      `,
    )
    .join("");

  container.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
    const i = Number(input.dataset.index);
    const field = input.dataset.field as "name" | "email";
    input.value = state.recipients[i][field];
    input.oninput = () => {
      state.recipients[i][field] = input.value;
      updateSendButtonState();
    };
  });

  container.querySelectorAll<HTMLButtonElement>("button.remove").forEach((btn) => {
    btn.onclick = () => {
      state.recipients.splice(Number(btn.dataset.index), 1);
      renderRecipients();
      updateSendButtonState();
    };
  });
}

async function runContactSearch() {
  state.contactSearchLoading = true;
  state.contactSearchError = "";
  renderContactResults();
  try {
    state.contactResults = await searchContacts(state.settings, state.contactQuery.trim());
  } catch (err) {
    state.contactResults = [];
    state.contactSearchError = err instanceof Error ? err.message : String(err);
  } finally {
    state.contactSearchLoading = false;
    renderContactResults();
  }
}

function renderContactResults() {
  const container = document.getElementById("contact-results");
  if (!container) return;
  if (state.contactSearchLoading) {
    container.innerHTML = `<div class="contact-results"><div class="loading">Searching…</div></div>`;
    return;
  }
  if (state.contactSearchError) {
    container.innerHTML = `<div class="contact-results"><div class="empty">${escapeHtml(state.contactSearchError)}</div></div>`;
    return;
  }
  if (!state.contactQuery.trim()) {
    container.innerHTML = "";
    return;
  }
  if (state.contactResults.length === 0) {
    container.innerHTML = `<div class="contact-results"><div class="empty">No matches — add manually below.</div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="contact-results">
      ${state.contactResults
        .map(
          (c, i) => `
            <div class="contact-item" data-index="${i}">
              <div>${escapeHtml(c.name)}</div>
              <div class="sub">${escapeHtml(c.email)}${c.clientName ? ` · ${escapeHtml(c.clientName)}` : ""}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
  container.querySelectorAll<HTMLDivElement>(".contact-item").forEach((item) => {
    item.onclick = () => {
      const contact = state.contactResults[Number(item.dataset.index)];
      addRecipientFromContact(contact);
    };
  });
}

function addRecipientFromContact(contact: ContactRecord) {
  const alreadyAdded = state.recipients.some(
    (r) => r.email.trim().toLowerCase() === contact.email.trim().toLowerCase(),
  );
  if (alreadyAdded) {
    send({ type: "notify", message: `${contact.name} is already added.` });
  } else {
    state.recipients.push({
      name: contact.name,
      email: contact.email,
      contactId: contact.id,
    });
    if (!state.clientName.trim() && contact.clientName) {
      state.clientName = contact.clientName;
      const clientInput = document.getElementById("client-name") as HTMLInputElement | null;
      if (clientInput) clientInput.value = state.clientName;
    }
    renderRecipients();
    updateSendButtonState();
  }
  state.contactQuery = "";
  state.contactResults = [];
  const searchInput = document.getElementById("contact-search") as HTMLInputElement | null;
  if (searchInput) searchInput.value = "";
  renderContactResults();
}

function renderSettingsView() {
  const container = document.getElementById("settings-view");
  if (!container) return;
  container.innerHTML = `
    <div class="section-title">Backend</div>
    <div class="field">
      <label for="api-base-url">Backend URL</label>
      <input type="text" id="api-base-url" placeholder="https://off-you-pop.vercel.app" />
      <div class="hint">Where this plugin sends new sign-offs. Leave blank and Send stays disabled.</div>
    </div>
    <div class="field">
      <label for="api-key">API key <span style="font-weight:400;color:var(--figma-color-text-tertiary,#999)">(optional for now)</span></label>
      <input type="text" id="api-key" placeholder="Issued from the dashboard, once that exists" />
    </div>
    <div class="section-title">Attribution</div>
    <div class="field">
      <label for="created-by">Your name</label>
      <input type="text" id="created-by" placeholder="Shown on the audit trail as who sent this" />
    </div>
    <button class="primary-btn" id="settings-save-btn">Save</button>
    <button class="secondary-btn" id="settings-back-btn">Back</button>
  `;

  (document.getElementById("api-base-url") as HTMLInputElement).value = state.settings.apiBaseUrl;
  (document.getElementById("api-key") as HTMLInputElement).value = state.settings.apiKey;
  (document.getElementById("created-by") as HTMLInputElement).value = state.settings.createdBy;

  document.getElementById("settings-save-btn")!.addEventListener("click", () => {
    state.settings = {
      apiBaseUrl: (document.getElementById("api-base-url") as HTMLInputElement).value.trim(),
      apiKey: (document.getElementById("api-key") as HTMLInputElement).value.trim(),
      createdBy: (document.getElementById("created-by") as HTMLInputElement).value.trim(),
    };
    send({ type: "set-settings", settings: state.settings });
    state.view = "form";
    renderBody();
  });

  document.getElementById("settings-back-btn")!.addEventListener("click", () => {
    state.view = "form";
    renderBody();
  });
}

function renderSuccessView() {
  const container = document.getElementById("success-view");
  if (!container) return;
  container.innerHTML = `
    <h2>Sent 🎉</h2>
    <p>The client will receive an email with the link below. You can also copy it directly.</p>
    <div class="link-box">
      <input type="text" id="success-url" readonly />
      <button class="secondary-btn" id="copy-btn" style="margin-top:0;width:auto;">Copy</button>
    </div>
    <button class="primary-btn" id="another-btn">Create another sign-off</button>
  `;
  const urlInput = document.getElementById("success-url") as HTMLInputElement;
  urlInput.value = state.successUrl;

  document.getElementById("copy-btn")!.addEventListener("click", () => {
    urlInput.select();
    document.execCommand("copy");
    send({ type: "notify", message: "Link copied." });
  });

  document.getElementById("another-btn")!.addEventListener("click", () => {
    resetForm();
    state.view = "form";
    renderBody();
  });
}

function resetForm() {
  state.clientName = "";
  state.projectName = "";
  state.scopeType = "single_frame";
  state.scopeLabel = "";
  state.notes = "";
  state.requiresAllRecipients = true;
  state.recipients = [];
  state.sendError = "";
  state.successUrl = "";
  // Deliberately keep orderedNodes/thumbnails/settings as-is — the designer
  // is likely about to send the next stage (e.g. full site) from the same
  // or an overlapping canvas selection.
}

function showBanner(message: string, kind: "error" | "info") {
  const slot = document.getElementById("banner-slot");
  if (!slot) return;
  slot.innerHTML = message
    ? `<div class="banner ${kind}">${escapeHtml(message)}</div>`
    : "";
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

async function handleSend() {
  const missing = computeMissing();
  if (missing.length > 0) {
    updateSendButtonState();
    return;
  }

  state.sending = true;
  state.sendError = "";
  showBanner("", "error");
  const sendBtn = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
  }

  try {
    const exports = await requestFullExport(state.orderedNodes.map((n) => n.id));
    const payload: CreateSignoffPayload = {
      clientName: state.clientName.trim(),
      projectName: state.projectName.trim(),
      scopeType: state.scopeType,
      scopeLabel: state.scopeLabel.trim() || computeScopeLabel(),
      requiresAllRecipients: state.requiresAllRecipients,
      // No UI for this yet — pasting a raw ID isn't a workable interaction.
      // Once the dashboard exists, this should become a proper search
      // (same pattern as the contact picker) rather than a text field.
      followsSignoffId: null,
      notes: state.notes.trim(),
      createdBy: state.settings.createdBy.trim(),
      recipients: validRecipients(),
      snapshots: state.orderedNodes.map((node, i) => ({
        figmaFrameKey: node.id,
        figmaNodeName: node.name,
        sequenceOrder: i,
      })),
    };
    const result = await createSignoff(state.settings, payload, exports);
    state.successUrl = result.landingUrl;
    state.view = "success";
    renderBody();
  } catch (err) {
    const message =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : "Something went wrong sending this sign-off.";
    state.sendError = message;
    showBanner(message, "error");
  } finally {
    state.sending = false;
    if (state.view === "form") {
      const btn = document.getElementById("send-btn") as HTMLButtonElement | null;
      if (btn) btn.textContent = "Generate & Send";
      updateSendButtonState();
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderShell();
send({ type: "ready" });

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    send({ type: "resize", width: window.innerWidth, height: window.innerHeight });
  }, 200);
});
