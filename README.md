# Toronto median income map

An interactive choropleth of median income across the City of Toronto's
dissemination areas (DAs) in the 2016 and 2021 censuses (income years 2015 and 2020),
and the change between them. Switch between four measures (household and individual,
before and after tax), hover for values, click for detail, or search for a Toronto
address or intersection to jump to its DA.

## Census years and change

- **2016 / 2021** show each census on its own DA boundaries (3,702 and 3,743 DAs). Both
  use one colour scale (6 quantile classes over 2016 and 2021 DAs pooled), so a colour
  means the same dollars in either year. The 2016 tiles load on first use.
- **Change** (2021 boundaries) shows, for each DA, the change in median income in
  2020 dollars (the default: 2015 incomes × 1.0935, Toronto's all-items CPI 128.3 → 140.3,
  table 18-10-0005-01, from `pipeline/cpi.json`), in nominal dollars, or the change in its percentile rank (points),
  on a red-grey-blue scale centred on zero. Only DAs whose boundary is identical in both censuses are compared, per
  StatCan's DA correspondence file: 3,606 of 3,743 (96%). The other 137 were split or
  redrawn; a median can't be split or combined across new boundaries, so they are
  shown dotted, not estimated. DAs whose income wasn't published in either year are
  hatched.
- The popup lists both years, the dollar change and the percentile change for all four
  measures, and a histogram of all Toronto DAs with this DA's bar in orange and a line at
  the city median (or at zero for change). The histograms are in `breaks.json`, built by
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
- **Pin to compare.** "Pin to compare" in the popup outlines that DA in purple; clicking
  another DA then adds a table of the pinned DA, this DA and the difference for all four
  measures, in the current view's terms. The chip at the top of the map unpins it. The
  pin follows a switch to the other census only if the DA's boundary is the same in both.
- **Boundaries.** The legend's Boundaries control draws City neighbourhood or ward
  outlines (with labels) over the DAs, and FSAs (the first three characters of a postal
  code) when the pipeline had StatCan's FSA file. It lists only the layers in
  `overlays.pmtiles` and is hidden if that file wasn't built.
- **Keyboard and screen readers.** Tab to the map: a crosshair marks the centre, arrow
  keys pan and + / − zoom, and the DA under the crosshair is announced after each move.
  Enter or Space opens it; Escape closes it.

## Search and place names

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
PMTiles file (~2 MB) plus `breaks.json`; MapLibre GL JS reads the tiles through
pmtiles.js. It is hosted as a Cloudflare Worker with static assets only (no Worker
script, no API keys). Basemap: OpenFreeMap Positron.

Cloudflare's cache answers HTTP Range requests for the tiles with the whole file, which
the stock pmtiles.js fetcher rejects. `web/src/main.js` therefore uses a small source
that keeps range reads when a server returns 206 (as the Vite dev server does) and
otherwise reads from the single full response.

```
pipeline/            Python + Makefile: raw downloads -> GeoJSON -> PMTiles, search index
web/                 Vite app (index.html, src/, public/ with tiles, breaks, search, _headers)
scripts/             build-time size check (fails above the 15 MB budget)
wrangler.jsonc       Worker config: serves ./web/dist as static assets
```

## Run locally

Requires Node 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # -> web/dist (about 12 MB; fails above 15 MB)
npm test           # search lookups vs the pipeline's DA assignment
```

## Rebuild the data

The derived `web/public/*.pmtiles` (including `overlays.pmtiles`), `breaks.json`,
`search.json` and `data/*.csv` are
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

StatCan's site blocks scripted downloads with a bot challenge. If `make download`
reports that, fetch the files it prints in a browser into `pipeline/raw/`. The City of
Toronto portal sometimes times out; rerun `make download` later.
Source URLs, row counts and processing details are in
[pipeline/README.md](pipeline/README.md).

## Deploy

The GitHub repo is connected to the Cloudflare Worker `sixfigures` (Workers Builds),
so every push to `main` deploys. The dashboard deploy command is `npx wrangler deploy`;
no dashboard build command is needed because `wrangler.jsonc` sets
`build.command: "npm run build"`, which wrangler runs before each deploy.

Manual deploy from a machine logged in with `npx wrangler login`:

```sh
npm run deploy     # vite build && wrangler deploy
```

`web/public/_headers` gives `*.pmtiles`, `search.json` and hashed assets a one-year
immutable cache and `index.html` no-cache. The page requests those data files with
`?v=<content hash>`, so a data rebuild still reaches visitors.

## Data downloads

The footer links to two CSVs (one row per DA, built by `pipeline/exports.py`; values
match the popups, dollars rounded to whole dollars):

- `/data/toronto_da_income_2021.csv`: 3,743 DAs on 2021 boundaries.
  - `dauid`; `nbhd_id`, `nbhd`: the City neighbourhood covering most of the DA; `nbhd2`:
    a second neighbourhood when the DA is split between two (otherwise empty).
  - `pop21`: 2021 population; `hh`: private households.
  - `same_boundary_2016`: 1 if the DA's boundary is identical in 2016 (change is
    only reported for these), else 0.
  - For each measure `med_hh_tot`, `med_hh_at`, `med_ind_tot`, `med_ind_at` (household
    total / after-tax, individual total / after-tax):
    `<m>_2020` and `<m>_2020_pctl` (median and percentile rank among Toronto DAs, 2021
    Census); `<m>_2015` and `<m>_2015_pctl` (the same DA in the 2016 Census, boundary-
    identical DAs only); `<m>_change` (nominal dollars), `<m>_change_real` (2020
    dollars, 2015 median × the CPI factor in `breaks.json`) and `<m>_change_pctl`
    (percentile points).
  - Empty cells: suppressed or not published, or (for the 2015 and change columns) no
    boundary-identical 2016 DA.
- `/data/toronto_da_income_2016.csv`: 3,702 DAs on 2016 boundaries: `dauid`, `nbhd_id`,
  `nbhd`, `nbhd2`, `pop16`, `hh`, `same_boundary_2021`, and `<m>_2015`, `<m>_2015_pctl`
  for the four measures.

## Data caveats

- **Income years are 2015 and 2020.** Each census asks about the previous calendar
  year. 2020 includes pandemic benefits (CERB and others), which raised low-end
  incomes, so part of the 2015→2020 change reflects temporary benefits.
- **Inflation.** The default change is in 2020 dollars using Toronto's annual-average
  all-items CPI (prices rose 9.4%, 2015 → 2020). It is one price index for everyone; it
  doesn't reflect each household's own costs (rent especially). The nominal option shows
  unadjusted dollars, where a DA whose income merely kept pace with prices still gains.
- **Percentile change** compares a DA's rank among Toronto DAs in each census; each
  year's percentiles are computed over that year's own set of DAs.
- **Residents change.** A DA's population turns over between censuses (new towers
  especially), so a change describes the place, not the same people.
- **Suppression.** StatCan suppresses income for DAs with small populations or
  data-quality problems: 68 Toronto DAs in 2021, 23 (household) / 66 (individual) in
  2016. They are drawn hatched grey, never as zero.
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

## Sources and licence

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
Basemap © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
