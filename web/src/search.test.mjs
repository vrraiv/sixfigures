// node --test web/src/search.test.mjs
// Checks the browser lookup against the pipeline's point-in-polygon result.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { SearchIndex } from "./search.js";

const idx = new SearchIndex(JSON.parse(readFileSync(new URL("../public/search.json", import.meta.url))));
const dauids = (r) => r.results.flatMap((h) => h.das.map((i) => idx.das[i][0]));

// Written by pipeline/search_index.py (gitignored), so only present after a data build.
const SAMPLE = new URL("../../pipeline/out/search_sample.json", import.meta.url);

test("20,000 random official addresses resolve to the pipeline's DA", { skip: !existsSync(SAMPLE) && "run pipeline/search_index.py first" }, () => {
  const sample = JSON.parse(readFileSync(SAMPLE));
  const bad = [];
  for (const [addr, muni, dauid] of sample) {
    const r = idx.resolve(muni ? `${addr}, ${muni}` : addr);
    if (r.status !== "match" || !dauids(r).includes(dauid)) bad.push([addr, muni, dauid, r.status, r.message]);
    // Without the municipality: either a direct match or a choice that includes it.
    const r2 = idx.resolve(addr);
    if (r2.status === "error" || !dauids(r2).includes(dauid)) bad.push([addr, null, dauid, r2.status, r2.message]);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test("input variants reach the same official address", () => {
  const base = dauids(idx.resolve("100 Queen St W"));
  assert.equal(base.length, 1);
  for (const q of [
    "100 queen street west", "100 Queen St. W.", "100 QUEEN ST W, Toronto, ON",
    "100 Queen St W, Toronto, ON M5H 2N2", "Unit 5, 100 Queen St W", "100 Queen St W #1203",
    "1203-100 Queen St W", "100 Queen St W, former Toronto",
  ]) {
    const r = idx.resolve(q);
    assert.equal(r.status, "match", q);
    assert.deepEqual(dauids(r), base, q);
  }
});

test("city, province and postal code are ignored with or without commas", () => {
  const base = dauids(idx.resolve("100 Queen St W"));
  for (const q of [
    "100 Queen St W Toronto", "100 Queen St W Toronto ON", "100 Queen St W, Toronto ON",
    "100 Queen St W, Toronto ON M5H 2N2", "100 Queen St W Toronto, Ontario, Canada",
    "100 Queen St W, City of Toronto",
  ]) {
    const r = idx.resolve(q);
    assert.equal(r.status, "match", q);
    assert.deepEqual(dauids(r), base, q);
  }
});

test("Toronto streets named after other municipalities are not refused", () => {
  for (const q of ["20 Markham", "20 Markham Rd", "12 Vaughan", "1 Peel", "12 Vaughan Rd, Toronto ON"]) {
    assert.notEqual(idx.resolve(q).status, "error", q);
  }
  assert.ok(idx.suggest("20 Markham").length > 0);
  assert.match(idx.resolve("100 City Centre Dr Mississauga").message, /City of Toronto only/);
  assert.match(idx.resolve("100 City Centre Dr, Mississauga, ON").message, /City of Toronto only/);
});

test("street type or direction can be omitted when unambiguous", () => {
  assert.equal(idx.resolve("100 Queen St W").status, "match");
  const r = idx.resolve("100 Queen"); // Queen St E and Queen St W both have 100
  assert.equal(r.status, "choose");
  assert.ok(r.results.length >= 2);
});

test("letter suffixes", () => {
  const r = idx.resolve("17C Overlea Blvd");
  assert.equal(r.status, "match");
  assert.deepEqual(dauids(r), dauids(idx.resolve("17 c overlea boulevard")));
});

test("same address in several former municipalities asks which one", () => {
  const r = idx.resolve("1 Byng Ave");
  assert.equal(r.status, "choose");
  assert.deepEqual(r.results.map((h) => h.detail).sort(), ["Etobicoke", "North York", "Scarborough"]);
  assert.equal(idx.resolve("1 Byng Ave, Scarborough").status, "match");
});

test("graceful failures", () => {
  let r = idx.resolve("99999 Yonge St");
  assert.equal(r.status, "error");
  assert.match(r.message, /isn't an official address/);
  assert.match(r.hint, /Nearest listed numbers/);
  r = idx.resolve("100 City Centre Dr, Mississauga");
  assert.match(r.message, /City of Toronto only/);
  r = idx.resolve("100 City Centre Dr Mississauga");
  assert.match(r.message, /City of Toronto only/);
  r = idx.resolve("12 Notastreet Rd");
  assert.match(r.message, /No street called/);
  assert.match(idx.resolve("").message, /Type a Toronto/);
  assert.match(idx.resolve("Yonge St").message, /house number|cross street/);
  assert.match(idx.resolve("Yonge & Notastreet").message, /No street called/);
  // Markham Rd is a Toronto street, not the municipality
  assert.equal(idx.resolve("20 Markham Rd").status, "match");
});

test("intersections", () => {
  const r = idx.resolve("Yonge & Bloor");
  assert.ok(["match", "choose"].includes(r.status));
  assert.ok(r.results.some((h) => /Yonge St/.test(h.label) && /Bloor St/.test(h.label)));
  for (const q of ["yonge and bloor", "Bloor St W / Yonge St", "Yonge St at Bloor St E"]) {
    assert.notEqual(idx.resolve(q).status, "error", q);
  }
  // "King" must not match "Kingston Rd"
  const k = idx.resolve("King St W & Spadina Ave");
  assert.ok(k.results.every((h) => !/Kingston/.test(h.label)));
});

test("DAUID lookup", () => {
  assert.equal(idx.resolve("35204576").status, "match");
  assert.equal(idx.resolve("DA 35204576").status, "match");
  assert.match(idx.resolve("35000001").message ?? "", /.*/);
});

test("typeahead offers only official addresses", () => {
  const s = idx.suggest("100 Queen");
  assert.ok(s.length >= 2);
  for (const x of s) assert.equal(idx.resolve(x.text).status, "match", x.text);
  const b = idx.suggest("1 Byng");
  assert.ok(b.length >= 3);
  for (const x of b) assert.equal(idx.resolve(x.text).status, "match", x.text);
});
