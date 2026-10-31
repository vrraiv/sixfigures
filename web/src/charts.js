// Shared by the Insights pages (insights.js, schools.js): the tooltip, segmented
// controls, quantiles and correlations, and the correlation colours.
import { $, DIVERGING } from "./catalogue.js";

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
