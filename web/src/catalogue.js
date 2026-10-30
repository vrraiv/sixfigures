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
  med_ind_tot: { group: "income", unit: "money", stat: "median", short: "Individual, total", long: "Median total income of recipients (15+)" },
  med_ind_at: { group: "income", unit: "money", stat: "median", short: "Individual, after tax", long: "Median after-tax income of recipients (15+)" },
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
// col: the details table's value column; noun: what the group's figures are.
export const GROUPS = {
  income: { col: "Income", noun: "incomes" }, low: { col: "Share", noun: "shares" }, housing: { col: "Share", noun: "shares" },
  costs: { col: "Median", noun: "medians" }, dwellings: { col: "Share", noun: "shares" }, people: { col: "Share", noun: "shares" },
};
export const YEARS = {
  2016: { source: "da16", income: "2015", census: "2016 Census", pop: "pop16" },
  2021: { source: "da", income: "2020", census: "2021 Census", pop: "pop21" },
};
export const VIEWS = ["2016", "2021", "change"];
// The year measure m's figures refer to, for census "2016" or "2021".
export const refYear = (m, y) => (MEASURES[m].dated === "census" ? y : YEARS[y].income);
export const lc = (s) => s[0].toLowerCase() + s.slice(1); // keeps "LIM-AT"

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
