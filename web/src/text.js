// Small text helpers with no DOM, so the build (scripts/nbhd-pages.mjs) can share them with the
// pages; catalogue.js re-exports them.
export const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// A neighbourhood's page address, /n/<slug>/ (scripts/nbhd-pages.mjs): its official name in plain
// lower-case words, "O'Connor-Parkview" -> "oconnor-parkview", "St.James Town" -> "st-james-town".
// Once search engines have the addresses they shouldn't change, so a test pins a few.
export const slug = (name) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const nbPage = (name) => `/n/${slug(name)}/`;
