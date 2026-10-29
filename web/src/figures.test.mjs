// node --test web/src/figures.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { Figures, classIndex } from "./figures.js";

const FILES = {
  "/data/figures/2021/common.json?v=dev": { dauid: ["35200001", "35200002"], nbhd: ["A", "B"], nbhd_id: [1, 2], nbhd2: [null, "C"], pop21: [300, 500], hh: [100, 200], rel: [1, 0] },
  "/data/figures/2021/med_hh_tot.json?v=dev": { v: [90000, null], pct: [60, null], v16: [80000, null], p16: [55, null] },
  "/data/figures/2021/renter.json?v=dev": { v: [40.5, 70], pct: [30, 80], v16: [42, null], p16: [35, null] },
};

function fake() {
  const calls = [];
  const fetchJSON = async (url) => {
    calls.push(url);
    if (!FILES[url]) throw new Error(`404 ${url}`);
    return structuredClone(FILES[url]);
  };
  return { calls, f: new Figures("2021", fetchJSON) };
}

test("props joins common and measure columns in common.json's order", async () => {
  const { f } = fake();
  await f.load("med_hh_tot", "renter");
  assert.deepEqual(f.props("35200001", ["med_hh_tot", "renter"]), {
    dauid: "35200001", nbhd: "A", nbhd_id: 1, nbhd2: null, pop21: 300, hh: 100, rel: 1,
    med_hh_tot: 90000, pct_med_hh_tot: 60, v16_med_hh_tot: 80000, p16_med_hh_tot: 55,
    renter: 40.5, pct_renter: 30, v16_renter: 42, p16_renter: 35,
  });
  const p = f.props("35200002", ["med_hh_tot"]);
  assert.equal(p.med_hh_tot, null, "a suppressed value is null");
  assert.equal(p.rel, 0);
  assert.equal(f.props("99999999"), null);
});

test("each file is fetched once; a failure is retried", async () => {
  const { f, calls } = fake();
  await Promise.all([f.load("renter"), f.load("renter"), f.file("renter")]);
  assert.deepEqual(calls, ["/data/figures/2021/common.json?v=dev", "/data/figures/2021/renter.json?v=dev"]);
  assert.ok(f.has("renter"));
  assert.ok(!f.has("med_hh_tot"));
  await assert.rejects(f.load("missing"));
  await assert.rejects(f.load("missing"));
  assert.equal(calls.filter((u) => u.includes("missing")).length, 2);
  // Only the measures loaded so far appear in props; an unloaded one is skipped.
  assert.ok(!("med_hh_tot" in f.props("35200001", ["med_hh_tot", "renter"])));
});

test("classIndex matches MapLibre's step expression", () => {
  const stops = [10, 20, 30];
  assert.equal(classIndex(5, stops), 0);
  assert.equal(classIndex(10, stops), 1);
  assert.equal(classIndex(29.9, stops), 2);
  assert.equal(classIndex(30, stops), 3);
  assert.equal(classIndex(-5, [-20, -10, -3, 3, 10, 20]), 2);
});
