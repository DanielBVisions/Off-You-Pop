// POST /api/signoffs — create a record (called by the plugin, matches
// docs/api-contract.md exactly: multipart/form-data with a "data" JSON
// field and snapshot_0..N image files).
// GET  /api/signoffs — list records for the dashboard (status/client/search
// filters, archived excluded unless ?includeArchived=1).

const { readRawBody, parseMultipart, query, sendJson, methodNotAllowed, withErrorHandling } = require("../../lib/http");
const { pgInsert, pgUpsert, pgSelect } = require("../../lib/supabase");
const { validateCreateSignoff } = require("../../lib/validate");
const { uploadToStorage } = require("../../lib/supabase");
const { sendEmail } = require("../../lib/resend");
const { signoffCreatedEmail } = require("../../lib/emails");
const { requirePluginKey, requireAuthOrPluginKey } = require("../../lib/auth-guard");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function handleCreate(req, res) {
  if (!requirePluginKey(req, res)) return;

  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) {
    return sendJson(res, 400, { error: "Expected multipart/form-data" });
  }
  const raw = await readRawBody(req);
  const { fields, files } = parseMultipart(raw, contentType);

  let data;
  try {
    data = JSON.parse(fields.data || "{}");
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON in 'data' field" });
  }

  const errors = validateCreateSignoff(data, files.length);
  if (errors.length > 0) {
    return sendJson(res, 400, { error: errors.join("; ") });
  }

  // 1. Create the record.
  const record = await pgInsert(
    "signoff_records",
    {
      project_name: data.projectName.trim(),
      client_name: data.clientName.trim(),
      scope_label: data.scopeLabel.trim(),
      figma_file_key: data.figmaFileKey || null,
      scope_type: data.scopeType,
      requires_all_recipients: !!data.requiresAllRecipients,
      follows_signoff_id: data.followsSignoffId || null,
      notes: data.notes || "",
      created_by: data.createdBy.trim(),
    },
    { single: true },
  );

  // 2. Upload snapshots in scope order, matching data.snapshots[i] <-> files snapshot_i.
  const snapshotRows = [];
  for (let i = 0; i < data.snapshots.length; i++) {
    const meta = data.snapshots[i];
    const file = files.find((f) => f.field === `snapshot_${i}`);
    if (!file) {
      return sendJson(res, 400, { error: `Missing uploaded image for snapshot_${i}` });
    }
    const path = `${record.id}/${i}-${Date.now()}.png`;
    const url = await uploadToStorage("snapshots", path, file.data, file.contentType || "image/png");
    snapshotRows.push({
      signoff_id: record.id,
      figma_frame_key: meta.figmaFrameKey,
      figma_node_name: meta.figmaNodeName || "",
      snapshot_url: url,
      sequence_order: meta.sequenceOrder ?? i,
    });
  }
  await pgInsert("frame_snapshots", snapshotRows);

  // 3. Upsert each recipient's Contact, then create the Recipient rows
  // (copying name/email now — see lib/supabase.js pgUpsert note in
  // docs/api-contract.md on why this always links a contact_id).
  const recipientRows = [];
  for (const r of data.recipients) {
    const email = r.email.trim().toLowerCase();
    const name = r.name.trim();
    const contact = await pgUpsert(
      "contacts",
      { name, email, client_name: data.clientName.trim(), last_used_at: new Date().toISOString() },
      { onConflict: "email" },
    );
    recipientRows.push({
      signoff_id: record.id,
      contact_id: contact?.id || null,
      email,
      name,
    });
  }
  const recipients = await pgInsert("recipients", recipientRows);

  // 4. Record-level "created" event.
  await pgInsert("event_log", {
    signoff_id: record.id,
    recipient_id: null,
    event_type: "created",
    ip_address: null,
    metadata: { createdBy: data.createdBy.trim() },
  });

  // 5. Email each recipient their own landing link. Best-effort: a failed
  // send shouldn't fail the whole creation (the record and its link still
  // exist — the dashboard's "resend" action covers a failed initial send).
  const recipientList = Array.isArray(recipients) ? recipients : [recipients];
  for (const recipient of recipientList) {
    const landingUrl = `${siteUrl()}/s/${recipient.id}`;
    try {
      await sendEmail({
        to: recipient.email,
        subject: `${data.projectName.trim()} — ready for your sign-off`,
        html: signoffCreatedEmail({
          recipientName: recipient.name,
          projectName: data.projectName.trim(),
          clientName: data.clientName.trim(),
          scopeLabel: data.scopeLabel.trim(),
          landingUrl,
          notes: data.notes || "",
        }),
      });
    } catch (err) {
      console.error(`Failed to send creation email to ${recipient.email}:`, err.message);
    }
  }

  return sendJson(res, 201, {
    id: record.id,
    landingUrl: `${siteUrl()}/s/${recipientList[0].id}`,
  });
}

async function handleList(req, res) {
  if (!requireAuthOrPluginKey(req, res)) return;

  const q = query(req);
  const filters = ["order=created_at.desc"];
  if (!q.has("includeArchived")) filters.push("archived_at=is.null");
  if (q.get("status")) filters.push(`status=eq.${encodeURIComponent(q.get("status"))}`);
  if (q.get("client_name")) filters.push(`client_name=ilike.*${encodeURIComponent(q.get("client_name"))}*`);
  if (q.get("search")) {
    const term = encodeURIComponent(q.get("search"));
    filters.push(`or=(project_name.ilike.*${term}*,client_name.ilike.*${term}*)`);
  }

  const records = await pgSelect("signoff_records", filters);
  return sendJson(res, 200, { signoffs: records });
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method === "POST") return handleCreate(req, res);
  if (req.method === "GET") return handleList(req, res);
  return methodNotAllowed(res, ["GET", "POST"]);
});
