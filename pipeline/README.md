# Data pipeline

`make data` (from the repo root, in WSL/Linux/macOS) runs:

1. `pipeline/download.py` – fetches the raw files into `pipeline/raw/` (gitignored).
2. `pipeline/build.py` (with `census2016.py` and `distributions.py`) – streams both profile CSVs, filters to
   Toronto, pivots, joins to boundaries, tags each DA with its City neighbourhood, links
   the years through the DA correspondence file, writes `pipeline/out/toronto_da.geojson`,
   `pipeline/out/toronto_da_2016.geojson` and `web/public/breaks.json`, and (through
   `exports.py`) the CSV downloads in `web/public/data/`.
3. `tippecanoe` – writes `web/public/toronto_da.pmtiles` and `toronto_da_2016.pmtiles`.
4. `pipeline/search_index.py` – writes `web/public/search.json` (address/intersection → DA
   lookup) and `pipeline/out/search_sample.json` for `npm test`.
5. `pipeline/overlays.py` + `tippecanoe` – boundary overlays in `web/public/overlays.pmtiles`:
   layers `nbhd`, `ward` and, if `raw/lfsa000b21a_e.zip` exists, `fsa` (FSAs whose code
   starts with M), each with a `<kind>_label` layer of one point per area
   (`representative_point`, inside the area). Properties: `code`, `label`, `area_km2`.

Separately:

- `make cpi` – `pipeline/cpi.py` reads the annual-average all-items CPI for
  "Toronto, Ontario" (or `--geo Canada`) for 2015 and 2020 from table 18-10-0005-01
  through StatCan's Web Data Service (getCubeMetadata, then
  getDataFromCubePidCoordAndLatestNPeriods), writes `pipeline/cpi.json`, then runs
  `make breaks`. Last run 2026-10-26: Toronto 128.3 → 140.3 (×1.0935, vector v41695186);
  a Canada run returned 126.6 → 137.0, as published.
- `make breaks` – `pipeline/refresh.py` reapplies the CPI factor and histograms to
  `breaks.json` and rewrites the CSVs from `pipeline/out/*.geojson`, without the raw
  downloads. It checks that the GeoJSON matches the breaks (same comparable-DA counts).

The FSA boundary file comes from www12.statcan.gc.ca, whose bot challenge rejects
scripts, so `download.py` lists it as optional: fetch
https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lfsa000b21a_e.zip
in a browser into `pipeline/raw/` and rerun `make overlays` to add FSAs.

Setup in WSL (keep the Linux venv off `/mnt/c`, which is OneDrive-synced and already
holds the Windows `.venv`; Ubuntu 24.04's system pip refuses installs under PEP 668):

```sh
python3 -m venv ~/.venvs/toronto-dash && . ~/.venvs/toronto-dash/bin/activate && make deps
```

Then install tippecanoe (below).

## Sources (downloaded 2026-10-26)

| File | Size | URL |
|---|---|---|
| `98-401-X2021006_Ontario_eng_CSV.zip` – Census Profile 2021, CDs/CSDs/DAs, Ontario only | 757,020,277 B (8.78 GB CSV inside) | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=006_Ontario |
| `lda_000b21a_e.zip` – 2021 DA cartographic boundary file, shapefile, English | 197,042,003 B | https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lda_000b21a_e.zip |

2016 Census and correspondence (downloaded 2026-10-26):

| File | Size | URL |
|---|---|---|
| `98-401-X2016044_ONTARIO_eng_CSV.zip` – Census Profile 2016, CDs/CSDs/DAs, Ontario only | 567,028,559 B (4.70 GB CSV inside) | https://www12.statcan.gc.ca/census-recensement/2016/dp-pd/prof/details/download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=044_ONTARIO |
| `lda_000b16a_e.zip` – 2016 DA cartographic boundary file, shapefile, English | 92,584,383 B | https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/files-fichiers/2016/lda_000b16a_e.zip |
| `2021_92-156-X_DALand_ADsup.zip` – 2021↔2016 DA correspondence with land-area share | 628,586 B | https://www12.statcan.gc.ca/census-recensement/2021/geo/aip-pia/correspondence-correspondance/files-fichiers/2021_92-156-X_DALand_ADsup.zip |

Listing pages: 2016 profile https://www12.statcan.gc.ca/census-recensement/2016/dp-pd/prof/details/download-telecharger/comp/page_dl-tc.cfm?Lang=E ;
2016 boundaries https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/bound-limit-2016-eng.cfm ;
correspondence https://www12.statcan.gc.ca/census-recensement/2021/geo/aip-pia/correspondence-correspondance/index2021-eng.cfm?year=21 .

City of Toronto Open Data (Open Government Licence – Toronto), resolved at download time
through the portal's CKAN `package_show` API (the portal intermittently returns 504s, so
`download.py` retries with backoff and checks the leading bytes before keeping a file):

| File | Size | Dataset |
|---|---|---|
| `toronto_neighbourhoods_4326.geojson` – 158 neighbourhoods | 2,141,269 B | https://open.toronto.ca/dataset/neighbourhoods/ |
| `toronto_wards_4326.geojson` – 25 City wards (CKAN `city-wards`, "City Wards Data - 4326.geojson") | 1,148,140 B | https://open.toronto.ca/dataset/city-wards/ |
| `toronto_address_points_4326.csv` – Address Points (Municipal), Toronto One Address Repository | 183,485,596 B | https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/ |
| `toronto_intersections_4326.csv` – Centreline Intersection file | 11,731,542 B | https://open.toronto.ca/dataset/intersection-file-city-of-toronto/ |

The address points are refreshed daily by the City; `search.json` is a snapshot of the
2026-10-26 file.

Listing pages:
- Profile: https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm?Lang=E
  → "Comprehensive download files" → "Canada, provinces, territories, CDs, CSDs and DAs – Ontario only" → CSV.
  (The older `.../download-telecharger/comp/page_dl-tc.cfm?Lang=E` URL now returns 404.)
- Boundaries: https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21
  → English, Cartographic, Dissemination areas, Shapefile.

**Download note:** www12.statcan.gc.ca serves a Cloudflare bot challenge, so scripted
downloads usually get HTTP 403. `download.py` detects this, never saves the challenge
page, and prints the URLs; open them in a browser and save to `pipeline/raw/`.

## Processing notes

- **Encoding:** the profile CSV is Latin-1, not UTF-8.
- **Layout:** long format; `C1_COUNT_TOTAL` is followed by its own `SYMBOL` column. Suppressed
  cells have a blank value and `SYMBOL = "x"`. Any non-numeric value (`..`, `x`, `F`, blank) is
  treated as null and flagged `sup_<measure> = true`.
- **Toronto filter:** the DA boundary file has no CSDUID column, so DAs are selected by
  `DAUID LIKE '3520%'` (Toronto CD). `build.py` checks that CD 3520 contains only CSD 3520005,
  and that DA populations sum to the CSD total, before continuing.
- **City-wide median** in `breaks.json` is the official CSD 3520005 value from the profile
  (`city_median`); `median_of_das` is the unweighted median of DA medians, for reference.
- **Breaks:** 6-class quantiles over 2016 and 2021 DA values pooled
  (`numpy.quantile(method="nearest")`, so each break is an actual DA value); array is
  `[min, q1/6 … q5/6, max]`. One scale for both years, so a colour means the same dollars.
- **Change breaks** (fixed, symmetric around zero): household ±$2k / $10k / $20k,
  individual ±$1k / $5k / $10k, percentile ±3 / 10 / 20 points. The middle class is
  "little or no change" because 2021 medians are rounded and 2016 medians are not.
- **2016 profile format** differs from 2021: UTF-8 with BOM, no DGUID, numeric GEO_LEVEL,
  DAUID in `GEO_CODE (POR)` and CSDUID + suffix in `ALT_GEO_CODE` (so Toronto DAs are
  exactly those with ALT_GEO_CODE starting 3520005), suppression markers (`x`, `F`)
  inline in the value column, unrounded medians.
- **Correspondence:** `DARELFLAG` 1 = same DA (same code, 100% of land), 3 = several 2021
  DAs from one 2016 DA (each 2021 DA wholly inside it, checked), 4 = many-to-many. Only
  flag-1 DAs get 2016 values (`v16_*`, `p16_*`) in the 2021 tiles; the browser computes
  the change from them. 2021 DAs: 3,606 flag 1, 70 flag 3, 67 flag 4.
- **Percentile rank** `pct_<measure>`: share of non-null DAs with an equal or lower value
  (`rank(method="max", pct=True) × 100`, rounded, floor 1).

- **Neighbourhood (`nbhd`)**: DAs have no names (the profile's GEO_NAME is the DAUID). Each
  DA gets the City of Toronto neighbourhood covering the largest share of its area
  (EPSG:2952 overlay). 3,703 of 3,743 DAs are >= 95% inside one neighbourhood; 13 are
  < 90%, and for those the runner-up is kept as `nbhd2` ("mostly X, partly Y").
- **Address search** (`search_index.py`): each official address point is placed in a DA by
  point-in-polygon against the StatCan DA boundaries. The browser only matches exact
  official addresses (number + street, with common abbreviations); it never interpolates.
  The same address string in two former municipalities stays as separate records (the
  user picks one); 3 addresses have points in two DAs within one former municipality and
  show both. Intersections (excluding overpass/underpass pseudo-intersections) keep every
  DA within 15 m: 9,210 resolve to one DA, 19,594 sit on a DA boundary and show all of them.
- **Test:** `npm test` decodes 20,000 random address records with the browser code and
  checks each lands in the pipeline's DA, with and without the former municipality.

## Row counts (2026-10-26 build)

| | rows |
|---|---|
| Profile CSV data rows scanned | 55,503,576 |
| Rows kept (CD 3520 DAs + CSD, 6 characteristics) | 22,464 |
| Toronto DAs in boundary file / in profile | 3,743 / 3,743 |
| DAs with suppressed income (all four measures together) | 68 |
| DAs with suppressed household count | 9 |
| Population: sum of DAs = CSD 3520005 | 2,794,356 |
| City address points / inside a Toronto DA | 525,377 / 525,375 |
| Address records in `search.json` (distinct strings) | 523,984 (522,235) |
| Intersections kept / one DA / on a boundary | 28,804 / 9,210 / 19,594 |
| 2016 profile data rows scanned / kept | 46,706,142 / 22,224 |
| 2016 Toronto DAs (profile = boundary = correspondence) | 3,702 |
| 2016 population: sum of DAs = CSD 3520005 | 2,731,571 |
| 2016 DAs suppressed (household / individual measures) | 23 / 66 |
| DAs with a change value (household / individual) | 3,534 / 3,526 |
| DAs not compared: boundary changed / not published | 137 / 72–80 |

Matched characteristics (`CHARACTERISTIC_ID`: name): 243 median total household income,
244 median after-tax household income, 113 median total income among recipients,
115 median after-tax income among recipients, 1 Population 2021,
50 "Total - Private households by household size - 100% data".

2016 (Member ID: name): 742 "Median total income of households in 2015 ($)",
743 "Median after-tax income of households in 2015 ($)", 663 "Median total income in 2015
among recipients ($)", 665 "Median after-tax income in 2015 among recipients ($)",
1 "Population, 2016", 51 "Total - Private households by household size - 100% data".

## Output properties (`da` layer)

2021 (`toronto_da.pmtiles`): `dauid`, `med_hh_tot`, `med_hh_at`, `med_ind_tot`,
`med_ind_at`, `pop21`, `hh`, `sup_<measure>` (bool), `pct_<measure>` (1–100), `nbhd`,
`nbhd_id`, `nbhd2`, `rel` (correspondence flag), and for `rel` = 1: `v16_<measure>`,
`p16_<measure>` (2016 value and percentile).

2016 (`toronto_da_2016.pmtiles`): the same income fields for 2016 plus `pop16`, and
`rel` = 1 if the DA is unchanged in 2021, else 0. Nulls are omitted from the tiles.

## Installing tippecanoe

Windows has no native build; use WSL (admin PowerShell: `wsl --install -d Ubuntu`, reboot), then in Ubuntu:

```sh
sudo apt update && sudo apt install -y build-essential libsqlite3-dev zlib1g-dev make git python3-venv
git clone https://github.com/felt/tippecanoe && cd tippecanoe && make -j && sudo make install
tippecanoe --version   # needs >= 2.17 for direct .pmtiles output
```

macOS: `brew install tippecanoe`.
