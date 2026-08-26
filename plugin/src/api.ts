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

export async function createSignoff(
  settings: PluginSettings,
  payload: CreateSignoffPayload,
  images: { id: string; name: string; bytes: number[] }[],
): Promise<CreateSignoffResponse> {
  if (!settings.apiBaseUrl.trim()) {
    throw new ApiError("Set the backend URL in Settings first.");
  }

  const url = resolveUrl(settings.apiBaseUrl, "/api/signoffs");
  const form = new FormData();
  form.append("data", JSON.stringify(payload));
  images.forEach((img, i) => {
    const blob = new Blob([new Uint8Array(img.bytes)], { type: "image/png" });
    form.append(`snapshot_${i}`, blob, `${img.name || "frame"}.png`);
  });

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(settings),
    body: form,
  });

  if (!res.ok) {
    let message = `The backend rejected this sign-off (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message);
  }

  const body = await res.json();
  return {
    id: body.id,
    landingUrl: body.landingUrl ?? body.landing_url,
  };
}
