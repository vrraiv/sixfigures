// The neighbourhood pages (scripts/nbhd-pages.mjs), made in memory as the build makes them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { description, indexPage, nbhdData, nbhdPage, nbhdPaths, title } from "./nbhd-pages.mjs";
import { ORIGIN, sitemap } from "./site-nav.mjs";
import { slug } from "../web/src/text.js";

const X = nbhdData(), N = X.N, paths = nbhdPaths(X.D);
const pages = X.D.nbhd.map((_, i) => nbhdPage(X, i));
const at = (name) => X.D.nbhd.findIndex((n) => n.name === name);

test("each neighbourhood has its own address, and the addresses don't move", () => {
  assert.equal(N, 158);
  assert.equal(new Set(paths).size, N);
  for (const p of paths) assert.match(p, /^\/n\/[a-z0-9]+(-[a-z0-9]+)*\/$/);
  // search engines keep these: a change here breaks links already out there
  assert.equal(slug("South Riverdale"), "south-riverdale");
  assert.equal(slug("O'Connor-Parkview"), "oconnor-parkview");
  assert.equal(slug("Cabbagetown-South St.James Town"), "cabbagetown-south-st-james-town");
  assert.equal(slug("Wexford/Maryvale"), "wexford-maryvale");
  assert.equal(slug("L'Amoreaux West"), "lamoreaux-west");
});

test("titles and descriptions are each the page's own, and fit a search result", () => {
  const ds = X.D.nbhd.map((_, i) => description(X, i));
  assert.equal(new Set(ds).size, N);
  for (const d of ds) assert.ok(d.length <= 160 && d.length > 60, d);
  assert.equal(new Set(X.D.nbhd.map((n) => title(n.name))).size, N);
});

test("no page shows a figure it doesn't have", () => {
  for (const [i, html] of pages.entries()) assert.ok(!/undefined|NaN|null|\[object/.test(html.replace(/<path d="[^"]*"/g, "")), X.D.nbhd[i].name);
  // a neighbourhood without school results says so, rather than 0
  const g3 = X.M["schools.g3_math"], none = g3.values.findIndex((v) => v == null);
  if (none >= 0) assert.match(pages[none], /Grade 3[^<]*math[\s\S]*?<td>—<span class="nbp-per">[^<]*<\/span><\/td><td>no figure<\/td>/i);
});

test("ranks run from the highest, among the neighbourhoods with a figure", () => {
  const m = X.M["census.med_hh_tot"], v = m.values, top = v.indexOf(Math.max(...v.filter((x) => x != null)));
  assert.deepEqual(X.rank(v, top), { r: 1, of: v.filter((x) => x != null).length });
});

test("each page links its closest matches, the Explorers, the census map and the index, all to real pages", () => {
  for (const [i, html] of pages.entries()) {
    const n = X.D.nbhd[i];
    for (const [, href] of html.matchAll(/href="(\/n\/[^"]*)"/g)) assert.ok(href === "/n/" || paths.includes(href), `${n.name}: ${href}`);
    assert.ok(!html.includes(`href="${paths[i]}"`), `${n.name} links itself`);
    assert.ok(html.includes(`/insights/neighbourhoods/#nb=${n.id}"`) && html.includes(`/insights/explorer/#nb=${n.id}"`), n.name);
    assert.match(html, /href="\/census\/#m=med_hh_tot&amp;y=2021&amp;at=13\/[-\d.]+\/[-\d.]+&amp;o=nbhd"/);
  }
  // the closest match is the Explorer's: the first in order of affinity, every theme counted
  const i = at("South Riverdale"), [, j] = X.order(i)[0];
  assert.ok(pages[i].indexOf(`href="${paths[j]}"`) < pages[i].indexOf("Least alike") && pages[i].indexOf(`href="${paths[j]}"`) > pages[i].indexOf("Most alike"));
});

test("the index lists every neighbourhood once, and the sitemap every page", () => {
  const html = indexPage(X);
  for (const p of paths) assert.equal((html.match(new RegExp(`<li><a href="${p}"`, "g")) ?? []).length, 1, p);
  const locs = [...sitemap(paths).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const p of ["/n/", ...paths]) assert.ok(locs.includes(`${ORIGIN}${p}`), p);
});
