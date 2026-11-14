// The Getting Around page: Bike Share trips, ride-hail trips, subway delays and bicycle counts,
// month by month, from transport.json (pipeline/transport_insights.py), with the census figures
// from insights.json. Bike Share's trips are by station, so they can be mapped: a neighbourhood's
// trips are those of the stations inside it.
import "./style.css";
import { $, COLORS, DIVERGING, MEASURES as CENSUS, escapeHTML, isMoney, ordinal, sign, loadJSON, loadFailed, own } from "./catalogue.js";
import { chart, fmtR, initPick, initTip, key, quantile, rColor, seg, spark, spearman } from "./charts.js";
import { buildToc } from "./nbtools.js";

const [T, census] = await Promise.all([
  loadJSON(`/transport.json?v=${__TRANSPORT_VERSION__}`),
  loadJSON(`/insights.json?v=${__INSIGHTS_VERSION__}`),
]).catch(loadFailed);
const nbhd = T.nbhd, B = T.bike, R = T.ridehail, S = T.subway, K = T.counters, NB = T.nb;
const LIGHT = COLORS[1], MID = COLORS[3], DARK = COLORS[5], ORANGE = "#c2410c", GREY = "#6b6b66";
const MIN_BASE = 500; // trips in the earlier period before a change is shown
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ml = (m) => `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const mlLong = (m) => `${LONG[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const daysIn = (m) => new Date(+m.slice(0, 4), +m.slice(5), 0).getDate();
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtBig = (v) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(v >= 1e5 ? 0 : 1)}k` : fmtN(v));
const fmtSPct = (v) => (v == null ? "—" : `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}%`);
const fmtPct0 = (v) => `${Math.round(v)}%`;
const fmtMoney2 = (v) => `$${v.toFixed(2)}`;
const pctOf = (a, b) => a.map((v, k) => (v != null && b[k] ? (v / b[k]) * 100 : null));
const lastWith = (vs) => vs.findLastIndex((v) => v != null);

initTip();

// ---- 1. the city at a glance ------------------------------------------------------------------
// The latest month of each source against the same month a year before: the months differ,
// because each source is published on its own schedule, so every card names its own.
function card(name, months, vals, fmt, note = "") {
  const k = lastWith(vals), prev = vals[k - 12], from = Math.max(0, k - 36);
  return `<div class="card static" aria-label="${escapeHTML(`${name}, ${mlLong(months[k])}: ${fmt(vals[k])}`)}">
    <span class="card-name">${name}</span><span class="card-value">${fmt(vals[k])}</span>${spark(vals.slice(from, k + 1))}
    <span class="card-years"><span>${ml(months[from])}</span><span>${ml(months[k])}</span></span>
    <span class="card-delta">${prev ? `${fmtSPct((vals[k] / prev - 1) * 100)} from ${ml(months[k - 12])}` : ""}${note}</span></div>`;
}
const rideDaily = R.trips.map((v, k) => v / R.days[k]);
const subTotal = (what) => S.months.map((_, k) => Object.values(S.lines).reduce((a, l) => a + l[what][k], 0));
function renderCards() {
  $("cards").innerHTML = [
    card("Bike Share trips in the month", B.months, B.trips, fmtN),
    card("Bike Share stations in use", B.months, B.stations, fmtN),
    card("Ride-hail trips a day", R.months, rideDaily, fmtN),
    card("Average ride-hail fare", R.months, R.fare, fmtMoney2),
    card("Minutes of subway delay in the month", S.months, subTotal("minutes"), fmtN),
    card(`Bicycles a day at ${K.sites.length} counters`, K.months, K.daily, fmtN),
  ].join("");
  $("glance-lede").innerHTML = "Each source's latest whole month, against the same month a year before; the lines show the three years to it. "
    + "The sources are published on their own schedules, so the months differ: each card names its own.";
}

// ---- 2. month by month ---------------------------------------------------------------------------
function panel(title, body, caption) {
  return `<figure class="panel"><h3 class="sub-h">${title}</h3>${body}<figcaption>${caption}</figcaption></figure>`;
}
// The twelve months to each month, as an index: the twelve months of `base` = 100.
function rolling(months, vals, base) {
  const tot = months.map((_, k) => (k < 11 ? null : vals.slice(k - 11, k + 1).reduce((a, v) => a + v, 0)));
  const b = tot[months.indexOf(`${base}-12`)];
  return tot.map((v) => (v == null || !b ? null : (v / b) * 100));
}
const splitNote = `The files' labels can't tell the two apart from ${ml(B.split_unknown[0])} to ${ml(B.split_unknown[1])}: plans sold in those years were filed as casual.`;
function renderMonths() {
  const bl = B.months.map(ml), rl = R.months.map(ml), sl = S.months.map(ml);
  const fareFrom = R.fare.findIndex((v) => v != null);
  // both on the months ride-hail has, 2018 on: the year to each month against the year 2019
  const rideMonth = R.trips.map((v, k) => (v / R.days[k]) * daysIn(R.months[k]));
  const bikeOnR = R.months.map((m) => B.trips[B.months.indexOf(m)] ?? null);
  const ri = rolling(R.months, rideMonth, 2019), bi = rolling(R.months, bikeOnR.map((v) => v ?? 0), 2019).map((v, k) => (bikeOnR.slice(Math.max(0, k - 11), k + 1).includes(null) ? null : v));
  const from = ri.findIndex((v) => v != null);
  const lines = ["YU", "BD", "SHP"], rest = S.months.map((_, k) => S.lines.SRT.minutes[k] + S.lines.other.minutes[k]);
  const modelFrom = B.modelled.findIndex((v, k) => v > 0.9 * B.trips[k]);
  const ebike = B.months.map((_, k) => (modelFrom >= 0 && k >= modelFrom && B.modelled[k] ? (B.ebike[k] / B.modelled[k]) * 100 : null));
  $("panels").innerHTML = [
    panel("Bike Share trips", chart({ labels: bl, fmt: fmtBig, tipLabel: (_, k) => mlLong(B.months[k]),
      bars: [{ name: "Members", color: MID, values: B.member }, { name: "Casual riders", color: LIGHT, values: B.casual },
        { name: "All riders", color: GREY, values: B.trips.map((v, k) => (B.member[k] == null ? v : null)) }] })
      + key([["Members", MID], ["Casual riders", LIGHT], ["Kind of rider not known", GREY]]),
    `Trips of a minute or more, by the month they started, ${ml(B.months[0])} to ${ml(B.months.at(-1))}. A casual rider pays by the trip or the day; a member by the year or month. ${splitNote}`),
    panel("Ride-hail trips a day", chart({ labels: rl, fmt: fmtBig, tipLabel: (_, k) => mlLong(R.months[k]),
      lines: [{ name: "Trips a day", color: DARK, values: rideDaily }] }),
    `Trips with Uber, Lyft and the other licensed companies that started or ended in Toronto, averaged over the month's days, ${ml(R.months[0])} to ${ml(R.months.at(-1))}. Taxis and deliveries are not included.`),
    panel("The two since 2019", chart({ labels: rl.slice(from), fmt: (v) => `${Math.round(v)}`, zero: false, tipLabel: (_, k) => `Year to ${mlLong(R.months[from + k])}`,
      lines: [{ name: "Bike Share", color: MID, values: bi.slice(from) }, { name: "Ride-hail", color: ORANGE, values: ri.slice(from) }] })
      + key([["Bike Share", MID, "line"], ["Ride-hail", ORANGE, "line"]]),
    "Trips in the twelve months to each month, with the year 2019 as 100: a year's total takes the seasons out. Bike Share made about a twentieth as many trips as ride-hail in 2019."),
    panel("Minutes of subway delay", chart({ labels: sl, fmt: fmtBig, tipLabel: (_, k) => mlLong(S.months[k]),
      bars: [{ name: "Line 1", color: DARK, values: S.lines.YU.minutes }, { name: "Line 2", color: MID, values: S.lines.BD.minutes },
        { name: "Line 4", color: LIGHT, values: S.lines.SHP.minutes }, { name: "Line 3 and unassigned", color: GREY, values: rest }] })
      + key([["Line 1", DARK], ["Line 2", MID], ["Line 4", LIGHT], ["Line 3 (to 2023) and unassigned", GREY]]),
    `The minutes trains were held, added over every delay the TTC logged, ${ml(S.months[0])} to ${ml(S.months.at(-1))}. A long closure counts as one long delay.`),
    panel("Subway delays", chart({ labels: sl, fmt: fmtBig, tipLabel: (_, k) => mlLong(S.months[k]),
      lines: lines.map((l, i) => ({ name: `Line ${{ YU: 1, BD: 2, SHP: 4 }[l]}`, color: [DARK, MID, ORANGE][i], values: S.lines[l].delays })) })
      + key([["Line 1", DARK, "line"], ["Line 2", MID, "line"], ["Line 4", ORANGE, "line"]]),
    "The number of incidents that held a train, by line. About two in three incidents the TTC logs hold no train and are not counted here."),
    panel(`Bicycles a day at ${K.sites.length} counters`, chart({ labels: K.months.map(ml), fmt: fmtBig, tipLabel: (_, k) => mlLong(K.months[k]),
      lines: [{ name: "Bicycles a day", color: DARK, values: K.daily }] }),
    `The City's permanent counters at ${K.sites.map((s) => escapeHTML(s.replace(/,? \(.*\)$/, ""))).join("; ")}: both directions, averaged over the month's days and added. Only these ${K.sites.length} have counted in every month since ${ml(K.months[0])}; every bicycle is counted, not only Bike Share's.`),
    panel("Who rides Bike Share", chart({ labels: bl, fmt: fmtPct0, tipLabel: (_, k) => mlLong(B.months[k]),
      lines: [{ name: "Casual riders' trips", color: MID, values: pctOf(B.casual, B.trips) }, { name: "Trips on an e-bike", color: ORANGE, values: ebike }] })
      + key([["Casual riders' share of trips", MID, "line"], ["E-bikes' share of trips", ORANGE, "line"]]),
    `Casual riders' share rises every summer. ${splitNote}${modelFrom >= 0 ? ` The files name the bike's model from ${ml(B.months[modelFrom])}.` : ""}`),
    panel("Ride-hail fare and wait", chart({ labels: rl.slice(fareFrom), fmt: (v) => v.toFixed(1), tipLabel: (_, k) => mlLong(R.months[fareFrom + k]),
      lines: [{ name: "Average fare, dollars", color: DARK, values: R.fare.slice(fareFrom) }, { name: "Average wait, minutes", color: ORANGE, values: R.wait.slice(fareFrom) }] })
      + key([["Average fare, dollars", DARK, "line"], ["Average wait, minutes", ORANGE, "line"]]),
    "The fare is what the rider paid before discounts and tips, not adjusted for inflation; the wait is from the request to the pickup. Both are published from 2020."),
  ].join("");
}

// ---- 3. through the day ------------------------------------------------------------------------------
const P = T.profile;
const hourLabel = (h) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);
let profYear = P.years.at(-1);
function renderProfile() {
  seg($("prof-year"), P.years.map((y) => [String(y), String(y)]), String(profYear), (y) => { profYear = +y; renderProfile(); });
  const k = P.years.indexOf(profYear), wd = P.weekday[k], we = P.weekend[k];
  const labels = Array.from({ length: 24 }, (_, h) => hourLabel(h));
  const one = (title, d, note) => panel(title, chart({ labels, fmt: fmtN, tipLabel: (l) => `Starting ${l}`, height: 190,
    lines: d.all ? [{ name: "All riders", color: DARK, values: d.all }]
      : [{ name: "Members", color: DARK, values: d.member }, { name: "Casual riders", color: ORANGE, values: d.casual }] })
    + (d.all ? "" : key([["Members", DARK, "line"], ["Casual riders", ORANGE, "line"]])), note);
  $("profile").innerHTML = one("A weekday", wd, "Trips started in each hour of an average Monday to Friday.")
    + one("A day of the weekend", we, "The same for an average Saturday or Sunday, on its own scale.");
  const peak = (vs) => vs.indexOf(Math.max(...vs));
  $("prof-lede").innerHTML = `Bike Share trips by the hour they started, ${profYear}${profYear === +B.months.at(-1).slice(0, 4) && !B.months.at(-1).endsWith("-12") ? ` (to ${LONG[+B.months.at(-1).slice(5) - 1]})` : ""}, averaged over the year's days. `
    + (wd.all ? `Weekday trips peak at ${hourLabel(peak(wd.all))}, weekend trips at ${hourLabel(peak(we.all))}. The files' labels can't tell members from casual riders in ${profYear}.`
      : `On weekdays members' trips peak at ${hourLabel(peak(wd.member))} and casual riders' at ${hourLabel(peak(wd.casual))}; at the weekend, at ${hourLabel(peak(we.member))} and ${hourLabel(peak(we.casual))}.`);
}

// ---- 3b. subway delays: why, and where ------------------------------------------------------------------------
const CAUSE_COLORS = ["#0d366b", "#1c5cab", "#3987e5", "#86b6ef", "#c2410c", "#e98b5a", "#7a5195", "#b9a3c9", "#6b6b66", "#c9c9c3"];
function renderDelays() {
  const yl = TT.cause_years.map((y, k) => (TT.cause_partial && k === TT.cause_years.length - 1 ? `${y}*` : y));
  const lastMonth = LONG[+TT.cause_last.slice(5) - 1];
  $("why").innerHTML = panel("Why trains were held: minutes of delay", chart({ labels: yl, fmt: fmtBig, height: 220,
    tipLabel: (l, k) => (TT.cause_partial && k === yl.length - 1 ? `${TT.cause_years[k]}, January to ${lastMonth}` : String(TT.cause_years[k])),
    partialFrom: TT.cause_partial ? yl.length - 1 : null,
    bars: TT.causes.map((c, k) => ({ name: c, color: CAUSE_COLORS[k], values: TT.cause_minutes[k] })) })
    + key(TT.causes.map((c, k) => [c, CAUSE_COLORS[k]])),
  `Every delay that held a subway train, by year and by the cause group of the TTC's code${TT.cause_partial ? `; ${TT.cause_years.at(-1)} runs to ${lastMonth}` : ""}. Line 3 (Scarborough) closed in July 2023.`);
  const st = TT.stations.filter((s) => s.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const top = st.slice(0, 15), max = top[0].minutes;
  const main = (s) => { const k = s.by.indexOf(Math.max(...s.by)); return `${TT.causes[k]} (${Math.round((s.by[k] / s.minutes) * 100)}%)`; };
  $("delay-ranks").innerHTML = top.map((s, k) => `<li><span class="rk">${k + 1}</span><button type="button" class="nm" data-nb="${s.nb}" title="Find ${escapeHTML(nbhd[s.nb].name)} on the map">${escapeHTML(s.name)}</button>
    <span class="barcell" data-tip="${escapeHTML(`${s.name} (Line ${s.lines.replaceAll("/", " and ")})<br><b>${fmtN(s.minutes)}</b> minutes in ${fmtN(s.delays)} delays<br>Most: ${main(s)}<br>${nbhd[s.nb].name}`)}"><span class="bar-fill" style="width:${((s.minutes / max) * 100).toFixed(1)}%"></span></span>
    <span class="vl">${fmtN(s.minutes)}</span><span class="move"></span></li>`).join("");
  const total = TT.stations.reduce((a, s) => a + s.minutes, 0);
  $("delay-lede").innerHTML = `The stations where the most minutes of subway delay began, ${ml(TT.stations_period[0])} to ${ml(TT.stations_period[1])}: ${fmtN(total)} minutes at ${st.length} stations. `
    + "A delay is logged where it began, so a busy interchange or a terminus collects the delays of the trains held behind it. Delays logged between two stations or for a whole line are in the chart and not in the list. Pick a station to find its neighbourhood on the map.";
}

// ---- neighbourhood measures --------------------------------------------------------------------------------
// A period is a year, or one month of it. A neighbourhood with no trip in the period has no
// figure: it had no station then.
const TT = T.ttc;
const sumModes = (w) => w.bus.map((v, i) => v + w.streetcar[i] + w.subway[i]);
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1); // "TTC" and month names keep their capitals
const fmtDate = (iso) => { const d = new Date(`${iso}T12:00`); return `${d.getDate()} ${LONG[d.getMonth()]} ${d.getFullYear()}`; };
const feedLabel = (k) => `${MON[+TT.feeds[k].slice(5, 7) - 1]} ${TT.feeds[k].slice(0, 4)}`;
const NBM = NB.months, YEARS = [...new Set(NBM.map((m) => +m.slice(0, 4)))];
const monthsOf = (y, mo) => NBM.map((m, k) => [m, k]).filter(([m]) => +m.slice(0, 4) === y && (!mo || +m.slice(5) === mo)).map(([, k]) => k);
const partial = (y) => monthsOf(y, 0).length < 12;
const total = (rows, ks) => nbhd.map((_, i) => ks.reduce((a, k) => a + rows[k][i], 0));
const M = {
  starts: { label: "Bike Share trips started", count: true, get: (ks) => total(NB.starts, ks).map((v) => v || null) },
  ends: { label: "Bike Share trips ended", count: true, get: (ks) => total(NB.ends, ks).map((v) => v || null) },
  change: { label: "Change in trips started from a year before", unit: "spct", from: YEARS[0] + 1,
    get: (ks, y, mo) => {
      const now = total(NB.starts, ks), nums = ks.map((k) => +NBM[k].slice(5));
      const then = total(NB.starts, monthsOf(y - 1, mo).filter((k) => nums.includes(+NBM[k].slice(5))));
      return now.map((v, i) => (then[i] >= MIN_BASE && v ? (v / then[i] - 1) * 100 : null));
    } },
  balance: { label: "Trips ended for every 100 started", unit: "ratio",
    get: (ks) => { const s = total(NB.starts, ks), e = total(NB.ends, ks); return s.map((v, i) => (v >= MIN_BASE ? (e[i] / v) * 100 : null)); } },
  docks: { label: "Bike Share docks today", count: true, fixed: true, get: () => NB.docks.map((v) => v || null) },
  stations: { label: "Bike Share stations today", count: true, fixed: true, get: () => NB.stations.map((v) => v || null) },
  // The TTC's schedule: a period at a time (TT.feeds), not a year or month
  ttc_all: { label: "TTC departures on a weekday, every mode", group: "ttc", count: true, get: (f) => sumModes(TT.nb[f].weekday) },
  ttc_bus: { label: "TTC departures on a weekday, by bus", group: "ttc", count: true, get: (f) => TT.nb[f].weekday.bus },
  ttc_streetcar: { label: "TTC departures on a weekday, by streetcar and LRT", group: "ttc", count: true, get: (f) => TT.nb[f].weekday.streetcar },
  ttc_subway: { label: "TTC departures on a weekday, by subway", group: "ttc", count: true, get: (f) => TT.nb[f].weekday.subway },
  ttc_sunday: { label: "TTC Sunday service, as a share of a weekday's", group: "ttc", unit: "pct",
    get: (f) => sumModes(TT.nb[f].weekday).map((w, i) => (w ? (TT.nb[f].sunday[i] / w) * 100 : null)) },
  ttc_frequent: { label: "Residents within 400 m of a stop served every 10 minutes all day", group: "ttc", unit: "pct", get: (f) => TT.nb[f].frequent },
  ttc_rapid: { label: "Residents within 800 m of a subway or LRT station", group: "ttc", unit: "pct", get: (f) => TT.nb[f].rapid },
};
const isTTC = (m = state.m) => M[m].group === "ttc";
const years = (m) => YEARS.filter((y) => y >= (M[m].from ?? YEARS[0]));

// ---- state, kept in the address -------------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
const state = {
  m: own(M, hash.get("m")) ? hash.get("m") : "starts",
  y: +hash.get("y") || null,
  mo: Math.min(12, Math.max(0, +hash.get("mo") || 0)),
  f: Math.max(0, TT.feeds.indexOf(hash.get("f") ?? TT.feeds.at(-1))),
  rate: hash.get("r") !== "0",
  dots: hash.get("st") === "1",
  sx: hash.get("sx"),
  nb: nbIndex(hash.get("nb")),
};
const fixPeriod = () => {
  if (!years(state.m).includes(state.y)) state.y = years(state.m).filter((y) => !partial(y)).at(-1) ?? years(state.m).at(-1);
  if (state.mo && !monthsOf(state.y, state.mo).length) state.mo = 0;
};
fixPeriod();
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, y: state.y, mo: state.mo, r: state.rate ? "1" : "0" });
  if (isTTC()) { h.delete("y"); h.delete("mo"); h.set("f", TT.feeds[state.f]); }
  if (state.dots) h.set("st", "1");
  if (state.sx) h.set("sx", state.sx);
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};

const isRate = () => state.rate && M[state.m].count;
function values() {
  let vs = isTTC() ? M[state.m].get(state.f) : M[state.m].get(monthsOf(state.y, state.mo), state.y, state.mo);
  if (isRate()) vs = vs.map((v, i) => (v == null ? null : (v / T.pop[i]) * 1000));
  return vs;
}
function fmtV(v) {
  if (v == null) return "—";
  const u = M[state.m].unit;
  return u === "spct" ? fmtSPct(v) : u === "pct" ? `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%` : u === "ratio" ? v.toFixed(0) : isRate() ? (v >= 100 ? fmtN(v) : v.toFixed(1)) : fmtN(v);
}
function period() {
  if (isTTC()) return `, the TTC's schedule from ${fmtDate(TT.feeds[state.f])}${M[state.m].unit === "pct" ? "" : ` (a typical weekday: ${fmtDate(TT.days[state.f].weekday)})`}`;
  if (M[state.m].fixed) return "";
  if (state.mo) return `, ${LONG[state.mo - 1]} ${state.y}`;
  const ks = monthsOf(state.y, 0);
  return partial(state.y) ? `, ${state.y} to date (${LONG[+NBM[ks[0]].slice(5) - 1]} to ${LONG[+NBM[ks.at(-1)].slice(5) - 1]})` : `, ${state.y}`;
}
const describe = () => `${escapeHTML(M[state.m].label)}${period()}${isRate() ? " per 1,000 residents (2021 Census)" : ""}`;

// ---- controls ----------------------------------------------------------------------------------
const select = $("measure"), monthSel = $("month");
const opts = (g) => Object.entries(M).filter(([, d]) => (d.group ?? "bike") === g).map(([k, d]) => `<option value="${k}">${escapeHTML(d.label)}</option>`).join("");
select.innerHTML = `<optgroup label="Bike Share">${opts("bike")}</optgroup><optgroup label="TTC">${opts("ttc")}</optgroup>`;
select.addEventListener("change", () => set({ m: select.value }));
monthSel.addEventListener("change", () => set({ mo: +monthSel.value }));
$("rate").addEventListener("change", (e) => set({ rate: e.target.checked }));
$("dots").addEventListener("change", (e) => set({ dots: e.target.checked }));
function controls() {
  select.value = state.m;
  const fixed = !!M[state.m].fixed, ttc = isTTC();
  monthSel.hidden = fixed || ttc;
  $("period").hidden = fixed || (ttc && TT.feeds.length < 2);
  if (ttc) seg($("period"), TT.feeds.map((_, k) => [String(k), feedLabel(k)]), String(state.f), (k) => set({ f: +k }));
  else seg($("period"), years(state.m).map((y) => [String(y), partial(y) ? `${y}*` : String(y)]), String(state.y), (y) => set({ y: +y }));
  const have = new Set(monthsOf(state.y, 0).map((k) => +NBM[k].slice(5)));
  monthSel.innerHTML = `<option value="0">All year</option>${LONG.map((n, k) => (have.has(k + 1) ? `<option value="${k + 1}">${n}</option>` : "")).join("")}`;
  monthSel.value = String(state.mo);
  $("rate-wrap").hidden = !M[state.m].count;
  $("rate").checked = state.rate;
  $("dots").checked = state.dots;
}
function set(changes) {
  Object.assign(state, changes);
  if ("m" in changes) state.sx = null;
  fixPeriod();
  render();
}

// ---- 4. the map ---------------------------------------------------------------------------------------
const markPick = initPick($("nb-map"), $("map-pick"), () => state.nb, (i) => {
  state.nb = i;
  renderOne();
  writeHash();
}, undefined, nbhd.map((n) => n.name));
const rankOrder = (vs) => vs.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
function renderMap() {
  const vs = values(), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const diverging = M[state.m].unit === "spct";
  let b, pal;
  if (diverging) { // red where trips fell, blue where they rose, in steps about zero
    const top = Math.max(10, quantile(s.map(Math.abs).sort((p, q) => p - q), 0.8));
    const step = top > 60 ? 20 : top > 30 ? 10 : 5;
    b = [-3, -2, -1, 1, 2, 3].map((k) => (k < 0 ? k + 0.5 : k - 0.5) * step);
    pal = DIVERGING;
  } else {
    b = [1, 2, 3, 4, 5].map((k) => quantile(s, k / 6)).filter((q, k, qs) => k === 0 || q > qs[k - 1]);
    pal = b.length + 1 === COLORS.length ? COLORS : COLORS.slice(COLORS.length - b.length - 1);
  }
  const cls = (v) => b.filter((e) => v >= e).length;
  const shapes = nbhd.map((n, i) => {
    const v = vs[i];
    const t = `${escapeHTML(n.name)}<br>${v == null ? (isTTC() ? "No figure" : NB.stations[i] ? "No figure for this period" : "No Bike Share station") : `<b>${fmtV(v)}</b> · ${ordinal(rank.get(i))} of ${order.length}`}`
      + (isTTC() ? `<br>${fmtN(TT.nb[state.f].stops[i])} stops with a weekday departure`
        : `<br>${NB.stations[i] ? `${NB.stations[i]} station${NB.stations[i] === 1 ? "" : "s"}, ${fmtN(NB.docks[i])} docks today` : ""}`);
    return `<path d="${n.path}" fill="${v == null ? "url(#nb-hatch)" : pal[cls(v)]}" data-i="${i}" data-tip="${t}"/>`;
  }).join("");
  const pts = isTTC() ? TT.stations.map((d) => ({ x: d.x, y: d.y, n: d.departures })) : T.stations.map((d) => ({ x: d.x, y: d.y, n: d.starts }));
  const big = Math.max(...pts.map((d) => d.n));
  const dots = state.dots ? `<g class="st-dots${isTTC() ? " ttc" : ""}">${pts.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${(isTTC() ? 2.5 + 3 * Math.sqrt(d.n / big) : 1.5 + 5 * Math.sqrt(d.n / big)).toFixed(1)}"/>`).join("")}</g>` : "";
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${T.map.width} ${T.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${M[state.m].label.toLowerCase()}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g>${dots}</svg>`;
  const edges = [null, ...b, null];
  const label = (k) => (edges[k] == null ? `under ${fmtV(edges[k + 1])}` : edges[k + 1] == null ? `${fmtV(edges[k])} or more` : `${fmtV(edges[k])} to ${fmtV(edges[k + 1])}`);
  $("map-key").innerHTML = pal.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${label(k)}</li>`).join("")
    + (vs.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>${isTTC() ? "No figure" : "No station, or no figure"}</li>` : "")
    + (state.dots ? (isTTC() ? `<li><span class="key-dot ttc"></span>A subway or LRT station, sized by its weekday departures</li>`
      : `<li><span class="key-dot"></span>A Bike Share station, sized by its trips started, ${ml(T.stations_period[0])} to ${ml(T.stations_period[1])}</li>`) : "");
  const none = nbhd.length - NB.stations.filter(Boolean).length;
  $("map-lede").innerHTML = isTTC() ? `${describe()}, by neighbourhood, in classes of about equal numbers of neighbourhoods. ${TTC_NOTES[state.m] ?? ""}${isRate() ? " Per resident, service is highest where many routes pass through few residents: downtown and around the subway's end stations." : ""}`
    : `${describe()}, by neighbourhood${diverging ? "" : ", in classes of about equal numbers of neighbourhoods"}. A neighbourhood's trips are those of the stations inside it; ${none} neighbourhoods have no station.`
    + (state.m === "balance" ? " Under 100, more bikes leave than arrive, and Bike Share's trucks make up the difference: often the top of a hill." : "")
    + (state.m === "change" ? ` Only neighbourhoods with ${fmtN(MIN_BASE)} trips or more in the earlier period; a new station nearby raises a neighbourhood's trips as surely as more riding does.` : "")
    + (isRate() ? " Trips per resident are highest where people visit more than live: downtown, the waterfront, the parks." : "");
  markPick();
}

const TTC_NOTES = {
  ttc_all: "A departure is a bus, streetcar or train leaving a stop in the neighbourhood: a route through it counts once at every stop. Counts are from the schedule, not of riders.",
  ttc_bus: "A departure is a bus leaving a stop in the neighbourhood; a route through it counts once at every stop.",
  ttc_streetcar: "Streetcars and Lines 5 and 6 (Eglinton and Finch West), each leaving a stop in the neighbourhood.",
  ttc_subway: "A train leaving a station platform in the neighbourhood; most neighbourhoods have none.",
  ttc_sunday: "Departures on a typical Sunday against a typical weekday: under 100%, the neighbourhood loses service at the weekend.",
  ttc_frequent: "A stop served by six departures or more in every hour from 7 am to 7 pm on a weekday, at that stop (one side of the street); residents count where their dissemination area's centre is within 400 m of one, as the crow flies.",
  ttc_rapid: "Within 800 m, as the crow flies, of a subway station or a Line 5 or 6 LRT stop, by dissemination area centre.",
};

// ---- 5. highest and lowest -------------------------------------------------------------------------------
function renderRanks() {
  const vs = values(), order = rankOrder(vs);
  const max = Math.max(...order.map((i) => Math.abs(vs[i])));
  const row = (i) => {
    const v = vs[i], w = (Math.abs(v) / max) * 100;
    return `<li><span class="rk">${order.indexOf(i) + 1}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${fmtV(v)}</b>`)}"><span class="bar-fill" style="width:${w.toFixed(1)}%${v < 0 ? `;background:${DIVERGING[1]}` : ""}"></span></span>
      <span class="vl">${fmtV(v)}</span><span class="move"></span></li>`;
  };
  $("rank-top").innerHTML = order.slice(0, 10).map(row).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map(row).join("");
  $("rank-lede").innerHTML = `${describe()}: ${order.length} of the ${nbhd.length} neighbourhoods have a figure. Pick a name to find it on the map.`;
}

// ---- 6. one neighbourhood, month by month -------------------------------------------------------------------
function ttcLine(i) {
  const f = TT.feeds.length - 1, w = TT.nb[f].weekday, all = w.bus[i] + w.streetcar[i] + w.subway[i];
  const parts = [["bus", w.bus[i]], ["streetcar and LRT", w.streetcar[i]], ["subway", w.subway[i]]].filter(([, v]) => v).map(([k, v]) => `${fmtN(v)} by ${k}`);
  return ` On a weekday the TTC schedules <b>${fmtN(all)}</b> departures from its ${fmtN(TT.nb[f].stops[i])} stops (${parts.join(", ")}); `
    + `${TT.nb[f].frequent[i].toFixed(0)}% of its residents live within 400 m of a stop served every 10 minutes all day, and ${TT.nb[f].rapid[i].toFixed(0)}% within 800 m of a subway or LRT station.`;
}
function renderOne() {
  const i = state.nb;
  if (i == null || !NB.starts.some((row) => row[i])) {
    if (i == null) $("one-lede").textContent = "Pick a neighbourhood on the map, in a list or by name to see its trips month by month.";
    else $("one-lede").innerHTML = `<b>${escapeHTML(nbhd[i].name)}</b> has had no Bike Share station since ${ml(NBM[0])}.${ttcLine(i)}`;
    $("one").innerHTML = "";
    return;
  }
  const starts = NBM.map((_, k) => NB.starts[k][i]), ends = NBM.map((_, k) => NB.ends[k][i]);
  const city = NBM.map((m) => B.trips[B.months.indexOf(m)]);
  const share = starts.map((v, k) => (v / city[k]) * 100);
  const here = T.stations.filter((d) => d.nb === i).sort((a, b) => b.starts - a.starts);
  $("one-lede").innerHTML = `<b>${escapeHTML(nbhd[i].name)}</b>: ${NB.stations[i] ? `${NB.stations[i]} station${NB.stations[i] === 1 ? "" : "s"} and ${fmtN(NB.docks[i])} docks today` : "no station today"}, ${fmtN(T.pop[i])} residents (2021 Census).${ttcLine(i)}`;
  $("one").innerHTML = panel("Trips started and ended", chart({ labels: NBM.map(ml), fmt: fmtBig, tipLabel: (_, k) => mlLong(NBM[k]),
    bars: [{ name: "Started here", color: MID, values: starts }], lines: [{ name: "Ended here", color: ORANGE, values: ends }] })
    + key([["Started here", MID], ["Ended here", ORANGE, "line"]]), `By month, ${ml(NBM[0])} to ${ml(NBM.at(-1))}.`)
    + panel("Share of the city's trips", chart({ labels: NBM.map(ml), fmt: (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`, tipLabel: (_, k) => mlLong(NBM[k]),
      lines: [{ name: "Share of trips started", color: DARK, values: share }] }), "Its trips started as a share of every Bike Share trip that month: flat where it has grown with the system.")
    + (here.length ? `<figure class="panel"><h3 class="sub-h">Its busiest stations</h3><ol class="rank-list">${here.slice(0, 8).map((d, k) => `<li><span class="rk">${k + 1}</span><span class="nm">${escapeHTML(d.name)}</span>
        <span class="barcell"><span class="bar-fill" style="width:${((d.starts / here[0].starts) * 100).toFixed(1)}%"></span></span><span class="vl">${fmtN(d.starts)}</span><span class="move"></span></li>`).join("")}</ol>
        <figcaption>Trips started, ${ml(T.stations_period[0])} to ${ml(T.stations_period[1])}${here.length > 8 ? `; ${here.length - 8} more stations not shown` : ""}.</figcaption></figure>` : "");
}

// ---- 7. what goes with what ------------------------------------------------------------------------------
function renderCorr() {
  const vs = values();
  const rs = censusMeasures.map((c) => ({ c, v: spearman(vs, census.measures[c].values["2021"]) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  $("corr-body").hidden = !rs.length;
  if (!rs.length) {
    $("corr-lede").innerHTML = `Too few neighbourhoods have a figure for ${lower1(describe())} to compare it with the census.`;
    return;
  }
  if (!state.sx || !rs.some((r) => r.c === state.sx)) state.sx = [...rs].sort((a, b) => Math.abs(b.v.r) - Math.abs(a.v.r))[0].c;
  $("census-list").innerHTML = rs.map(({ c, v: { r } }) => {
    const w = Math.abs(r) * 50;
    return `<li><button type="button" data-x="${c}" class="${state.sx === c ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(CENSUS[c].long)}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  }).join("");
  $("corr-lede").innerHTML = `How closely ${lower1(describe())} follows each 2021 Census measure across the neighbourhoods that have a figure (Spearman rank correlation: 1, the same order; −1, the reverse). ${isTTC() ? "Routes follow the main roads and the subway follows its lines, so these describe where the network runs as much as who it serves." : "Stations were put where riders were expected, so these describe where Bike Share is as much as who uses it."} Choose one to see its neighbourhoods.`;
  const c = state.sx, xs = census.measures[c].values["2021"];
  const idx = nbhd.map((_, i) => i).filter((i) => xs[i] != null && vs[i] != null);
  const sx = idx.map((i) => xs[i]).sort((a, b) => a - b), sy = idx.map((i) => vs[i]).sort((a, b) => a - b);
  const xa = sx[0], xb = quantile(sx, 0.99), ya = Math.min(0, sy[0]), yb = quantile(sy, 0.98);
  const px = (v) => Math.min(100, Math.max(0, ((v - xa) / (xb - xa || 1)) * 100)), py = (v) => Math.min(100, Math.max(0, ((v - ya) / (yb - ya || 1)) * 100));
  const fx = (v) => (isMoney(c) ? `$${Math.round(v / 1000)}k` : `${Math.round(v)}%`);
  const fxl = (v) => (isMoney(c) ? `$${Math.round(v).toLocaleString("en-CA")}` : `${v.toFixed(1)}%`);
  const q = [0, 0.25, 0.5, 0.75, 1];
  $("scatter").innerHTML = `<div class="sc-y">${describe()}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtV(ya + f * (yb - ya))}${f === 1 && yb < sy.at(-1) ? "+" : ""}</span>`).join("")}
      ${idx.map((i) => `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(vs[i]).toFixed(2)}%" data-tip="${escapeHTML(`${nbhd[i].name}<br>${CENSUS[c].short}: <b>${fxl(xs[i])}</b><br>${M[state.m].label}: <b>${fmtV(vs[i])}</b>`)}"></span>`).join("")}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fx(xa + f * (xb - xa))}${f === 1 && xb < sx.at(-1) ? "+" : ""}</span>`).join("")}</div>
    <div class="sc-x">${escapeHTML(CENSUS[c].long)}, 2021 Census</div>`;
  $("scatter-caption").innerHTML = `Spearman <b>${fmtR(spearman(vs, xs)?.r)}</b> across ${idx.length} neighbourhoods. Each dot is a neighbourhood; the axes end at the 99th and 98th percentiles.`;
}
$("census-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-x]");
  if (!b) return;
  state.sx = b.dataset.x;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

const lowLocated = B.months.map((m, k) => [m, B.located[k]]).filter(([m, v]) => m >= NBM[0] && v != null);
$("method-note").textContent = `Bike Share trips are counted in the month they started; trips under a minute are left out. A neighbourhood's trips are those of the stations inside it, from ${ml(NBM[0])}: `
  + `the files give a station's name but not where it is, so a station removed since is placed by the intersection it was named for, or not at all, `
  + `and ${Math.min(...lowLocated.map(([, v]) => v * 100)).toFixed(1)}% to ${Math.max(...lowLocated.map(([, v]) => v * 100)).toFixed(1)}% of a month's trips started at a station with a place. `
  + `Rates are per 1,000 residents at the 2021 Census. Station and dock counts are Bike Share's list of ${NB.listed}. Changes compare the same months a year apart and need ${fmtN(MIN_BASE)} trips in the earlier period. Map classes are sixths of the neighbourhoods with a figure.`;

function render() {
  controls();
  renderMap();
  renderRanks();
  renderOne();
  renderCorr();
  writeHash();
}
renderCards();
renderMonths();
renderProfile();
renderDelays();
render();
buildToc();
