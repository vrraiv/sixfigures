# Data pipeline

`make data` (from the repo root, in WSL/Linux/macOS) runs:

1. `pipeline/download.py` – fetches the raw files into `pipeline/raw/` (gitignored).
2. `pipeline/build.py` (with `census2016.py` and `distributions.py`) – streams both profile CSVs, filters to
   Toronto, keeps the characteristics listed in `measures.py`, pivots, computes the renter
   and shelter-cost shares, joins to boundaries, tags each DA with its City neighbourhood, links
   the years through the DA correspondence file, writes `pipeline/out/toronto_da.geojson`,
   `pipeline/out/toronto_da_2016.geojson` (every property) and `web/public/breaks.json`,
   and (through `exports.py`) the CSV downloads in `web/public/data/` and (through
   `figures.py`) the geometry-only `pipeline/out/toronto_da_geom.geojson` and
   `toronto_da_2016_geom.geojson` the tiles are cut from, plus the per-measure figure
   files in `web/public/data/figures/<year>/`.
3. `tippecanoe` – writes `web/public/toronto_da.pmtiles` and `toronto_da_2016.pmtiles`
   from the geometry-only GeoJSON.
   - `pipeline/census2011.py` does the same for the 2011 Census on its own: streams the
     Ontario 2011 DA profile, computes the dwelling-type and age shares, joins the 2011
     boundaries, flags DAs kept unchanged in 2016, and writes
     `pipeline/out/toronto_da_2011_geom.geojson` (geometry and DA numbers only),
     `web/public/data/figures/2011/` (the figures the page joins to the tiles, through
     `figures.py`), `web/public/breaks_2011.json` (the colour classes are copied from
     `breaks.json`) and `web/public/data/toronto_da_income_2011.csv`; `tippecanoe` then
     writes `toronto_da_2011.pmtiles` for the `/2011/` page.
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
  `breaks.json` and rewrites the CSVs and figure files from `pipeline/out/*.geojson`,
  without the raw downloads. It checks that the GeoJSON matches the breaks (same
  comparable-DA counts).

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

2011 Census (downloaded 2026-10-29). The 2011 DA profile is one zip for all of Canada with a
CSV per province (Deflate64: Python's `zipfile` can't open it; the Makefile uses `unzip`). Its
CSV has no characteristic IDs, so `measures.CHARS_2011` matches rows by Topic and
Characteristic. Only the short form is in it: the 2011 long form was the voluntary
National Household Survey (NHS), and StatCan's NHS Profile comprehensive downloads stop at
census tracts. The DA-level NHS Profile exists as one Beyond 20/20 table in the Data
Liberation Initiative copy on Borealis (Scholars Portal), public; `download.py` fetches it.
Reading it needs an IVT reader (`pyivt` on PyPI, or the `canivt` R package); not wired in yet.

| File | Size | URL |
|---|---|---|
| `98-316-XWE2011001-1501.zip` – Census Profile 2011, dissemination areas, Canada (15 provincial CSVs; `-ONT.csv` is 891,059,541 B, 9.4 M rows) | 155,904,986 B | https://www12.statcan.gc.ca/census-recensement/2011/dp-pd/prof/details/download-telecharger/comprehensive/comp_download.cfm?LANG=E&CTLG=98-316-XWE2011001&FMT=CSV1501 |
| `gda_000b11a_e.zip` – 2011 DA cartographic boundary file, shapefile, English (EPSG:4269) | 150,420,759 B | https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/files-fichiers/gda_000b11a_e.zip |
| `2016_92-156_DALand_ADsup_csv.zip` – 2016↔2011 DA correspondence with land-area share | 427,653 B | https://www12.statcan.gc.ca/census-recensement/2011/geo/ref/files-fichiers/2016/2016_92-156_DALand_ADsup_csv.zip |
| `NHSprofile_Can_PR_CD_CSD_DA.IVT` – NHS Profile 2011, Canada/PR/CD/CSD/DA, Beyond 20/20 | 394,820,739 B | https://borealisdata.ca/api/access/datafile/16487 (dataset hdl:10864/11372) |

Listing pages: 2011 profile https://www12.statcan.gc.ca/census-recensement/2011/dp-pd/prof/details/download-telecharger/comprehensive/comp-csv-tab-dwnld-tlchrgr.cfm?Lang=E ;
NHS profile (no DA level) https://www12.statcan.gc.ca/nhs-enm/2011/dp-pd/prof/details/download-telecharger/comprehensive/comp-csv-tab-nhs-enm.cfm?Lang=E ;
2011 boundaries https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/bound-limit-2011-eng.cfm ;
2016 correspondence https://www12.statcan.gc.ca/census-recensement/2011/geo/ref/cor-eng.cfm (a form; the file names
are `2016_92-156_<DA_AD|DALand_ADsup|DB_ID>_<csv|txt>.zip`).

2011 figures: Toronto 3,685 DAs (population 2,615,060, as published); the 2016↔2011
correspondence has 3,671 2016 DAs with flag 1 (same DA) and 31 with flag 3 (split from a
2011 DA), none many-to-many. The profile suppresses 20 DAs (`..`, 8; `x`, 12). Ages come
as five-year groups, summed to 0–14 and 65+ (`measures.AGE_SUMS_2011`); city-wide shares
are computed from the DA counts.

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
- **2016 zeros:** where too few owner or tenant households answered, the 2016 profile
  publishes a median of 0 rather than a suppression marker (2021 uses `x` or `..`): a
  dwelling value, owner cost or rent of $0. `measures.null_unpublished_2016` nulls
  those (278, 278 and 1,288 DAs). Percentages for the same households (`owner30`,
  `tenant30`, `subsidized`) are kept as published, 0% included, as in 2021, which also
  publishes 0% for many DAs whose median rent it suppresses. It also nulls published
  percentages above 100 (one 2016 `owner30` of 150).
- **Zero class:** when a sixth or more of the pooled DA values are exactly 0, quantile
  breaks would repeat 0, so `build.class_breaks` makes 0 its own class and splits the
  positive values into fifths; `breaks.json` marks those measures `zero_class`.
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

## Adding a measure

1. Find the characteristic in both profiles (the first geography in each CSV lists them
   all) and add it to `CHARS_2021` and `CHARS_2016` in `measures.py` by ID **and** name;
   both must match, since some names repeat (2021 has "Government transfers (%)" for
   both 2020 and 2019 income). A share computed from counts goes in `SHARES`.
2. Add it to `MEASURES` (unit, histogram widths, change breaks) and, if it refers to
   the income year (2015, 2020) rather than the census year, to `INCOME_DATED`.
3. Add it to `MEASURES` in `web/src/main.js` and to the menu in `web/index.html`.
4. `make data`. The cached extracts in `pipeline/out/` are re-streamed automatically
   when they lack a characteristic. Check the class counts that `build.py` prints.

A measure adds one JSON file per census to `web/public/data/figures/` (about 20–25 KB
compressed for 2021), not to the tiles, which carry only DA numbers. The browser
fetches only the tiles in view, and `npm run build` (`scripts/check-size.mjs`) budgets
the 2021 tile set at its heaviest zoom level, the most any view could need: it fails
above 2 MB (it was 1.76 MB with 27 measures in the tiles; a few hundred KB without).
The tiles are built with `--no-tile-size-limit`: under tippecanoe's default 500 KB
limit, 27 measures in the tiles made it drop about 1,500 of the 3,743 DAs at zooms 9
and 10.

## Row counts (2026-10-26 build; characteristics as of 2026-10-27)

| | rows |
|---|---|
| Profile CSV data rows scanned | 55,503,576 |
| Rows kept (CD 3520 DAs + CSD, 13 characteristics) | 67,392 (22,464 with the first 6) |
| Toronto DAs in boundary file / in profile | 3,743 / 3,743 |
| DAs with suppressed income (all four measures together) | 68 |
| DAs with suppressed household count | 9 |
| Population: sum of DAs = CSD 3520005 | 2,794,356 |
| City address points / inside a Toronto DA | 525,377 / 525,375 |
| Address records in `search.json` (distinct strings) | 523,984 (522,235) |
| Intersections kept / one DA / on a boundary | 28,804 / 9,210 / 19,594 |
| 2016 profile data rows scanned / kept | 46,706,142 / 48,152 |
| 2016 Toronto DAs (profile = boundary = correspondence) | 3,702 |
| 2016 population: sum of DAs = CSD 3520005 | 2,731,571 |
| 2016 DAs suppressed (household / individual measures) | 23 / 66 |
| DAs with a change value (household / individual) | 3,534 / 3,526 |
| DAs not compared: boundary changed / not published | 137 / 72–80 |

Matched characteristics: see `CHARS_2021` (`CHARACTERISTIC_ID`) and `CHARS_2016`
(Member ID) in `measures.py`. 2021 DAs suppressed per measure: 68 (median incomes),
100 (average household income, transfers share, shelter costs), 81 (LIM-AT), 16
(tenure). 2016: 23 / 66 (household / individual medians), 87, 66, 66, 19, 87.

## Outputs: tiles and figure files

The tiles (`toronto_da.pmtiles`, `toronto_da_2016.pmtiles`, layer `da`) carry one
property, `dauid`, which is also the feature id. The figures live in
`web/public/data/figures/<2021|2016>/`, every file listing DAs in the same order:

- `common.json`: `dauid`, `nbhd`, `nbhd_id`, `nbhd2`, `pop21` (or `pop16`), `hh`, `rel`
  (2021: the correspondence flag, 1 = same boundary as 2016; 2016: 1 if unchanged in 2021).
- `<measure>.json`: `v` (dollars as whole numbers, rates with one decimal; null where
  suppressed), `pct` (percentile, 1–100) and, for 2021 DAs with `rel` = 1, `v16` and
  `p16` (the 2016 value and percentile).

`pipeline/out/toronto_da.geojson` and `toronto_da_2016.geojson` keep every property
in one place (`refresh.py` reads them): the measures, `pct_<measure>`, `v16_<measure>`,
`p16_<measure>` and the common fields above.

## Installing tippecanoe

Windows has no native build; use WSL (admin PowerShell: `wsl --install -d Ubuntu`, reboot), then in Ubuntu:

```sh
sudo apt update && sudo apt install -y build-essential libsqlite3-dev zlib1g-dev make git python3-venv
git clone https://github.com/felt/tippecanoe && cd tippecanoe && make -j && sudo make install
tippecanoe --version   # needs >= 2.17 for direct .pmtiles output
```

macOS: `brew install tippecanoe`.
