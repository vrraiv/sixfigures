// A page for each of the 158 neighbourhoods, /n/<slug>/, and an index of them, /n/: plain HTML
// written at build time (vite.config.js calls writeNbhdPages() and builds them as pages), so a search
// engine or a reader without script sees every figure. Drawn from the files the Explorers read:
//
//   web/public/neighbourhoods.json      every measure, its percentile ranks, themes and kinds (pipeline/affinity.py)
//   web/public/explorer/catalogue.json  each measure's definition (`note`)
//   web/public/explorer/census.json     the census measures in 2006, 2011, 2016 and 2021
//   web/public/insights.json            each neighbourhood's point, for the census map's link
//
// The pages go to web/n/ (ignored by git: they are rebuilt from those files every build). Ranks are
// among the neighbourhoods with a figure, highest first; a neighbourhood without one gets none, not 0.
// The closest matches use affinity.js, as the Neighbourhood Explorer does with every theme counted.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { overallGaps, themeGaps } from "../web/src/affinity.js";
import { escapeHTML as esc, nbPage, ordinal, slug } from "../web/src/text.js";
import { fmt, lc } from "../web/src/units.js";
import { mapHref } from "./city-map.mjs";

const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const OUT = "web/n";
// the figures at the top of each page
const GLANCE = ["census.med_hh_tot", "census.lim_at", "census.renter", "prices.price", "housing.avg_rent", "trees.canopy"];
const ALIKE = 5, UNLIKE = 3;
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function nbhdData() {
  const D = read("web/public/neighbourhoods.json"), cat = read("web/public/explorer/catalogue.json");
  const census = read("web/public/explorer/census.json"), ins = read("web/public/insights.json");
  const N = D.nbhd.length;
  const M = Object.fromEntries(D.measures.map((m) => [m.id, m]));
  const CAT = Object.fromEntries(cat.measures.map((m) => [m.id, m]));
  // rank among those with a figure, highest first; ties share a rank
  const rank = (values, i) => {
    const v = values[i];
    if (v == null) return null;
    const known = values.filter((x) => x != null);
    return { r: 1 + known.filter((x) => x > v).length, of: known.length };
  };
  const overall = overallGaps(Object.values(themeGaps(D)), new Float32Array(N * N));
  const aff = (i, j) => (Number.isNaN(overall[i * N + j]) ? null : 100 - overall[i * N + j]);
  const order = (i) => D.nbhd.map((_, j) => [j === i ? null : aff(i, j), j]).filter(([a]) => a != null)
    .sort((x, y) => y[0] - x[0] || D.nbhd[x[1]].name.localeCompare(D.nbhd[y[1]].name));
  const typical = D.nbhd.map((_, i) => { const o = order(i); return o.length ? o.reduce((s, [a]) => s + a, 0) / o.length : null; }).filter((v) => v != null);
  const cityMean = typical.reduce((a, v) => a + v, 0) / typical.length;
  return { D, N, M, CAT, census, ins, rank, order, cityMean };
}

export const nbhdPaths = (D = read("web/public/neighbourhoods.json")) => D.nbhd.map((n) => nbPage(n.name));

// ---- pieces -----------------------------------------------------------------------------------------
const head = (title, desc) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="description" content="${esc(desc)}" />
  </head>
  <body class="with-nav doc">
    <!-- site-header -->`;
const FOOT = `
    <footer class="foot">
      Statistics Canada, the 2006, 2011, 2016 and 2021 Censuses of Population and the 2011 National Household Survey, under the
      <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence - Canada</a>.
      City of Toronto Open Data (Toronto Police Service, collisions, building permits, development applications, apartment
      registry, street trees, tree canopy, Bike Share, TTC schedules, election results); contains information licensed under the
      <a href="https://open.toronto.ca/open-data-licence/">Open Government Licence - Toronto</a>.
      Canada Mortgage and Housing Corporation, Rental Market Survey. EQAO results through the Ontario Ministry of Education.
      TRREB community reports. Landsat 8 and 9 courtesy of the U.S. Geological Survey. Inside Airbnb (insideairbnb.com), CC BY 4.0.
      <a href="https://github.com/vrraiv/sixfigures">Source</a>
    </footer>
    <div id="tip" class="tip" role="tooltip" hidden></div>
    <script type="module" src="/src/nbpage.js"></script>
  </body>
</html>
`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "today" -> "current", "2026-09-16" -> "Sep 2026"
const period = (p) => (p === "today" ? "current" : /^\d{4}-\d{2}-\d{2}$/.test(p) ? `${MONTHS[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : p);
// a measure's name; its definition is in the list at the foot of the page, and web/src/nbpage.js
// shows it on hover too (written once, not beside every use)
const named = (CAT, id, label) => (CAT[id]?.note ? `<span class="def" data-def="${id}">${esc(label)}</span>` : esc(label));
const rankText = (rk) => (rk ? `${ordinal(rk.r)} of ${rk.of}` : "no figure");

// the city, with one neighbourhood lit (or, for the index, every one a link)
function cityMap(D, lit, { links = false } = {}) {
  const { width, height } = D.map;
  const shape = (n, i) => {
    const p = `<path d="${n.path}"${i === lit ? ' class="lit"' : ""}><title>${esc(n.name)}</title></path>`;
    return links ? `<a href="${nbPage(n.name)}" tabindex="-1">${p}</a>` : p;
  };
  // the lit one last, so its outline is drawn over its neighbours'
  const idx = D.nbhd.map((_, i) => i).filter((i) => i !== lit);
  if (lit != null) idx.push(lit);
  return `<svg class="nbp-city" viewBox="-4 -4 ${width + 8} ${height + 8}" aria-hidden="true" focusable="false">${idx.map((i) => shape(D.nbhd[i], i)).join("")}</svg>`;
}

// ---- one neighbourhood ----------------------------------------------------------------------------------
export function description(X, i) {
  const { D, M } = X, name = D.nbhd[i].name;
  const parts = [];
  const inc = M["census.med_hh_tot"].values[i], rent = M["census.renter"].values[i];
  if (inc != null) parts.push(`median household income ${fmt(M["census.med_hh_tot"], inc)}`);
  if (rent != null) parts.push(`${Math.round(rent)}% renting`);
  const tail = "crime, schools, trees and transit, ranked among Toronto's 158 neighbourhoods.";
  for (let k = parts.length; k >= 0; k--) {
    const d = `${name}, Toronto, in figures: ${[...parts.slice(0, k), tail].join("; ")}`;
    if (d.length <= 160) return d;
  }
  return `${name}, Toronto: ${tail}`;
}
export const title = (name) => `${name}: Toronto neighbourhood profile`;

export function nbhdPage(X, i) {
  const { D, M, CAT, census, ins, rank, order, cityMean } = X;
  const n = D.nbhd[i], name = esc(n.name), kind = D.types[D.type[i]];
  const glance = GLANCE.filter((id) => M[id]).map((id) => {
    const m = M[id], v = m.values[i], rk = rank(m.values, i);
    return `<div><dt>${named(CAT, id, m.short)}</dt><dd><b>${fmt(m, v)}</b><span>${v == null ? "no figure" : `${period(m.period)} · ${rankText(rk)}`}</span></dd></div>`;
  }).join("");
  const themes = D.themes.map((t) => {
    const rows = t.measures.map((id) => {
      const m = M[id], v = m.values[i];
      return `<tr><th scope="row">${named(CAT, id, m.label)}</th><td>${fmt(m, v)}<span class="nbp-per">${esc(period(m.period))}</span></td><td>${rankText(rank(m.values, i))}</td></tr>`;
    }).join("");
    return `
      <section class="ins-section" id="${t.key}" aria-labelledby="${t.key}-h">
        <div class="ins-head"><h2 id="${t.key}-h">${esc(t.label)}</h2></div>
        <div class="tbl-wrap"><table class="tbl nbp-tbl"><thead><tr><th scope="col">Measure</th><th scope="col">Figure</th><th scope="col">Rank</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>`;
  }).join("");
  // since 2006: the census measures that go back that far, at each census
  const years = D.history.periods;
  const histRows = Object.values(D.history.themes).flat().filter((id) => census[id.replace(/^census\./, "")]).map((id) => {
    const m = M[id] ?? CAT[id], vals = census[id.replace(/^census\./, "")];
    return `<tr><th scope="row">${named(CAT, id, m.label)}</th>${years.map((_, y) => `<td>${fmt(m, vals[y]?.[i] ?? null)}</td>`).join("")}</tr>`;
  }).join("");
  const o = order(i);
  const item = ([a, j]) => `<li><a href="${nbPage(D.nbhd[j].name)}">${esc(D.nbhd[j].name)}</a> <span class="vl">${Math.round(a)}</span></li>`;
  const defs = [...new Set([...GLANCE, ...D.themes.flatMap((t) => t.measures)])].filter((id) => CAT[id]?.note && M[id])
    .map((id) => `<li data-def="${id}"><b>${esc(M[id].label)}:</b> <span>${esc(CAT[id].note)}</span></li>`).join("");
  const ex = `#nb=${n.id}`;
  return `${head(title(n.name), description(X, i))}
    <section class="bar" aria-label="This page">
      <h1>${name} <span class="sub">One of Toronto's ${X.N} neighbourhoods, in figures</span></h1>
    </section>

    <main class="insights nbp">
      <div class="nbp-top">
        <figure class="nbp-fig">${cityMap(D, i)}<figcaption>${name} in the City of Toronto.</figcaption></figure>
        <div class="nbp-intro">
          <p class="ins-lede">${name} is one of the City of Toronto's ${X.N} official neighbourhoods. This page gathers its figures from across the site: each is ranked among the neighbourhoods that have one, highest first, whatever the measure.</p>
          <p class="ins-lede">Of the Neighbourhood Explorer's ${WORDS[D.types.length]} <a href="/insights/neighbourhoods/${ex}">kinds of neighbourhood</a>, it is one of the <b>${esc(lc(kind.name))}</b>: ${esc(lc(kind.blurb))}</p>
          <ul class="nbp-go">
            <li><a href="${mapHref(ins.nbhd[i])}">See it on the census map</a></li>
            <li><a href="/insights/neighbourhoods/${ex}">Compare it in the Neighbourhood Explorer</a></li>
            <li><a href="/insights/explorer/${ex}">Chart its figures in the Data Explorer</a></li>
            <li><a href="/n/">All ${X.N} neighbourhoods, A–Z</a></li>
          </ul>
        </div>
      </div>

      <section class="ins-section" id="glance" aria-labelledby="glance-h">
        <div class="ins-head"><h2 id="glance-h">At a glance</h2></div>
        <dl class="nbp-glance">${glance}</dl>
      </section>
${themes}
      <section class="ins-section" id="since" aria-labelledby="since-h">
        <div class="ins-head"><h2 id="since-h">Since 2006</h2></div>
        <p class="ins-lede">The census measures that go back to 2006, at each census. So that a trend is real change, incomes are in 2020 dollars and home values, rents and owners' costs in 2021 dollars (Toronto CPI); incomes are for the year before each census.</p>
        <div class="tbl-wrap"><table class="tbl nbp-tbl"><thead><tr><th scope="col">Measure</th>${years.map((y) => `<th scope="col">${y}</th>`).join("")}</tr></thead><tbody>${histRows}</tbody></table></div>
      </section>

      <section class="ins-section" id="alike" aria-labelledby="alike-h">
        <div class="ins-head"><h2 id="alike-h">Most and least alike</h2></div>
        <p class="ins-lede">Affinity out of 100 across all ${WORDS[D.themes.length]} themes, as the <a href="/insights/neighbourhoods/${ex}">Neighbourhood Explorer</a> works it out: 100 would be the same standing on everything, and two neighbourhoods taken at random average about ${Math.round(cityMean)}.</p>
        <div class="ranks">
          <div class="rank-col"><h3>Most alike</h3><ol class="nbp-list">${o.slice(0, ALIKE).map(item).join("")}</ol></div>
          <div class="rank-col"><h3>Least alike</h3><ol class="nbp-list">${o.slice(-UNLIKE).reverse().map(item).join("")}</ol></div>
        </div>
      </section>

      <details class="ins-section nbp-defs">
        <summary>What the measures mean</summary>
        <ul>${defs}</ul>
      </details>
    </main>
${FOOT}`;
}

// ---- the index -----------------------------------------------------------------------------------------
export function indexPage(X) {
  const { D, M } = X, inc = M["census.med_hh_tot"];
  const byName = D.nbhd.map((n, i) => [n.name, i]).sort((a, b) => a[0].localeCompare(b[0]));
  const letters = [...new Set(byName.map(([nm]) => nm[0].toUpperCase()))];
  const groups = letters.map((L) => `<section class="nbp-letter" aria-labelledby="l-${L}"><h2 id="l-${L}">${L}</h2><ul>${byName.filter(([nm]) => nm[0].toUpperCase() === L)
    .map(([nm, i]) => `<li><a href="${nbPage(nm)}">${esc(nm)}</a>${inc.values[i] == null ? "" : ` <span class="vl">${fmt(inc, inc.values[i])}</span>`}</li>`).join("")}</ul></section>`).join("");
  return `${head("Toronto's 158 Neighbourhoods, A–Z", `Every one of the City of Toronto's ${X.N} neighbourhoods, A to Z, each with a page of its figures: income, housing, people, safety, schools, trees and transit.`)}
    <section class="bar" aria-label="This page">
      <h1>Neighbourhoods A–Z <span class="sub">A page of figures for each of Toronto's ${X.N} neighbourhoods</span></h1>
    </section>

    <main class="insights nbp">
      <div class="nbp-top">
        <figure class="nbp-fig">${cityMap(D, null, { links: true })}<figcaption>Select a neighbourhood on the map, or by name below.</figcaption></figure>
        <div class="nbp-intro">
          <p class="ins-lede">The City of Toronto divides the city into ${X.N} official neighbourhoods. Each has a page here with its figures from across the site, ranked among the others, how it has changed since 2006 and the neighbourhoods most like it.</p>
          <p class="ins-lede">Beside each name, its median household income in the 2021 Census. To compare neighbourhoods directly, use the <a href="/insights/neighbourhoods/">Neighbourhood Explorer</a> or the <a href="/insights/explorer/">Data Explorer</a>.</p>
          <nav class="nbp-letters" aria-label="Letters">${letters.map((L) => `<a href="#l-${L}">${L}</a>`).join("")}</nav>
        </div>
      </div>
      <div class="nbp-az">${groups}</div>
    </main>
${FOOT}`;
}

// Writes web/n/index.html and web/n/<slug>/index.html; returns the vite inputs for them.
export function writeNbhdPages() {
  const X = nbhdData();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/index.html`, indexPage(X));
  const inputs = { nbindex: `${OUT}/index.html` };
  X.D.nbhd.forEach((n, i) => {
    const dir = `${OUT}/${slug(n.name)}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/index.html`, nbhdPage(X, i));
    inputs[`n-${slug(n.name)}`] = `${dir}/index.html`;
  });
  return inputs;
}
