// The Data Explorer's three-measure view: A against B with C as colour. The three pairwise
// relationships, the A-B scatter coloured by thirds of C (and whether A and B still go together
// within each third), three small maps, a picked neighbourhood's profile, and the eight
// high/low combinations of the three on a map.
import { $, COLORS, escapeHTML } from "./catalogue.js";
import { fmtR, quantile } from "./charts.js";
import { breaks, cls, fitLine, rangeLabels, scatter } from "./nbtools.js";
import { N, ORANGE, S, fmt, fmtAxis, lc, mapSVG, named, nbhd, pctOrd, pctRank, rho, sorted, strength, vals } from "./explorer-core.js";

const THIRDS = ["#9ec5f4", "#2a78d6", "#0d366b"];
// the eight combinations, indexed by 4 (A high) + 2 (B high) + 1 (C high)
const COMBO = ["#e4e4e0", "#a6cee3", "#b2df8a", "#33a02c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"];
const M = (k) => S.cur[k];

// ---- 1. the three pairs ----------------------------------------------------------------------------------
function mini(k0, k1) {
  const xs = vals(k0), ys = vals(k1), px = pctRank(xs), py = pctRank(ys), r = rho(xs, ys);
  const dots = nbhd.map((n, i) => (px[i] == null || py[i] == null ? "" : `<circle cx="${px[i].toFixed(1)}" cy="${(100 - py[i]).toFixed(1)}" r="${i === S.nb ? 3.2 : 1.6}" fill="${i === S.nb ? ORANGE : COLORS[3]}" opacity="${i === S.nb ? 1 : 0.6}"/>`)).join("");
  return `<figure class="th-mini"><svg viewBox="-3 -3 106 106" role="img" aria-label="${escapeHTML(`${M(k0).d.short} against ${M(k1).d.short}, in ranks`)}"><rect x="0" y="0" width="100" height="100" fill="none" stroke="#c9c9c3"/>${dots}</svg>
    <figcaption><b>${fmtR(r)}</b> ${escapeHTML(M(k0).d.short)} <span class="th-vs">against</span> ${escapeHTML(M(k1).d.short)}</figcaption></figure>`;
}
function renderPairs() {
  $("th-pairs").innerHTML = mini(0, 1) + mini(0, 2) + mini(1, 2);
  const r = [rho(vals(0), vals(1)), rho(vals(0), vals(2)), rho(vals(1), vals(2))];
  const names = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => `${lc(M(a).d.short)} and ${lc(M(b).d.short)}`);
  const k = r.map((v, i) => [Math.abs(v ?? 0), i]).sort((p, q) => q[0] - p[0]);
  $("th-pairs-lede").innerHTML = `The three measures two at a time, each plotted in ranks (percentiles) so that all three panels share a scale; the figure is the Spearman rank correlation. The closest pair is ${escapeHTML(names[k[0][1]])} (<b>${fmtR(r[k[0][1]])}</b>, ${strength(r[k[0][1]])}); the loosest is ${escapeHTML(names[k[2][1]])} (<b>${fmtR(r[k[2][1]])}</b>).`;
}

// ---- 2. the first against the second, coloured by thirds of the third ----------------------------------------
function renderScatter() {
  const a = M(0), b = M(1), c = M(2), xs = vals(0), ys = vals(1), zs = vals(2), z3 = breaks(zs, 3);
  const third = (i) => (zs[i] == null ? null : cls(z3.edges, zs[i]));
  const s = scatter({ xs, ys, fit: fitLine(xs, ys), pick: S.nb, zeroX: false, zeroY: false, fx: (v) => fmtAxis(a.d, v), fy: (v) => fmtAxis(b.d, v),
    xLabel: escapeHTML(named(a)), yLabel: escapeHTML(named(b)), mark: (i) => (third(i) == null ? " cn" : ` c${third(i)}`),
    tip: (i) => `${nbhd[i].name}<br>${a.d.short}: <b>${fmt(a.d, xs[i])}</b><br>${b.d.short}: <b>${fmt(b.d, ys[i])}</b><br>${c.d.short}: <b>${fmt(c.d, zs[i])}</b>` });
  $("th-scatter").innerHTML = s.html;
  const labels = rangeLabels(z3.edges, z3.zero, (v) => fmtAxis(c.d, v));
  const within = [0, 1, 2].map((t) => rho(xs.map((v, i) => (third(i) === t ? v : null)), ys));
  $("th-scatter-key").innerHTML = labels.map((l, t) => `<li><span class="key-dot" style="background:${THIRDS[t]}"></span>${escapeHTML(c.d.short)} ${escapeHTML(l)}: ${within[t] == null ? "too few to say" : `Spearman <b>${fmtR(within[t])}</b>`}</li>`).join("")
    + (zs.some((v) => v == null) ? `<li><span class="key-dot" style="background:#c9c9c3"></span>No ${escapeHTML(lc(c.d.short))} figure</li>` : "");
  // the first two with the third held fixed (partial rank correlation), over the neighbourhoods with all three
  const all = (vs) => vs.map((v, i) => (xs[i] == null || ys[i] == null || zs[i] == null ? null : v));
  const rab = rho(all(xs), all(ys)), rac = rho(all(xs), all(zs)), rbc = rho(all(ys), all(zs));
  const part = rab == null || rac == null || rbc == null ? null : (rab - rac * rbc) / Math.sqrt((1 - rac ** 2) * (1 - rbc ** 2));
  $("th-scatter-lede").innerHTML = part == null ? "Too few neighbourhoods have all three figures." : `${escapeHTML(a.d.short)} against ${escapeHTML(lc(b.d.short))}, with each neighbourhood coloured by its third of ${escapeHTML(lc(c.d.short))}. Over all of them the two go together at Spearman <b>${fmtR(rab)}</b>; holding ${escapeHTML(lc(c.d.short))} fixed (the partial rank correlation) it is <b>${fmtR(part)}</b>. ${Math.abs(part) < Math.abs(rab) * 0.6 ? `Much of the link between the first two runs through ${escapeHTML(lc(c.d.short))}: among neighbourhoods alike on it, they go together much less.` : Math.abs(part) < Math.abs(rab) * 0.85 ? `Part of the link runs through ${escapeHTML(lc(c.d.short))}, but most of it holds among neighbourhoods alike on it.` : Math.abs(part) > Math.abs(rab) * 1.15 ? `${escapeHTML(c.d.short)} was masking part of the link: among neighbourhoods alike on it, the first two go together more closely.` : `The link holds up among neighbourhoods alike on ${escapeHTML(lc(c.d.short))}, so it isn't just the third measure showing through.`} The correlation within each third is beside its colour.`;
}

// ---- 3. three small maps --------------------------------------------------------------------------------------
function renderMaps() {
  $("th-maps").innerHTML = [0, 1, 2].map((k) => {
    const m = M(k), vs = vals(k), b = breaks(vs), pal = COLORS.slice(COLORS.length - b.edges.length - 1);
    const key = rangeLabels(b.edges, b.zero, (v) => fmtAxis(m.d, v));
    return `<figure class="th-map"><figcaption>${escapeHTML(named(m))}</figcaption><div class="nb-map">${mapSVG((i) => (vs[i] == null ? null : pal[cls(b.edges, vs[i])]),
      (i) => `${nbhd[i].name}<br>${m.d.short}: <b>${fmt(m.d, vs[i])}</b>`, `Map of ${named(m)}`)}</div>
      <p class="th-map-key"><span>${escapeHTML(key[0])}</span>${pal.map((c) => `<i style="background:${c}"></i>`).join("")}<span>${escapeHTML(key.at(-1))}</span></p></figure>`;
  }).join("");
}

// ---- 4. a neighbourhood's profile -----------------------------------------------------------------------------
function renderProfile() {
  if (S.nb == null) {
    $("th-profile").innerHTML = "";
    $("th-profile-lede").textContent = "Pick a neighbourhood on a map, a dot or a list to see where it stands on each of the three.";
    return;
  }
  const i = S.nb;
  $("th-profile").innerHTML = [0, 1, 2].map((k) => {
    const m = M(k), vs = vals(k), p = pctRank(vs)[i];
    return `<li><span class="cl-name">${escapeHTML(m.d.short)}<span class="ex-src">${escapeHTML(m.d.periods[m.p])}</span></span>
      <span class="th-track"><span class="th-mid"></span>${p == null ? "" : `<span class="th-dot" style="left:${p}%"></span>`}</span>
      <span class="cl-val th-val">${vs[i] == null ? "no figure" : `${fmt(m.d, vs[i])} · ${pctOrd(p)}`}</span></li>`;
  }).join("");
  $("th-profile-lede").innerHTML = `<b>${escapeHTML(nbhd[i].name)}</b> on each measure: its figure and its percentile among the neighbourhoods (the 50th is the median, marked).`;
}

// ---- 5. the eight combinations --------------------------------------------------------------------------------
function renderCombos() {
  const med = [0, 1, 2].map((k) => quantile(sorted(vals(k)), 0.5));
  const code = nbhd.map((_, i) => ([0, 1, 2].some((k) => vals(k)[i] == null) ? null : (vals(0)[i] > med[0] ? 4 : 0) + (vals(1)[i] > med[1] ? 2 : 0) + (vals(2)[i] > med[2] ? 1 : 0)));
  const name = (c) => [4, 2, 1].map((bit, k) => `${c & bit ? "High" : "Low"} ${lc(M(k).d.short)}`).join(" · ");
  const cells = (c) => [4, 2, 1].map((bit) => `<td class="th-hl ${c & bit ? "hi" : "lo"}">${c & bit ? "High" : "Low"}</td>`).join("");
  $("th-combo-map").innerHTML = mapSVG((i) => (code[i] == null ? null : COMBO[code[i]]),
    (i) => `${nbhd[i].name}<br>${code[i] == null ? "No figure on one of the three" : name(code[i])}`, "Map of the neighbourhoods by their combination of the three measures");
  const groups = [7, 6, 5, 4, 3, 2, 1, 0].map((c) => ({ c, idx: [...nbhd.keys()].filter((i) => code[i] === c) }));
  const total = groups.reduce((s, g) => s + g.idx.length, 0);
  $("th-combo").innerHTML = `<thead><tr><th></th>${[0, 1, 2].map((k) => `<th class="th-hl">${escapeHTML(M(k).d.short)}</th>`).join("")}<th>Neighbourhoods</th><th class="txt">For example</th></tr></thead><tbody>${groups.map(({ c, idx }) => `<tr><th><span class="key-sq" style="background:${COMBO[c]}"></span></th>${cells(c)}<td>${idx.length}</td>
      <td class="txt th-eg">${idx.slice(0, 3).map((i) => `<button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button>`).join(", ") || "—"}</td></tr>`).join("")}</tbody>`;
  const big = groups.reduce((p, q) => (q.idx.length > p.idx.length ? q : p)), even = total / 8;
  $("th-combo-lede").innerHTML = `Each neighbourhood is above or below the median on each measure, which makes eight combinations. If the three were unrelated each would hold about ${Math.round(even)} of the ${total} neighbourhoods with all three figures; the commonest here is <b>${escapeHTML(name(big.c))}</b>, with ${big.idx.length}.${total < N ? ` ${N - total} lack a figure on one of the three.` : ""}`;
}

export function renderThree() {
  renderPairs();
  renderScatter();
  renderMaps();
  renderProfile();
  renderCombos();
}
