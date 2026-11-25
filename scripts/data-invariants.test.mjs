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

test("Getting around: whole months in order, and no neighbourhood with more trips than the city", () => {
  const t = json(`${PUBLIC}/transport.json`);
  const next = (m) => (m.endsWith("-12") ? `${+m.slice(0, 4) + 1}-01` : `${m.slice(0, 5)}${String(+m.slice(5) + 1).padStart(2, "0")}`);
  for (const [name, months] of [["bike", t.bike.months], ["ridehail", t.ridehail.months], ["subway", t.subway.months], ["counters", t.counters.months], ["nb", t.nb.months]]) {
    months.slice(1).forEach((m, k) => assert.equal(m, next(months[k]), `${name}: ${m} follows ${months[k]}`));
  }
  assert.equal(t.nbhd.length, 158);
  t.nb.months.forEach((m, k) => {
    const city = t.bike.trips[t.bike.months.indexOf(m)];
    for (const rows of [t.nb.starts, t.nb.ends]) {
      assert.equal(rows[k].length, 158, `${m}: a figure for every neighbourhood`);
      const sum = rows[k].reduce((a, v) => a + v, 0);
      assert.ok(sum <= city, `${m}: the neighbourhoods' ${sum} trips are within the city's ${city}`);
      assert.ok(sum >= 0.95 * city, `${m}: ${((sum / city) * 100).toFixed(1)}% of trips are at a station with a place`);
    }
  });
  for (const nb of t.ttc.nb) {
    for (const k of ["frequent", "rapid"]) assert.ok(nb[k].every((v) => v != null && v >= 0 && v <= 100), `TTC ${k}: a share of residents for every neighbourhood`);
    assert.ok(nb.weekday.bus.every((v) => v >= 0), "TTC departures are counts");
  }
  t.ttc.city.forEach((c, k) => {
    const nbAll = ["bus", "streetcar", "subway"].reduce((a, m) => a + t.ttc.nb[k].weekday[m].reduce((s, v) => s + v, 0), 0);
    const all = Object.values(c.weekday).reduce((a, v) => a + v, 0);
    assert.equal(nbAll, all, `${t.ttc.feeds[k]}: the neighbourhoods' weekday departures add to the city's`);
  });
  t.bike.months.forEach((m, k) => {
    if (t.bike.member[k] != null) assert.equal(t.bike.member[k] + t.bike.casual[k], t.bike.trips[k], `${m}: members and casual riders add to the trips`);
  });
});

test("Trees: the tree points' shares are shares, and the owner groups add to the points", () => {
  const t = json(`${PUBLIC}/trees.json`);
  assert.equal(t.nbhd.air_points.length, 158);
  for (const k of ["air_tall", "air_public"]) assert.ok(t.nbhd[k].every((v) => v >= 0 && v <= 100), `${k} is a share`);
  assert.ok(t.nbhd.air_height.every((v) => v >= 2 && v <= 50), "a median height is a tree's");
  const byGroup = t.air.groups.reduce((a, g) => a + g.bands.reduce((s, v) => s + v, 0), 0);
  assert.equal(byGroup, t.air.points, "the height bands by owner add to the points kept");
  assert.equal(t.nbhd.air_points.reduce((a, v) => a + v, 0), t.air.points, "the neighbourhoods' points add to the city's");
});

test("Neighbourhood Explorer: every neighbourhood has a share of runs with each kind, highest with its own", () => {
  const n = json(`${PUBLIC}/neighbourhoods.json`);
  assert.equal(n.grouped.length, n.nbhd.length);
  const bad = [];
  n.grouped.forEach((g, i) => {
    const ok = g.length === n.types.length && g.every((v) => Number.isInteger(v) && v >= 0 && v <= 100);
    // the kinds are clusters of that agreement, so a neighbourhood sits with its own kind most often
    if (!ok || g[n.type[i]] !== Math.max(...g)) bad.push(n.nbhd[i].name);
  });
  assert.deepEqual(bad, [], list(bad));
});

// The Sixplex experiment (pipeline/sixplex_insights.py): every ward in one group, the estimate
// what its four totals give, inside its own range, and the totals those of the quarterly series.
test("the sixplex estimate follows from its counts and sits inside its range", () => {
  const d = json(`${PUBLIC}/sixplex.json`);
  const arms = Object.groupBy(d.wards, (w) => w.arm);
  assert.deepEqual([d.wards.length, arms.six.length, arms.four.length, arms.early.length], [25, 8, 16, 1]);
  assert.deepEqual(arms.six.map((w) => +w.ward), [4, 9, 10, 11, 12, 13, 14, 19]);
  const m = d.main, [p0, p1] = d.pre, [a0, a1] = d.post;
  assert.equal(d.quarters[p0], "2023 Q3");
  assert.equal(d.quarters[a0], "2025 Q3");
  assert.equal(a1, d.quarters.length - 1);
  const total = (vs, a, b) => vs.slice(a, b + 1).reduce((s, v) => s + v, 0);
  assert.equal(total(d.arms.plex_homes.six, p0, p1), m.t0);
  assert.equal(total(d.arms.plex_homes.six, a0, a1), m.t1);
  assert.equal(total(d.arms.plex_homes.four, a0, a1), m.c1);
  assert.equal(arms.six.reduce((s, w) => s + w.post, 0), m.t1);
  for (const k of ["six", "four", "early"]) {
    d.arms.plex_homes[k].forEach((v, q) => assert.equal(v, d.arms.small_homes[k][q] + d.arms.big_homes[k][q], `${k} ${d.quarters[q]}: small and big homes add up`));
  }
  const expected = (m.t0 * m.c1) / m.c0;
  assert.ok(Math.abs(m.expected - expected) < 0.06 && Math.abs(m.extra - (m.t1 - expected)) < 0.06, "the extra homes are those beyond the other wards' pace");
  assert.ok(m.lo <= m.ratio && m.ratio <= m.hi && m.extra_lo <= m.extra && m.extra <= m.extra_hi, "the estimate is inside its range");
  assert.ok(m.p > 0 && m.p <= 1);
  assert.equal(d.leave.length, 24);
  // the headline: the trend before, fading; between the catch-up stopping and never slowing
  const h = d.headline;
  assert.equal(h.t1, m.t1);
  assert.ok(Math.abs(h.extra - (h.t1 - h.expected)) < 0.06 && h.lo <= h.ratio && h.ratio <= h.hi && h.extra_lo <= h.extra && h.extra <= h.extra_hi, "the headline is inside its range");
  assert.ok(h.p > 0 && h.p <= 1 && h.phi > 0 && h.phi < 1 && h.floor > 0);
  const [a, b] = [d.fades.stop.extra, d.fades.full.extra].sort((x, y) => x - y);
  assert.ok(a <= h.extra && h.extra <= b, "fading sits between stopping and never slowing");
  assert.equal(d.expected_fading.filter((v) => v != null).length, a1 - a0 + 1);
  assert.ok(Math.abs(d.expected_fading.reduce((s, v) => s + (v ?? 0), 0) - h.expected) < 1);
  assert.equal(d.headline_leave.length, 24);
  assert.deepEqual(d.headline_placebos.map((c) => c.key), d.placebos.map((c) => c.key));
});

test("Housing multiplexes: whole months, the wards add to the city, the sixplex wards are the by-law's", () => {
  const { multiplex: m } = json(`${PUBLIC}/housing.json`);
  // every number in a nest of objects and arrays, summed
  const total = (o) => (Array.isArray(o) ? o.reduce((a, v) => a + v, 0) : Object.values(o).reduce((a, v) => a + total(v), 0));
  assert.match(m.last_month, /^\d{4}-\d{2}$/);
  assert.ok(m.last_month < m.retrieved.slice(0, 7), "the last month is a whole month before the retrieval date");
  assert.equal(m.quarters.at(-1), `${m.last_month.slice(0, 4)}Q${Math.ceil(+m.last_month.slice(5) / 3)}`);
  assert.equal(m.partial_quarter == null, +m.last_month.slice(5) % 3 === 0, "a quarter is partial unless the month ends it");
  assert.equal(m.wards.length, 25);
  assert.deepEqual(m.wards.filter((w) => w.sixplex).map((w) => +w.code.slice(1)).sort((a, b) => a - b), [4, 9, 10, 11, 12, 13, 14, 19, 23]);
  for (const sz of ["3-4", "5-6"]) {
    m.quarters.forEach((q, k) => {
      const byWard = m.wards.reduce((a, w) => a + w[sz][k], 0);
      const byWork = ["inside", "outside"].reduce((a, ar) => a + m.city[ar][sz].new[k] + m.city[ar][sz].conversion[k], 0);
      const byStatus = ["inside", "outside"].reduce((a, ar) => a + Object.values(m.status[ar][sz]).reduce((s, v) => s + v[k], 0), 0);
      assert.ok(byWard <= byWork, `${q} ${sz}: no more by ward than in the city`);
      assert.equal(byStatus, byWork, `${q} ${sz}: the statuses add to the applications`);
    });
  }
  // the neighbourhoods hold the placed projects, so no more than the city's
  assert.ok(total(m.nbhd) <= total(m.city));
  assert.ok(total(m.nbhd) >= 0.97 * total(m.city), "nearly every project is placed");
});
