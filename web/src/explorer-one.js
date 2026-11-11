// The Data Explorer's one-measure view: map, spread, ranking, trend, biggest changes,
// stability, and the measures it goes with.
import { $, COLORS, DIVERGING, escapeHTML, ordinal } from "./catalogue.js";
import { fmtR, quantile, rColor, spearman } from "./charts.js";
import { breaks, cls, rangeLabels, rankOrder } from "./nbtools.js";
import { C, DEF, N, ORANGE, S, SRC, fmt, fmtAxis, fmtDiff, histHTML, known, lc, loadAll, mapSVG, nbhd, nearest, sorted, whenOf } from "./explorer-core.js";

let api; // {setPeriod(slot, k), addMeasure(id), changed()}
const M = () => S.cur[0];
const when = (k) => whenOf(M(), k);

// ---- 1. the map: one set of classes for every period, so a colour means the same as the slider moves
function renderMap() {
  const { d, cols, p } = M(), vs = cols[p], b = breaks(cols.flat());
  const pal = COLORS.slice(COLORS.length - b.edges.length - 1), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  $("nb-map").innerHTML = mapSVG((i) => (vs[i] == null ? null : pal[cls(b.edges, vs[i])]),
    (i) => `${nbhd[i].name}<br>${vs[i] == null ? "No figure" : `<b>${fmt(d, vs[i])}</b> · ${ordinal(rank.get(i))} of ${order.length}`}<br>${when()}`,
    `Map of the neighbourhoods by ${d.label}, ${when()}`);
  $("map-key").innerHTML = rangeLabels(b.edges, b.zero, (v) => fmtAxis(d, v)).map((l, k) => `<li><span class="key-sq" style="background:${pal[k]}"></span>${escapeHTML(l)}</li>`).join("")
    + (vs.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
  $("map-lede").innerHTML = `${escapeHTML(d.label)}, ${escapeHTML(when())}. Classes are sixths of the neighbourhoods${d.periods.length > 1 ? `, over all ${d.periods.length} periods together, so a colour means the same in each` : ""}. Pick a neighbourhood to follow it down the page.`;
}

// ---- 2. how it's spread -----------------------------------------------------------------------------
function renderHist() {
  const { d, cols, p } = M(), vs = cols[p], s = sorted(vs);
  $("hist").innerHTML = histHTML(d, vs);
  const med = quantile(s, 0.5), q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), pk = S.nb == null ? null : vs[S.nb];
  const loI = vs.indexOf(s[0]), hiI = vs.indexOf(s.at(-1));
  $("dist-lede").innerHTML = `${escapeHTML(when())}: the median neighbourhood is at <b>${fmt(d, med)}</b> (the dark line), and the middle half lie between ${fmt(d, q1)} and ${fmt(d, q3)}. They run from ${fmt(d, s[0])} (${escapeHTML(nbhd[loI].name)}) to ${fmt(d, s.at(-1))} (${escapeHTML(nbhd[hiI].name)})${s.length < N ? `; ${N - s.length} have no figure` : ""}.${pk == null ? "" : ` ${escapeHTML(nbhd[S.nb].name)}, in orange, is at <b>${fmt(d, pk)}</b>.`}`;
}

// ---- 3. highest and lowest ---------------------------------------------------------------------------
function renderRanks() {
  const { d, cols, p } = M(), vs = cols[p], order = rankOrder(vs);
  const lo = Math.min(0, ...known(vs)), hi = Math.max(...known(vs));
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${fmt(d, vs[i])}</b>`)}"><span class="bar-fill" style="width:${(((vs[i] - lo) / (hi - lo || 1)) * 100).toFixed(1)}%"></span></span>
      <span class="vl">${fmt(d, vs[i])}</span><span class="move"></span></li>`;
  $("rank-top").innerHTML = order.slice(0, 10).map((i, k) => row(i, k + 1)).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map((i, k) => row(i, order.length - k)).join("");
  $("rank-lede").innerHTML = `${escapeHTML(d.label)}, ${escapeHTML(when())}: ${order.length} neighbourhoods. Pick a name to find it on the map.`;
}

// ---- 4. over time: the median neighbourhood and the spread around it ---------------------------------
function renderTrend() {
  const { d, cols, p } = M();
  if (d.periods.length < 2) return;
  const q = (f) => cols.map((c) => quantile(sorted(c), f));
  const p10 = q(0.1), p25 = q(0.25), p50 = q(0.5), p75 = q(0.75), p90 = q(0.9);
  const pk = S.nb == null ? null : cols.map((c) => c[S.nb]);
  const all = [...p10, ...p90, ...(pk ? known(pk) : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const t0 = d.t[0], t1 = d.t.at(-1), x = (k) => ((d.t[k] - t0) / (t1 - t0)) * 100, y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;
  const pts = (vs) => vs.map((v, k) => `${x(k).toFixed(2)},${y(v).toFixed(2)}`);
  const band = (a, b, fill) => `<polygon points="${[...pts(b), ...pts(a).reverse()].join(" ")}" fill="${fill}"/>`;
  let svg = band(p10, p90, COLORS[0]) + band(p25, p75, COLORS[1])
    + `<polyline points="${pts(p50).join(" ")}" fill="none" stroke="${COLORS[5]}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  if (pk) {
    const runs = [[]];
    pk.forEach((v, k) => (v == null ? runs.push([]) : runs.at(-1).push(`${x(k).toFixed(2)},${y(v).toFixed(2)}`)));
    svg += runs.filter((r) => r.length).map((r) => `<polyline points="${r.join(" ")}" fill="none" stroke="${ORANGE}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join("");
  }
  svg += `<line x1="${x(p)}" x2="${x(p)}" y1="0" y2="100" stroke="#1a1a19" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
  // each period's hit area runs between the midpoints to its neighbours
  const n = d.periods.length, edge = (k) => (k <= 0 ? 0 : k >= n ? 100 : (x(k - 1) + x(k)) / 2);
  const hits = d.periods.map((_, k) => `<button type="button" class="tr-hit" data-p="${k}" style="left:${edge(k)}%;width:${edge(k + 1) - edge(k)}%"
    data-tip="${escapeHTML(`${when(k)}<br>Median neighbourhood: <b>${fmt(d, p50[k])}</b><br>Middle half: ${fmt(d, p25[k])} to ${fmt(d, p75[k])}<br>Middle 80%: ${fmt(d, p10[k])} to ${fmt(d, p90[k])}${pk ? `<br>${nbhd[S.nb].name}: <b>${fmt(d, pk[k])}</b>` : ""}`)}" aria-label="${escapeHTML(when(k))}"></button>`).join("");
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtAxis(d, lo + f * (hi - lo))}</span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("");
  const every = Math.ceil(n / 8);
  const xt = d.periods.map((per, k) => ((k % every === 0 && n - 1 - k >= every * 0.9) || k === n - 1 ? `<span style="left:${x(k)}%">${escapeHTML(d.kind === "scrape" ? per.slice(0, 7) : per.split(" ")[0])}</span>` : "")).join("");
  $("trend").innerHTML = `<div class="tr-box ex-trend">${yt}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>${hits}</div><div class="ch-xticks">${xt}</div>
    <ul class="year-key"><li><span class="ex-key-line" style="background:${COLORS[5]}"></span>Median neighbourhood</li><li><span class="key-sq" style="background:${COLORS[1]}"></span>Middle half</li>
      <li><span class="key-sq" style="background:${COLORS[0]}"></span>Middle 80%</li>${pk ? `<li><span class="ex-key-line" style="background:${ORANGE}"></span>${escapeHTML(nbhd[S.nb].name)}</li>` : ""}</ul>`;
  const a = p50[0], b = p50.at(-1), spread0 = p75[0] - p25[0], spread1 = p75.at(-1) - p25.at(-1);
  $("trend-lede").innerHTML = `From ${escapeHTML(when(0))} to ${escapeHTML(when(n - 1))} the median neighbourhood went from ${fmt(d, a)} to <b>${fmt(d, b)}</b> (${fmtDiff(d, b - a)}), and the gap between the 25th and 75th percentile neighbourhoods ${Math.abs(spread1 - spread0) < Math.abs(spread0) * 0.05 ? "held about steady" : spread1 > spread0 ? "widened" : "narrowed"} (${fmt(d, spread0).replace(/^[+−±]/, "")} to ${fmt(d, spread1).replace(/^[+−±]/, "")}). Pick a point to move the map to it${pk ? "" : "; pick a neighbourhood to add its line"}.`;
}

// ---- 5. biggest changes between two periods -----------------------------------------------------------
function renderChange() {
  const { d, cols } = M();
  if (d.periods.length < 2) return;
  const opts = d.periods.map((per, k) => `<option value="${k}">${escapeHTML(per)}</option>`).join("");
  $("chg-from").innerHTML = opts;
  $("chg-to").innerHTML = opts;
  $("chg-from").value = S.from;
  $("chg-to").value = S.to;
  const a = cols[S.from], b = cols[S.to];
  const diff = a.map((v, i) => (v == null || b[i] == null ? null : b[i] - v));
  const order = rankOrder(diff), max = Math.max(...known(diff).map(Math.abs), 1e-9);
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br>${when(S.from)}: ${fmt(d, a[i])}<br>${when(S.to)}: ${fmt(d, b[i])}<br><b>${fmtDiff(d, diff[i])}</b>`)}"><span class="bar-fill" style="width:${((Math.abs(diff[i]) / max) * 100).toFixed(1)}%;background:${diff[i] < 0 ? DIVERGING[1] : DIVERGING[5]}"></span></span>
      <span class="vl ex-diff">${fmtDiff(d, diff[i])}</span><span class="move"></span></li>`;
  const ups = order.filter((i) => diff[i] > 0).slice(0, 10), downs = order.filter((i) => diff[i] < 0).reverse().slice(0, 10);
  $("chg-up").innerHTML = ups.map((i, k) => row(i, k + 1)).join("") || `<li class="ex-none">None rose.</li>`;
  $("chg-down").innerHTML = downs.map((i, k) => row(i, k + 1)).join("") || `<li class="ex-none">None fell.</li>`;
  const s = sorted(diff), up = s.filter((v) => v > 0).length, down = s.filter((v) => v < 0).length;
  $("chg-lede").innerHTML = S.from === S.to ? "Choose two different periods."
    : `From ${escapeHTML(when(S.from))} to ${escapeHTML(when(S.to))}, ${up} neighbourhoods rose and ${down} fell; the median change was <b>${fmtDiff(d, quantile(s, 0.5))}</b>${s.length < N ? ` (${N - s.length} without a figure in both)` : ""}.${d.unit === "money" && d.source === "census" ? " Dollars are already restated for inflation." : ""}`;
}

// ---- 6. how stable the order is --------------------------------------------------------------------------
function renderStability() {
  const { d, cols, p } = M();
  if (d.periods.length < 2) return;
  const rs = d.periods.map((_, k) => (k === p ? null : spearman(cols[k], cols[p])?.r ?? null));
  $("stab-list").innerHTML = d.periods.map((_, k) => (k === p ? "" : `<li><button type="button" data-p="${k}">
      <span class="cl-name">${escapeHTML(when(k))}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${rs[k] >= 0 ? "left:50%" : `left:${50 - Math.abs(rs[k]) * 50}%`};width:${Math.abs(rs[k] ?? 0) * 50}%;background:${rColor(rs[k] ?? 0)}"></span></span>
      <span class="cl-val">${fmtR(rs[k])}</span></button></li>`)).join("");
  const far = rs.findIndex((r) => r != null), r0 = rs[far];
  $("stab-lede").innerHTML = `How closely each period's ranking of the neighbourhoods matches ${escapeHTML(when())}'s (Spearman rank correlation: 1 is the same order). Against ${escapeHTML(when(far))} it is <b>${fmtR(r0)}</b>: ${r0 > 0.9 ? "the order has barely changed" : r0 > 0.7 ? "mostly the same places at the top and bottom" : r0 > 0.4 ? "a good deal of reshuffling" : "little of the order carries over, which for small counts is partly noise"}. Pick a period to move to it.`;
}

// ---- 7. what it goes with: every other measure, at its period nearest this one ----------------------------
const PER_SOURCE = 3;
let relToken = 0, relKey = null;
async function renderRelated() {
  const key = `${M().d.id}|${M().p}`;
  if (key === relKey) return; // unchanged since it was last drawn
  const mine = ++relToken;
  $("rel-other").innerHTML = $("rel-same").innerHTML = "";
  $("rel-lede").textContent = "Loading the other sources…";
  const data = await loadAll();
  if (mine !== relToken || S.cur.length !== 1) return;
  relKey = key;
  const { d, cols, p } = M(), vs = cols[p], t = d.t[p];
  const rs = C.measures.filter((m) => m.id !== d.id).map((m) => {
    const k = nearest(m, t), r = spearman(vs, data[m.source][m.id.split(".")[1]][k]);
    return r && { m, k, r: r.r, n: r.n };
  }).filter(Boolean).sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const item = ({ m, k, r, n }) => `<li><button type="button" data-m="${m.id}" title="Set ${escapeHTML(m.label)} beside this measure">
      <span class="cl-name">${escapeHTML(m.label)}<span class="ex-src">${escapeHTML(SRC[m.source].label)} · ${escapeHTML(m.periods[k])}${n < N ? ` · ${n} neighbourhoods` : ""}</span></span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - Math.abs(r) * 50}%`};width:${Math.abs(r) * 50}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  // at most PER_SOURCE from any one other source, so seven school results don't crowd out the rest
  const seen = {};
  const other = rs.filter((x) => x.m.source !== d.source && (seen[x.m.source] = (seen[x.m.source] ?? 0) + 1) <= PER_SOURCE).slice(0, 10);
  const same = rs.filter((x) => x.m.source === d.source).slice(0, 6);
  $("rel-other").innerHTML = other.map(item).join("");
  $("rel-same").innerHTML = same.map(item).join("") || `<li class="ex-none">This source has no other measure.</li>`;
  $("rel-same-h").textContent = `From the same source (${SRC[d.source].label})`;
  $("rel-lede").innerHTML = `The measures whose ranking of the neighbourhoods is closest to ${escapeHTML(lc(d.label))}'s in ${escapeHTML(when())}, or most nearly its reverse, out of the other ${C.measures.length - 1}: Spearman rank correlation, each measure at its period nearest ${escapeHTML(d.periods[p])}. Measures from the same source often count nearly the same thing, so they are listed apart, and no other source gets more than ${PER_SOURCE} places. A correlation across neighbourhoods says nothing about individual people, and none of this shows cause. Pick one to set it beside this measure.`;
}
// the closest measure from another source, for "Add a measure"; null until the list has been drawn
export const suggestion = () => $("rel-other").querySelector("[data-m]")?.dataset.m ?? null;

export function initOne(a) {
  api = a;
  $("chg-from").addEventListener("change", (e) => { S.from = +e.target.value; renderChange(); api.changed(); });
  $("chg-to").addEventListener("change", (e) => { S.to = +e.target.value; renderChange(); api.changed(); });
  for (const id of ["trend", "stab-list"]) $(id).addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b) api.setPeriod(0, +b.dataset.p);
  });
  $("rel-cols").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (b && DEF[b.dataset.m]) api.addMeasure(b.dataset.m);
  });
}
export function renderOne() {
  const many = M().d.periods.length > 1;
  for (const id of ["trend-sec", "change-sec", "stab-sec"]) $(id).hidden = !many;
  renderMap();
  renderHist();
  renderRanks();
  renderTrend();
  renderChange();
  renderStability();
  renderRelated();
}
