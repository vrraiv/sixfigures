// The committed figures must be figures: no dollar value of $0, no percentage outside 0 to 100,
// flags that are 1 or 0, and DA values that add back up to the city's. Each check is one a past
// rebuild got wrong (pipeline/measures.py null_unpublished, pipeline/insights.py check_city).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const PUBLIC = "web/public";
const FIGURES = `${PUBLIC}/data/figures`;
const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const breaks = json(`${PUBLIC}/breaks.json`);
const MEASURES = breaks.measures;
const YEARS = readdirSync(FIGURES).sort();
const figures = (year, m) => json(`${FIGURES}/${year}/${m}.json`);
// a line per offender, the first few
const list = (bad) => `${bad.length}: ${bad.slice(0, 5).join(", ")}`;

test("every census has a figures file for every measure", () => {
  assert.deepEqual(YEARS, ["2011", "2016", "2021"]);
  for (const y of YEARS) {
    assert.deepEqual(readdirSync(`${FIGURES}/${y}`).sort(), ["common", ...Object.keys(MEASURES)].map((m) => `${m}.json`).sort(), y);
  }
});

test("no dollar figure is $0 or less; no percentage is outside 0 to 100", () => {
  for (const y of YEARS) {
    const { dauid } = figures(y, "common");
    for (const [m, { unit }] of Object.entries(MEASURES)) {
      const f = figures(y, m);
      for (const key of ["v", "v16"]) {
        if (!f[key]) continue;
        assert.equal(f[key].length, dauid.length, `${y} ${m}.${key}: one value per DA`);
        const bad = f[key].flatMap((v, i) => (v != null && (unit === "money" ? v <= 0 : v < 0 || v > 100) ? [`DA ${dauid[i]} = ${v}`] : []));
        assert.equal(bad.length, 0, `${y} ${m}.${key}: ${list(bad)}`);
      }
      for (const key of ["pct", "p16"]) {
        if (!f[key]) continue;
        const bad = f[key].flatMap((p, i) => (p != null && !(Number.isInteger(p) && p >= 1 && p <= 100) ? [`DA ${dauid[i]} = ${p}`] : []));
        assert.equal(bad.length, 0, `${y} ${m}.${key} percentile: ${list(bad)}`);
      }
    }
  }
});

test("the neighbourhood figures hold no $0 and no percentage outside 0 to 100", () => {
  const ins = json(`${PUBLIC}/insights.json`);
  for (const [m, { values }] of Object.entries(ins.measures)) {
    for (const [y, vs] of Object.entries(values)) {
      assert.equal(vs.length, ins.nbhd.length, `${m} ${y}`);
      const bad = vs.flatMap((v, i) => (v != null && (MEASURES[m].unit === "money" ? v <= 0 : v < 0 || v > 100) ? [`${ins.nbhd[i].name} = ${v}`] : []));
      assert.equal(bad.length, 0, `${m} ${y}: ${list(bad)}`);
    }
  }
});

// All DAs taken together should give back the value Statistics Canada publishes for the city:
// an average weighted on the wrong base, or a placeholder counted as a value, shows up here.
// [measure, weight of a DA, tolerance]: people for a share of people, households for a household
// average, total household income for a share of income.
const BASES = [
  ["lim_at", (c, i) => c.pop[i], 1],
  ["avg_hh_tot", (c, i) => c.hh[i], 0.03],
  ["transfers", (c, i, avg) => (avg[i] == null ? null : c.hh[i] * avg[i]), 1],
];
test("DA figures, weighted on each measure's base, reproduce the published city values", () => {
  const b11 = json(`${PUBLIC}/breaks_2011.json`).measures;
  for (const y of YEARS) {
    const common = figures(y, "common");
    const c = { pop: common[`pop${y.slice(2)}`], hh: common.hh };
    const avg = figures(y, "avg_hh_tot").v;
    for (const [m, weight, tolerance] of BASES) {
      const v = figures(y, m).v;
      let sum = 0, total = 0;
      v.forEach((x, i) => {
        const w = weight(c, i, avg);
        if (x == null || w == null) return;
        sum += x * w;
        total += w;
      });
      const got = sum / total, city = (y === "2011" ? b11[m].y2011 : MEASURES[m][`y${y}`]).city;
      const off = MEASURES[m].unit === "money" ? Math.abs(got - city) / city : Math.abs(got - city);
      assert.ok(off <= tolerance, `${y} ${m}: the DAs give ${got.toFixed(1)}, the city's published value is ${city}`);
    }
  }
});

test("the CSV downloads flag an unchanged boundary with 1 or 0", () => {
  for (const [file, column] of [["toronto_da_income_2021.csv", "same_boundary_2016"], ["toronto_da_income_2016.csv", "same_boundary_2021"], ["toronto_da_income_2011.csv", "same_boundary_2016"]]) {
    const text = readFileSync(`${PUBLIC}/data/${file}`, "utf8");
    assert.ok(!text.includes('"'), `${file}: no quoted fields, so a line splits on its commas`);
    const [head, ...rows] = text.trim().split("\n");
    const at = head.split(",").indexOf(column);
    assert.ok(at > 0, `${file}: has ${column}`);
    assert.deepEqual([...new Set(rows.map((r) => r.split(",")[at]))].sort(), ["0", "1"], `${file} ${column}`);
  }
});

test("breaks.json carries the CPI that pipeline/cpi.json holds", () => {
  const cpi = json("pipeline/cpi.json");
  for (const [k, v] of Object.entries(cpi)) assert.deepEqual(breaks.cpi[k], v, `cpi.${k}`);
});
