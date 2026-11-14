// The site header (scripts/site-nav.mjs) against the pages vite builds.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CARD, DISCLAIMER, META, ORIGIN, ROWS, SOCIAL, allPages, pagePath, pageTarget, sectionOf, siteFooter, siteGuide, siteHeader, siteTitle, socialTags } from "./site-nav.mjs";

const inputs = [...readFileSync("vite.config.js", "utf8").matchAll(/"(web\/[^"]*index\.html)"/g)].map((m) => pagePath(m[1].replace(/^web/, "")));

test("every page vite builds is in the header, and every header link is a page", () => {
  assert.deepEqual([...new Set(allPages())].sort(), [...inputs].sort());
  for (const p of allPages()) assert.ok(existsSync(`web${p}index.html`), p);
});

test("each page marks exactly one top link, and its own entry in a section's row", () => {
  for (const p of inputs) {
    const html = siteHeader(p), nav = html.slice(html.indexOf('class="site-nav"'), html.indexOf("</nav>"));
    assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1, p);
    const section = sectionOf(p);
    assert.equal(html.includes('class="site-local"'), !!section.pages, p);
    if (section.pages) assert.equal((html.slice(html.indexOf('class="site-local"')).match(/aria-current="page"/g) ?? []).length, 1, p);
  }
});

test("every page carries the placeholder and no header of its own", () => {
  for (const p of inputs) {
    const html = readFileSync(`web${p}index.html`, "utf8");
    assert.equal((html.match(/<!-- site-header -->/g) ?? []).length, 1, p);
    assert.ok(!/class="(wordmark|ins-nav|themes)"/.test(html), p);
  }
});

test("the landing page's guide has a card for every link in the two rows, and a line for every page of a section", () => {
  const guide = siteGuide();
  const links = ROWS.flatMap((r) => r.links);
  assert.equal((guide.match(/class="guide-card"/g) ?? []).length, links.length);
  for (const l of links) {
    assert.ok(l.blurb && guide.includes(`<h3><a href="${l.href}">${l.label}</a></h3>`), l.label);
    for (const p of l.pages ?? []) assert.ok(p.blurb && guide.includes(`<li><a href="${p.href}">${p.label}`), `${l.label}: ${p.label}`);
  }
  assert.equal((readFileSync("web/index.html", "utf8").match(/<!-- site-guide -->/g) ?? []).length, 1);
  assert.deepEqual(META.map((l) => l.href), ["/", "/about/"]);
});

test("the old address of the census map sends its links on", () => {
  const home = readFileSync("web/index.html", "utf8");
  const [, re] = home.match(/if \((\/.*?\/)\.test\(location\.hash\)\) location\.replace\("\/census\/" \+ location\.hash\)/);
  const moves = (hash) => new RegExp(re.slice(1, -1)).test(hash);
  for (const h of ["#m=rent&y=2021", "#m=med_hh_tot&y=2021&at=13/43.7/-79.4&o=nbhd", "#diag", "#find=100%20Queen"]) assert.ok(moves(h), h);
  for (const h of ["", "#guide", "#guide-topics"]) assert.ok(!moves(h), h);
});

test("a section's first page is its top link", () => {
  for (const l of ROWS.flatMap((r) => r.links)) if (l.pages) assert.equal(l.pages[0].href, l.href);
});

test("every page gets its own address, title and description for a shared link, and the card is there", () => {
  for (const p of inputs) {
    const html = socialTags(siteTitle(readFileSync(`web${p}index.html`, "utf8")), p);
    assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}${p}" />`), p);
    assert.ok(html.includes(`<meta property="og:url" content="${ORIGIN}${p}" />`), p);
    const title = html.match(/<meta property="og:title" content="([^"]*)"/)[1], desc = html.match(/<meta property="og:description" content="([^"]*)"/)[1];
    assert.ok(title.includes("Six Figures") && title.length < 90, `${p}: ${title}`);
    assert.ok(desc.length > 60, `${p}: ${desc}`);
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1, p);
    assert.ok(html.indexOf("og:image") < html.indexOf("</head>"), p);
  }
  assert.ok(existsSync(`web/public${CARD.src}`), "run node scripts/make-icons.mjs");
  assert.throws(() => socialTags("<head><title>A</title></head>", "/x/"), /meta description/);
});

test("the landing page's map is a picture for the eye and a menu for everyone else", async () => {
  const { heroPick, heroSvg } = await import("./city-map.mjs");
  const svg = heroSvg(), pick = heroPick();
  assert.ok(svg.includes('aria-hidden="true"') && !svg.includes('role="img"'));
  assert.equal((svg.match(/<a href=/g) ?? []).length, 158);
  assert.equal((svg.match(/tabindex="-1"/g) ?? []).length, 158);
  assert.equal((pick.match(/<option value="\/census\//g) ?? []).length, 158);
  assert.equal((readFileSync("web/index.html", "utf8").match(/<!-- city-map-pick -->/g) ?? []).length, 1);
});

test("the site's name is added to a title once", () => {
  assert.equal(siteTitle("<title>Toronto Safety Insights</title>"), "<title>Toronto Safety Insights · Six Figures</title>");
  assert.equal(siteTitle(siteTitle("<title>A</title>")), "<title>A · Six Figures</title>");
});

test("every page's footer opens with the disclaimer and closes with the three links", () => {
  assert.deepEqual(SOCIAL.map((s) => s.name), ["LinkedIn", "GitHub", "X"]);
  for (const p of inputs) {
    const f = siteFooter(readFileSync(`web${p}index.html`, "utf8")), foot = f.slice(f.indexOf('<footer class="foot">'), f.indexOf("</footer>"));
    assert.ok(foot.startsWith(`<footer class="foot">\n      <p class="disclaimer">${DISCLAIMER}</p>`), p);
    assert.equal((f.match(/class="disclaimer"/g) ?? []).length, 1, p);
    assert.equal((f.match(/class="social"/g) ?? []).length, 1, p);
    assert.ok(foot.trimEnd().endsWith("</p>") && foot.lastIndexOf('class="social"') > foot.lastIndexOf('class="downloads"'), p);
    for (const s of SOCIAL) assert.ok(f.includes(`href="${s.href}"`), `${p} ${s.name}`);
  }
});

test("the header starts with a skip link, and every page has the place it lands", () => {
  for (const p of inputs) {
    const header = siteHeader(p);
    // the first link in the header, so the first thing the Tab key reaches
    assert.equal(header.match(/<a [^>]*>/)[0], '<a class="skip" href="#page">', p);
    const html = pageTarget(readFileSync(`web${p}index.html`, "utf8"));
    assert.equal((html.match(/id="page"/g) ?? []).length, 1, p);
    assert.match(html, /<(section|main) id="page" tabindex="-1"/, p);
    // the page's title is at or after the landing place, never skipped
    assert.ok(html.indexOf("<h1") > html.indexOf('id="page"'), p);
  }
});

test("a page has one banner: its own title and controls are a named region, not a second header", () => {
  for (const p of inputs) {
    const html = readFileSync(`web${p}index.html`, "utf8");
    assert.ok(!/<header\b/.test(html), p);
    if (html.includes('class="bar"')) assert.match(html, /<section class="bar" aria-label="[^"]+">/, p);
  }
});
