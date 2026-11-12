// The Neighbourhood Explorer: pick one of the 158 neighbourhoods and see which others are most
// and least like it, from web/public/neighbourhoods.json (pipeline/affinity.py). The file holds
// every measure as a percentile rank among the neighbourhoods; the likeness is worked out here,
// so the themes that count can be switched:
//   gap on a measure   the difference between two neighbourhoods' percentile ranks
//   gap on a theme     the mean gap over the theme's measures both have a figure for
//   overall gap        the mean of the theme gaps, over the themes counted
//   affinity           100 less the gap
import "./style.css";
import { $, COLORS, escapeHTML, ordinal } from "./catalogue.js";
import { initTip } from "./charts.js";
import { buildToc, inkOn, nbMap } from "./nbtools.js";
import { fmt, lc } from "./units.js";

const D = await fetch(`/neighbourhoods.json?v=${__NEIGHBOURHOODS_VERSION__}`).then((r) => r.json());
const nbhd = D.nbhd, N = nbhd.length;
const M = Object.fromEntries(D.measures.map((m) => [m.id, m]));
const THEME = Object.fromEntries(D.themes.map((t) => [t.key, t]));
const BLUE = "#2a78d6", ORANGE = "#c2410c";
// one colour per kind of neighbourhood (Okabe and Ito's set, grey for black), biggest kind first
const KIND = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#f0e442", "#8a8a84"];
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EDGES = [50, 60, 70, 80, 90], RANGES = ["under 50", "50 to 59", "60 to 69", "70 to 79", "80 to 89", "90 or more"];
const shade = (a) => COLORS[EDGES.filter((e) => Math.round(a) >= e).length];
const show = (a) => (a == null ? "—" : String(Math.round(a)));
const nameOf = (i) => escapeHTML(nbhd[i].name);
const lower = (s) => s[0].toLowerCase() + s.slice(1);
const poss = (i) => `${nameOf(i)}${nbhd[i].name.endsWith("s") ? "’" : "’s"}`; // Trinity-Bellwoods’, Rustic’s
const kindOf = (i) => D.types[D.type[i]];
const dot = (i) => `<i class="nx-kind" style="background:${KIND[D.type[i]]}"></i>`;

// ---- the gaps --------------------------------------------------------------------------------------
// G[theme][i * N + j]: the two neighbourhoods' gap on the theme, NaN where they share no measure
// of it (schools: a few neighbourhoods have no results).
const G = {};
for (const t of D.themes) {
  const g = new Float32Array(N * N), cols = t.measures.map((id) => M[id].pct);
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
    let s = 0, n = 0;
    for (const p of cols) if (p[i] != null && p[j] != null) { s += Math.abs(p[i] - p[j]); n++; }
    g[i * N + j] = g[j * N + i] = n ? s / n : NaN;
  }
  G[t.key] = g;
}

// The page's choices: the neighbourhood it is about, the one beside it (auto: its closest match
// until one is picked), what likeness is measured on (all the themes counted, one theme or one
// measure), the themes not counted, the full table's sort column and the kind lit on the map.
const S = { nb: null, vs: null, auto: true, by: "all", off: new Set(), sort: "all", kind: null };
const active = () => D.themes.filter((t) => !S.off.has(t.key));
let overall = new Float32Array(N * N), cityMean = 0, typical = [];

function recompute() {
  const gs = active().map((t) => G[t.key]);
  for (let k = 0; k < N * N; k++) {
    let s = 0, n = 0;
    for (const g of gs) if (!Number.isNaN(g[k])) { s += g[k]; n++; }
    overall[k] = n ? s / n : NaN;
  }
  typical = nbhd.map((_, i) => {
    let s = 0;
    for (let j = 0; j < N; j++) if (j !== i) s += 100 - overall[i * N + j];
    return s / (N - 1);
  });
  cityMean = typical.reduce((a, v) => a + v, 0) / N;
}

function aff(by, i, j) {
  let g;
  if (by === "all") g = overall[i * N + j];
  else if (G[by]) g = G[by][i * N + j];
  else {
    const p = M[by].pct;
    g = p[i] == null || p[j] == null ? NaN : Math.abs(p[i] - p[j]);
  }
  return Number.isNaN(g) ? null : 100 - g;
}
// a neighbourhood's affinity with every other (null for itself and where there is none), and the
// others in order, most alike first
const row = (by, i) => nbhd.map((_, j) => (j === i ? null : aff(by, i, j)));
const ordered = (a) => a.map((v, j) => [v, j]).filter(([v]) => v != null).sort((x, y) => y[0] - x[0] || nbhd[x[1]].name.localeCompare(nbhd[y[1]].name)).map(([, j]) => j);
const basis = (by = S.by) => {
  const n = active().length;
  return by === "all" ? (n === D.themes.length ? `Across all ${WORDS[n]} themes` : `Across the ${WORDS[n]} theme${n === 1 ? "" : "s"} counted`)
    : G[by] ? `On ${lc(THEME[by].label)} alone` : `On ${lc(M[by].label)} alone`;
};
const basisShort = (by = S.by) => (by === "all" ? "overall" : G[by] ? `on ${lc(THEME[by].label)}` : `on ${lc(M[by].short)}`);

// ---- the link ----------------------------------------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
function writeHash() {
  const h = new URLSearchParams();
  if (S.nb != null) h.set("nb", nbhd[S.nb].id);
  if (S.nb != null && S.vs != null && !S.auto) h.set("vs", nbhd[S.vs].id);
  if (S.by !== "all") h.set("by", S.by);
  if (S.off.size) h.set("off", [...S.off].join("."));
  history.replaceState(null, "", `${location.pathname}${h.size ? `#${h}` : ""}`);
}

// ---- the controls ------------------------------------------------------------------------------------
const byName = nbhd.map((n, i) => [n.name, i]).sort((a, b) => a[0].localeCompare(b[0]));
const options = (skip) => byName.filter(([, i]) => i !== skip).map(([n, i]) => `<option value="${i}">${escapeHTML(n)}</option>`).join("");
$("nb").innerHTML = `<option value="">Choose a neighbourhood…</option>${options(null)}`;
$("by").innerHTML = `<option value="all">All the themes counted</option>
  <optgroup label="One theme">${D.themes.map((t) => `<option value="${t.key}">${escapeHTML(t.label)} alone</option>`).join("")}</optgroup>
  ${D.themes.map((t) => `<optgroup label="${escapeHTML(t.label)}: one measure">${t.measures.map((id) => `<option value="${id}">${escapeHTML(M[id].short)}</option>`).join("")}</optgroup>`).join("")}`;
$("themes").insertAdjacentHTML("beforeend", D.themes.map((t) => `<label data-tip="${escapeHTML(t.measures.map((id) => M[id].short).join(" · "))}"><input type="checkbox" value="${t.key}" /> ${escapeHTML(t.label)} <span class="nx-n">${t.measures.length}</span></label>`).join(""));

// ---- most and least alike ------------------------------------------------------------------------------
function listHTML(a, idx, start, single) {
  return idx.map((j, k) => `<li${j === S.vs ? ' class="sel"' : ""}><span class="rk">${start + k}</span>
    <button type="button" class="nm nx-nm" data-vs="${j}" data-tip="${escapeHTML(`${kindOf(j).name}`)}">${dot(j)}${nameOf(j)}</button>
    ${single ? `<span class="move">${escapeHTML(fmt(single, single.values[j]))}</span>` : ""}
    <span class="barcell"><span class="bar-fill" style="width:${a[j].toFixed(1)}%;background:${shade(a[j])}"></span></span>
    <span class="vl">${show(a[j])}</span></li>`).join("");
}

function renderAlike() {
  const i = S.nb, a = row(S.by, i), order = ordered(a), single = M[S.by] ?? null, me = nameOf(i);
  const first = order[0], last = order.at(-1), k = kindOf(i);
  const beside = single ? ` (${escapeHTML(fmt(single, single.values[first]))} against ${escapeHTML(fmt(single, single.values[i]))})` : "";
  $("alike-lede").innerHTML = single && single.values[i] == null ? `There is no figure for ${escapeHTML(lc(single.label))} in <b>${me}</b>.`
    : `<b>${me}</b> is one of the city's ${k.n} ${escapeHTML(lower(k.name))}. ${basis()}, the neighbourhood most like it is <b>${nameOf(first)}</b>, with an affinity of ${show(a[first])} out of 100${beside},
      and the least like it is <b>${nameOf(last)}</b>, at ${show(a[last])}.${S.by === "all" ? ` Two Toronto neighbourhoods taken at random average ${show(cityMean)}.` : ""}
      The map shades every neighbourhood by its affinity with ${me}; pick one, there or in the lists, to set it beside ${me}.`;
  const fig = $("alike-map");
  fig.innerHTML = nbMap(nbhd, D.map, (j) => (j === i ? ORANGE : a[j] == null ? null : shade(a[j])),
    (j) => (j === i ? `<b>${me}</b><br>The neighbourhood picked<br>${escapeHTML(k.name)}` : `<b>${nameOf(j)}</b><br>${a[j] == null ? "No figure to compare" : `Affinity with ${me} ${basisShort()}: <b>${show(a[j])}</b>`}<br>${escapeHTML(kindOf(j).name)}`),
    `Toronto's neighbourhoods by their affinity with ${nbhd[i].name}`, (j) => (j === i ? "nx-me" : j === S.vs ? "pick" : ""));
  for (const p of fig.querySelectorAll("path.nx-me, path.pick")) p.parentNode.append(p); // outlines on top
  $("alike-key").innerHTML = `${RANGES.map((r, c) => `<li><span class="key-sq" style="background:${COLORS[c]}"></span>${r}</li>`).join("")}
    <li><span class="key-sq" style="background:${ORANGE}"></span>${me}</li>${a.some((v, j) => v == null && j !== i) ? '<li><span class="key-sq hatch"></span>No figure</li>' : ""}`;
  const top = order.slice(0, 10), bottom = order.slice(-10).reverse();
  $("alike-top").innerHTML = listHTML(a, top, 1, single);
  $("alike-bottom").innerHTML = listHTML(a, bottom, 1, single);
  for (const id of ["alike-top", "alike-bottom"]) $(id).classList.toggle("with-val", !!single);

  // the neighbourhood set beside it
  const bar = $("vs-bar"), v = S.vs;
  bar.classList.toggle("empty", v == null);
  bar.innerHTML = v == null ? escapeHTML(bar.dataset.empty)
    : `<span><b>${nameOf(v)}</b> · affinity with ${me} ${basisShort()}: <b>${show(a[v])}</b>${a[v] == null ? "" : ` · its ${ordinal(order.indexOf(v) + 1)} closest of ${order.length}`} · ${escapeHTML(kindOf(v).name)} · <a href="#side" class="nx-jump">Side by side ↓</a></span>
      <button type="button" data-pick="${v}" data-with="${i}">Explore ${nameOf(v)}</button>`;
  renderAll();
}

// every other neighbourhood, with its affinity overall and on each theme
function renderAll() {
  const i = S.nb, cols = ["all", ...D.themes.map((t) => t.key)], rows = cols.map((c) => row(c, i));
  const s = cols.indexOf(S.sort), order = ordered(rows[s < 0 ? 0 : s]);
  const rest = nbhd.map((_, j) => j).filter((j) => j !== i && !order.includes(j)); // no figure in the sort column
  const head = cols.map((c, k) => `<th${c !== "all" && S.off.has(c) ? ' class="nx-off"' : ""}><button type="button" data-sort="${c}" aria-pressed="${k === (s < 0 ? 0 : s)}">${c === "all" ? "Overall" : escapeHTML(THEME[c].label)}</button></th>`).join("");
  const cell = (v) => (v == null ? '<td class="none">—</td>' : `<td style="background:${shade(v)};color:${inkOn(shade(v))}">${show(v)}</td>`);
  $("all-table").innerHTML = `<thead><tr><th>#</th><th class="txt">Neighbourhood</th>${head}</tr></thead>
    <tbody>${[...order, ...rest].map((j, k) => `<tr${j === S.vs ? ' class="sel"' : ""}><td>${k + 1}</td><th><button type="button" class="nm nx-nm" data-vs="${j}">${dot(j)}${nameOf(j)}</button></th>${rows.map((r) => cell(r[j])).join("")}</tr>`).join("")}</tbody>`;
}

// ---- theme by theme ------------------------------------------------------------------------------------
function renderThemes() {
  const i = S.nb, v = S.vs, me = nameOf(i);
  $("theme-lede").innerHTML = `Two neighbourhoods can be near twins on one theme and nothing alike on another. Each row is ${poss(i)} closest and furthest matches on that theme alone${v == null ? "" : `, and how it compares with ${nameOf(v)}`}.
    Pick a theme's name to map likeness on it alone.`;
  const who = (a, j) => `<button type="button" class="nm nx-nm" data-vs="${j}">${nameOf(j)}</button> <span class="nx-sc">${show(a[j])}</span>`;
  $("theme-table").innerHTML = `<thead><tr><th>Theme</th><th class="txt">Closest on it</th><th class="txt">Furthest</th>${v == null ? "" : `<th>${nameOf(v)}</th>`}</tr></thead>
    <tbody>${D.themes.map((t) => {
      const a = row(t.key, i), order = ordered(a), off = S.off.has(t.key);
      const pair = v == null ? "" : a[v] == null ? '<td class="none">—</td>' : `<td class="nx-heat" style="background:${shade(a[v])};color:${inkOn(shade(a[v]))}">${show(a[v])}</td>`;
      return `<tr${t.key === S.by ? ' class="sel"' : ""}><th><button type="button" class="nx-link" data-by="${t.key}">${escapeHTML(t.label)}</button><span class="small">${t.measures.length} measures${off ? " · not counted" : ""}</span></th>
        ${order.length ? `<td class="txt nx-names">${order.slice(0, 3).map((j) => who(a, j)).join("<br>")}</td><td class="txt nx-names">${who(a, order.at(-1))}</td>` : '<td class="txt none" colspan="2">No figures for this neighbourhood</td>'}${pair}</tr>`;
    }).join("")}</tbody>`;
}

// ---- side by side --------------------------------------------------------------------------------------
function renderSide() {
  const i = S.nb, v = S.vs, me = nameOf(i), them = nameOf(v);
  $("vs").innerHTML = options(i);
  $("vs").value = v;
  const a = row("all", i), order = ordered(a), back = ordered(row("all", v));
  const themes = active().map((t) => [t, aff(t.key, i, v)]).filter(([, x]) => x != null).sort((x, y) => y[1] - x[1]);
  const rank = order.indexOf(v) + 1, rankBack = back.indexOf(i) + 1;
  $("side-lede").innerHTML = `${basis("all")}, <b>${me}</b> and <b>${them}</b> have an affinity of <b>${show(a[v])}</b> out of 100. ${them} is ${poss(i)} ${rank === 1 ? "closest match" : `${ordinal(rank)} closest match of ${order.length}`}${rankBack === rank ? ", and the same the other way round" : `; ${me} is ${poss(v)} ${rankBack === 1 ? "closest" : ordinal(rankBack)}`}.
    ${themes.length > 1 ? `They are most alike on ${lc(themes[0][0].label)} (${show(themes[0][1])}) and least on ${lc(themes.at(-1)[0].label)} (${show(themes.at(-1)[1])}).` : ""}
    ${D.type[i] === D.type[v] ? `Both are ${escapeHTML(lower(kindOf(i).name))}.` : `${me} is among the ${escapeHTML(lower(kindOf(i).name))}, ${them} the ${escapeHTML(lower(kindOf(v).name))}.`}
    Pick a measure's name to map likeness on it alone.`;
  $("side-key").innerHTML = `<span><i class="nx-dot a"></i>${me}</span><span><i class="nx-dot b"></i>${them}</span>`;
  const pc = (p) => `${ordinal(Math.min(99, Math.max(1, Math.round(p))))} percentile`;
  $("side-body").innerHTML = D.themes.map((t) => {
    const x = aff(t.key, i, v), off = S.off.has(t.key);
    const rows = t.measures.map((id) => {
      const m = M[id], pa = m.pct[i], pb = m.pct[v];
      const tip = `<b>${escapeHTML(m.label)}, ${escapeHTML(String(m.period))}</b><br>${me}: ${escapeHTML(fmt(m, m.values[i]))}${pa == null ? "" : ` (${pc(pa)})`}<br>${them}: ${escapeHTML(fmt(m, m.values[v]))}${pb == null ? "" : ` (${pc(pb)})`}${pa == null || pb == null ? "" : `<br>Gap: ${Math.round(Math.abs(pa - pb))} of 100`}`;
      return `<div class="nx-row" data-tip="${escapeHTML(tip)}"><button type="button" class="nx-lab nx-link" data-by="${id}">${escapeHTML(m.short)}</button>
        <span class="nx-v a">${escapeHTML(fmt(m, m.values[i]))}</span>
        <span class="nx-track"><i class="nx-mid"></i>${pa == null || pb == null ? "" : `<i class="nx-span" style="left:${Math.min(pa, pb)}%;width:${Math.abs(pa - pb)}%"></i>`}${pb == null ? "" : `<i class="nx-dot b" style="left:${pb}%"></i>`}${pa == null ? "" : `<i class="nx-dot a" style="left:${pa}%"></i>`}</span>
        <span class="nx-v b">${escapeHTML(fmt(m, m.values[v]))}</span></div>`;
    }).join("");
    return `<div class="nx-theme${off ? " off" : ""}"><h3 class="nx-theme-h"><span>${escapeHTML(t.label)}</span>${x == null ? "" : `<span class="nx-aff" style="background:${shade(x)};color:${inkOn(shade(x))}" data-tip="Affinity on ${escapeHTML(lc(t.label))}: ${show(x)} out of 100">${show(x)}</span>`}${off ? '<span class="small">not counted</span>' : ""}</h3>${rows}</div>`;
  }).join("");
}

// ---- kinds of neighbourhood ------------------------------------------------------------------------------
function renderKinds() {
  const i = S.nb;
  $("kinds-lede").innerHTML = `${i == null ? "" : `<b>${nameOf(i)}</b> is one of ${kindOf(i).n} <b>${escapeHTML(lower(kindOf(i).name))}</b>; the kind it is next nearest to is the ${escapeHTML(lower(D.types[D.next[i]].name))}. `}
    The 158 neighbourhoods sort into ${WORDS[D.types.length]} kinds by what they are like on every theme but voting. Pick a kind to light it up on the map, or a neighbourhood on the map to explore it.`;
  const fig = $("kinds-map");
  fig.innerHTML = nbMap(nbhd, D.map, (j) => KIND[D.type[j]],
    (j) => `<b>${nameOf(j)}</b><br>${escapeHTML(kindOf(j).name)}<br>Next nearest: ${escapeHTML(lower(D.types[D.next[j]].name))}`,
    "Toronto's neighbourhoods by kind", (j) => `${j === i ? "pick" : ""}${S.kind != null && D.type[j] !== S.kind ? " dim" : ""}`);
  for (const p of fig.querySelectorAll("path.pick")) p.parentNode.append(p);
  const list = (ids) => ids.map((id) => escapeHTML(lc(M[id].short))).join(", ");
  $("kinds-cards").innerHTML = D.types.map((t, k) => `<div class="nx-card${i != null && D.type[i] === k ? " mine" : ""}">
      <button type="button" class="nx-card-h" data-kind="${k}" aria-pressed="${S.kind === k}"><i class="nx-sw" style="background:${KIND[k]}"></i><span>${escapeHTML(t.name)}</span><span class="nx-n">${t.n}</span></button>
      <p>${escapeHTML(t.blurb)}</p>
      <p class="small"><b>Higher on</b> ${list(t.high)}. <b>Lower on</b> ${list(t.low)}.</p>
      <p class="small">Nearest its centre: <button type="button" class="nx-link" data-pick="${nbhd.findIndex((n) => n.name === t.medoid)}">${escapeHTML(t.medoid)}</button></p></div>`).join("");
}

// ---- typical and distinctive ---------------------------------------------------------------------------
function renderTypical() {
  const order = ordered(typical), i = S.nb;
  const li = (j, k) => `<li${j === i ? ' class="sel"' : ""}><span class="rk">${k}</span><button type="button" class="nm nx-nm" data-pick="${j}" data-tip="${escapeHTML(kindOf(j).name)}">${dot(j)}${nameOf(j)}</button>
    <span class="barcell"><span class="bar-fill" style="width:${typical[j].toFixed(1)}%;background:${shade(typical[j])}"></span></span><span class="vl">${show(typical[j])}</span></li>`;
  $("typ-lede").innerHTML = `A neighbourhood's average affinity with the other 157, ${lower(basis("all"))}: high for the neighbourhoods that are a bit like everywhere, low for the ones like nowhere else. The city-wide average is ${show(cityMean)}.
    ${i == null ? "" : `<b>${nameOf(i)}</b> averages ${show(typical[i])}, the ${ordinal(order.indexOf(i) + 1)} highest of ${N}.`} Pick a name to explore it.`;
  $("typ-top").innerHTML = order.slice(0, 10).map((j, k) => li(j, k + 1)).join("");
  $("typ-bottom").innerHTML = order.slice(-10).reverse().map((j, k) => li(j, N - k)).join("");
  const pairs = [];
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (!Number.isNaN(overall[a * N + b])) pairs.push([100 - overall[a * N + b], a, b]);
  pairs.sort((x, y) => y[0] - x[0]);
  $("pairs").innerHTML = pairs.slice(0, 10).map(([v, a, b], k) => `<li><span class="rk">${k + 1}</span>
    <span class="nx-pair"><button type="button" class="nm nx-nm" data-pick="${a}" data-with="${b}">${dot(a)}${nameOf(a)}</button><span class="nx-and">and</span><button type="button" class="nm nx-nm" data-pick="${b}" data-with="${a}">${dot(b)}${nameOf(b)}</button></span>
    <span class="vl">${show(v)}</span></li>`).join("");
}

// ---- drawing and choosing ------------------------------------------------------------------------------
function render() {
  const has = S.nb != null;
  if (has && (S.vs == null || S.vs === S.nb)) { S.vs = ordered(row("all", S.nb))[0]; S.auto = true; }
  $("nb").value = has ? S.nb : "";
  $("by").value = S.by;
  $("by").hidden = $("by").previousElementSibling.hidden = !has;
  for (const box of $("themes").querySelectorAll("input")) box.checked = !S.off.has(box.value);
  const shown = !$("picked").hidden;
  $("picked").hidden = !has;
  $("about").innerHTML = `${has ? "" : "<b>Choose a neighbourhood</b> above, or on the map of kinds below, to see which others are most and least like it. "}
    Each of ${D.measures.length} measures becomes a percentile rank among the ${N} neighbourhoods. Two neighbourhoods' gap on a theme is the average difference in their ranks on its measures,
    and their <b>affinity</b> is 100 less the average gap over the themes counted: 100 would be the same standing on everything, and two neighbourhoods taken at random average about ${show(cityMean)}.`;
  if (has) { renderAlike(); renderThemes(); renderSide(); }
  renderKinds();
  renderTypical();
  if (shown !== has || !$("toc").childElementCount) buildToc($("toc"));
  writeHash();
}

function setNb(i, vs = null) {
  S.nb = i;
  S.vs = vs;
  S.auto = vs == null;
  if (M[S.by] && i != null && M[S.by].values[i] == null) S.by = "all";
  render();
}
function setVs(j) {
  if (j === S.nb) return;
  S.vs = j;
  S.auto = false;
  render();
}
const jump = (id) => $(id).scrollIntoView({ behavior: "smooth", block: "start" });

$("nb").onchange = (e) => setNb(e.target.value === "" ? null : +e.target.value);
$("by").onchange = (e) => { S.by = e.target.value; render(); };
$("vs").onchange = (e) => setVs(+e.target.value);
$("swap").onclick = () => setNb(S.vs, S.nb);
$("themes").onchange = (e) => {
  const key = e.target.value;
  if (e.target.checked) S.off.delete(key);
  else if (active().length > 1) S.off.add(key); // at least one theme always counts
  recompute();
  render();
};
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-vs], [data-pick], [data-by], [data-sort], [data-kind], .nx-jump, path[data-i]");
  if (!t) return;
  if (t.matches(".nx-jump")) { e.preventDefault(); jump("side"); }
  else if (t.dataset.vs) setVs(+t.dataset.vs);
  else if (t.dataset.pick) { setNb(+t.dataset.pick, t.dataset.with == null ? null : +t.dataset.with); jump("measure-bar"); }
  else if (t.dataset.by) { S.by = t.dataset.by; render(); jump("alike"); }
  else if (t.dataset.sort) { S.sort = t.dataset.sort; renderAll(); }
  else if (t.dataset.kind) { S.kind = S.kind === +t.dataset.kind ? null : +t.dataset.kind; renderKinds(); }
  else if ($("alike-map").contains(t)) setVs(+t.dataset.i);
  else if ($("kinds-map").contains(t)) { setNb(+t.dataset.i); jump("measure-bar"); }
});

$("kinds-note").textContent = `The kinds are a convenient way to cut a continuum, not sharply separate groups, so each neighbourhood also carries the kind it is next nearest to. They come from Ward's hierarchical clustering of the percentile ranks, every theme but voting counting equally (a kind of place shouldn't be defined by how it votes); the silhouette is ${D.typing.silhouette.toFixed(2)}, where 1 would be cleanly separate groups and 0 none at all.`;
$("method-note").textContent = `Built ${D.built}. ${D.measures.length} measures in ${D.themes.length} themes, each at its latest period, from the Data Explorer's figures. `
  + "Percentile ranks are among the 158 neighbourhoods, ties sharing the middle. A theme's gap is averaged over the measures both neighbourhoods have a figure for (a few have no school results), and the overall gap over the themes counted, so a theme with many measures counts no more than one with few.";

initTip();
S.nb = nbIndex(hash.get("nb"));
S.vs = S.nb == null ? null : nbIndex(hash.get("vs"));
S.auto = S.vs == null;
for (const key of (hash.get("off") ?? "").split(".")) if (THEME[key]) S.off.add(key);
if (S.off.size >= D.themes.length) S.off.clear();
const by = hash.get("by");
if (by && (THEME[by] || M[by])) S.by = by;
recompute();
render();
