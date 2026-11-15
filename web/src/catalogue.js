// The measure catalogue, colours and formatting: everything the pages share
// that doesn't need the map library (common.js re-exports it for the map pages;
// the Insights page imports it directly).

// One-hue blue ramp, light -> dark (validated: monotone lightness, single hue).
export const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
// Diverging ramp for change: red (fell) <- neutral grey -> blue (rose); each arm
// validated as one hue with monotone lightness, light steps distinct from grey.
export const DIVERGING = ["#8f1c1c", "#d9403f", "#f2a39b", "#f0efec", "#9ec5f4", "#3987e5", "#184f95"];

// Grouped as in the measure menu (index.html); the details tables show the
// current measure's group. unit: "money" (a change can be restated in 2020
// dollars) or "rate" (percent; a change is in percentage points). stat names the
// city-wide figure. dated: "census" for figures StatCan dates by census year
// rather than income year. cerb: 2020 values are moved by pandemic benefits.
// monthly: dollars per month, shown whole rather than in thousands.
export const MEASURES = {
  med_hh_tot: { group: "income", unit: "money", stat: "median", short: "Household, total", long: "Median total household income" },
  med_hh_at: { group: "income", unit: "money", stat: "median", short: "Household, after tax", long: "Median after-tax household income" },
  med_ind_tot: { group: "income", unit: "money", stat: "median", short: "Individual, total", long: "Median total income of people 15+ with income" },
  med_ind_at: { group: "income", unit: "money", stat: "median", short: "Individual, after tax", long: "Median after-tax income of people 15+ with income" },
  avg_hh_tot: { group: "income", unit: "money", stat: "average", short: "Household, average", long: "Average total household income" },
  lim_at: { group: "low", unit: "rate", stat: "rate", cerb: true, short: "Low-income rate", long: "People in low income (LIM-AT)" },
  transfers: { group: "low", unit: "rate", stat: "share", cerb: true, short: "Income from transfers", long: "Share of income from government transfers" },
  renter: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Renter households", long: "Renter households" },
  shelter30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Shelter costs 30%+", long: "Households spending 30%+ of income on shelter" },
  owner30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Owners, costs 30%+", long: "Owner households spending 30%+ of income on shelter" },
  tenant30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Tenants, costs 30%+", long: "Tenant households spending 30%+ of income on shelter" },
  subsidized: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Subsidized tenants", long: "Tenant households in subsidized housing" },
  value: { group: "costs", unit: "money", stat: "median", dated: "census", short: "Dwelling value", long: "Median value of owned dwellings" },
  own_cost: { group: "costs", unit: "money", stat: "median", dated: "census", monthly: true, short: "Owner costs, monthly", long: "Median monthly shelter costs of owners" },
  rent: { group: "costs", unit: "money", stat: "median", dated: "census", monthly: true, short: "Rent, monthly", long: "Median monthly shelter costs of renters" },
  detached: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Single-detached", long: "Single-detached houses" },
  apt5: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Apartments, 5+ storeys", long: "Apartments in buildings of 5+ storeys" },
  condo: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Condominiums", long: "Condominium dwellings" },
  built_new: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Built in past 5 years", long: "Dwellings built in the five years before the census" },
  built_old: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Built 1960 or before", long: "Dwellings built in 1960 or before" },
  crowded: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Not suitable (crowded)", long: "Households in housing not suitable for their size" },
  degree: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Bachelor's+, aged 25–64", long: "Adults 25–64 with a bachelor's degree or higher" },
  moved1: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Moved in past year", long: "People who moved in the past year" },
  moved5: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Moved in past 5 years", long: "People who moved in the past five years" },
  imm_recent: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Recent immigrants", long: "Immigrants who arrived in the five years before the census" },
  age0_14: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Aged 0–14", long: "Children aged 0 to 14" },
  age65: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Aged 65+", long: "People aged 65 and over" },
};
// What each measure is, in plain words, from Statistics Canada's Census Dictionary (2021) and
// the profile's notes: shown on hover beside a measure's name and in the Explorers' notes.
// One line each, as `key: "text",` (pipeline/explorer_data.py reads them by pattern).
export const DEFS = {
  med_hh_tot: "The middle income of the neighbourhood's households: half have more, half less. Total income is before tax, from every source (work, investments, pensions, government transfers), for everyone in the household, in the year before the census.",
  med_hh_at: "The middle household income after income taxes are taken off: half of households have more, half less. For everyone in the household, in the year before the census.",
  med_ind_tot: "The middle income of the people aged 15 and over who had any income in the year before the census: half had more, half less. People with no income are left out (the census calls those with income \"recipients\"). Before tax, from every source.",
  med_ind_at: "The middle after-tax income of the people aged 15 and over who had any income in the year before the census: half had more, half less. People with no income are left out (the census calls those with income \"recipients\").",
  avg_hh_tot: "All household income added up and divided by the number of households: before tax, from every source. The highest incomes pull an average up much more than they move a median.",
  lim_at: "The share of people living in a household whose after-tax income, adjusted for its size, is under half the national median: Statistics Canada's Low-income measure, after tax (LIM-AT).",
  transfers: "The share of all the income received that came from governments: public pensions (CPP, OAS), Employment Insurance, child benefits, social assistance and, in 2020, pandemic benefits such as CERB.",
  renter: "The share of households that rent their home, including those in subsidized housing. The rest own it, with or without a mortgage.",
  shelter30: "The share of owner and tenant households with income that spend 30% or more of it, before tax, on shelter: rent or mortgage payments, property taxes, condominium fees and utilities.",
  owner30: "The share of owner households with income that spend 30% or more of it, before tax, on shelter: mortgage payments, property taxes, condominium fees and utilities.",
  tenant30: "The share of tenant households with income that spend 30% or more of it, before tax, on shelter: rent and any utilities paid separately.",
  subsidized: "The share of renting households whose rent is lowered by government: social housing, rent geared to income, rent supplements and housing allowances.",
  value: "The middle of what owners think their home would sell for: half think more, half less. Owners' own estimates, not sale prices.",
  own_cost: "What owner households pay a month for shelter: mortgage, property taxes, condominium fees and utilities. The middle figure: half pay more, half less.",
  rent: "What renting households pay a month for shelter: rent and any utilities paid separately. The middle figure: half pay more, half less.",
  detached: "The share of homes that are a single house standing alone, not joined to any other dwelling.",
  apt5: "The share of homes that are apartments in buildings of five storeys or more.",
  condo: "The share of homes that are part of a registered condominium, whether owned or rented, and whatever the building.",
  built_new: "The share of homes in buildings put up in the five years before the census (2016 to 2021 for the 2021 Census).",
  built_old: "The share of homes in buildings put up in 1960 or before.",
  crowded: "The share of households without enough bedrooms for who lives there, by the National Occupancy Standard: a bedroom for each couple, each other adult, and each pair of children (two of the same sex, or two under five).",
  degree: "The share of people aged 25 to 64 whose highest qualification is a bachelor's degree or above: bachelor's, professional degrees such as medicine and law, master's and doctorates.",
  moved1: "The share of people aged 1 and over who lived at another address a year before the census.",
  moved5: "The share of people aged 5 and over who lived at another address five years before the census.",
  imm_recent: "The share of residents who first became permanent residents of Canada in the five years before the census (2016 to 2021 for the 2021 Census).",
  age0_14: "The share of residents aged 14 or younger.",
  age65: "The share of residents aged 65 or older.",
};
// A measure's definition as a tooltip (charts.js initTip): defTip(m) is the data-tip attribute,
// for a control that names the measure; defined(m, html) wraps a name in a span that carries it.
// An unknown key gives nothing, so callers needn't check.
const tipOf = (m) => `<b>${escapeHTML(MEASURES[m].long)}</b><br>${escapeHTML(DEFS[m])}`;
export const defTip = (m) => (DEFS[m] ? ` data-tip="${escapeHTML(tipOf(m))}"` : "");
export const defined = (m, html) => (DEFS[m] ? `<span class="def"${defTip(m)}>${html}</span>` : html);
// label: the group's heading in the measure menu (census/index.html writes the same ones out);
// col: the details table's value column; noun: what the group's figures are.
export const GROUPS = {
  income: { label: "Income", col: "Income", noun: "incomes" },
  low: { label: "Low income and transfers", col: "Share", noun: "shares" },
  housing: { label: "Housing", col: "Share", noun: "shares" },
  costs: { label: "Housing costs and values", col: "Median", noun: "medians" },
  dwellings: { label: "Dwellings", col: "Share", noun: "shares" },
  people: { label: "People", col: "Share", noun: "shares" },
};
export const YEARS = {
  2016: { source: "da16", income: "2015", census: "2016 Census", pop: "pop16" },
  2021: { source: "da", income: "2020", census: "2021 Census", pop: "pop21" },
};
export const VIEWS = ["2016", "2021", "change"];
// The year measure m's figures refer to, for census "2016" or "2021".
export const refYear = (m, y) => (MEASURES[m].dated === "census" ? y : YEARS[y].income);
// A label inside a sentence: its first letter in lower case, the rest as written ("LIM-AT",
// "CMHC", "the City's"), and a label that opens with an abbreviation ("TTC departures") left alone.
// Never lower-case a whole label.
export const lc = (s) => (/^[A-Z][A-Z]/.test(s) ? s : s[0].toLowerCase() + s.slice(1));

export const narrow = window.matchMedia("(max-width: 640px)");
export const $ = (id) => document.getElementById(id);
export const fmtMoney = (v) => (v == null ? "—" : `$${v.toLocaleString("en-CA")}`);
export const fmtCount = (v) => (v == null ? "—" : v.toLocaleString("en-CA"));
export const fmtK = (v) => `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
export const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
export const fmtSignedMoney = (v) => (v == null ? "—" : `${sign(v)}$${Math.abs(v).toLocaleString("en-CA")}`);
export const fmtSignedK = (v) => `${sign(v)}${fmtK(Math.abs(v))}`;
export const fmtPts = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v)} pts`);
// Rates: one decimal in tables, trimmed in legends and axes. "pp" (percentage
// points) is kept distinct from "pts" (percentile points).
export const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const fmtPctShort = (v) => `${+v.toFixed(1)}%`;
export const fmtPP = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v).toFixed(1)} pp`);
export const fmtPPShort = (v) => `${sign(v)}${+Math.abs(v).toFixed(1)} pp`;
export const isMoney = (m) => MEASURES[m].unit === "money";
export const fmtVal = (m, v) => (isMoney(m) ? fmtMoney(v) : fmtPct(v));
// Monthly costs are in whole dollars; other money in thousands.
export const fmtMoneyShort = (m) => (MEASURES[m].monthly ? fmtMoney : fmtK);
export const fmtAxis = (m) => (isMoney(m) ? fmtMoneyShort(m) : fmtPctShort);
export const fmtDiff = (m, v) => (isMoney(m) ? fmtSignedMoney(v) : fmtPP(v));
export const fmtDiffShort = (m) => (isMoney(m) ? (MEASURES[m].monthly ? fmtSignedMoney : fmtSignedK) : fmtPPShort);
export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- what a link or a server can get wrong ------------------------------------------------
// Whether `key` (from a link) names an entry of a catalogue object: "constructor" and
// "toString" are on every object, and are not measures.
export const own = (obj, key) => key != null && Object.hasOwn(obj, key);
// A number from a link, or `fallback` where it isn't one in [lo, hi].
export const numIn = (text, lo, hi, fallback = null) => {
  const v = text == null || text === "" ? NaN : Number(text);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
};
// A map position from a link's at=<zoom>/<lat>/<lng>, or null where it isn't one on the globe.
export function parseAt(text) {
  const [z, lat, lng] = (text ?? "").split("/").map((x) => (x === "" ? NaN : Number(x)));
  const ok = (text ?? "").split("/").length === 3 && [z, lat, lng].every(Number.isFinite) && z >= 0 && z <= 22 && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
  return ok ? { zoom: z, center: [lng, lat] } : null;
}
// A data file the page needs: a failed request (offline, a 404 or 500) is an error here,
// not a parse failure somewhere later.
export async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split("?")[0]}: HTTP ${r.status}`);
  return r.json();
}
// For the files a page cannot draw without: say so on the page, where a blank map or empty
// headings would say nothing, and stop. Use as `await loadJSON(url).catch(loadFailed)`.
export function loadFailed(err) {
  if (!document.querySelector(".load-error")) {
    const p = document.createElement("p");
    p.className = "load-error";
    p.setAttribute("role", "alert");
    p.innerHTML = 'This page’s data didn’t load. Check your connection, then <button type="button">reload the page</button>.';
    p.querySelector("button").addEventListener("click", () => location.reload());
    (document.querySelector("main") ?? document.body).prepend(p);
  }
  throw err;
}
