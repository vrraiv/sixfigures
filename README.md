# Toronto median income map

An interactive choropleth of median income across the City of Toronto's 3,743
2021 Census dissemination areas (DAs). Switch between four measures (household and
individual, before and after tax), hover for values, click for detail, or search for
a Toronto address or intersection to jump to its DA.

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
scripts/             build-time size check (fails above the 10 MB budget)
wrangler.jsonc       Worker config: serves ./web/dist as static assets
```

## Run locally

Requires Node 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # -> web/dist (about 8.2 MB; fails above 10 MB)
npm test           # search lookups vs the pipeline's DA assignment
```

## Rebuild the data

The derived `web/public/toronto_da.pmtiles`, `breaks.json` and `search.json` are
committed, so this is only needed to change the pipeline. From WSL, Linux or macOS,
with Python 3.11+ and tippecanoe installed:

```sh
python3 -m venv ~/.venvs/toronto-dash && . ~/.venvs/toronto-dash/bin/activate
make deps
make data          # download -> build.py -> tippecanoe -> search_index.py
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

## Data caveats

- **Income year is 2020.** The 2021 Census asks about the previous calendar year. 2020
  includes pandemic benefits (CERB and others), which raised low-end incomes, so
  medians are not directly comparable with 2015 (2016 Census) figures.
- **Suppression.** StatCan suppresses income for DAs with small populations or
  data-quality problems. 68 Toronto DAs have no income figures; they are drawn
  hatched grey, never as zero.
- **Rounding.** StatCan publishes income medians rounded, more coarsely as values grow
  (in this data: multiples of $1,000 above $80,000, finer steps of $100–$200 below),
  so many DAs tie.
  Quantile classes and percentile ranks are computed on those rounded values.
- **Medians of DAs.** Each DA counts once in the classes and percentiles regardless
  of population. The city-wide figure shown is StatCan's own City of Toronto median
  ($84,000 household total), which is lower than the median of DA medians ($95,000).
- **Visual weight.** Large, sparsely populated DAs (industrial land, parks, the
  airport) take up more of the map than their population warrants.
- "Individual" measures cover people aged 15+ in private households who had income.
- **Search reflects census geography, not current addresses exactly.** Addresses are a
  2026 City snapshot placed in 2021 DAs; new buildings may sit in DAs whose 2021
  population was different, and a handful of points lie within metres of a DA edge.
- **Neighbourhoods** are the City's 158 social-planning neighbourhoods, used only as a
  locator; they are not a census geography.

## Sources and licence

Statistics Canada, Census Profile, 2021 Census of Population (98-316-X2021001), and
2021 Census dissemination area cartographic boundary file (92-160-X). Contains
information licensed under the
[Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada).
City of Toronto Open Data: Neighbourhoods, Address Points (Municipal) and Centreline
Intersection file. Contains information licensed under the
[Open Government Licence - Toronto](https://open.toronto.ca/open-data-licence/).
Basemap © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
