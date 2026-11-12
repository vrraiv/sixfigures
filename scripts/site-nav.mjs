// The site header, written into every page at build time (vite.config.js replaces the
// <!-- site-header --> comment), so the thirteen pages share one definition:
//
//   Six Figures                 DATA      Census · Schools · Housing · Sale prices · Safety · Trees
//   Toronto, mapped by its data INSIGHTS  Data Explorer · Neighbourhood Explorer · Forecasts
//   [Census:  2021 · 2016 map · 2011 map · Insights]     <- only inside a section with pages of its own
//
// Data holds the pages about one topic; Insights the pages that work across topics. A link is
// the current one on its own page and on its section's pages (`pages`), which get the third
// row. On phones the two rows fold behind a Menu button; without script they stay open.
export const SITE = { title: "Six Figures", sub: "Toronto, mapped by its data" };

export const ROWS = [
  { label: "Data", links: [
    { href: "/", label: "Census", pages: [
      { href: "/", label: "2021 · 2016", more: " map" },
      { href: "/2011/", label: "2011", more: " map" },
      { href: "/insights/", label: "Insights" },
    ] },
    { href: "/insights/schools/", label: "Schools" },
    { href: "/insights/housing/", label: "Housing" },
    { href: "/insights/prices/", label: "Sale prices" },
    { href: "/insights/safety/", label: "Safety" },
    { href: "/insights/trees/", label: "Trees" },
  ] },
  { label: "Insights", links: [
    { href: "/insights/explorer/", label: "Data Explorer" },
    { href: "/insights/neighbourhoods/", label: "Neighbourhood Explorer" },
    { href: "/forecasts/", label: "Forecasts", pages: [
      { href: "/forecasts/", label: "Method" },
      { href: "/forecasts/schools/", label: "Schools" },
      { href: "/forecasts/value/", label: "Dwelling value" },
    ] },
  ] },
];

// "/insights/index.html" -> "/insights/"
export const pagePath = (p) => p.replace(/index\.html$/, "").replace(/([^/])$/, "$1/");
// every address the header links to
export const allPages = () => ROWS.flatMap((r) => r.links.flatMap((l) => (l.pages ? l.pages.map((p) => p.href) : [l.href])));
// the top link a page belongs to
export const sectionOf = (path) => ROWS.flatMap((r) => r.links).find((l) => (l.pages ? l.pages.some((p) => p.href === path) : l.href === path)) ?? null;

// `more` is the part of a label dropped on the narrowest phones
const link = ({ href, label, more }, current) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}${more ? `<span class="site-more">${more}</span>` : ""}</a>`;

export function siteHeader(path) {
  const here = sectionOf(path);
  const rows = ROWS.map((r) => `
        <div class="site-row"><span class="site-label">${r.label}</span>${r.links.map((l) => link(l, l === here)).join("")}</div>`).join("");
  const local = here?.pages ? `
      <nav class="site-local" aria-label="${here.label}"><span class="site-label">${here.label}</span>${here.pages.map((p) => link(p, p.href === path)).join("")}</nav>` : "";
  return `<header class="site">
      <a class="site-brand" href="/"><span class="site-title">${SITE.title}</span><span class="site-sub">${SITE.sub}</span></a>
      <button type="button" class="site-menu" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav class="site-nav" id="site-nav" aria-label="Site">${rows}
      </nav>${local}
      <script>(function (h) { var b = h.querySelector(".site-menu"); h.classList.add("js"); b.onclick = function () { b.setAttribute("aria-expanded", h.classList.toggle("open")); }; })(document.currentScript.parentNode);</script>
    </header>`;
}

// The page's own title, then the site's.
export const siteTitle = (html) => html.replace(/<title>([^<]*)<\/title>/, (_, t) => `<title>${t.includes(SITE.title) ? t : `${t} · ${SITE.title}`}</title>`);
