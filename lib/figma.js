// Figma REST API via fetch, using a personal/team access token
// (docs: https://www.figma.com/developers/api#images) — only ever called
// server-side, after a branding sign-off completes.

async function exportNodeImages(fileKey, nodeIds, format) {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error("Missing required env var: FIGMA_ACCESS_TOKEN");

  const url = new URL(`https://api.figma.com/v1/images/${fileKey}`);
  url.searchParams.set("ids", nodeIds.join(","));
  url.searchParams.set("format", format);
  url.searchParams.set("scale", format === "svg" ? "1" : "2");

  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.err) {
    throw new Error(
      `Figma image export failed (${res.status}): ${body?.err || "unknown error"}`,
    );
  }
  return body.images; // { [nodeId]: imageUrl | null }
}

async function fetchImageBytes(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download exported image (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { exportNodeImages, fetchImageBytes };
