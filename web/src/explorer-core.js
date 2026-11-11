// Shared by the Data Explorer's views (explorer.js and explorer-one/-two/-three.js): the
// catalogue, loading a source's data, formatting by unit, the current selection, and the
// small statistics and chart pieces more than one view uses.
import { COLORS, escapeHTML, ordinal, sign } from "./catalogue.js";
import { quantile, spearman } from "./charts.js";

export const V = __EXPLORER_VERSION__;
export const C = await fetch(`/explorer/catalogue.json?v=${V}`).then((r) => r.json());
export const nbhd = C.nbhd, N = nbhd.length, ORANGE = "#c2410c", INK = "#1a1a19";
export const DEF = Object.fromEntries(C.measures.map((m) => [m.id, m]));
export const SRC = Object.fromEntries(C.sources.map((s) => [s.key, s]));
const cache = {};
export const load = (src) => (cache[src] ??= fetch(`/explorer/${src}.json?v=${V}`).then((r) => r.json()));
export const columns = async (id) => (await load(DEF[id].source))[id.split(".")[1]];
export const loadAll = async () => Object.fromEntries(await Promise.all(C.sources.map((s) => load(s.key).then((data) => [s.key, data]))));

// The selection: up to three measures, each {d, cols, p} (definition, its columns by period,
// the period on show), the picked neighbourhood, and the view-specific choices kept in the link.
export const S = { cur: [], nb: null, from: 0, to: 0, pairFrom: null, pairTo: null };
export const vals = (k) => S.cur[k].cols[S.cur[k].p];
export const whenOf = (m, p = m.p) => `${m.d.periods[p]}${m.d.kind === "census" ? " Census" : ""}`;
export const named = (m, p = m.p) => `${m.d.label}, ${whenOf(m, p)}`;

// ---- formatting by unit --------------------------------------------------------------------
const num = (v, d) => v.toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
const F = {
  money: (v) => `$${num(Math.round(v), 0)}`,
  pct: (v) => `${v.toFixed(1)}%`,
  rate: (v) => (v === 0 ? "0" : Math.abs(v) >= 100 ? num(Math.round(v), 0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)),
  score: (v) => v.toFixed(1),
  degC: (v) => `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}°C`,
  temp: (v) => `${v.toFixed(1)}°C`,
  index: (v) => v.toFixed(2),
  pts: (v) => `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)} pts`,
};
export const fmt = (d, v) => (v == null ? "—" : F[d.unit](v));
export const fmtAxis = (d, v) => (d.unit === "money" && Math.abs(v) >= 10000 ? `$${Math.round(v / 1000)}k` : d.unit === "pct" ? `${+v.toFixed(1)}%` : fmt(d, v));
// a change in the measure's own terms: dollars, percentage points, degrees, or plain
export const fmtDiff = (d, v) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = sign(+v.toFixed(2));
  return d.unit === "money" ? `${s}$${num(Math.round(a), 0)}` : d.unit === "pct" ? `${s}${a.toFixed(1)} pp`
    : d.unit === "degC" || d.unit === "temp" ? `${s}${a.toFixed(1)}°C` : d.unit === "pts" ? `${s}${a.toFixed(1)} pts` : `${s}${F[d.unit === "index" ? "index" : "rate"](a)}`;
};
export const fmtDiffAxis = (d, v) => (d.unit === "money" && Math.abs(v) >= 1000 ? `${sign(Math.round(v))}$${+(Math.abs(v) / 1000).toFixed(Math.abs(v) < 10000 ? 1 : 0)}k` : fmtDiff(d, v));
// a label inside a sentence: lower-case its first letter unless it is a name
export const lc = (s) => (/^[A-Z][a-z]/.test(s) && !/^(Grade|Norway|John|Olivia|Ana|Airbnb|CMHC)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
export const known = (vs) => vs.filter((v) => v != null);
export const sorted = (vs) => known(vs).sort((a, b) => a - b);
export const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);

// ---- statistics --------------------------------------------------------------------------------
// Percentile rank (0-100) of each value among the known ones; ties share the middle.
export function pctRank(vs) {
  const s = sorted(vs);
  return vs.map((v) => (v == null ? null : ((s.filter((x) => x < v).length + s.filter((x) => x === v).length / 2) / s.length) * 100));
}
// a percentile in words, kept within 1st to 99th
export const pctOrd = (p) => ordinal(Math.min(99, Math.max(1, Math.round(p))));
export const rho = (a, b) => spearman(a, b)?.r ?? null;
// how a rank correlation reads in words
export const strength = (r) => {
  const a = Math.abs(r);
  return a >= 0.7 ? "strongly" : a >= 0.4 ? "moderately" : a >= 0.2 ? "weakly" : "hardly at all";
};
// the period of measure definition d nearest time t
export const nearest = (d, t) => d.t.reduce((a, x, k) => (Math.abs(x - t) < Math.abs(d.t[a] - t) ? k : a), 0);

// ---- a histogram of one measure's neighbourhoods -------------------------------------------------
// Bins run between the 1st and 99th percentiles; the end bins hold what lies beyond. The dark
// line is the median neighbourhood, the orange one the picked neighbourhood.
export function histHTML(d, vs, { bins = 24, height = null } = {}) {
  const s = sorted(vs), lo = quantile(s, 0.01), hi = quantile(s, 0.99), w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of s) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  const max = Math.max(...counts), bw = 100 / bins;
  const bars = counts.map((c, k) => (c ? `<rect x="${(k * bw + 0.15).toFixed(2)}" y="${(100 - (c / max) * 100).toFixed(2)}" width="${(bw - 0.3).toFixed(2)}" height="${((c / max) * 100).toFixed(2)}" fill="${COLORS[3]}"/>` : "")).join("");
  const tips = counts.map((c, k) => `<span class="hi-bin" style="left:${k * bw}%;width:${bw}%" data-tip="${escapeHTML(`${k === 0 && s[0] < lo ? "up to " : `${fmtAxis(d, lo + k * w)} to `}${fmtAxis(d, lo + (k + 1) * w)}${k === bins - 1 && s.at(-1) > hi ? " or more" : ""}: <b>${c}</b> neighbourhood${c === 1 ? "" : "s"}`)}"></span>`).join("");
  const at = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100));
  const med = quantile(s, 0.5), pk = S.nb == null ? null : vs[S.nb];
  return `<div class="hi-box"${height ? ` style="height:${height}px"` : ""}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>${tips}
      <span class="hi-city" style="left:${at(med)}%" data-tip="Median neighbourhood: ${escapeHTML(fmt(d, med))}"></span>
      ${pk == null ? "" : `<span class="hi-city hi-pick" style="left:${at(pk)}%" data-tip="${escapeHTML(`${nbhd[S.nb].name}: ${fmt(d, pk)}`)}"></span>`}<span class="hi-max">${max}</span></div>
    <div class="sc-xticks hi-ticks">${[0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${f === 0 && s[0] < lo ? "≤" : f === 1 && s.at(-1) > hi ? "≥" : ""}${fmtAxis(d, lo + f * (hi - lo))}</span>`).join("")}</div>`;
}

// ---- a neighbourhood map: one <path> per neighbourhood, filled by fill(i) -------------------------
export function mapSVG(fill, tip, label, cls = () => "") {
  const shapes = nbhd.map((n, i) => `<path d="${n.path}" fill="${fill(i) ?? "url(#nb-hatch)"}" data-i="${i}"${cls(i) ? ` class="${cls(i)}"` : ""} data-tip="${escapeHTML(tip(i))}"/>`).join("");
  return `<svg viewBox="0 0 ${C.map.width} ${C.map.height}" role="img" aria-label="${escapeHTML(label)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
}
