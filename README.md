# Six Figures

*Toronto, mapped by its data.* Live site at http://sixfigures.vikramrai.com/.

## About

Six Figures brings together open data about the City of Toronto and its 158
neighbourhoods, and sets it side by side so it can be compared.

A great deal is published about Toronto: the census every five years, school test
results, home sale prices, new construction and rents, crime and road safety, the tree
canopy and summer heat, elections. But it comes from many different organizations, in
different formats, on different maps and at different times. That makes simple questions
hard to answer: how do a neighbourhood's incomes compare with its school results? Which
parts of the city have the least tree cover and the hottest summer ground? How has a
place changed over fifteen years, and which other neighbourhoods is it most like?

This site does the gathering. Every source is placed on the same neighbourhood
boundaries (and, for the census, on small areas of a few hundred people each), so any
measure can be mapped, ranked and set against any other. On the site you can:

- **Explore the map** of income and housing from the latest census, a few blocks at a
  time, and look up your own address.
- **Read about one topic** (the census, schools, housing, sale prices, safety, trees and
  heat) through maps, rankings, trends, and how it relates to everything else.
- **Compare any measures** in the Data Explorer: choose up to three and see how they line
  up across the city and over time.
- **Find a neighbourhood's closest matches** in the Neighbourhood Explorer: which
  neighbourhoods are most and least alike, theme by theme, and how that has changed since
  2006.
- **See where the numbers might go** in the Forecasts, an experiment in predicting school
  results and home values that publishes its own errors.

Everything comes from public sources, credited on each page and listed in the
[data catalogue](docs/data-catalogue.md). The figures can be downloaded, and the code that
produces them is in this repository, so anyone can check the work or build on it. The
site is refreshed as new data is released.

It is an independent project, not affiliated with the City of Toronto or any of the
organizations whose data it uses, and nothing on it is advice. Any views expressed, or
errors within, are those of the author and the author alone.

## Details

The landing page, `/`, says what the site is and how to get around it: an address box
that opens the census map at that address, a small map of the neighbourhoods by 2021
household income (each one a link to the census map there), three ways in, and a card
for every link in the header with a line on what it is for. `/about/` goes further: how
to read the maps, where each topic's data comes from, and what to keep in mind.

The census map, `/census/`, is an interactive choropleth of income, low income and housing
across the City of Toronto's dissemination areas (DAs) in the 2016 and 2021 censuses, and
the change between them. Hover for values, click for detail, or search for a Toronto
address or intersection to jump to its DA. Around it are pages on schools, housing, sale
prices, safety and trees by neighbourhood, two explorers that work across all of them,
and forecasts. (The map was at `/` until the landing page took that address; the landing
page sends old map links, such as `/#m=rent&y=2021`, on to `/census/`.)

Every page carries the same header: a small map of the city and the site's name, two rows
of links, and Home and About. **Topics** has the pages about one subject (Census, Schools,
Housing, Sale prices, Safety, Trees); **Tools** the pages that work across subjects (Data
Explorer, Neighbourhood Explorer, Forecasts). A section with pages of its own shows them
in a third row: Census has the 2021 · 2016 map, the 2011 map and Census Insights;
Forecasts has Method, Schools and Dwelling value. On phones the links fold behind a Menu
button. The header is defined once, in `scripts/site-nav.mjs`, and written into each page
at build time (`vite.config.js`); a page holds only a `<!-- site-header -->` comment, and
a new page is added to the header there (`npm test` checks every built page is in it).
The landing page's cards are written from the same list, so a link added to a row needs a
`blurb` there. The header's map and the landing page's are drawn at build time from
`insights.json` (`scripts/city-map.mjs`).

A second page, `/2011/`, shows 2011 on its own DA boundaries (3,685 DAs), coloured on
the same classes as the main map, with the main map's measures: dwelling types and ages
from the 2011 Census, and the rest from the 2011 National Household Survey (the voluntary
long form that year; income year 2010), whose DA table StatCan issued only to universities
as a Beyond 20/20 file (see `pipeline/README.md`).

Census Insights, `/insights/`, summarises the City's 158 neighbourhoods across the 2006,
2011, 2016 and 2021 censuses (2006 for the 19 measures its profile publishes on the same
terms, from `pipeline/census2006.py`): the city's figure for every measure in each census, the ten
highest and lowest neighbourhoods for a chosen measure and census, and the biggest
rises and falls between any two censuses (dollar changes after inflation, Toronto CPI), and
a map of the neighbourhoods in any census or of the change from the census before.
`pipeline/insights.py` computes the neighbourhood figures from the DAs, one method for
all three years: shares from summed counts, income medians interpolated from pooled
income groups (except 2011 household income, whose DA groups are incomplete), other
medians as the median of the DA medians on the measure's own base. Against the City's
official 2021 neighbourhood profile, shares and averages typically agree to within 0.3%
(the worst cases differ by 4–6%), household income medians by a typical 2.4% with the
same top-ten neighbourhoods, and rent and dwelling value medians by a typical 2–3%.

School Insights, `/insights/schools/`, shows the Grade 3 and 6 EQAO results of the City's
English public and Catholic elementary schools and its neighbourhoods for the test years
2018, 2019 and 2022–2025 (2024 preliminary): the City's figures by year and board, a
neighbourhood map, rankings, the spread of schools and neighbourhoods, how stable the
results are from year to year, the biggest changes, correlations with the schools'
student shares and with the 2021 Census, and a sortable table of every school. Its data
is `web/public/schools.json` (`pipeline/school_insights.py`).

Housing Insights, `/insights/housing/`, covers new homes and the rental market: the City's
building permits (2000 on), development applications, rental demolitions, registered
apartment buildings and affordable rental pipeline, CMHC's starts, completions, rents and
vacancy, and StatCan's series for the City and CMA (population, prices, the labour force,
income, metro permits). By neighbourhood it maps and ranks permits, applications,
demolitions, the apartment stock, the affordable pipeline and household change, as counts
or per 1,000 households, shows how concentrated new units are, correlates them with the
2021 Census, compares net units on permits with census household change, and tabulates
CMHC's rents and vacancy by zone. Its data is `web/public/housing.json`
(`pipeline/housing_insights.py`).

Sale Prices Insights, `/insights/prices/`, covers home sales from TRREB's quarterly
community reports (Q4 2011 on): the City's sales and average sale price by quarter, by
region, and the spread of the communities' medians. By neighbourhood it maps and ranks the
median sale price, its standing against the City's, its change over one and five years,
and homes sold (as counts or per 1,000 households), correlates them with the 2021 Census,
and compares the change in sale prices with the change in census dwelling values. Its
data is `web/public/prices.json` (`pipeline/price_insights.py`).

Safety Insights, `/insights/safety/`, covers police-reported crime (assaults, break and
enters, auto thefts, robberies, thefts over $5,000; by year reported, 2014 on), shootings and
homicides (2004 on) and people killed or seriously injured on the roads (2006 on): the City's
counts by year, and by neighbourhood a map that crosses the chosen category with household
income (a 3 × 3 bivariate key) or shows either alone, each category's rate in fifths of the
neighbourhoods by income, rankings, the change between five-year periods, correlations with
the 2021 Census and with school results, sale prices, tree canopy, surface heat, turnout and
short-term rentals, and how the categories go together. Like the other Insights pages it draws
the neighbourhoods as SVG and loads no map tiles. Rates are per 100,000 residents (2021
Census), which overstates places people visit more than live in. Its data is
`web/public/safety.json` (`pipeline/safety_insights.py`, from `pipeline/crime.py`).

Trees and Heat, `/insights/trees/`, covers the 2018 tree canopy (the City's Tree Canopy
Study), the City's 688,000 street trees (per hectare, large trees, trunk size, commonest
species) and summer surface temperature from 11 clear Landsat 8/9 passes in 2022-2025, by
neighbourhood: the canopy against heat (about 1.3°C cooler ground for every 10 more points
of canopy, across neighbourhoods and DAs alike), a map that crosses the chosen measure with
household income or shows either alone, each measure in fifths of the neighbourhoods by
income, rankings, and correlations with the 2021 Census, crime, school results, sale prices,
turnout and short-term rentals. Inside the neighbourhood draws a chosen neighbourhood's DAs (on
the city-wide DA classes) with its hottest and coolest DA and the heat gap between its 10th and
90th percentile DAs, and lists the widest gaps. Hot and vulnerable scores each neighbourhood's
vulnerability as its mean percentile rank on census measures the reader ticks (65 and over, low
income and 5+ storey apartments by default; renters, crowding, children) and maps it against
heat, listing the neighbourhoods in the top third on both. What's planted lists the commonest street
trees city-wide and in a picked neighbourhood against the 10-20-30 rule (no species over 10%,
genus over 20%, family over 30%), and species diversity, Norway maple's share and the commonest
genus's share can be mapped (`pipeline/trees.py --species` writes the species tables). Toward 40%
canopy sets the City's target (40% canopy cover by 2050, city-wide; reaffirmed by Council in 2021)
against the canopy measured here (26.2%; the City's own 2018 estimate is 28.4-31%) and lists the
neighbourhoods furthest from 40% of their area, in hectares or points, and points to the City's
Tree Equity Score Analyzer for planting priorities. Canopy change, 2008 to 2018, sets the City's
2008 tree cover by neighbourhood against its 2018 land cover: the city-wide change depends on
whether 2018's shrubs count (27.9% to 25.9% as trees only, to 30.6% with shrubs; the City's
sampled headline is 26.6% to 28.4%), so the map shows each neighbourhood's change against the
city's, on either reading (`pipeline/trees.py --canopy-change`). Day by day maps each of the 11 Landsat days on
one colour scale and lists the neighbourhoods in the hottest sixth on nearly every day
(`pipeline/trees.py` writes `lst_by_pass_nbhd.csv`); those outlines are `trees_da.json` (0.6 MB,
0.23 MB compressed), fetched only when the section nears the screen. No map tiles. Its data is `web/public/trees.json`
(`pipeline/trees_insights.py`, from `pipeline/trees.py`).

On the Safety, Trees and Explorer pages a neighbourhood can be picked on any map, chart or list, or
found by name in a menu, and is then marked everywhere on the page; Safety and Trees open with a
contents list, and the Trees measure menu stays pinned only over the sections it drives. Tooltips
work by touch on every Insights page: a tap shows the figures and the next tap elsewhere hides them.

The Data Explorer, `/insights/explorer/`, offers every neighbourhood measure on the site in one menu: 67 measures from the census,
safety, schools, sale prices, housing, trees and heat, elections and short-term rentals. Up to
three can be chosen, each with its own period, and the page shows the view that suits the number:
- **One:** the map with a period slider (one colour scale for all periods), the spread, the
  highest and lowest neighbourhoods, the median neighbourhood over time with the middle half and
  middle 80% (and a picked neighbourhood's line), the biggest rises and falls between two periods,
  how stable the ranking is, and the other measures it goes with, from other sources and its own
  (picking one adds it as the second measure).
- **Two:** the scatter with its rank correlation, both on one two-colour map, the second across
  fifths of the first, the neighbourhoods furthest from the pattern (in ranks), the correlation
  at each time both have a figure (on a fixed -1 to 1 scale), change against change, leads and
  lags (two yearly measures), and the two spreads. Sections that need a history say why when a
  measure is a single figure or the two don't overlap.
- **Three:** the three pairs in ranks, the first two coloured by thirds of the third with the
  correlation within each third and the partial rank correlation, three small maps, a picked
  neighbourhood's percentile on each, and the eight high/low combinations on a map.
The picked neighbourhood is marked in every chart, the link holds every choice, and Download CSV
gives the chosen measures at their chosen periods. Its data is `web/public/explorer/`
(`pipeline/explorer_data.py`): a catalogue and one file per source, fetched when a measure from
it is first used. The code is `web/src/explorer.js` (pickers, link, picks, CSV), `explorer-core.js`
and one module per view.

The Neighbourhood Explorer, `/insights/neighbourhoods/`,
starts from a neighbourhood instead of a measure: pick one and it shows which of the other 157
are most and least like it. Likeness is an **affinity** out of 100, from 60 of the Explorer's
measures at their latest period, grouped into nine named themes (Income, Housing costs, Homes,
People, New building, Safety, Schools, Trees and heat, Voting):
- every measure becomes a percentile rank among the 158 neighbourhoods;
- two neighbourhoods' gap on a theme is the mean difference in their ranks on its measures, and
  their overall gap the mean of the theme gaps, so a theme with ten measures counts no more
  than one with four;
- affinity is 100 less the gap. Two neighbourhoods taken at random average about 66.

On the Neighbourhood Explorer, Safety, Trees and the Data Explorer, a small box finds the
neighbourhood an address or intersection is in (`web/src/addressfinder.js`), for readers
who don't know the City's names. It reuses the census map's address lookup and the 2021
figures file's DA neighbourhoods, both loaded only when the box is first used; a DA that
straddles a boundary (13 of them) is reported as mostly in one and partly in the other,
and picking a name in the answer picks that neighbourhood on the page.

Any theme can be unticked (Voting is the obvious one), and likeness can be measured on one theme
or one measure alone. The page has the map shaded by affinity with the ten most and least alike
(and every neighbourhood in a sortable table, theme by theme), the closest and furthest matches
on each theme, a side-by-side of the picked neighbourhood and any other on every measure, the
eight kinds of neighbourhood on a map, and the most typical and most distinctive neighbourhoods
and closest pairs. It also shows:
- **Twins across town:** the closest matches at least 10 km away (likeness is partly local: a
  neighbourhood's ten closest matches are typically about 5 km off, against 12 km for any two),
  and the closest pairs that far apart;
- **Since 2006:** the same affinity on the 18 census measures that go back to 2006 (Income,
  Housing costs, Homes and People), at each census, for the picked pair and for the picked
  neighbourhood against all the others, with the neighbourhoods it has grown most like and
  furthest from;
- **A map of likeness:** every neighbourhood placed on the two axes that separate them most
  (the first two principal components of the percentiles, about 46% of the variance), coloured
  by kind or by affinity with the picked neighbourhood. It is a picture, not the measure: the
  lists come from the gaps.

The kinds come from Ward's hierarchical clustering on the same percentiles,
every theme but Voting weighted equally; they cut a continuum (silhouette about 0.1), so each
neighbourhood also carries its next nearest kind. The link holds every choice. Its data is
`web/public/neighbourhoods.json` (`pipeline/affinity.py`, `make neighbourhoods`, run after
`make explorer`), where the choice of method is recorded; the code is
`web/src/neighbourhoods.js`, which works the affinity out in the browser.

Forecasts are an exercise in how far public data can be pushed, not advice, and each
forecast page opens by saying so. Forecasts, `/forecasts/`, sets out how the forecasts are made and tested (the method,
the rungs, the backtests, the decision rule and the ranges), with a page for each
target. School Forecasts, `/forecasts/schools/`, maps and lists each neighbourhood's
forecast Grade 3 and Grade 6 score for 2026-27 with its 80% range, and tabulates every
rung's errors in the backtests, the holdout and the frozen 2025-26 forecast (scored on
EQAO's results, `make eqao`), the ranges' coverage, and the 2019 to 2022 results by
school low-income share. Dwelling Value Forecasts, `/forecasts/value/`, maps
and lists each neighbourhood's forecast median value of owned dwellings in the 2026
Census with its range, and tabulates every rung's errors, the range's coverage on 2016
to 2021, and the TRREB figures behind the City's nowcast. Their data is
`web/public/forecasts.json` (`pipeline/forecast_pages.py`, from `make forecast`); the
method and every run's results are in `docs/forecast-spec.md`.

### Measures

The measure menu has six sections:

| Section | Measures | Unit |
|---|---|---|
| Income | Median household income, total and after tax; median individual income (recipients 15+), total and after tax; average household income | dollars, income years 2015 and 2020 |
| Low income and transfers | People in low income (LIM-AT prevalence); share of total income from government transfers | percent, income years 2015 and 2020 |
| Housing | Renter households (share of private households); households spending 30% or more of income on shelter costs (owners and tenants with income); owner households and tenant households spending 30% or more; tenant households in subsidized housing | percent, 2016 and 2021 Census |
| Housing costs and values | Median value of owned dwellings; median monthly shelter costs of owners; of renters | dollars, 2016 and 2021 Census |
| Dwellings | Single-detached houses; apartments in buildings of 5+ storeys; condominiums (each a share of occupied private dwellings); dwellings built in the five years before the census (2011–2016, 2016–2021); built in 1960 or before; households in housing not suitable for their size | percent, 2016 and 2021 Census |
| People | Bachelor's degree or higher (aged 25–64); moved in the past year; in the past five years; immigrated in the five years before the census; aged 0–14; aged 65 and over | percent, 2016 and 2021 Census |

The popup and the pinned comparison list the measures in the current section. Rates
are published with one decimal; shares such as renters, condominiums or movers are computed from
StatCan's counts (`pipeline/measures.py`, which lists every characteristic by ID and
name). A rate's change is in percentage points (pp), not restated for inflation.

### Census years and change

- **2016 / 2021** show each census on its own DA boundaries (3,702 and 3,743 DAs). Both
  use one colour scale (6 quantile classes over 2016 and 2021 DAs pooled), so a colour
  means the same value in either year. Where a sixth or more of DAs are at exactly 0%
  (condominiums, subsidized housing, new dwellings and others), 0% is the first class
  and the other five split the rest. The 2016 tiles load on first use.
- **Change** (2021 boundaries) shows, for each DA, the change in a dollar measure after
  inflation (the default: 2015 incomes × 1.0935 in 2020 dollars, Toronto's all-items CPI
  128.3 → 140.3; 2016 dwelling values and shelter costs × 1.1015 in 2021 dollars, CPI
  131.0 → 144.3; table 18-10-0005-01, from `pipeline/cpi.json`) or in nominal dollars; the change in a
  rate in percentage points; or the change in its percentile rank (points),
  on a red-grey-blue scale centred on zero. Red always means the value fell, which for
  low income or shelter costs means fewer people affected. Only DAs whose boundary is identical in both censuses are compared, per
  StatCan's DA correspondence file: 3,606 of 3,743 (96%). The other 137 were split or
  redrawn; a median can't be split or combined across new boundaries, so they are
  shown dotted, not estimated. DAs whose measure wasn't published in either year are
  hatched.
- The popup lists both years, the change and the percentile change for the measures in
  the current section, and a histogram of all Toronto DAs with this DA's bar in orange
  and a line at the city-wide figure (or at zero for change). The histograms are in `breaks.json`, built by
  `pipeline/distributions.py`.
- **Links.** The URL hash holds the measure, view, change basis, the open DA (`da`), the
  pinned DA (`vs`), the boundary overlay (`o`) and (once the map has moved) the map
  position, e.g. `#m=med_hh_tot&y=change&c=real&da=35204265&vs=35202681&o=ward&at=13.5/43.73/-79.38`.
  Opening such a link selects that DA; if it isn't in the loaded tiles, it is looked up
  like a DA-number search. "Copy link to this DA" in the popup copies it. Search works in every view; in 2016 a split DA opens its 2016 parent, and a
  redrawn one outlines every 2016 DA it overlaps.
- **Legend as a filter.** Hovering over a colour class in the legend (or tabbing to it)
  fades every other class; clicking keeps that class until "Show all" or a second
  click. A kept class survives a change of measure, a switch between 2016 and 2021 and
  between real and nominal dollars; it is cleared on a switch between the census and
  change views or to or from percentile points, where the classes differ.
- **Wheel zoom** is linear and bounded (`web/src/wheel.js`): a mouse notch zooms the same
  whether the driver sends it as one event or a smooth-scroll stream of thirty, a frame
  applies at most a quarter of a level, and input that piles up while tiles load is
  dropped rather than applied late, so the zoom stops when the wheel does.
- **Map detail** for machines that draw the map in software (a browser with graphics
  acceleration switched off by policy, an old integrated chip). Medium and low draw on a
  canvas at 0.8 or 0.67 pixels per CSS pixel, a basemap without the fills and minor roads
  that show least under the DA colours, DA outlines from z12 only, the hovered DA paled rather
  than outlined, and a filtered copy of the tiles that outlines only the open, found and
  pinned DAs. Under SwiftShader on four cores a frame went
  from 91 ms at full to about 32 at medium and 27 at low. Chosen by `q=auto|full|medium|low`
  in the hash or the footer's "Map detail" buttons; auto measures the first frames after
  load, at rest and then repainting, and takes medium when a repainted frame runs over
  30 ms past the display's interval, low over 90 ms. A chosen level is kept, a measured one
  for a week; the line beside the buttons says which is on and why.
- **Diagnostics.** Adding `diag` to the hash (`/census/#diag`) overlays the graphics driver, load
  timings, frame and input times, long tasks and the raw mouse-wheel events, for reporting
  problems from a machine without developer tools. Pressing `p` samples the main thread
  for 20 s and lists where the time went (the `Document-Policy: js-profiling` header in
  `web/public/_headers` allows it), with what happened meanwhile: frames shown, long
  tasks, slow input and the graphics card's time per frame (a GPU timer query, where the
  driver has one); `b` and `d` hide the basemap or the DA layers, to feel which side a
  slow drag comes from.
- **Old links** keep working: `c=real` or `c=dollars` on a rate measure opens its
  percentage-point change (`c=pp`).
- **Pin to compare.** "Pin to compare" in the popup outlines that DA in purple; clicking
  another DA then adds a table of the pinned DA, this DA and the difference for the
  measures in the current section, in the current view's terms. The chip at the top of the map (the bottom, on
  phones) unpins it. On phones, pinning closes the details sheet so the map is clear for
  the second tap. The pin follows a switch to the other census only if the DA's boundary is the same in both.
- **Boundaries.** The legend's Boundaries control draws City neighbourhood or ward
  outlines (with labels) over the DAs, and FSAs (the first three characters of a postal
  code) when the pipeline had StatCan's FSA file. It lists only the layers in
  `overlays.pmtiles` and is hidden if that file wasn't built.
- **Keyboard and screen readers.** Tab to the map: a crosshair marks the centre, arrow
  keys pan and + / − zoom, and the DA under the crosshair is announced after each move.
  Enter or Space opens it; Escape closes it.

### Search and place names

- **Search** accepts a street address (`100 Queen St W`, `1203-100 Queen St W`,
  `978 1/2 Kingston Rd`), an intersection (`Yonge & Bloor`, `King St W and Spadina Ave`)
  or a DA number. It works offline against the City of Toronto's official address points
  and intersection file, pre-assigned to DAs in the pipeline. No geocoding service is
  called. Only exact official addresses resolve:
  - an address in more than one former municipality (e.g. `1 Byng Ave`) asks which one;
  - a number that isn't on the street suggests the nearest listed numbers;
  - an address naming another municipality (`…, Mississauga`) is refused;
  - most intersections lie on DA boundaries (DAs are bounded by streets), so all DAs
    meeting there are outlined and you pick one.
  The index (`search.json`, ~4.7 MB, ~1.1 MB compressed) loads the first time the search
  box is used.
- **Snapshot.** The camera button (under the zoom buttons) works like a snipping tool:
  drag a rectangle over the map (or take the whole view), then preview, copy to the
  clipboard or download a PNG. Options: title, legend (a strip that fits any width),
  the selected DA's figures (beside the map, or below it for narrow snips), a callout
  labelling the selected DA, and screen or 2× resolution. The clicked or searched DA
  keeps an orange outline so its borders show in the image. Everything is drawn in
  exact sRGB with dark text, which avoids over-saturated system screenshots on HDR or
  wide-gamut displays. Credits are always included.
- **Place names.** DAs have no names; StatCan identifies them only by number. The popup
  shows the City of Toronto neighbourhood (one of 158) that covers most of the DA, or
  "mostly X, partly Y" for the 13 DAs split between two.

Fully static: a Python pipeline turns Statistics Canada bulk downloads into one
PMTiles file of DA outlines per census (~1.2 MB for 2021, ~0.9 MB for 2016), the
figures as one small JSON file per measure and census (`data/figures/`), and
`breaks.json`. It is hosted as a Cloudflare Worker with static assets only (no Worker
script, no API keys). Basemap: Protomaps' map of OpenStreetMap, kept on the site (below).

The street map under the census maps is the site's own too. `pipeline/basemap.py` (`make
basemap`) reads the tiles that cover Toronto and a margin, zoom 0 to 14 (about 23 MB, 937
tiles), out of Protomaps' daily OpenStreetMap build by HTTP range requests, and writes
`web/public/basemap.pmtiles`. It is unpacked into static tiles like the others, and its
layers (`scripts/basemap-style.mjs`, from `@protomaps/basemaps`) and label fonts
(`web/public/fonts`, Noto Sans) are the site's, so opening a map asks no third party for
anything. The streets change slowly under a census map, so the file is committed and redone
rarely: delete it and run `make basemap` for a newer build (Protomaps keeps a week of them).

Cloudflare's cache answers HTTP Range requests with the whole file, so serving the
.pmtiles directly would make every visitor download all of them. Instead
`scripts/extract-tiles.mjs` (run by `vite.config.js` on every dev start and build)
unpacks each archive into gzipped z/x/y files under `web/public/tiles/<name>-<hash>/`
(about 555 files, plus empty ones for squares with no data inside the bounds,
which would otherwise 404; not committed), and MapLibre fetches only the tiles in view: about
130 KB (two z10 tiles) for the opening whole-city view on a desktop. The tiles carry only
each DA's number; `web/src/figures.js` fetches the figures of the measure on show (about
55 KB with the place names and population) and attaches each DA's colour class to its
tile feature through feature state, so a change of measure never refetches tiles.
`census/index.html` (and `2011/index.html`) starts the opening view's tile and figure
downloads before the app script arrives, and the DA layers go in at `style.load`, so they
load alongside the basemap rather than after it.

On the map pages the site header, the controls and the map fill the screen between them,
and the footer sits below, a scroll away. The opening view (`openingCamera` in
`web/src/common.js`, mirrored by the preloaders) fits the whole city on a wide screen; on a
narrow one, where fitting Toronto's width would leave empty bands above and below, it fills
the map's height instead (up to one zoom level closer), and the east and west ends are a
pan away. A link with a view (`#at=`) opens on that view.
`web/src/main.js` inflates the tiles itself, so it works whether or not a server marks
them `Content-Encoding: gzip`. The archives are left out of the deploy
(`web/public/.assetsignore`).

```
pipeline/            Python + Makefile: raw downloads -> GeoJSON -> PMTiles, search index
web/                 Vite app (index.html, src/, public/ with tiles, breaks, search, _headers)
scripts/             tile extraction; build-time size check (2021 tiles, Cloudflare limits)
wrangler.jsonc       Worker config: serves ./web/dist as static assets
```

### Run locally

Requires Node 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # -> web/dist (about 15 MB in ~970 files; first load about 2 MB before compression)
npm test           # search lookups, wheel zoom bounds, figures loader
```

### Rebuild the data

Every dataset, its publisher's update cadence, what the site holds now and how to refresh
it are in [docs/data-catalogue.md](docs/data-catalogue.md), with the update schedule
(a quarterly run for TRREB and Inside Airbnb, two annual runs, and the 2026 Census
releases).
The quarterly run and the yearly police and housing refreshes are automated: the Data
refresh workflow (`.github/workflows/data-refresh.yml`, `pipeline/data_refresh.py`) runs on that
schedule and opens a pull request with what changed, for review before merging.

The derived `web/public/*.pmtiles` (including `overlays.pmtiles` and `basemap.pmtiles`), `breaks.json`,
`search.json`, `data/figures/` and `data/*.csv` are
committed, so this is only needed to change the pipeline. From WSL, Linux or macOS,
with Python 3.11+ and tippecanoe installed:

```sh
python3 -m venv ~/.venvs/toronto-dash && . ~/.venvs/toronto-dash/bin/activate
make deps
make data          # download -> build.py -> tippecanoe -> search_index.py, overlays
make cpi           # refetch the CPI from StatCan's Web Data Service, then make breaks
make breaks        # redo breaks.json histograms/CPI and the CSVs from pipeline/out
make overlays      # boundary overlays -> web/public/overlays.pmtiles
```

Without the raw files, `make from-extracts` rebuilds the neighbourhood figures and the two
Explorers' data from Toronto's rows of the census profiles, which are kept in
`pipeline/extracts/`: it runs on any checkout, with Python alone.

StatCan's site blocks scripted downloads with a bot challenge. If `make download`
reports that, fetch the files it prints in a browser into `pipeline/raw/`. The City of
Toronto portal sometimes times out; rerun `make download` later.
Source URLs, row counts and processing details are in
[pipeline/README.md](pipeline/README.md).

### Deploy

The GitHub repo is connected to the Cloudflare Worker `sixfigures` (Workers Builds),
so every push to `main` deploys. The dashboard deploy command is `npx wrangler deploy`;
no dashboard build command is needed because `wrangler.jsonc` sets
`build.command: "npm run build"`, which wrangler runs before each deploy.

Manual deploy from a machine logged in with `npx wrangler login`:

```sh
npm run deploy     # vite build && wrangler deploy
```

`web/public/_headers` gives `tiles/*`, `search.json` and hashed assets a one-year
immutable cache and `index.html` no-cache. The tile directories are named after the
archive's content hash and the page requests `search.json` with `?v=<content hash>`,
so a data rebuild still reaches visitors.

### Data downloads

The census map's footer links to two CSVs (one row per DA, built by `pipeline/exports.py`; values
match the popups, dollars rounded to whole dollars, rates to one decimal):

- `/data/toronto_da_income_2021.csv`: 3,743 DAs on 2021 boundaries.
  - `dauid`; `nbhd_id`, `nbhd`: the City neighbourhood covering most of the DA; `nbhd2`:
    a second neighbourhood when the DA is split between two (otherwise empty).
  - `pop21`: 2021 population; `hh`: private households.
  - `same_boundary_2016`: 1 if the DA's boundary is identical in 2016 (change is
    only reported for these), else 0.
  - For each income measure `med_hh_tot`, `med_hh_at`, `med_ind_tot`, `med_ind_at`
    (median household total / after-tax, individual total / after-tax) and
    `avg_hh_tot` (average household total):
    `<m>_2020` and `<m>_2020_pctl` (value and percentile rank among Toronto DAs, 2021
    Census); `<m>_2015` and `<m>_2015_pctl` (the same DA in the 2016 Census, boundary-
    identical DAs only); `<m>_change` (nominal dollars), `<m>_change_real` (2020
    dollars, 2015 value × the CPI factor in `breaks.json`) and `<m>_change_pctl`
    (percentile points).
  - For `lim_at` (% of people in low income, LIM-AT) and `transfers` (% of total
    income from government transfers): `<m>_2020`, `<m>_2020_pctl`, `<m>_2015`,
    `<m>_2015_pctl`, `<m>_change` (percentage points) and `<m>_change_pctl`.
  - For the census-dated rates `renter` (% of private households renting), `shelter30`
    (% of owner and tenant households with income spending 30%+ of it on shelter),
    `owner30`, `tenant30` (the same among owners, tenants), `subsidized` (% of tenant
    households in subsidized housing), `detached`, `apt5`, `condo` (% of occupied private
    dwellings that are single-detached, apartments in 5+ storey buildings,
    condominiums), `built_new`, `built_old` (% built in the five years before the
    census, in 1960 or before), `crowded` (% of households in housing not suitable for
    their size), `degree` (% of people aged 25–64 with a bachelor's degree or higher),
    `moved1`, `moved5` (% who moved in the past year, five years), `imm_recent` (% who
    immigrated in the five years before the census), `age0_14`, `age65` (% of the
    population): the same columns, suffixed by census year: `<m>_2021`,
    `<m>_2021_pctl`, `<m>_2016`, `<m>_2016_pctl`, `<m>_change`, `<m>_change_pctl`.
  - For `value` (median value of owned dwellings), `own_cost` and `rent` (median
    monthly shelter costs of owners, renters): `<m>_2021`, `<m>_2021_pctl`, `<m>_2016`,
    `<m>_2016_pctl`, `<m>_change` (nominal dollars), `<m>_change_real` (2021 dollars,
    2016 value × `factor_census` in `breaks.json`) and `<m>_change_pctl`.
  - Empty cells: suppressed or not published, or (for the 2015/2016 and change
    columns) no boundary-identical 2016 DA.
- `/data/toronto_da_income_2016.csv`: 3,702 DAs on 2016 boundaries: `dauid`, `nbhd_id`,
  `nbhd`, `nbhd2`, `pop16`, `hh`, `same_boundary_2021`, and for each measure its 2016
  Census value and percentile (`<m>_2015`, `<m>_2015_pctl` for the income measures,
  `<m>_2016`, `<m>_2016_pctl` for the rest).
- `/data/toronto_da_income_2011.csv` (linked from the 2011 page): 3,685 DAs on 2011
  boundaries: `dauid`, `nbhd_id`, `nbhd`, `nbhd2`, `pop11`, `hh`, `same_boundary_2016`
  (1 if the DA is identical in 2016), and for each measure its value and percentile
  (`<m>_2010`, `<m>_2010_pctl` for the income measures, `<m>_2011`, `<m>_2011_pctl` for
  the rest). Empty cells: suppressed, a global non-response rate of 50% or more, or a DA
  absent from the NHS table.

### Data caveats

- **Income years are 2015 and 2020.** Each census asks about the previous calendar
  year. 2020 includes pandemic benefits (CERB and others), which raised low-end
  incomes, so part of the 2015→2020 change reflects temporary benefits. This matters
  most for the low-income rate (City of Toronto 20.2% → 13.2%) and the share of income
  from transfers (9.4% → 15.5%), and it also lowers 2021's shelter-cost burden, which is
  measured against 2020 income.
- **Housing shares are estimates from the 25% sample, with randomly rounded counts.**
  In small DAs this makes them noisy (a renter share can move several points by
  rounding alone), and a computed share is capped at 100%.
- **Inflation.** The default change is in 2020 dollars for incomes and 2021 dollars for
  dwelling values and shelter costs, using Toronto's annual-average all-items CPI
  (prices rose 9.4%, 2015 → 2020, and 10.2%, 2016 → 2021). It is one price index for everyone; it
  doesn't reflect each household's own costs (rent especially). The nominal option shows
  unadjusted dollars, where a DA whose income merely kept pace with prices still gains.
- **Percentile change** compares a DA's rank among Toronto DAs in each census; each
  year's percentiles are computed over that year's own set of DAs.
- **Residents change.** A DA's population turns over between censuses (new towers
  especially), so a change describes the place, not the same people.
- **Suppression.** StatCan suppresses figures for DAs with small populations or
  data-quality problems: for median incomes, 68 Toronto DAs in 2021, 23 (household) / 66
  (individual) in 2016; 16-100 DAs for the other measures (the legend gives each count).
  They are drawn hatched grey, never as zero.
- **Rounding.** StatCan publishes income medians rounded, more coarsely as values grow
  (in this data: multiples of $1,000 above $80,000, finer steps of $100–$200 below),
  so many DAs tie. 2016 medians are not rounded. Quantile classes and percentile ranks
  are computed on the published values, so small changes (the "within ±$2k" / ±$1k /
  ±3 pts class) are within rounding noise.
- **Medians of DAs.** Each DA counts once in the classes and percentiles regardless
  of population. The city-wide figures shown are StatCan's own City of Toronto medians
  (household total $65,829 in 2015, $84,000 in 2020), which differ from the median of
  DA medians.
- **Visual weight.** Large, sparsely populated DAs (industrial land, parks, the
  airport) take up more of the map than their population warrants.
- "Individual" measures cover people aged 15+ in private households who had income.
- **Search reflects census geography, not current addresses exactly.** Addresses are a
  2026 City snapshot placed in 2021 DAs; new buildings may sit in DAs whose 2021
  population was different, and a handful of points lie within metres of a DA edge.
- **Neighbourhoods** are the City's 158 social-planning neighbourhoods, used only as a
  locator; they are not a census geography.

### Sources and licence

Statistics Canada, Census Profile, 2021 Census of Population (98-316-X2021001) and
2016 Census of Population (98-316-X2016001); 2021 and 2016 dissemination area
cartographic boundary files (92-160-X); 2021 dissemination area correspondence file
(92-156-X). Contains
information licensed under the
[Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada).
2021 forward sortation area boundary file, when used for the FSA overlay; Consumer Price
Index, table 18-10-0005-01.
City of Toronto Open Data: Neighbourhoods, City Wards, Address Points (Municipal) and
Centreline Intersection file. Contains information licensed under the
[Open Government Licence - Toronto](https://open.toronto.ca/open-data-licence/).
Basemap: Protomaps (BSD-3-Clause style code, ODbL data), data © OpenStreetMap contributors; label fonts Noto Sans (SIL OFL).
