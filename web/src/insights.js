// The Insights page: the city's figures in each census, the highest and lowest
// of the 158 neighbourhoods, and the biggest changes between censuses. Charts are
// inline SVG and HTML; the figures come from insights.json (pipeline/insights.py).
import "./style.css";
import { $, COLORS, DIVERGING, GROUPS, MEASURES, escapeHTML, fmtMoney, fmtPct, isMoney, ordinal } from "./catalogue.js";

const data = await fetch(`/insights.json?v=${__INSIGHTS_VERSION__}`).then((r) => r.json());
const YEARS = data.years; // ["2011", "2016", "2021"]
const PAIRS = [["2011", "2016"], ["2016", "2021"], ["2011", "2021"]];
const GROUP_NAMES = { income: "Income", low: "Low income and transfers", housing: "Housing", costs: "Housing costs and values", dwellings: "Dwellings", people: "People" };
const RISE = DIVERGING[5], FALL = DIVERGING[1], INK3 = "#75756f";
const nbhd = data.nbhd;
const measures = Object.keys(MEASURES).filter((m) => m in data.measures);

// ---- state, kept in the address -----------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const state = {
  m: measures.includes(hash.get("m")) ? hash.get("m") : "med_hh_tot",
  year: YEARS.includes(hash.get("y")) ? hash.get("y") : "2021",
  pair: PAIRS.find((p) => p.join("-") === hash.get("p")) ?? PAIRS[1],
  real: hash.get("real") === "1",
  spreadReal: hash.get("sr") !== "0",
  corrYear: YEARS.includes(hash.get("cy")) ? hash.get("cy") : "2021",
  shiftPair: PAIRS.find((p) => p.join("-") === hash.get("sp")) ?? PAIRS[1],
  shiftOnly: false,
  sx: measures.includes(hash.get("sx")) ? hash.get("sx") : null,
  sy: measures.includes(hash.get("sy")) ? hash.get("sy") : null,
};
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, y: state.year, p: state.pair.join("-"), cy: state.corrYear, sp: state.shiftPair.join("-") });
  if (state.sx && state.sy) { h.set("sx", state.sx); h.set("sy", state.sy); }
  if (!state.spreadReal) h.set("sr", "0");
  if (state.real) h.set("real", "1");
  history.replaceState(null, "", `#${h}`);
};

// ---- figures ---------------------------------------------------------------
// The year a census's figure refers to: income measures are for the year before.
const refYear = (m, y) => (MEASURES[m].dated === "census" ? y : data.income_years[y]);
// A dollar figure from census y restated in census `to`'s dollars (Toronto CPI).
const restate = (m, v, y, to) => (v == null || !isMoney(m) ? v : v * (data.cpi[refYear(m, to)] / data.cpi[refYear(m, y)]));
const val = (m, y) => data.measures[m].values[y];
const city = (m, y) => data.measures[m].city[y];
const source = (m, y) => (y === "2011" ? (data.measures[m].source["2011"] === "nhs" ? "2011 NHS" : "2011 Census") : `${y} Census`);
const yearLabel = (m, y) => (refYear(m, y) === y ? `${y} Census` : `${refYear(m, y)} (${source(m, y)})`);

const fmt = (m, v) => (v == null ? "—" : isMoney(m) ? fmtMoney(Math.round(v)) : fmtPct(v));
const fmtShort = (m, v) => {
  if (!isMoney(m)) return `${+v.toFixed(1)}%`;
  if (MEASURES[m].monthly) return `$${Math.round(v).toLocaleString("en-CA")}`;
  return Math.abs(v) >= 1e6 ? `$${(v / 1e6).toLocaleString("en-CA", { maximumFractionDigits: 2 })}M` : `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
};
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
// A change: whole dollars, or percentage points to one decimal; short for lists.
const fmtChange = (m, d) => (d == null ? "—" : isMoney(m) ? `${sign(Math.round(d))}${fmtMoney(Math.abs(Math.round(d)))}` : `${sign(+d.toFixed(1))}${Math.abs(d).toFixed(1)} pp`);
const fmtChangeShort = (m, d) => (isMoney(m) ? `${sign(Math.round(d))}${fmtShort(m, Math.abs(d))}` : fmtChange(m, d));
const mapLink = (m, y, i) => {
  const [lat, lng] = nbhd[i].at;
  const at = `at=13/${lat}/${lng}`;
  return y === "2011" ? `/2011/#m=${m}&${at}` : `/#m=${m}&y=${y}&${at}&o=nbhd`;
};

// ---- tooltip shared by every chart: any element with data-tip -----------------
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

// ---- measure menu -------------------------------------------------------------
const select = $("measure");
for (const g of Object.keys(GROUPS)) {
  const og = document.createElement("optgroup");
  og.label = GROUP_NAMES[g];
  og.innerHTML = measures.filter((m) => MEASURES[m].group === g).map((m) => `<option value="${m}">${escapeHTML(MEASURES[m].long)}</option>`).join("");
  select.append(og);
}
select.value = state.m;
select.addEventListener("change", () => setMeasure(select.value));

function setMeasure(m) {
  state.m = m;
  select.value = m;
  renderCards();
  renderRanks();
  renderChanges();
  renderSpread();
  state.sx = state.sy = null; // the scatter follows the new measure
  renderCorr();
  renderShift();
  renderGap();
  writeHash();
}

// ---- 1. the city at a glance ----------------------------------------------------
function sparkline(m) {
  const W = 120, H = 34, px = 6, py = 6;
  const vs = YEARS.map((y) => (state.real ? restate(m, city(m, y), y, "2021") : city(m, y)));
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => px + (i * (W - 2 * px)) / (YEARS.length - 1);
  const y = (v) => (hi === lo ? H / 2 : H - py - ((v - lo) / span) * (H - 2 * py));
  const pts = vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = vs.map((v, i) => {
    const last = i === vs.length - 1;
    const t = `${yearLabel(m, YEARS[i])}: <b>${fmt(m, v)}</b>${state.real && isMoney(m) && YEARS[i] !== "2021" ? ` in ${refYear(m, "2021")} dollars` : ""}`;
    return `<circle cx="${x(i)}" cy="${y(v)}" r="${last ? 4 : 3}" fill="${last ? COLORS[4] : COLORS[2]}" stroke="#fcfcfb" stroke-width="2"/>`
      + `<circle cx="${x(i)}" cy="${y(v)}" r="11" fill="transparent" data-tip="${escapeHTML(t)}"/>`;
  }).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${COLORS[2]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

function renderCards() {
  const html = Object.keys(GROUPS).map((g) => {
    const cards = measures.filter((m) => MEASURES[m].group === g).map((m) => {
      const now = city(m, "2021");
      // The toggle sets both the sparkline and the change: as published, or in 2021 terms.
      const real = state.real && isMoney(m);
      const d = now - (real ? restate(m, city(m, "2016"), "2016", "2021") : city(m, "2016"));
      const change = `<span class="card-delta">${fmtChange(m, d)} since ${refYear(m, "2016")}${real ? ", after inflation" : ""}</span>`;
      const years = YEARS.map((y) => refYear(m, y));
      const aria = `${MEASURES[m].long}: ${YEARS.map((y) => `${refYear(m, y)} ${fmt(m, city(m, y))}`).join(", ")}`;
      return `<button type="button" class="card" data-m="${m}" aria-pressed="${m === state.m}" aria-label="${escapeHTML(aria)}">
        <span class="card-name">${escapeHTML(MEASURES[m].short)}</span>
        <span class="card-value">${fmt(m, now)}</span>
        ${sparkline(m)}
        <span class="card-years"><span>${years[0]}</span><span>${years[2]}</span></span>
        ${change}
      </button>`;
    }).join("");
    return `<div class="card-group"><h3>${GROUP_NAMES[g]}</h3><div class="card-row">${cards}</div></div>`;
  }).join("");
  $("cards").innerHTML = html;
}
$("cards").addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  setMeasure(c.dataset.m);
  $("measure-bar").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("real").checked = state.real;
$("real").addEventListener("change", (e) => {
  state.real = e.target.checked;
  renderCards();
  writeHash();
});

// ---- segmented controls ---------------------------------------------------------
function seg(el, items, current, onPick) {
  el.innerHTML = items.map(([key, label]) => `<button type="button" data-k="${key}" aria-pressed="${key === current}">${label}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (b) onPick(b.dataset.k);
  };
}

// ---- 2. highest and lowest --------------------------------------------------------
// Rank 1 = highest. Neighbourhoods without a figure are left out.
function ranking(m, y) {
  const v = val(m, y);
  const order = nbhd.map((_, i) => i).filter((i) => v[i] != null).sort((a, b) => v[b] - v[a]);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  return { order, rank, v };
}

function rankRow(m, y, i, r, scale, prev) {
  const v = r.v[i], k = r.rank.get(i), n = r.order.length;
  const w = Math.max(0, (v / scale.max) * 100), c = (city(m, y) / scale.max) * 100;
  let move = "";
  if (prev) {
    const was = prev.rank.get(i);
    const d = was == null ? null : was - k;
    const py = refYear(m, YEARS[YEARS.indexOf(y) - 1]);
    move = d == null ? `<span class="move">new</span>`
      : d === 0 ? `<span class="move" aria-label="same rank as in ${py}">–</span>`
      : `<span class="move" aria-label="${d > 0 ? "up" : "down"} ${Math.abs(d)} from ${py}" data-tip="${escapeHTML(`${ordinal(was)} of ${prev.order.length} in ${py}`)}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  }
  const t = `${escapeHTML(nbhd[i].name)}<br><b>${fmt(m, v)}</b> · ${ordinal(k)} of ${n}<br>City: ${fmt(m, city(m, y))}`;
  return `<li>
    <span class="rk">${k}</span>
    <a class="nm" href="${mapLink(m, y, i)}" title="Show ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</a>
    <span class="barcell" data-tip="${t}"><span class="bar-fill" style="width:${w.toFixed(1)}%"></span><span class="city-mark" style="left:${c.toFixed(1)}%"></span></span>
    <span class="vl">${fmtShort(m, v)}</span>
    ${move}
  </li>`;
}

function renderRanks() {
  const m = state.m, y = state.year;
  seg($("rank-year"), YEARS.map((yy) => [yy, refYear(m, yy) === yy ? yy : `${yy} (${refYear(m, yy)})`]), y, (k) => {
    state.year = k;
    renderRanks();
    writeHash();
  });
  const r = ranking(m, y);
  const i = YEARS.indexOf(y);
  const prev = i > 0 ? ranking(m, YEARS[i - 1]) : null;
  const scale = { max: Math.max(...r.order.map((j) => r.v[j]), city(m, y)) };
  const top = r.order.slice(0, 10), bottom = r.order.slice(-10).reverse();
  $("rank-top").innerHTML = top.map((j) => rankRow(m, y, j, r, scale, prev)).join("");
  $("rank-bottom").innerHTML = bottom.map((j) => rankRow(m, y, j, r, scale, prev)).join("");
  const missing = nbhd.length - r.order.length;
  $("rank-lede").innerHTML = `${escapeHTML(MEASURES[m].long)}, ${yearLabel(m, y)}, ${r.order.length} neighbourhoods${missing ? ` (${missing} without a figure)` : ""}. `
    + `The tick on each bar marks the city (${fmt(m, city(m, y))}).${prev ? ` Arrows: places gained or lost since ${refYear(m, YEARS[i - 1])}.` : ""}`;
}

// ---- 3. biggest changes ----------------------------------------------------------
function changes(m, [a, b]) {
  const va = val(m, a), vb = val(m, b);
  const rows = [];
  nbhd.forEach((_, i) => {
    if (va[i] == null || vb[i] == null) return;
    const before = restate(m, va[i], a, b);
    rows.push({ i, before, after: vb[i], d: vb[i] - before, pct: isMoney(m) ? (vb[i] / before - 1) * 100 : null });
  });
  rows.sort((x, y) => y.d - x.d);
  const cityD = city(m, b) - restate(m, city(m, a), a, b);
  return { rows, cityD };
}

function changeRow(m, pair, row, scale, up) {
  const x = (v) => ((v - scale.lo) / (scale.hi - scale.lo)) * 100;
  const x0 = x(row.before), x1 = x(row.after), left = Math.min(x0, x1), width = Math.abs(x1 - x0);
  const col = up ? RISE : FALL;
  const [a, b] = pair;
  const t = `${escapeHTML(nbhd[row.i].name)}<br>${refYear(m, a)}: ${fmt(m, row.before)}${isMoney(m) ? ` (in ${refYear(m, b)} dollars)` : ""}<br>${refYear(m, b)}: <b>${fmt(m, row.after)}</b><br>Change: ${fmtChange(m, row.d)}${row.pct != null ? ` (${sign(row.pct)}${Math.abs(row.pct).toFixed(1)}%)` : ""}`;
  return `<li>
    <a class="nm" href="${mapLink(m, b, row.i)}" title="Show ${escapeHTML(nbhd[row.i].name)} on the map">${escapeHTML(nbhd[row.i].name)}</a>
    <span class="dumbbell" data-tip="${t}">
      <span class="db-line" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:${col}"></span>
      <span class="db-dot db-from" style="left:${x0.toFixed(1)}%"></span>
      <span class="db-dot" style="left:${x1.toFixed(1)}%;background:${col}"></span>
    </span>
    <span class="vl">${fmtChangeShort(m, row.d)}</span>
  </li>`;
}

function strip(m, pair, { rows, cityD }) {
  const W = 800, H = 140, pad = 4;
  const sorted = [...rows].reverse(); // biggest fall on the left
  const lo = Math.min(0, ...sorted.map((r) => r.d)), hi = Math.max(0, ...sorted.map((r) => r.d));
  const y = (v) => pad + ((hi - v) / (hi - lo || 1)) * (H - 2 * pad);
  const bw = (W - 2 * pad) / sorted.length;
  const bars = sorted.map((r, k) => {
    const y0 = y(0), y1 = y(r.d), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
    const t = `${escapeHTML(nbhd[r.i].name)}<br>${fmtChange(m, r.d)}${r.pct != null ? ` (${sign(r.pct)}${Math.abs(r.pct).toFixed(1)}%)` : ""}`;
    return `<rect x="${(pad + k * bw + 0.5).toFixed(2)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(2)}" height="${h.toFixed(1)}" fill="${r.d >= 0 ? RISE : FALL}"/>`
      + `<rect x="${(pad + k * bw).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${H}" fill="transparent" data-tip="${t}"/>`;
  }).join("");
  const cy = y(cityD);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(`Change in each of ${rows.length} neighbourhoods, sorted from the biggest fall to the biggest rise. The city changed by ${fmtChange(m, cityD)}.`)}">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#c9c9c3" stroke-width="1" vector-effect="non-scaling-stroke"/>
    ${bars}
    <line x1="0" x2="${W}" y1="${cy}" y2="${cy}" stroke="#1a1a19" stroke-width="1" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function renderChanges() {
  const m = state.m;
  seg($("change-pair"), PAIRS.map((p) => [p.join("-"), `${refYear(m, p[0])}–${refYear(m, p[1])}`]), state.pair.join("-"), (k) => {
    state.pair = PAIRS.find((p) => p.join("-") === k);
    renderChanges();
    writeHash();
  });
  const pair = state.pair, [a, b] = pair;
  const c = changes(m, pair);
  const up = c.rows.slice(0, 10).filter((r) => r.d > 0), down = c.rows.slice(-10).reverse().filter((r) => r.d < 0);
  const shown = [...up, ...down];
  const lo = Math.min(...shown.map((r) => Math.min(r.before, r.after))), hi = Math.max(...shown.map((r) => Math.max(r.before, r.after)));
  const scale = { lo: lo - (hi - lo) * 0.04, hi: hi + (hi - lo) * 0.04 };
  $("change-up").innerHTML = up.map((r) => changeRow(m, pair, r, scale, true)).join("") || `<li class="none">No neighbourhood rose.</li>`;
  $("change-down").innerHTML = down.map((r) => changeRow(m, pair, r, scale, false)).join("") || `<li class="none">No neighbourhood fell.</li>`;
  const unit = isMoney(m) ? `, ${refYear(m, a)} figures in ${refYear(m, b)} dollars` : ", in percentage points";
  $("change-lede").innerHTML = `${escapeHTML(MEASURES[m].long)}, ${source(m, a)} to ${source(m, b)}${unit}. `
    + `Each row runs from the earlier figure (open dot) to the later one. The city changed by ${fmtChange(m, c.cityD)}.`;
  $("strip").innerHTML = strip(m, pair, c);
  const rose = c.rows.filter((r) => r.d > 0).length, fell = c.rows.filter((r) => r.d < 0).length;
  $("strip-caption").innerHTML = `All ${c.rows.length} neighbourhoods with figures in both censuses, from the biggest fall to the biggest rise: ${rose} rose, ${fell} fell. The dark line marks the city's change.`;
}

// ---- sections 4-7 share: the three censuses as one light-to-dark blue ramp ----------
// (validated as an ordinal palette: one hue, monotone lightness, visible steps)
const YEAR_COLOR = { 2011: "#7aa9e6", 2016: "#2a78d6", 2021: "#0d366b" };
const yearKey = (el, label = (y) => y) => {
  el.innerHTML = YEARS.map((y) => `<li><span class="key-dot" style="background:${YEAR_COLOR[y]}"></span>${label(y)}</li>`).join("");
};
const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const shortName = (m) => MEASURES[m].short;

// ---- 4. how the neighbourhoods spread out ---------------------------------------------
// One row per census: a dot per neighbourhood, a bar over the middle 80% (10th to
// 90th percentile) and a tick at the median. Positions are percentages, so text
// stays legible at any width.
function renderSpread() {
  const m = state.m, money = isMoney(m), real = money && state.spreadReal;
  $("spread-real-wrap").hidden = !money;
  const f = (y) => (real ? data.cpi[refYear(m, "2021")] / data.cpi[refYear(m, y)] : 1);
  const rows = YEARS.map((y) => {
    const pts = val(m, y).map((v, i) => (v == null ? null : { i, v: v * f(y) })).filter(Boolean);
    const s = pts.map((p) => p.v).sort((a, b) => a - b);
    return { y, pts, n: s.length, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  });
  const all = rows.flatMap((r) => r.pts.map((p) => p.v)).sort((a, b) => a - b);
  // A few very high neighbourhoods (Bridle Path's dwelling value) would squash the
  // rest: the axis ends at the 99th percentile and they sit on its edge.
  const lo = Math.min(0, all[0]), hi = quantile(all, 0.99);
  const x = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const jitter = (i) => ((i * 2654435761) % 1000) / 1000; // stable per neighbourhood
  const html = rows.map((r) => {
    const dots = r.pts.map((p) => {
      const t = `${escapeHTML(nbhd[p.i].name)}<br>${refYear(m, r.y)}: <b>${fmt(m, p.v)}</b>${real && r.y !== "2021" ? ` in ${refYear(m, "2021")} dollars` : ""}`;
      return `<span class="sp-dot" style="left:${x(p.v).toFixed(2)}%;top:${(4 + jitter(p.i) * 22).toFixed(1)}px;background:${YEAR_COLOR[r.y]}" data-tip="${t}"></span>`;
    }).join("");
    const t = `${yearLabel(m, r.y)}, ${r.n} neighbourhoods<br>10th percentile ${fmt(m, r.p10)} · median <b>${fmt(m, r.p50)}</b> · 90th ${fmt(m, r.p90)}`;
    return `<div class="sp-row">
      <span class="sp-year">${refYear(m, r.y)}</span>
      <div class="sp-plot">${dots}
        <span class="sp-range" style="left:${x(r.p10).toFixed(2)}%;width:${(x(r.p90) - x(r.p10)).toFixed(2)}%;background:${YEAR_COLOR[r.y]}" data-tip="${t}"></span>
        <span class="sp-median" style="left:${x(r.p50).toFixed(2)}%" data-tip="${t}"></span>
      </div>
      <span class="sp-stat">${fmtShort(m, r.p50)}</span>
    </div>`;
  }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((q) => lo + q * (hi - lo));
  $("spread").innerHTML = html + `<div class="sp-axis"><span class="sp-year"></span><div class="sp-ticks">${ticks.map((v, k) => `<span style="left:${k * 25}%">${fmtShort(m, v)}${k === 4 ? "+" : ""}</span>`).join("")}</div><span class="sp-stat">median</span></div>`;
  $("spread-lede").innerHTML = `${escapeHTML(MEASURES[m].long)}${real ? `, earlier censuses in ${refYear(m, "2021")} dollars` : ", as published"}. `
    + `Each dot is a neighbourhood; the bar spans the middle 80% of them (10th to 90th percentile) and the dark tick marks the median.`;
  yearKey($("spread-key"), (y) => `${yearLabel(m, y)} · ${rows[YEARS.indexOf(y)].n} neighbourhoods`);
}
$("spread-real").addEventListener("change", (e) => {
  state.spreadReal = e.target.checked;
  renderSpread();
  writeHash();
});

// ---- 5. what goes with what ----------------------------------------------------------
// Spearman rank correlation between two measures across the neighbourhoods with
// both figures in a census.
function ranks(xs) {
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
function spearman(a, b) {
  const idx = a.map((_, i) => i).filter((i) => a[i] != null && b[i] != null);
  if (idx.length < 30) return null;
  const ra = ranks(idx.map((i) => a[i])), rb = ranks(idx.map((i) => b[i]));
  const n = idx.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < n; k++) {
    sab += (ra[k] - ma) * (rb[k] - mb); saa += (ra[k] - ma) ** 2; sbb += (rb[k] - mb) ** 2;
  }
  return { r: sab / Math.sqrt(saa * sbb), n };
}
const corrCache = {};
function corr(y) {
  if (corrCache[y]) return corrCache[y];
  const c = {};
  for (const a of measures) {
    c[a] = {};
    for (const b of measures) c[a][b] = a === b ? { r: 1, n: null } : (c[b]?.[a] ?? spearman(val(a, y), val(b, y)));
  }
  return (corrCache[y] = c);
}
// Seven classes on the site's diverging ramp: negative red, positive blue.
const R_EDGES = [-0.6, -0.3, -0.1, 0.1, 0.3, 0.6];
const rColor = (r) => DIVERGING[R_EDGES.filter((e) => r >= e).length];
const fmtR = (r) => (r == null ? "—" : `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`);

function renderCorr() {
  const y = state.corrYear, c = corr(y), m = state.m;
  seg($("corr-year"), YEARS.map((yy) => [yy, yy]), y, (k) => {
    state.corrYear = k;
    renderCorr();
    writeHash();
  });
  // the grid (wide screens)
  const head = `<span class="cg-corner"></span>` + measures.map((b) => `<span class="cg-col${b === m ? " sel" : ""}"><span>${escapeHTML(shortName(b))}</span></span>`).join("");
  const body = measures.map((a) => `<span class="cg-row${a === m ? " sel" : ""}">${escapeHTML(shortName(a))}</span>` + measures.map((b) => {
    if (a === b) return `<span class="cg-cell cg-self"></span>`; // not "diag": that is the overlay's class
    const v = c[a][b];
    if (!v) return `<span class="cg-cell none" data-tip="${escapeHTML(`${shortName(a)} and ${shortName(b)}, ${y}: too few neighbourhoods with both`)}"></span>`;
    const t = `${escapeHTML(MEASURES[a].long)}<br>and ${escapeHTML(MEASURES[b].long)}<br>${y}: <b>${fmtR(v.r)}</b> across ${v.n} neighbourhoods`;
    return `<button type="button" class="cg-cell${a === m || b === m ? " hl" : ""}${a === state.sx && b === state.sy ? " pick" : ""}" style="background:${rColor(v.r)}" data-a="${a}" data-b="${b}" data-tip="${t}" aria-label="${escapeHTML(`${shortName(a)} and ${shortName(b)}: ${fmtR(v.r)}`)}"></button>`;
  }).join("")).join("");
  $("corr-grid").innerHTML = head + body;
  // the list (narrow screens): the selected measure against the other 26
  const others = measures.filter((b) => b !== m && c[m][b]).sort((p, q) => c[m][q].r - c[m][p].r);
  $("corr-list").innerHTML = others.map((b) => {
    const r = c[m][b].r, w = Math.abs(r) * 50;
    return `<li><button type="button" data-a="${m}" data-b="${b}" class="${b === state.sy && m === state.sx ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(shortName(b))}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? `left:50%` : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  }).join("");
  $("corr-key").innerHTML = DIVERGING.map((col, k) => {
    const lo = k ? R_EDGES[k - 1] : -1, hi = k < R_EDGES.length ? R_EDGES[k] : 1;
    return `<li><span class="key-sq" style="background:${col}"></span>${fmtR(lo)} to ${fmtR(hi)}</li>`;
  }).join("");
  $("corr-lede").innerHTML = `How closely each pair of measures rises and falls together across the neighbourhoods in the ${y} census (Spearman rank correlation: 1, the same order; −1, the reverse; 0, unrelated). `
    + `<span class="wide-only">The rows and columns of the selected measure are outlined. </span><span class="narrow-only">Here: ${escapeHTML(MEASURES[m].long.toLowerCase())} against each other measure. </span>Choose a pair to see its neighbourhoods.`;
  renderScatter();
}
// The explorer's axis menus: every measure, grouped as in the measure bar.
for (const id of ["sc-x", "sc-y"]) {
  const sel = $(id);
  for (const g of Object.keys(GROUPS)) {
    const og = document.createElement("optgroup");
    og.label = GROUP_NAMES[g];
    og.innerHTML = measures.filter((m) => MEASURES[m].group === g).map((m) => `<option value="${m}">${escapeHTML(MEASURES[m].long)}</option>`).join("");
    sel.append(og);
  }
  sel.addEventListener("change", () => {
    state[id === "sc-x" ? "sx" : "sy"] = sel.value;
    renderCorr();
    writeHash();
  });
}
$("sc-swap").addEventListener("click", () => {
  [state.sx, state.sy] = [state.sy, state.sx];
  renderCorr();
  writeHash();
});
const pickPair = (e) => {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  state.sx = b.dataset.a;
  state.sy = b.dataset.b;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
};
$("corr-grid").addEventListener("click", pickPair);
$("corr-list").addEventListener("click", pickPair);

function renderScatter() {
  const y = state.corrYear, c = corr(y);
  // Default pair: the selected measure and the measure it moves with most closely.
  if (!state.sx || !state.sy || state.sx === state.sy) {
    const m = state.m;
    // ...from another group: within a group (total and after-tax income) it is trivially close.
    const pool = measures.filter((b) => b !== m && c[m][b]);
    const other = pool.filter((b) => MEASURES[b].group !== MEASURES[m].group);
    const best = (other.length ? other : pool).sort((p, q) => Math.abs(c[m][q].r) - Math.abs(c[m][p].r))[0];
    state.sx = m;
    state.sy = best;
  }
  const a = state.sx, b = state.sy, va = val(a, y), vb = val(b, y), v = c[a][b];
  $("sc-x").value = a;
  $("sc-y").value = b;
  seg($("sc-year"), YEARS.map((yy) => [yy, yy]), y, (k) => {
    state.corrYear = k;
    renderCorr();
    writeHash();
  });
  const idx = nbhd.map((_, i) => i).filter((i) => va[i] != null && vb[i] != null);
  const ext = (vs) => {
    const s = idx.map((i) => vs[i]).sort((p, q) => p - q);
    return [s[0], quantile(s, 0.99)];
  };
  const [xa, xb] = ext(va), [ya, yb] = ext(vb);
  const px = (v_) => Math.min(100, Math.max(0, ((v_ - xa) / (xb - xa || 1)) * 100));
  const py = (v_) => Math.min(100, Math.max(0, ((v_ - ya) / (yb - ya || 1)) * 100));
  const dots = idx.map((i) => {
    const t = `${escapeHTML(nbhd[i].name)}<br>${escapeHTML(shortName(a))}: <b>${fmt(a, va[i])}</b><br>${escapeHTML(shortName(b))}: <b>${fmt(b, vb[i])}</b>`;
    return `<a class="sc-dot" href="${mapLink(a, y, i)}" style="left:${px(va[i]).toFixed(2)}%;bottom:${py(vb[i]).toFixed(2)}%" data-tip="${t}" aria-label="${escapeHTML(nbhd[i].name)}"></a>`;
  }).join("");
  // Gridlines and ticks at quarters of each axis; the top end is the 99th percentile.
  const q = [0, 0.25, 0.5, 0.75, 1];
  const grid = q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("");
  const yt = q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtShort(b, ya + f * (yb - ya))}${f === 1 ? "+" : ""}</span>`).join("");
  const xt = q.map((f) => `<span style="left:${f * 100}%">${fmtShort(a, xa + f * (xb - xa))}${f === 1 ? "+" : ""}</span>`).join("");
  $("scatter").innerHTML = `<div class="sc-y">${escapeHTML(MEASURES[b].long)}, ${refYear(b, y)}</div>
    <div class="sc-box">${grid}${yt}${dots}</div>
    <div class="sc-xticks">${xt}</div>
    <div class="sc-x">${escapeHTML(MEASURES[a].long)}, ${refYear(a, y)}</div>`;
  const stat = a === b ? "the same measure on both axes; pick two different ones" : v ? `correlation <b>${fmtR(v.r)}</b> across ${v.n} neighbourhoods` : "too few neighbourhoods with both";
  $("scatter-caption").innerHTML = `${y} census: ${stat}. `
    + `Each dot is a neighbourhood; open one on the map. Pick any two measures, or choose a cell above.`;
}

// ---- 6. relationships that changed -------------------------------------------------------
function renderShift() {
  const [a, b] = state.shiftPair;
  seg($("shift-pair"), PAIRS.map((p) => [p.join("-"), `${p[0]}–${p[1]}`]), state.shiftPair.join("-"), (k) => {
    state.shiftPair = PAIRS.find((p) => p.join("-") === k);
    renderShift();
    writeHash();
  });
  const ca = corr(a), cb = corr(b), all = YEARS.map((y) => corr(y));
  const rows = [];
  measures.forEach((p, i) => measures.slice(i + 1).forEach((q) => {
    if (state.shiftOnly && p !== state.m && q !== state.m) return;
    const r0 = ca[p][q], r1 = cb[p][q];
    if (r0 && r1) rows.push({ p, q, d: r1.r - r0.r });
  }));
  rows.sort((u, v) => Math.abs(v.d) - Math.abs(u.d));
  const x = (r) => ((r + 1) / 2) * 100;
  $("shift-list").innerHTML = rows.slice(0, 10).map(({ p, q, d }) => {
    const rs = YEARS.map((y, k) => [y, all[k][p][q]?.r]);
    const dots = rs.filter(([, r]) => r != null).map(([y, r]) => `<span class="sh-dot" style="left:${x(r).toFixed(1)}%;background:${YEAR_COLOR[y]}" data-tip="${escapeHTML(`${shortName(p)} and ${shortName(q)}, ${y}: ${fmtR(r)}`)}"></span>`).join("");
    const r0 = ca[p][q].r, r1 = cb[p][q].r;
    return `<li><button type="button" data-a="${p}" data-b="${q}" data-y="${b}">
      <span class="sh-name">${escapeHTML(shortName(p))} <span class="x">and</span> ${escapeHTML(shortName(q))}</span>
      <span class="sh-strip"><span class="sh-zero"></span><span class="sh-move" style="left:${Math.min(x(r0), x(r1)).toFixed(1)}%;width:${Math.abs(x(r1) - x(r0)).toFixed(1)}%"></span>${dots}</span>
      <span class="sh-val">${fmtR(r0)} → ${fmtR(r1)}</span></button></li>`;
  }).join("") || `<li class="none">No pairs to show.</li>`;
  $("shift-lede").innerHTML = `The pairs of measures whose correlation across neighbourhoods changed most between the ${a} and ${b} censuses${state.shiftOnly ? `, among pairs with ${escapeHTML(MEASURES[state.m].long.toLowerCase())}` : ""}. `
    + `Each strip runs from −1 to 1; the dots are the three censuses. Choose a pair to see it in the chart above.`;
  yearKey($("shift-key"));
}
$("shift-only").addEventListener("change", (e) => {
  state.shiftOnly = e.target.checked;
  renderShift();
});
$("shift-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  state.sx = b.dataset.a;
  state.sy = b.dataset.b;
  state.corrYear = b.dataset.y;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "center" });
});

// ---- 7. the gap between neighbourhoods ---------------------------------------------------
// The 90th-percentile neighbourhood's figure over the 10th's, for each dollar measure.
function renderGap() {
  const money = measures.filter((m) => isMoney(m));
  const ratio = (m, y) => {
    const s = val(m, y).filter((v) => v != null).sort((a, b) => a - b);
    return s.length < 30 ? null : quantile(s, 0.9) / quantile(s, 0.1);
  };
  const rows = money.map((m) => ({ m, r: YEARS.map((y) => ratio(m, y)) }));
  const max = Math.max(...rows.flatMap((r) => r.r.filter((v) => v != null)));
  $("gap-list").innerHTML = rows.map(({ m, r }) => `<li class="${m === state.m ? "sel" : ""}">
    <span class="gp-name">${escapeHTML(shortName(m))}</span>
    <span class="gp-bars">${YEARS.map((y, k) => r[k] == null ? "" : `<span class="gp-bar" data-tip="${escapeHTML(`${MEASURES[m].long}, ${refYear(m, y)}: the 90th-percentile neighbourhood has ${r[k].toFixed(2)} times the 10th's`)}"><span class="gp-fill" style="width:${(r[k] / max * 100).toFixed(1)}%;background:${YEAR_COLOR[y]}"></span><span class="gp-val">${r[k].toFixed(1)}×</span></span>`).join("")}</span>
  </li>`).join("");
  $("gap-lede").innerHTML = `For each dollar measure, the figure of the neighbourhood at the 90th percentile divided by the one at the 10th, in each census: 2× means the higher one has twice the lower one's. Ratios don't depend on inflation.`;
  yearKey($("gap-key"));
}

$("method").textContent = "Neighbourhood figures combine the dissemination areas in each of the City's 158 neighbourhoods. "
  + "Shares are summed from counts; income medians are interpolated from income groups (2011 household income: the median of the areas' medians, weighted by households); "
  + "dwelling value, owner costs and rent are the median of the areas' medians, weighted by owner or renter households; published rates are weighted averages. "
  + "A neighbourhood is left out when areas holding less than half of its households (or owners, renters, people) have a figure. City figures are Statistics Canada's. "
  + "Dollar changes restate the earlier figure with Toronto's consumer price index. "
  + "Correlations are Spearman rank correlations across the neighbourhoods with both figures; the gap is the 90th-percentile neighbourhood's figure over the 10th's.";

renderCards();
renderRanks();
renderChanges();
$("spread-real").checked = state.spreadReal;
renderSpread();
renderCorr();
renderShift();
renderGap();
writeHash();
