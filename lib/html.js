// Minimal safe-by-default HTML templating — no dependency needed for the
// small amount of server-rendered HTML this project has (landing page,
// dashboard). `html` is a tagged template: every interpolated value is
// escaped unless it's already-safe HTML (wrapped in `raw()`, or itself
// the result of `html` — see below).

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

// toString() makes this transparent everywhere a plain string used to be
// expected (res.end(), string concatenation, Array.join, etc.) — nothing
// downstream of `html`/`raw` needs to know the difference.
function raw(value) {
  return {
    [RAW]: true,
    value: String(value),
    toString() {
      return this.value;
    },
  };
}

function stringifyValue(v) {
  if (v && typeof v === "object" && v[RAW]) return v.value;
  if (Array.isArray(v)) return v.map(stringifyValue).join("");
  return escapeHtml(v);
}

// Returns a raw()-wrapped result, not a plain string — this is the actual
// fix, not just a convention to remember. Nesting `html` inside `html`
// (e.g. a per-row template used inside a page template) used to require
// manually wrapping every nested call in `raw(...)`, and it was easy to
// forget one — when that happened, the *entire nested markup* got
// escaped and rendered as visible literal tag text on the page instead
// of being applied as markup (this happened for real: snapshot captions
// and a couple of conditional banners on the landing page). Since `html`
// now marks its own output as already-safe, nested calls compose
// correctly whether or not they're wrapped in `raw(...)` — existing
// `raw(someHtmlCall())` wrappers still work fine, they're just redundant
// now, not wrong.
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += stringifyValue(values[i]);
    out += strings[i + 1];
  }
  return raw(out);
}

module.exports = { html, raw, escapeHtml };
