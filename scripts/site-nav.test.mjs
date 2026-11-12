// The site header (scripts/site-nav.mjs) against the pages vite builds.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DISCLAIMER, ROWS, SOCIAL, allPages, pagePath, sectionOf, siteFooter, siteHeader, siteTitle } from "./site-nav.mjs";

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

test("a section's first page is its top link", () => {
  for (const l of ROWS.flatMap((r) => r.links)) if (l.pages) assert.equal(l.pages[0].href, l.href);
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
