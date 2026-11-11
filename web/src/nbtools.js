// Shared by the neighbourhood Insights pages that map one measure against income
// (safety.js, trees.js): map classes, the bivariate scheme and key, rankings, income
// fifths and a neighbourhood scatter. Pages keep their own wording and colours.
import { escapeHTML } from "./catalogue.js";
import { quantile } from "./charts.js";

// 3 x 3 bivariate scheme (J. Stevens' blue-red): rows income low -> high, columns the
// page's measure low -> high.
export const BI = [["#e8e8e8", "#e4acac", "#c85a5a"], ["#b0d5df", "#ad9ea5", "#985356"], ["#64acbe", "#627f8c", "#574249"]];
export const INCOME = ["med_hh_tot", "med_hh_at", "avg_hh_tot", "med_ind_tot", "lim_at"];

// n classes of about equal numbers of neighbourhoods; where more than 1/n have none,
// none is a class of its own.
export function breaks(vs, n = 6) {
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const uniq = (qs) => qs.filter((q, k) => k === 0 || q > qs[k - 1]);
  if (s[0] === 0 && s.filter((v) => v === 0).length > s.length / n) {
    const pos = s.filter((v) => v > 0);
    return { edges: [Number.MIN_VALUE, ...uniq(Array.from({ length: n - 2 }, (_, k) => quantile(pos, (k + 1) / (n - 1))))], zero: true };
  }
  return { edges: uniq(Array.from({ length: n - 1 }, (_, k) => quantile(s, (k + 1) / n))), zero: false };
}
export const cls = (edges, v) => edges.filter((e) => v >= e).length;
export const rankOrder = (vs) => vs.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
export function rangeLabels(edges, zero, f) {
  const e = [null, ...edges, null];
  return e.slice(0, -1).map((_, k) => (zero && k === 0 ? "None" : zero && k === 1 ? `under ${f(e[2])}`
    : e[k] == null ? `under ${f(e[k + 1])}` : e[k + 1] == null ? `${f(e[k])} or more` : `${f(e[k])} to ${f(e[k + 1])}`));
}

// The bivariate key: a 3 x 3 grid with its axes, and the class ranges in words.
export function biKey({ xName, xRanges, xArrow, yName, yRanges, yArrow }) {
  const rows = [2, 1, 0].map((r) => `<div class="bi-row">${[0, 1, 2].map((c) => `<span style="background:${BI[r][c]}"></span>`).join("")}</div>`).join("");
  return `<div class="bi-grid" aria-hidden="true"><div class="bi-y">${yArrow}</div><div class="bi-cells">${rows}</div><div class="bi-x">${xArrow}</div></div>
      <dl class="bi-text"><dt>${escapeHTML(xName)} (columns)</dt><dd>${xRanges.map(escapeHTML).join(" · ")}</dd>
      <dt>${escapeHTML(yName)} (rows, bottom to top)</dt><dd>${yRanges.map(escapeHTML).join(" · ")}</dd></dl>`;
}

// The neighbourhoods with an income figure in fifths, the least well off first.
export function incomeFifths(inc, up) {
  const idx = inc.map((_, i) => i).filter((i) => inc[i] != null);
  idx.sort((a, b) => (up ? inc[a] - inc[b] : inc[b] - inc[a]));
  return { idx, fifths: [0, 1, 2, 3, 4].map((q) => idx.slice(Math.round((q * idx.length) / 5), Math.round(((q + 1) * idx.length) / 5))) };
}

// Ordinary least squares of ys on xs over the pairs where both are known.
export function fitLine(xs, ys) {
  const idx = xs.map((_, i) => i).filter((i) => xs[i] != null && ys[i] != null), n = idx.length;
  const mx = idx.reduce((s, i) => s + xs[i], 0) / n, my = idx.reduce((s, i) => s + ys[i], 0) / n;
  let sxy = 0, sxx = 0;
  for (const i of idx) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}

// A scatter of the neighbourhoods; a dot picks its neighbourhood (data-nb). The axes end
// at the 98th percentile (and the 2nd, where an axis isn't anchored at zero).
// guides: {x, y} draws dashed lines at those values (a quadrant's edges); mark(i) adds a class to a dot.
export function scatter({ xs, ys, xLabel, yLabel, fx, fy, tip, pick = null, diag = false, zeroX = true, zeroY = true, fit = null, guides = null, mark = () => "" }) {
  const idx = xs.map((_, i) => i).filter((i) => xs[i] != null && ys[i] != null);
  const sx = idx.map((i) => xs[i]).sort((a, b) => a - b), sy = idx.map((i) => ys[i]).sort((a, b) => a - b);
  let xa = zeroX ? Math.min(0, sx[0]) : sx[0], xb = quantile(sx, 0.98);
  let ya = zeroY ? Math.min(0, sy[0]) : quantile(sy, 0.02), yb = quantile(sy, 0.98);
  if (diag) xa = ya = Math.min(xa, ya), xb = yb = Math.max(xb, yb);
  const px = (v) => Math.min(100, Math.max(0, ((v - xa) / (xb - xa || 1)) * 100)), py = (v) => Math.min(100, Math.max(0, ((v - ya) / (yb - ya || 1)) * 100));
  const q = [0, 0.25, 0.5, 0.75, 1];
  let line = "";
  if (diag) line = `<line x1="0" y1="100" x2="100" y2="0" stroke="#9a9a93" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  if (fit) {
    const y = (x) => fit.intercept + fit.slope * x;
    line = `<line x1="0" y1="${(100 - ((y(xa) - ya) / (yb - ya)) * 100).toFixed(2)}" x2="100" y2="${(100 - ((y(xb) - ya) / (yb - ya)) * 100).toFixed(2)}" stroke="#1a1a19" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  }
  if (guides) {
    const gx = guides.x == null ? null : ((guides.x - xa) / (xb - xa)) * 100, gy = guides.y == null ? null : 100 - ((guides.y - ya) / (yb - ya)) * 100;
    if (gx != null) line += `<line x1="${gx.toFixed(2)}" y1="0" x2="${gx.toFixed(2)}" y2="100" stroke="#9a9a93" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
    if (gy != null) line += `<line x1="0" y1="${gy.toFixed(2)}" x2="100" y2="${gy.toFixed(2)}" stroke="#9a9a93" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  }
  const svg = line ? `<svg class="sc-diag" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${line}</svg>` : "";
  const hi = (f, b, s) => (f === 1 && b < s.at(-1) ? "+" : "");
  return { n: idx.length, html: `<div class="sc-y">${yLabel}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}${svg}
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${!zeroY && f === 0 && ya > sy[0] ? "≤" : !zeroY && f === 1 && yb < sy.at(-1) ? "≥" : ""}${fy(ya + f * (yb - ya))}${zeroY ? hi(f, yb, sy) : ""}</span>`).join("")}
      ${idx.map((i) => `<span class="sc-dot${i === pick ? " pick" : ""}${mark(i)}" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(ys[i]).toFixed(2)}%" data-nb="${i}" data-tip="${escapeHTML(tip(i))}"></span>`).join("")}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fx(xa + f * (xb - xa))}${hi(f, xb, sx)}</span>`).join("")}</div>
    <div class="sc-x">${xLabel}</div>` };
}
