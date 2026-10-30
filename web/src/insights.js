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
};
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, y: state.year, p: state.pair.join("-") });
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

$("method").textContent = "Neighbourhood figures combine the dissemination areas in each of the City's 158 neighbourhoods. "
  + "Shares are summed from counts; income medians are interpolated from income groups (2011 household income: the median of the areas' medians, weighted by households); "
  + "dwelling value, owner costs and rent are the median of the areas' medians, weighted by owner or renter households; published rates are weighted averages. "
  + "A neighbourhood is left out when areas holding less than half of its households (or owners, renters, people) have a figure. City figures are Statistics Canada's. "
  + "Dollar changes restate the earlier figure with Toronto's consumer price index.";

renderCards();
renderRanks();
renderChanges();
writeHash();
