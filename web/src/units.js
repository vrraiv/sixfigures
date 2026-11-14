// Formatting a figure by its unit, shared by the Data Explorer and the Neighbourhood Explorer.
// A measure definition d carries d.unit: money, pct, rate, score, degC, temp, index or pts.
import { sign } from "./catalogue.js";

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
export const lc = (s) => (/^[A-Z][a-z]/.test(s) && !/^(Grade|Gr |Norway|John|Olivia|Ana|Tory|Chow|Bail|Airbnb|CMHC|Shannon)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
