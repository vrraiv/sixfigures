// A neighbourhood's page (/n/<slug>/) and the index of them (/n/): written whole at build time by
// scripts/nbhd-pages.mjs. Script adds only the definitions on hover beside measures' names, taken
// from the page's own list of them ("What the measures mean"), as the Explorers show them.
import "./style.css";
import { initTip } from "./charts.js";
import { escapeHTML } from "./text.js";

const defs = new Map([...document.querySelectorAll("li[data-def]")].map((li) => [li.dataset.def, li]));
for (const el of document.querySelectorAll("span.def[data-def]")) {
  const li = defs.get(el.dataset.def);
  if (li) el.dataset.tip = `<b>${escapeHTML(li.querySelector("b").textContent.replace(/:$/, ""))}</b><br>${escapeHTML(li.querySelector("span").textContent)}`;
}
initTip();
