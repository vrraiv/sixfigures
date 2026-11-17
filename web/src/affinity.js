// How alike two neighbourhoods are, from web/public/neighbourhoods.json's percentile ranks: shared by
// the Neighbourhood Explorer (neighbourhoods.js, which explains the method) and the neighbourhood
// pages the build writes (scripts/nbhd-pages.mjs), so both name the same closest matches. No DOM.
//   gap on a theme   the mean gap in percentile rank over the theme's measures both have a figure for
//   overall gap      the mean of the theme gaps, over the themes counted
//   affinity         100 less the gap

// G[theme][i * N + j]: two neighbourhoods' gap on each theme, NaN where they share no measure of it.
export function themeGaps(D) {
  const N = D.nbhd.length, M = Object.fromEntries(D.measures.map((m) => [m.id, m])), G = {};
  for (const t of D.themes) {
    const g = new Float32Array(N * N), cols = t.measures.map((id) => M[id].pct);
    for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
      let s = 0, n = 0;
      for (const p of cols) if (p[i] != null && p[j] != null) { s += Math.abs(p[i] - p[j]); n++; }
      g[i * N + j] = g[j * N + i] = n ? s / n : NaN;
    }
    G[t.key] = g;
  }
  return G;
}

// The overall gap over the themes counted (a list of theme gaps), written into `out`.
export function overallGaps(gs, out) {
  for (let k = 0; k < out.length; k++) {
    let s = 0, n = 0;
    for (const g of gs) if (!Number.isNaN(g[k])) { s += g[k]; n++; }
    out[k] = n ? s / n : NaN;
  }
  return out;
}
