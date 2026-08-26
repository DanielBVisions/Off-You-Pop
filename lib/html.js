// Minimal safe-by-default HTML templating — no dependency needed for the
// small amount of server-rendered HTML this project has (landing page,
// dashboard). `html` is a tagged template: every interpolated value is
// escaped unless explicitly wrapped in `raw()`.

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

const RAW = Symbol("raw-html");

function raw(value) {
  return { [RAW]: true, value: String(value) };
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v && typeof v === "object" && v[RAW]) {
      out += v.value;
    } else if (Array.isArray(v)) {
      out += v
        .map((item) => (item && typeof item === "object" && item[RAW] ? item.value : escapeHtml(item)))
        .join("");
    } else {
      out += escapeHtml(v);
    }
    out += strings[i + 1];
  }
  return out;
}

module.exports = { html, raw, escapeHtml };
