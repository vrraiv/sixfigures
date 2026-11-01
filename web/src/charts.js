// Shared by the Insights pages (insights.js, schools.js, housing.js, prices.js): the tooltip,
// segmented controls, quantiles and correlations, the correlation colours, picking a
// neighbourhood, and the small bar-and-line charts and sparklines.
import { $, COLORS, DIVERGING, escapeHTML } from "./catalogue.js";

// ---- tooltip shared by every chart: any element with data-tip -----------------
export function initTip() {
  const tip = $("tip");
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) return;
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener("pointermove", (e) => {
    if (tip.hidden) return;
    const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(e.clientX + pad, innerWidth - w - 8), y = e.clientY - h - pad < 8 ? e.clientY + pad : e.clientY - h - pad;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest?.("[data-tip]") && !e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true;
  });
}

// ---- segmented controls ---------------------------------------------------------
export function seg(el, items, current, onPick) {
  el.innerHTML = items.map(([key, label]) => `<button type="button" data-k="${key}" aria-pressed="${key === current}">${label}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (b) onPick(b.dataset.k);
  };
}

export const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// ---- correlations ------------------------------------------------------------------
export function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let k = 0; k < order.length;) {
    let j = k;
    while (j + 1 < order.length && order[j + 1][0] === order[k][0]) j++;
    for (let q = k; q <= j; q++) r[order[q][1]] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return r;
}
// Pearson correlation of the pairs where both are known; null under `min` pairs.
export function pearson(a, b, min = 30) {
  const idx = a.map((_, i) => i).filter((i) => a[i] != null && b[i] != null);
  if (idx.length < min) return null;
  const n = idx.length;
  const ma = idx.reduce((s, i) => s + a[i], 0) / n, mb = idx.reduce((s, i) => s + b[i], 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (const i of idx) {
    sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2;
  }
  return { r: sab / Math.sqrt(saa * sbb), n };
}
// Spearman rank correlation: Pearson on the ranks.
export function spearman(a, b) {
  const idx = a.map((_, i) => i).filter((i) => a[i] != null && b[i] != null);
  if (idx.length < 30) return null;
  return pearson(ranks(idx.map((i) => a[i])), ranks(idx.map((i) => b[i])));
}
// Seven classes on the site's diverging ramp: negative red, positive blue.
export const R_EDGES = [-0.6, -0.3, -0.1, 0.1, 0.3, 0.6];
export const rColor = (r) => DIVERGING[R_EDGES.filter((e) => r >= e).length];
export const fmtR = (r) => (r == null ? "—" : `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`);

// ---- a neighbourhood picked from a list or the map ------------------------------
// Anything with data-nb (a neighbourhood's index) picks it: the page's map outlines it and
// the bar beneath shows its figures; a click on the map picks or clears. The map's paths
// carry data-i; call the returned mark() after each redraw.
export function initPick(fig, bar, get, set, extra = () => "") {
  const mark = () => {
    const i = get(), p = i == null ? null : fig.querySelector(`path[data-i="${i}"]`);
    fig.classList.toggle("has-pick", !!p);
    if (p) {
      p.classList.add("pick");
      p.parentNode.append(p); // drawn last, so its outline is on top
    }
    bar.hidden = !p;
    bar.innerHTML = p ? `<span>${p.dataset.tip.replaceAll("<br>", " · ")}</span>${extra(i)}<button type="button" class="nb-clear">Clear</button>` : "";
  };
  const pick = (i, scroll) => {
    fig.querySelector("path.pick")?.classList.remove("pick");
    set(i);
    mark();
    if (scroll && i != null) fig.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-nb]"), p = e.target.closest("path[data-i]");
    if (a) pick(+a.dataset.nb, true);
    else if (p && fig.contains(p)) pick(get() === +p.dataset.i ? null : +p.dataset.i, false);
    else if (e.target.closest(".nb-clear")) pick(null, false);
  });
  return mark;
}

// ---- small chart kit: bars and lines over years ----------------------------------------
// Marks live in a 0-100 SVG box stretched to the chart; labels and hover targets are
// HTML so they keep their size. series: [{name, color, values, neg?}]; bars stack.
function yTicks(lo, hi, fmt) {
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return { ticks, fmt };
}
export function chart({ labels, bars = [], lines = [], fmt, tipLabel = (l) => l, height = 170, zero = true, partialFrom = null }) {
  const n = labels.length;
  const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
  const stackTop = labels.map((_, k) => sum(bars.filter((s) => !s.neg).map((s) => s.values[k])));
  const stackBot = labels.map((_, k) => -sum(bars.filter((s) => s.neg).map((s) => s.values[k])));
  const lineVals = lines.flatMap((s) => s.values.filter((v) => v != null));
  const barVals = bars.length ? [...stackTop, ...stackBot] : [];
  let hi = Math.max(...barVals, ...lineVals), lo = Math.min(...barVals, ...lineVals);
  if (zero) { hi = Math.max(hi, 0); lo = Math.min(lo, 0); }
  else { const pad = (hi - lo) * 0.08; hi += pad; lo -= pad; }
  const { ticks } = yTicks(lo, hi);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1));
  const y = (v) => 100 - ((v - lo) / (hi - lo || 1)) * 100, bw = 100 / n, x = (k) => (k + 0.5) * bw;
  let svg = "";
  labels.forEach((l, k) => {
    let up = 0, down = 0;
    for (const s of bars) {
      const v = s.values[k] ?? 0;
      if (!v) continue;
      const [a, b] = s.neg ? [-down, -(down += v)] : [up, (up += v)];
      svg += `<rect x="${(k * bw + bw * 0.12).toFixed(2)}" width="${(bw * 0.76).toFixed(2)}" y="${y(Math.max(a, b)).toFixed(2)}" height="${Math.abs(y(a) - y(b)).toFixed(2)}" fill="${s.color}"${partialFrom != null && k >= partialFrom ? ' opacity="0.45"' : ""}/>`;
    }
  });
  for (const s of lines) {
    const pts = s.values.map((v, k) => (v == null ? null : `${x(k).toFixed(2)},${y(v).toFixed(2)}`));
    const runs = [[]];
    pts.forEach((p) => (p ? runs.at(-1).push(p) : runs.push([])));
    svg += runs.filter((r) => r.length).map((r) => `<polyline points="${r.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke"${s.dash ? ' stroke-dasharray="4 3"' : ""}/>`).join("");
  }
  const tips = labels.map((l, k) => {
    const rows = [...bars, ...lines].filter((s) => s.values[k] != null).map((s) => `${s.name}: <b>${fmt(s.values[k])}</b>`).join("<br>");
    return `<span class="ch-hit" style="left:${k * bw}%;width:${bw}%" data-tip="${escapeHTML(`${tipLabel(l)}<br>${rows}`)}"></span>`;
  }).join("");
  const yt = ticks.map((v) => `<span class="sc-ytick" style="bottom:${100 - y(v)}%">${fmt(v)}</span><span class="sc-gy" style="bottom:${100 - y(v)}%"></span>`).join("");
  const every = Math.ceil(n / (String(labels[0]).length > 4 ? 5 : 8)); // month labels are wider
  // every `every`th label, and the last, unless it would crowd the one before
  const xt = labels.map((l, k) => ((k % every === 0 && n - 1 - k >= every * 0.6) || k === n - 1 ? `<span style="left:${x(k)}%">${l}</span>` : "")).join("");
  const zeroLine = lo < 0 ? `<span class="ch-zero" style="bottom:${100 - y(0)}%"></span>` : "";
  return `<div class="ch-box" style="height:${height}px">${yt}${zeroLine}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>${tips}</div><div class="ch-xticks">${xt}</div>`;
}
export const key = (items) => `<ul class="year-key">${items.map(([name, color, kind]) => `<li><span class="${kind === "line" ? "key-line" : "key-sq"}" style="background:${color}"></span>${name}</li>`).join("")}</ul>`;

// A sparkline: the series' line and its last point.
export function spark(vals, labels) {
  const W = 120, H = 34, px = 6, py = 6, vs = vals.filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (k) => px + (k * (W - 2 * px)) / (vals.length - 1), y = (v) => H - py - ((v - lo) / span) * (H - 2 * py);
  const pts = vals.map((v, k) => (v == null ? "" : `${x(k).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const k = vals.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${COLORS[2]}" stroke-width="2" stroke-linejoin="round"/>`
    + `<circle cx="${x(k)}" cy="${y(vals[k])}" r="4" fill="${COLORS[4]}" stroke="#fcfcfb" stroke-width="2"/></svg>`;
}
