// The Data Explorer: any neighbourhood measure from any source on the site, alone or beside
// one or two others, from web/public/explorer/ (pipeline/explorer_data.py). This file holds the
// measure pickers, the link, the picked neighbourhood and the CSV download, and shows the view
// for the number of measures chosen: explorer-one.js, explorer-two.js or explorer-three.js.
import "./style.css";
import { $, escapeHTML, own } from "./catalogue.js";
import { initTip } from "./charts.js";
import { addressFinder } from "./addressfinder.js";
import { fillFinder } from "./nbtools.js";
import { C, DEF, S, SRC, columns, fmt, nbhd, nearest, pctOrd, pctRank, vals, whenOf } from "./explorer-core.js";
import { initOne, renderOne, suggestion } from "./explorer-one.js";
import { initTwo, renderTwo } from "./explorer-two.js";
import { renderThree } from "./explorer-three.js";

const MAX = 3, SLOT = ["Measure", "against", "and"], ADD = ["", "Add a second measure", "Add a third measure"];
const KEYS = [["m", "p"], ["m2", "p2"], ["m3", "p3"]];
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
initTip();

// ---- the link ----------------------------------------------------------------------------------------
function writeHash() {
  const h = new URLSearchParams();
  S.cur.forEach((m, k) => { h.set(KEYS[k][0], m.d.id); h.set(KEYS[k][1], m.d.periods[m.p]); });
  if (S.cur.length === 1 && S.cur[0].d.periods.length > 1) { h.set("f", S.cur[0].d.periods[S.from]); h.set("t", S.cur[0].d.periods[S.to]); }
  if (S.cur.length === 2 && S.pairFrom != null) { h.set("pf", S.pairFrom); h.set("pt", S.pairTo); }
  if (S.nb != null) h.set("nb", nbhd[S.nb].id);
  history.replaceState(null, "", `#${h}`);
}

// ---- choosing measures ---------------------------------------------------------------------------------
// sel: [{id, p}] with p a period label, an index, or null (the measure's period nearest the first's).
let token = 0;
async function select(sel, keep = {}) {
  const mine = ++token;
  const cols = await Promise.all(sel.map((s) => columns(s.id)));
  if (mine !== token) return; // a later choice won
  const cur = [];
  sel.forEach((s, k) => {
    const d = DEF[s.id];
    let p = typeof s.p === "number" ? s.p : d.periods.indexOf(s.p);
    if (p < 0 || p >= d.periods.length) p = k === 0 ? d.periods.length - 1 : nearest(d, cur[0].d.t[cur[0].p]);
    cur.push({ d, cols: cols[k], p });
  });
  const first = cur[0].d, changed = S.cur[0]?.d.id !== first.id;
  S.cur = cur;
  const at = (label, fallback) => (first.periods.indexOf(label) < 0 ? fallback : first.periods.indexOf(label));
  if (changed || keep.f != null) { S.from = at(keep.f, 0); S.to = at(keep.t, first.periods.length - 1); }
  if (keep.pf != null) { S.pairFrom = +keep.pf; S.pairTo = +keep.pt; } else if (keep.resetPairs) S.pairFrom = S.pairTo = null;
  buildSlots();
  draw();
}
const current = () => S.cur.map((m) => ({ id: m.d.id, p: m.p }));
const fallback = () => ["census.med_hh_tot", "safety.assault", "trees.canopy", "schools.score"].find((id) => !S.cur.some((m) => m.d.id === id));
const api = {
  setPeriod(k, p) { S.cur[k].p = p; draw(); },
  addMeasure(id) {
    if (S.cur.length >= MAX || S.cur.some((m) => m.d.id === id)) return;
    select([...current(), { id, p: null }], { resetPairs: true });
    $("measure-bar").scrollIntoView({ behavior: "smooth", block: "start" });
  },
  changed: writeHash,
};

// ---- the pickers: one row per measure -------------------------------------------------------------------
const options = (chosen, mine) => C.sources.map((s) => `<optgroup label="${escapeHTML(s.label)}">${C.measures.filter((m) => m.source === s.key)
  .map((m) => `<option value="${m.id}"${chosen.includes(m.id) && m.id !== mine ? " disabled" : ""}>${escapeHTML(m.label)}</option>`).join("")}</optgroup>`).join("");
function buildSlots() {
  const ids = S.cur.map((m) => m.d.id), n = ids.length;
  const focused = document.activeElement?.closest?.("#slots") ? document.activeElement : null;
  const again = focused && { slot: focused.closest(".ex-slot")?.dataset.s, cls: [...focused.classList].find((c) => c.startsWith("ex-")) };
  $("slots").innerHTML = S.cur.map((m, k) => `<div class="ex-slot" data-s="${k}">
      <label for="m${k}">${SLOT[k]}</label><select id="m${k}" class="ex-m">${options(ids, m.d.id)}</select>
      <div class="ex-period"${m.d.periods.length > 1 ? "" : " hidden"}>
        <button type="button" class="day-step ex-prev" aria-label="Earlier">‹</button>
        <input type="range" class="ex-range" min="0" max="${m.d.periods.length - 1}" step="1" aria-label="Period of ${escapeHTML(m.d.short)}" />
        <button type="button" class="day-step ex-next" aria-label="Later">›</button>
        <output class="ex-out"></output>
      </div>
      ${m.d.periods.length > 1 ? "" : `<span class="ex-single">${escapeHTML(m.d.periods[0])} only</span>`}
      ${n > 1 ? `<button type="button" class="day-step ex-remove" aria-label="Remove ${escapeHTML(m.d.short)}" title="Remove">×</button>` : ""}
    </div>`).join("");
  if (again?.cls) $("slots").querySelector(`.ex-slot[data-s="${again.slot}"] .${again.cls}`)?.focus();
  $("add").hidden = n >= MAX;
  $("add").textContent = ADD[n] ?? "";
  $("swap").hidden = n < 2;
  $("measure-bar").classList.toggle("multi", n > 1);
}
function syncSlots() {
  S.cur.forEach((m, k) => {
    const row = $("slots").children[k];
    row.querySelector(".ex-m").value = m.d.id;
    row.querySelector(".ex-range").value = m.p;
    row.querySelector(".ex-prev").disabled = m.p === 0;
    row.querySelector(".ex-next").disabled = m.p === m.d.periods.length - 1;
    row.querySelector(".ex-out").textContent = whenOf(m);
  });
}
const slotOf = (e) => +e.target.closest(".ex-slot").dataset.s;
$("slots").addEventListener("change", (e) => {
  if (!e.target.matches(".ex-m")) return;
  const k = slotOf(e), sel = current();
  sel[k] = { id: e.target.value, p: null };
  select(sel, { resetPairs: true });
});
$("slots").addEventListener("input", (e) => {
  if (e.target.matches(".ex-range")) api.setPeriod(slotOf(e), +e.target.value);
});
$("slots").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const k = slotOf(e), m = S.cur[k];
  if (b.matches(".ex-prev")) api.setPeriod(k, Math.max(0, m.p - 1));
  else if (b.matches(".ex-next")) api.setPeriod(k, Math.min(m.d.periods.length - 1, m.p + 1));
  else if (b.matches(".ex-remove")) select(current().filter((_, j) => j !== k), { resetPairs: true });
});
$("add").addEventListener("click", () => api.addMeasure((S.cur.length === 1 && suggestion()) || fallback()));
$("swap").addEventListener("click", () => {
  const sel = current();
  [sel[0], sel[1]] = [sel[1], sel[0]];
  select(sel, { resetPairs: true });
});

// ---- the picked neighbourhood ------------------------------------------------------------------------------
const view = () => $(`view${S.cur.length}`);
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-nb]"), p = e.target.closest(".nb-map path[data-i]");
  if (e.target.closest(".nb-clear")) S.nb = null;
  else if (a) S.nb = +a.dataset.nb;
  else if (p) S.nb = S.nb === +p.dataset.i ? null : +p.dataset.i;
  else return;
  draw();
  if (a?.matches("button.nm")) view().querySelector(".nb-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
});
function markPicks() {
  for (const fig of view().querySelectorAll(".nb-map")) {
    const p = S.nb == null ? null : fig.querySelector(`path[data-i="${S.nb}"]`);
    fig.classList.toggle("has-pick", !!p);
    if (p) {
      p.classList.add("pick");
      p.parentNode.append(p); // drawn last, so its outline is on top
    }
  }
  const bar = $("pick-bar");
  bar.hidden = S.nb == null;
  if (S.nb == null) return;
  bar.innerHTML = `<b>${escapeHTML(nbhd[S.nb].name)}</b>${S.cur.map((m, k) => {
    const v = vals(k)[S.nb], p = pctRank(vals(k))[S.nb];
    return `<span>${escapeHTML(m.d.short)}, ${escapeHTML(m.d.periods[m.p])}: <b>${fmt(m.d, v)}</b>${p == null ? "" : ` (${pctOrd(p)} percentile)`}</span>`;
  }).join("")}<button type="button" class="nb-clear">Clear</button>`;
}

fillFinder($("find-nb"), nbhd.map((n) => n.name));
$("find-nb").addEventListener("change", (e) => {
  S.nb = e.target.value === "" ? null : +e.target.value;
  draw();
});
addressFinder($("addr-find"), {
  nbhd,
  onPick: (i) => { const s = $("find-nb"); s.value = i; s.dispatchEvent(new Event("change")); },
});

// ---- the CSV download: the chosen measures at their chosen periods ------------------------------------------
$("csv").addEventListener("click", () => {
  const q = (s) => `"${String(s).replaceAll('"', '""')}"`;
  const head = ["neighbourhood_id", "neighbourhood", ...S.cur.map((m) => `${m.d.label} (${m.d.periods[m.p]})`)];
  const rows = nbhd.map((n, i) => [n.id, q(n.name), ...S.cur.map((_, k) => vals(k)[i] ?? "")].join(","));
  const url = URL.createObjectURL(new Blob([[head.map(q).join(","), ...rows].join("\n") + "\n"], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `toronto-neighbourhoods-${S.cur.map((m) => m.d.id.replace(".", "-")).join("_")}.csv` });
  a.click();
  URL.revokeObjectURL(url);
});

// ---- drawing -------------------------------------------------------------------------------------------------
function about() {
  const one = (m) => `<b>${escapeHTML(m.d.short)}</b> (${escapeHTML(SRC[m.d.source].label)}): ${escapeHTML(SRC[m.d.source].note)}.${m.d.note ? ` ${escapeHTML(m.d.note)}` : ""}${m.d.periods.length === 1 ? ` A single figure (${escapeHTML(m.d.periods[0])}), so it has no trend.` : ""}`;
  $("about").innerHTML = S.cur.length === 1 ? one(S.cur[0]) : S.cur.map((m) => `<span class="ex-about-row">${one(m)}</span>`).join("");
}
function draw() {
  const n = S.cur.length;
  syncSlots();
  about();
  for (const k of [1, 2, 3]) $(`view${k}`).hidden = k !== n;
  if (n === 1) renderOne();
  else if (n === 2) renderTwo();
  else renderThree();
  markPicks();
  $("find-nb").value = S.nb ?? "";
  writeHash();
}

$("method-note").textContent = `Built ${C.built}. ${C.measures.length} measures from ${C.sources.length} sources, each summed or averaged to the City's 158 neighbourhoods as its own page describes. `
  + "Map classes are sixths of the neighbourhoods (thirds when two measures share a map). Correlations are Spearman's rank correlation, over the neighbourhoods with a figure in both.";

initOne(api);
initTwo(api);
S.nb = nbIndex(hash.get("nb"));
const start = KEYS.map(([m, p]) => ({ id: hash.get(m), p: hash.get(p) })).filter((s, k, all) => own(DEF, s.id) && all.findIndex((x) => x.id === s.id) === k);
await select(start.length ? start : [{ id: "census.med_hh_tot", p: null }], { f: hash.get("f"), t: hash.get("t"), pf: hash.get("pf"), pt: hash.get("pt") });
