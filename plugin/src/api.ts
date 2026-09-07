import type {
  ContactRecord,
  CreateSignoffPayload,
  CreateSignoffResponse,
  PluginSettings,
} from "./types";

export class ApiError extends Error {}

function authHeaders(settings: PluginSettings): Record<string, string> {
  const headers: Record<string, string> = {};
  if (settings.apiKey.trim()) {
    headers["Authorization"] = `Bearer ${settings.apiKey.trim()}`;
  }
  return headers;
}

function resolveUrl(base: string, path: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  return `${trimmed}${path}`;
}

export async function searchContacts(
  settings: PluginSettings,
  query: string,
): Promise<ContactRecord[]> {
  if (!settings.apiBaseUrl.trim()) return [];
  const url = new URL(resolveUrl(settings.apiBaseUrl, "/api/contacts"));
  if (query) url.searchParams.set("query", query);

  const res = await fetch(url.toString(), { headers: authHeaders(settings) });
  if (!res.ok) {
    throw new ApiError(`Couldn't load saved contacts (${res.status}).`);
  }
  const body = await res.json();
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  return contacts.map(
    (c: any): ContactRecord => ({
      id: c.id,
      name: c.name,
      email: c.email,
      clientName: c.clientName ?? c.client_name ?? "",
      lastUsedAt: c.lastUsedAt ?? c.last_used_at ?? null,
    }),
  );
}

async function parseErrorBody(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  return fallback;
}

/**
 * Two-step create: a JSON-only POST (no images) followed by one raw-bytes
 * upload per frame. Not a stylistic choice — a single request carrying
 * every frame's image data routinely exceeded Vercel's hard 4.5MB
 * request-body limit for serverless functions on real multi-frame
 * sign-offs (a real 413 in production, not a theoretical concern). Each
 * upload here is bounded by one image's size instead of the sum of all
 * of them. See docs/api-contract.md's "Two-step create" note.
 */
export async function createSignoff(
  settings: PluginSettings,
  payload: CreateSignoffPayload,
  images: { id: string; name: string; bytes: number[] }[],
  onProgress?: (done: number, total: number) => void,
): Promise<CreateSignoffResponse> {
  if (!settings.apiBaseUrl.trim()) {
    throw new ApiError("Set the backend URL in Settings first.");
  }

  const createRes = await fetch(resolveUrl(settings.apiBaseUrl, "/api/signoffs"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(settings) },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    throw new ApiError(await parseErrorBody(createRes, `The backend rejected this sign-off (${createRes.status}).`));
  }
  const createBody = await createRes.json();
  const id = createBody.id as string;
  const landingUrl = (createBody.landingUrl ?? createBody.landing_url) as string;
  const snapshots = (createBody.snapshots ?? []) as { id: string; sequenceOrder: number }[];
  const bySequence = snapshots.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  for (let i = 0; i < bySequence.length; i++) {
    const image = images[i];
    const blob = new Blob([new Uint8Array(image.bytes)], { type: "image/png" });
    const uploadUrl = resolveUrl(settings.apiBaseUrl, `/api/signoffs/${id}/snapshot?snapshotId=${bySequence[i].id}`);
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/png", ...authHeaders(settings) },
      body: blob,
    });
    if (!uploadRes.ok) {
      throw new ApiError(
        await parseErrorBody(uploadRes, `Failed uploading frame ${i + 1} of ${bySequence.length} (${uploadRes.status}).`),
      );
    }
    onProgress?.(i + 1, bySequence.length);
  }

  return { id, landingUrl };
}
