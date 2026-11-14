// The Data Explorer's two-measure view: A (across) against B (up). The scatter and its
// correlation, a two-colour map, B across fifths of A, the neighbourhoods furthest from the
// pattern, the correlation over time, change against change, leads and lags, and the two
// spreads side by side. Sections that need a history say so when a measure has none.
import { $, COLORS, escapeHTML } from "./catalogue.js";
import { cellStyle, fmtR, pearson, quantile, rColor } from "./charts.js";
import { BI, biKey, breaks, cls, fitLine, rangeLabels, scatter, tiedGroups } from "./nbtools.js";
import { INK, S, fmt, fmtAxis, fmtDiff, fmtDiffAxis, histHTML, lc, mapSVG, named, nbhd, nearest, pctOrd, pctRank, rho, sorted, strength, vals, whenOf } from "./explorer-core.js";

let api;
const TOL = 1.5; // years: two periods this close count as the same time
const A = () => S.cur[0], B = () => S.cur[1];

// The periods of the two measures that fall at the same time, as [iA, iB], oldest first. With a
// single-figure measure, every period of the other is set against that one figure.
export function pairs(a = A(), b = B()) {
  if (a.d.t.length === 1) return b.d.t.map((_, j) => [0, j]);
  if (b.d.t.length === 1) return a.d.t.map((_, i) => [i, 0]);
  const flip = a.d.t.length > b.d.t.length, [drv, oth] = flip ? [b, a] : [a, b];
  const out = [];
  drv.d.t.forEach((t, i) => {
    const j = nearest(oth.d, t);
    if (Math.abs(oth.d.t[j] - t) <= TOL) out.push(flip ? [j, i] : [i, j]);
  });
  return out;
}
// a pair's name: the period, or both where they differ; with a single-figure measure, the other's
const pairLabel = ([i, j]) => {
  const a = A().d.periods[i], b = B().d.periods[j];
  return A().d.t.length === 1 ? b : B().d.t.length === 1 || a === b ? a : `${a} · ${b}`;
};

// ---- 1. the scatter ------------------------------------------------------------------------------------
function renderScatter() {
  const a = A(), b = B(), xs = vals(0), ys = vals(1);
  const fit = fitLine(xs, ys), r = rho(xs, ys), pr = pearson(xs, ys)?.r ?? null;
  const s = scatter({ xs, ys, fit, pick: S.nb, zeroX: false, zeroY: false, fx: (v) => fmtAxis(a.d, v), fy: (v) => fmtAxis(b.d, v),
    xLabel: escapeHTML(named(a)), yLabel: escapeHTML(named(b)),
    tip: (i) => `${nbhd[i].name}<br>${a.d.short}: <b>${fmt(a.d, xs[i])}</b><br>${b.d.short}: <b>${fmt(b.d, ys[i])}</b>` });
  $("t-scatter").innerHTML = s.html;
  const gap = Math.abs(a.d.t[a.p] - b.d.t[b.p]);
  $("t-sum").innerHTML = r == null ? "Too few neighbourhoods have both figures to compare them."
    : `Across the ${s.n} neighbourhoods with both figures, ${escapeHTML(lc(named(a)))} and ${escapeHTML(lc(named(b)))} go together <b>${strength(r)}</b>: Spearman rank correlation <b>${fmtR(r)}</b> (Pearson ${fmtR(pr)}). ${Math.abs(r) < 0.2 ? "Knowing one tells you little about the other." : r > 0 ? "Where the first is higher, the second tends to be higher." : "Where the first is higher, the second tends to be lower."}${gap > 2 ? ` The two figures are ${Math.round(gap)} years apart, the closest the sources allow unless you move the sliders.` : ""} Each dot is a neighbourhood and the line is the straight-line fit; the axes end at the 98th percentile. This is a pattern across places: it says nothing about individual people, and doesn't show that one causes the other.`;
}

// ---- 2. the two-colour map -------------------------------------------------------------------------------
function renderMap() {
  const a = A(), b = B(), xs = vals(0), ys = vals(1), x3 = breaks(xs, 3), y3 = breaks(ys, 3);
  $("t-map").innerHTML = mapSVG((i) => (xs[i] == null || ys[i] == null ? null : BI[cls(y3.edges, ys[i])][cls(x3.edges, xs[i])]),
    (i) => `${nbhd[i].name}<br>${a.d.short}: <b>${fmt(a.d, xs[i])}</b><br>${b.d.short}: <b>${fmt(b.d, ys[i])}</b>`,
    `Map of the neighbourhoods by ${a.d.label} and ${b.d.label}`);
  $("t-key").innerHTML = biKey({ xName: named(a), xRanges: rangeLabels(x3.edges, x3.zero, (v) => fmtAxis(a.d, v)), xArrow: "More of the first →",
    yName: named(b), yRanges: rangeLabels(y3.edges, y3.zero, (v) => fmtAxis(b.d, v)), yArrow: "More of the second ↑" });
  $("t-map-lede").innerHTML = `Each measure in thirds of the neighbourhoods. Light grey is low on both and the darkest is high on both; red is high on ${escapeHTML(lc(a.d.short))} but low on ${escapeHTML(lc(b.d.short))}, and teal the reverse. Where the two go together the map runs from grey to dark; red and teal are the exceptions.`;
}

// ---- 3. the second measure across fifths of the first ------------------------------------------------------
function renderFifths() {
  const a = A(), b = B(), xs = vals(0), ys = vals(1);
  const both = xs.map((v, i) => (v == null || ys[i] == null ? null : v));
  // fifths, unless ties get in the way: neighbourhoods with the same figure stay in one group
  const fifths = tiedGroups(both, 5), n = fifths.length, whole = n === 5;
  const med = fifths.map((g) => quantile(sorted(g.map((i) => ys[i])), 0.5));
  const order = [...med].sort((p, q) => p - q), shade = (v) => COLORS[Math.min(5, order.indexOf(v) + 1)];
  const names = whole ? ["Lowest fifth", "Second", "Middle", "Fourth", "Highest fifth"] : fifths.map((_, q) => (n === 1 ? "All" : q === 0 ? "Lowest group" : q === n - 1 ? "Highest group" : `Group ${q + 1}`));
  const span = (g) => { const a = Math.min(...g.map((i) => xs[i])), b = Math.max(...g.map((i) => xs[i])); return a === b ? fmtAxis(A().d, a) : `${fmtAxis(A().d, a)}–${fmtAxis(A().d, b)}`; };
  const head = fifths.map((g, q) => `<th>${names[q]}<br><span class="small">${span(g)}</span></th>`).join("");
  const row = (label, f) => `<tr><th>${label}</th>${fifths.map((g, q) => f(g, q)).join("")}</tr>`;
  $("t-fifths").innerHTML = `<thead><tr><th>By ${escapeHTML(lc(a.d.short))}</th>${head}</tr></thead><tbody>
    ${row(`Median ${escapeHTML(lc(b.d.short))}`, (g, q) => `<td style="${cellStyle(shade(med[q]))}"><b>${fmt(b.d, med[q])}</b></td>`)}
    ${row("Middle half", (g) => { const s = sorted(g.map((i) => ys[i])); return `<td>${fmtAxis(b.d, quantile(s, 0.25))} to ${fmtAxis(b.d, quantile(s, 0.75))}</td>`; })}
    ${row("Neighbourhoods", (g) => `<td>${g.length}</td>`)}</tbody>`;
  const rising = med.every((v, k) => k === 0 || v >= med[k - 1]), falling = med.every((v, k) => k === 0 || v <= med[k - 1]);
  const tied = whole ? "" : ` Many neighbourhoods share the same figure for ${escapeHTML(lc(a.d.short))} (${fifths.reduce((m, g) => Math.max(m, g.length), 0)} of them in one group), and those can't be put in an order, so they stay together: ${n === 1 ? "one group" : `${n} groups`} of unequal size rather than fifths.`;
  $("t-fifths-lede").innerHTML = n < 2 ? `The neighbourhoods can't be grouped by ${escapeHTML(lc(named(a)))}: they all share one figure.`
    : `The neighbourhoods in ${whole ? "fifths" : "groups"} by ${escapeHTML(lc(named(a)))}, and the median ${escapeHTML(lc(b.d.label))} (${escapeHTML(whenOf(b))}) in each. From the lowest ${whole ? "fifth" : "group"} to the highest it goes from <b>${fmt(b.d, med[0])}</b> to <b>${fmt(b.d, med.at(-1))}</b>${n < 3 ? "" : rising ? ", rising at every step" : falling ? ", falling at every step" : `, but not in a straight run: the middle ${whole ? "fifths" : "groups"} break the pattern`}.${tied}`;
}

// ---- 4. the neighbourhoods furthest from the pattern ------------------------------------------------------
// In ranks, so a few extreme values don't decide it: a neighbourhood's percentile on the second
// measure, against the percentile its place on the first would predict.
function renderOutliers() {
  const a = A(), b = B(), xs = vals(0), ys = vals(1), pa = pctRank(xs), pb = pctRank(ys), r = rho(xs, ys) ?? 0;
  const resid = pa.map((v, i) => (v == null || pb[i] == null ? null : pb[i] - (50 + r * (v - 50))));
  const idx = [...nbhd.keys()].filter((i) => resid[i] != null).sort((p, q) => resid[q] - resid[p]);
  const max = Math.max(...idx.map((i) => Math.abs(resid[i])), 1);
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br>${a.d.short}: ${fmt(a.d, xs[i])} (${pctOrd(pa[i])} percentile)<br>${b.d.short}: <b>${fmt(b.d, ys[i])}</b> (${pctOrd(pb[i])} percentile)`)}"><span class="bar-fill" style="width:${((Math.abs(resid[i]) / max) * 100).toFixed(1)}%;background:${resid[i] > 0 ? BI[2][0] : BI[0][2]}"></span></span>
      <span class="vl">${fmt(b.d, ys[i])}</span><span class="move"></span></li>`;
  $("t-out-up").innerHTML = idx.slice(0, 8).map((i, k) => row(i, k + 1)).join("");
  $("t-out-down").innerHTML = idx.slice(-8).reverse().map((i, k) => row(i, k + 1)).join("");
  $("t-out-up-h").textContent = `Higher ${lc(b.d.short)} than expected`;
  $("t-out-down-h").textContent = `Lower ${lc(b.d.short)} than expected`;
  $("t-out-lede").innerHTML = `The neighbourhoods whose ${escapeHTML(lc(b.d.short))} is furthest from what their ${escapeHTML(lc(a.d.short))} would suggest, given how the two go together across the city. Measured in ranks (percentiles), so one extreme figure doesn't decide it; the figure shown is the neighbourhood's ${escapeHTML(lc(b.d.short))}.`;
}

// ---- 5. the correlation over time ------------------------------------------------------------------------
function renderTime() {
  const a = A(), b = B(), ps = pairs();
  const oneA = a.d.t.length === 1, oneB = b.d.t.length === 1;
  if (oneA && oneB) {
    $("t-time").innerHTML = "";
    $("t-time-lede").textContent = "Both measures are single figures, so there is no correlation over time to show.";
    return;
  }
  if (ps.length < 2) {
    $("t-time").innerHTML = "";
    $("t-time-lede").innerHTML = `The two measures' periods don't overlap at two or more points (${escapeHTML(a.d.short)}: ${escapeHTML(a.d.periods[0])} to ${escapeHTML(a.d.periods.at(-1))}; ${escapeHTML(b.d.short)}: ${escapeHTML(b.d.periods[0])} to ${escapeHTML(b.d.periods.at(-1))}), so there is no correlation over time to show.`;
    return;
  }
  const rs = ps.map(([i, j]) => rho(a.cols[i], b.cols[j]));
  const fixed = oneA ? a : oneB ? b : null;
  // on a fixed -1 to 1 scale, so the line's height says how strong the relationship is
  const drv = oneA ? b : a, ts = ps.map(([i, j]) => drv.d.t[oneA ? j : i]), t0 = ts[0], t1 = ts.at(-1);
  const x = (k) => ((ts[k] - t0) / (t1 - t0 || 1)) * 100, y = (v) => 100 - ((v + 1) / 2) * 100;
  const pts = rs.map((v, k) => (v == null ? null : `${x(k).toFixed(2)},${y(v).toFixed(2)}`)).filter(Boolean);
  const every = Math.ceil(ps.length / 8);
  $("t-time").innerHTML = `<div class="tr-box ex-trend ex-rtime">${[-1, -0.5, 0, 0.5, 1].map((v) => `<span class="sc-ytick" style="bottom:${100 - y(v)}%">${fmtR(v)}</span><span class="${v === 0 ? "ch-zero" : "sc-gy"}" style="bottom:${100 - y(v)}%"></span>`).join("")}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[4]}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      ${rs.map((v, k) => (v == null ? "" : `<span class="ex-rdot" style="left:${x(k)}%;bottom:${100 - y(v)}%;background:${rColor(v)}" data-tip="${escapeHTML(`${pairLabel(ps[k])}<br>Spearman <b>${fmtR(v)}</b>`)}"></span>`)).join("")}</div>
    <div class="ch-xticks">${ps.map((pr, k) => ((k % every === 0 && ps.length - 1 - k >= every * 0.9) || k === ps.length - 1 ? `<span style="left:${x(k)}%">${escapeHTML(pairLabel(pr).split(" ")[0])}</span>` : "")).join("")}</div>`;
  const k0 = rs.findIndex((v) => v != null), r0 = rs[k0], r1 = rs.findLast((v) => v != null), d = r1 - r0;
  $("t-time-lede").innerHTML = `The rank correlation between the two at each time both have a figure${fixed ? ` (${escapeHTML(lc(fixed.d.short))} is a single figure, ${escapeHTML(whenOf(fixed, 0))}, set against every period of the other)` : ""}: from <b>${fmtR(r0)}</b> (${escapeHTML(pairLabel(ps[k0]))}) to <b>${fmtR(r1)}</b> (${escapeHTML(pairLabel(ps.at(-1)))}). ${Math.abs(d) < 0.08 ? "The relationship has held about steady." : Math.abs(r1) > Math.abs(r0) ? "The two have come to go together more closely." : "The two go together less closely than they did."}`;
}

// ---- 6. change against change -----------------------------------------------------------------------------
function renderChange() {
  const a = A(), b = B(), ps = pairs();
  const ok = a.d.t.length > 1 && b.d.t.length > 1 && new Set(ps.map((p) => p[0])).size > 1 && new Set(ps.map((p) => p[1])).size > 1;
  $("t-chg-controls").hidden = !ok;
  if (!ok) {
    $("t-chg").innerHTML = "";
    $("t-chg-lede").textContent = a.d.t.length === 1 || b.d.t.length === 1 ? "A change needs two periods of each measure, and one of these is a single figure."
      : "The two measures don't share two points in time, so their changes can't be set side by side.";
    return;
  }
  // from the link, so anything: not a whole number in range means the first and last
  const inRange = (k) => Number.isInteger(k) && k >= 0 && k < ps.length;
  if (!inRange(S.pairFrom)) S.pairFrom = 0;
  if (!inRange(S.pairTo)) S.pairTo = ps.length - 1;
  const opts = ps.map((p, k) => `<option value="${k}">${escapeHTML(pairLabel(p))}</option>`).join("");
  $("t-chg-from").innerHTML = opts;
  $("t-chg-to").innerHTML = opts;
  $("t-chg-from").value = S.pairFrom;
  $("t-chg-to").value = S.pairTo;
  const [i0, j0] = ps[S.pairFrom], [i1, j1] = ps[S.pairTo];
  const diff = (m, k0, k1) => m.cols[k0].map((v, i) => (v == null || m.cols[k1][i] == null ? null : m.cols[k1][i] - v));
  const dx = diff(a, i0, i1), dy = diff(b, j0, j1), r = rho(dx, dy);
  if (S.pairFrom === S.pairTo) {
    $("t-chg").innerHTML = "";
    $("t-chg-lede").textContent = "Choose two different points in time.";
    return;
  }
  const s = scatter({ xs: dx, ys: dy, pick: S.nb, zeroX: true, zeroY: true, guides: { x: 0, y: 0 }, fx: (v) => fmtDiffAxis(a.d, v), fy: (v) => fmtDiffAxis(b.d, v),
    xLabel: `Change in ${escapeHTML(lc(a.d.label))}, ${escapeHTML(a.d.periods[i0])} to ${escapeHTML(a.d.periods[i1])}`,
    yLabel: `Change in ${escapeHTML(lc(b.d.label))}, ${escapeHTML(b.d.periods[j0])} to ${escapeHTML(b.d.periods[j1])}`,
    tip: (i) => `${nbhd[i].name}<br>${a.d.short}: <b>${fmtDiff(a.d, dx[i])}</b><br>${b.d.short}: <b>${fmtDiff(b.d, dy[i])}</b>` });
  $("t-chg").innerHTML = s.html;
  const level = rho(a.cols[i1], b.cols[j1]);
  $("t-chg-lede").innerHTML = r == null ? "Too few neighbourhoods have both changes." : `Did the neighbourhoods where ${escapeHTML(lc(a.d.short))} rose most also see ${escapeHTML(lc(b.d.short))} rise? Across ${s.n} neighbourhoods the two changes go together <b>${strength(r)}</b> (Spearman <b>${fmtR(r)}</b>), against <b>${fmtR(level)}</b> for the levels themselves. ${Math.abs(r) < Math.abs(level) - 0.15 ? "Levels can line up while changes don't: places that are high on both mostly stayed high on both, which says little about what moves with what." : "The changes line up about as closely as the levels do."} The dashed lines are no change.`;
}

// ---- 7. leads and lags --------------------------------------------------------------------------------------
function renderLags() {
  const a = A(), b = B();
  const yearly = (m) => m.d.kind === "year" && m.d.t.length >= 6;
  if (!yearly(a) || !yearly(b)) {
    $("t-lag-sec").hidden = true;
    return;
  }
  const ya = new Map(a.d.t.map((t, k) => [Math.round(t), k])), yb = new Map(b.d.t.map((t, k) => [Math.round(t), k]));
  const rows = [-3, -2, -1, 0, 1, 2, 3].map((L) => {
    const rs = [...ya.keys()].filter((y) => yb.has(y + L)).map((y) => rho(a.cols[ya.get(y)], b.cols[yb.get(y + L)])).filter((v) => v != null);
    return rs.length < 3 ? null : { L, r: rs.reduce((s, v) => s + v, 0) / rs.length, n: rs.length };
  }).filter(Boolean);
  $("t-lag-sec").hidden = rows.length < 3;
  if (rows.length < 3) return;
  const name = (L) => (L === 0 ? "the same year" : `${Math.abs(L)} year${Math.abs(L) > 1 ? "s" : ""} ${L > 0 ? "later" : "earlier"}`);
  $("t-lag").innerHTML = rows.map(({ L, r, n }) => `<li><span class="cl-name">${escapeHTML(b.d.short)} ${name(L)}<span class="ex-src">average of ${n} years</span></span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - Math.abs(r) * 50}%`};width:${Math.abs(r) * 50}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></li>`).join("");
  const best = rows.reduce((p, q) => (Math.abs(q.r) > Math.abs(p.r) ? q : p)), range = Math.max(...rows.map((x) => x.r)) - Math.min(...rows.map((x) => x.r));
  $("t-lag-lede").innerHTML = `${escapeHTML(a.d.short)} in each year against ${escapeHTML(lc(b.d.short))} up to three years before and after, averaged over the years both have. ${range < 0.06 ? `The correlation hardly depends on the lag (within ${range.toFixed(2)}): the neighbourhoods' order on each measure changes slowly, so one year looks much like the next, and nothing here says which moves first.` : `It is strongest with ${escapeHTML(lc(b.d.short))} ${name(best.L)} (<b>${fmtR(best.r)}</b>). Rankings change slowly, so read a lead of a year or two with care.`}`;
}

// ---- 8. the two spreads --------------------------------------------------------------------------------------
function renderDist() {
  const describe = (m, vs) => {
    const s = sorted(vs), p10 = quantile(s, 0.1), p90 = quantile(s, 0.9);
    const ratio = p10 > 0 && !["degC", "index", "score"].includes(m.d.unit) ? ` The 90th percentile neighbourhood has <b>${(p90 / p10).toFixed(1)}×</b> the 10th's.` : "";
    return `Median ${fmt(m.d, quantile(s, 0.5))}; middle half ${fmt(m.d, quantile(s, 0.25))} to ${fmt(m.d, quantile(s, 0.75))}.${ratio}`;
  };
  [A(), B()].forEach((m, k) => {
    $(`t-dist-h${k}`).textContent = named(m);
    $(`t-dist${k}`).innerHTML = histHTML(m.d, vals(k), { height: 110 });
    $(`t-dist-note${k}`).innerHTML = describe(m, vals(k));
  });
}

export function initTwo(a) {
  api = a;
  $("t-chg-from").addEventListener("change", (e) => { S.pairFrom = +e.target.value; renderChange(); api.changed(); });
  $("t-chg-to").addEventListener("change", (e) => { S.pairTo = +e.target.value; renderChange(); api.changed(); });
}
export function renderTwo() {
  renderScatter();
  renderMap();
  renderFifths();
  renderOutliers();
  renderTime();
  renderChange();
  renderLags();
  renderDist();
}
