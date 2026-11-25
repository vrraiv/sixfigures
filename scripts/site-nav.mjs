// The site header, written into every page at build time (vite.config.js replaces the
// <!-- site-header --> comment), so every page shares one definition:
//
//   [map] Six Figures                 TOPICS  Census · Schools · Housing · Sale prices · Safety · Trees · Getting around     Home · About
//         Toronto, mapped by its data TOOLS   Data Explorer · Neighbourhood Explorer · Experiments
//   [Census:  2021 · 2016 map · 2011 map · Insights]     <- only inside a section with pages of its own
//
// Topics holds the pages about one subject; Tools the pages that work across subjects; Home (the
// landing page, a guide to all of these) and About sit apart at the right. A link is the current
// one on its own page and on its section's pages (`pages`), which get the third row. On phones
// the links fold behind a Menu button; without script they stay open.
//
// The landing page's guide (siteGuide, for its <!-- site-guide --> comment) is written from the
// same list: a card for each link, under the link's own name, with its `blurb` and its pages.
export const SITE = { title: "Six Figures", sub: "Toronto, mapped by its data" };

export const ROWS = [
  { label: "Topics", lede: "One subject each: where the city stands, how it has changed, and how its neighbourhoods compare.", links: [
    { href: "/census/", label: "Census", blurb: "Income, housing costs, dwellings and people from the census, mapped a few blocks at a time. Look up an address to see the figures for its own small area.", pages: [
      { href: "/census/", label: "2021 · 2016", more: " map", blurb: "the map, and the change between the two censuses" },
      { href: "/2011/", label: "2011", more: " map", blurb: "the same measures ten years earlier" },
      { href: "/insights/", label: "Insights", blurb: "the 158 neighbourhoods ranked and compared, 2006 to 2021" },
    ] },
    { href: "/insights/schools/", label: "Schools", blurb: "Grade 3 and 6 test results for public and Catholic elementary schools, by school and by neighbourhood, 2018 to 2025." },
    { href: "/insights/housing/", label: "Housing", blurb: "What is being built and what it costs to rent: building permits, multiplexes since the zoning by-laws allowed them, development applications, housing starts and rents, by year, ward and neighbourhood." },
    { href: "/insights/prices/", label: "Sale prices", blurb: "Home sales and median sale prices by quarter, for the city and each neighbourhood, set against the census." },
    { href: "/insights/safety/", label: "Safety", blurb: "Crime, shootings, homicides and road injuries in each neighbourhood, year by year." },
    { href: "/insights/trees/", label: "Trees", blurb: "Tree canopy, street trees, how tall the trees are and summer ground temperature: where the shade is, and where it isn't." },
    { href: "/insights/transport/", label: "Getting around", blurb: "Bike Share trips and TTC service by neighbourhood, subway delays and why, ride-hail trips and bicycle counts, month by month." },
  ] },
  { label: "Tools", lede: "Across subjects: put any of the site's measures side by side, or start from one neighbourhood.", links: [
    { href: "/insights/explorer/", label: "Data Explorer", blurb: "Choose up to three measures from anywhere on the site and see how they line up across the city and over time." },
    { href: "/insights/neighbourhoods/", label: "Neighbourhood Explorer", blurb: "Pick a neighbourhood and find the ones most and least like it, theme by theme, and how that has changed since 2006. Or open any neighbourhood's own page of figures.", pages: [
      { href: "/insights/neighbourhoods/", label: "Compare", blurb: "the most and least alike, theme by theme, and the kinds of neighbourhood" },
      // `under`: also the current link on the pages below it, /n/<slug>/ (scripts/nbhd-pages.mjs)
      { href: "/n/", label: "A–Z", under: true, blurb: "a page of figures for each of the 158 neighbourhoods" },
    ] },
    { href: "/experiments/", label: "Experiments", blurb: "Tests of how much open data can be made to say, each published with its ranges and its failures: forecasts of school results and home values, and an estimate of what sixplex zoning has done so far.", pages: [
      { href: "/experiments/", label: "About", blurb: "what the experiments are, and how to read them" },
      { href: "/forecasts/", label: "Forecast method", blurb: "how the forecasts are made and tested" },
      { href: "/forecasts/schools/", label: "School forecasts", blurb: "Grade 3 and 6 results for 2026–27" },
      { href: "/forecasts/value/", label: "Dwelling-value forecasts", blurb: "home values in the 2026 Census" },
      { href: "/experiments/sixplex/", label: "Sixplex zoning", blurb: "whether allowing six homes on a lot in eight wards has added homes" },
    ] },
  ] },
];
// The links about the site itself, apart from the two rows.
export const META = [
  { href: "/", label: "Home" },
  { href: "/about/", label: "About" },
];
const tops = () => [...ROWS.flatMap((r) => r.links), ...META];

// "/insights/index.html" -> "/insights/"
export const pagePath = (p) => p.replace(/index\.html$/, "").replace(/([^/])$/, "$1/");
// every address the header links to
export const allPages = () => tops().flatMap((l) => (l.pages ? l.pages.map((p) => p.href) : [l.href]));
// whether a header link is the one for `path`: its own address, or one below it for an `under` link
const isFor = (p, path) => p.href === path || (p.under && path.startsWith(p.href));
// the top link a page belongs to
export const sectionOf = (path) => tops().find((l) => (l.pages ? l.pages.some((p) => isFor(p, path)) : l.href === path)) ?? null;

// `more` is the part of a label dropped on the narrowest phones
const link = ({ href, label, more }, current) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}${more ? `<span class="site-more">${more}</span>` : ""}</a>`;

// `mark`: the address of the map beside the name (scripts/city-map.mjs), as vite.config.js versions it
export function siteHeader(path, mark = "/brand-map.svg") {
  const here = sectionOf(path);
  const rows = ROWS.map((r) => `
        <div class="site-row"><span class="site-label">${r.label}</span>${r.links.map((l) => link(l, l === here)).join("")}</div>`).join("");
  const local = here?.pages ? `
      <nav class="site-local" aria-label="${here.label}"><span class="site-label">${here.label}</span>${here.pages.map((p) => link(p, isFor(p, path))).join("")}</nav>` : "";
  return `<header class="site">
      <a class="skip" href="#page">Skip to the page</a>
      <a class="site-brand" href="/"><img class="site-mark" src="${mark}" width="58" height="42" alt="" /><span class="site-name"><span class="site-title">${SITE.title}</span><span class="site-sub">${SITE.sub}</span></span></a>
      <button type="button" class="site-menu" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav class="site-nav" id="site-nav" aria-label="Site">${rows}
        <div class="site-meta">${META.map((l) => link(l, l === here)).join("")}</div>
      </nav>${local}
      <script>(function (h) { var b = h.querySelector(".site-menu"); h.classList.add("js"); b.onclick = function () { b.setAttribute("aria-expanded", h.classList.toggle("open")); }; })(document.currentScript.parentNode);</script>
    </header>`;
}

// The landing page's guide: the header's rows again, each link a card with a line on what it is for.
export function siteGuide() {
  const card = (l) => `
          <li class="guide-card"><h3><a href="${l.href}">${l.label}</a></h3><p>${l.blurb}</p>${l.pages ? `<ul>${l.pages.map((p) => `<li><a href="${p.href}">${p.label}${p.more ?? ""}</a>: ${p.blurb}</li>`).join("")}</ul>` : ""}</li>`;
  return ROWS.map((r) => `<section class="guide" aria-labelledby="guide-${r.label.toLowerCase()}">
        <h2 id="guide-${r.label.toLowerCase()}">${r.label}</h2>
        <p class="guide-lede">${r.lede}</p>
        <ul class="guide-cards">${r.links.map(card).join("")}
        </ul>
      </section>`).join("\n      ");
}

// Where the header's skip link lands: the page's own title and controls (its "bar"), or on a
// page without one, its <main>. Either can take the focus, so the next Tab goes on from there.
export const pageTarget = (html) => (html.includes('<section class="bar"')
  ? html.replace('<section class="bar"', '<section id="page" tabindex="-1" class="bar"')
  : html.replace(/<main(?![^>]*\bid=)/, '<main id="page" tabindex="-1"'));

// The page's own title, then the site's.
export const siteTitle = (html) => html.replace(/<title>([^<]*)<\/title>/, (_, t) => `<title>${t.includes(SITE.title) ? t : `${t} · ${SITE.title}`}</title>`);

// ---- what a shared link shows: the page's address, title and description, and the site's card ----
// A link pasted into a message or a post is drawn from these: without them it is a bare address.
// The canonical address is the page's own, without the choices a link keeps after "#".
export const ORIGIN = "https://sixfigures.vikramrai.com";
export const CARD = { src: "/social-card.png", width: 1200, height: 630, alt: "Toronto's 158 neighbourhoods, shaded by median household income" };
const attr = (s) => s.replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;").replace(/"/g, "&quot;");
export function socialTags(html, path) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1], desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!title || !desc) throw new Error(`${path}: a page needs a <title> and a meta description`);
  const url = `${ORIGIN}${path}`;
  const tags = [
    `<link rel="canonical" href="${url}" />`,
    `<meta name="author" content="${AUTHOR.name}" />`,
    `<meta property="og:site_name" content="${SITE.title}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${ORIGIN}${CARD.src}" />`,
    `<meta property="og:image:width" content="${CARD.width}" />`,
    `<meta property="og:image:height" content="${CARD.height}" />`,
    `<meta property="og:image:alt" content="${attr(CARD.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...structuredData(path, desc).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`),
  ];
  return html.replace("</head>", `  ${tags.join("\n    ")}\n  </head>`);
}

// ---- for search engines: every page's address, and where to find that list ----
// Written into the build (vite.config.js) from the header's list, so a new page is listed once it
// is in the header. No dates: a page's figures change with its data, not with its file.
// `more`: the pages outside the header (the neighbourhood pages).
export const sitemap = (more = []) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set([...allPages(), ...more])].map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join("\n")}
</urlset>
`;
export const robots = () => `User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

// ---- what a search engine reads about a page (schema.org, as JSON-LD) ----
// The landing page names the site; the two census maps, whose footers offer their figures as
// CSV, describe that data as a Dataset (for Google Dataset Search). Other pages show data but
// offer no file of it, so they claim nothing.
const TORONTO = { "@type": "Place", name: "Toronto, Ontario, Canada", geo: { "@type": "GeoShape", box: "43.58 -79.64 43.86 -79.11" } };
const STATCAN = "https://www12.statcan.gc.ca/census-recensement/index-eng.cfm"; // the Census of Population
export const DATASETS = {
  "/census/": { name: "Toronto income and housing by dissemination area, 2016 and 2021 Censuses", temporalCoverage: "2015/2021",
    keywords: ["Toronto", "census", "dissemination area", "household income", "low income", "housing costs", "renters", "neighbourhoods"],
    files: [["2021 DAs, with 2016 figures and change", "/data/toronto_da_income_2021.csv"], ["2016 DAs", "/data/toronto_da_income_2016.csv"]] },
  "/2011/": { name: "Toronto income and housing by dissemination area, 2011 Census and National Household Survey", temporalCoverage: "2010/2011",
    keywords: ["Toronto", "census", "National Household Survey", "dissemination area", "household income", "housing", "neighbourhoods"],
    files: [["2011 DAs", "/data/toronto_da_income_2011.csv"]] },
};
export const AUTHOR = { name: "Vikram Rai", about: "/about/#who" };
const author = () => ({ "@type": "Person", name: AUTHOR.name, url: `${ORIGIN}${AUTHOR.about}`, sameAs: SOCIAL.map((s) => s.href) });
export function structuredData(path, desc) {
  if (path === "/") return [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE.title, url: `${ORIGIN}/`, description: desc, inLanguage: "en-CA", author: author() }];
  const d = DATASETS[path];
  if (!d) return [];
  return [{
    "@context": "https://schema.org", "@type": "Dataset", name: d.name, description: desc, url: `${ORIGIN}${path}`,
    keywords: d.keywords, temporalCoverage: d.temporalCoverage, spatialCoverage: TORONTO, isAccessibleForFree: true,
    isBasedOn: STATCAN, creator: author(), includedInDataCatalog: { "@type": "DataCatalog", name: SITE.title, url: `${ORIGIN}/` },
    distribution: d.files.map(([name, href]) => ({ "@type": "DataDownload", name: `${name} (CSV)`, encodingFormat: "text/csv", contentUrl: `${ORIGIN}${href}` })),
  }];
}

// ---- the footer: a disclaimer above each page's own sources, the author's links below ----
export const DISCLAIMER = "Any views expressed, or errors within, are those of the author and the author alone.";
// Simple Icons' marks (CC0), 24 x 24
export const SOCIAL = [
  { name: "LinkedIn", href: "https://www.linkedin.com/in/vikram-rai-00132083",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" },
  { name: "GitHub", href: "https://github.com/vrraiv",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" },
  { name: "X", href: "https://x.com/raiv11",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" },
];

// Wrap a page's footer: the disclaimer first, the links last.
export function siteFooter(html) {
  const links = SOCIAL.map((s) => `<a href="${s.href}" rel="noopener me" aria-label="${s.name}" title="${s.name}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="${s.path}"/></svg></a>`).join("");
  return html
    .replace('<footer class="foot">', `<footer class="foot">\n      <p class="disclaimer">${DISCLAIMER}</p>`)
    .replace("</footer>", `  <p class="social">${links}</p>\n    </footer>`);
}
