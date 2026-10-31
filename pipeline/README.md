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

2006 Census (downloaded 2026-10-30), for the forecast backtest: the DA profile
(94-581-XCB2006002, the last mandatory long form; income year 2005) is one Beyond 20/20
table in the Data Liberation Initiative's 2006 Profile Series deposit on Borealis
(doi:10.5683/SP3/RFXZIF, file 27195, 237,696,851 B, MD5 cba104748aa71c675022b64f2b309e51,
checked by `download.py`). `pipeline/profile2006.py` reads it with pyivt (as for the
NHS, under WSL) and writes Toronto's CSD row and 3,556 DAs to
`pipeline/out/toronto_profile_2006.csv`: the characteristics in `measures.CHARS_2006`
and the income groups in `measures.INCOME_GROUPS_2006`. Its Toronto population is the
published 2,503,281, and DA sums of the 100% counts are within 0.04-0.7% of the city.
`measures.COMPARABLE_2006` records how each map measure stands in 2006: 16 the same
concept; the three shelter-cost shares near (the 2006 base includes households with zero
or negative income); low income (LICO, not LIM-AT) and dwelling value, owner costs and
rent (published as averages) different; transfers, subsidized tenants, condominiums and
crowding not in the profile.

`make census2006` runs `pipeline/census2006.py`, which places the 2006 DAs in the 158
neighbourhoods and writes `pipeline/census/` (committed): `da_2006.csv` (each DA's
neighbourhood), `nbhd_2006.csv` (the same and near measures by neighbourhood, aggregated
as `insights.py` does, plus 2006's average rent, value and owner costs and LICO-AT under
their own names) and `manifest.json` (checks, city values). It needs two files from
www12, listed in `download.py` (usually a browser download, as for the other www12
files): the 2006 DA boundary file `gda_000a06a_e.zip` (digital; the cartographic
`gda_000b06a_e.zip` works too) and the 2011↔2006 DA correspondence
`2011_92-156_DALand_ADsup_txt.zip`. All 3,519 DAs unchanged between 2006
and 2011 land in the neighbourhood the 2011 figures give them. The profile stores
suppressed statistics as 0; the script nulls them. 21 boundary DAs are not in the
profile and 5 had their 100% data suppressed, so the DAs sum to 10,518 (0.4%) fewer
people than the city; `das_without_counts` marks the 23 neighbourhoods affected.

2011 Census (downloaded 2026-10-29). The 2011 DA profile is one zip for all of Canada with a
CSV per province (Deflate64: Python's `zipfile` can't open it; the Makefile uses `unzip`). Its
CSV has no characteristic IDs, so `measures.CHARS_2011` matches rows by Topic and
Characteristic. Only the short form is in it: the 2011 long form was the voluntary
National Household Survey (NHS), and StatCan never released NHS data for DAs (its NHS
Profile downloads stop at census tracts). A semi-custom DA tabulation (product
99-014-X2011007, "all GNRs": every DA, each with its non-response quality flag) went to
universities through the Data Liberation Initiative, and the University of Toronto Map and
Data Library's deposit of it on Borealis (Scholars Portal) is public, as one zipped
Beyond 20/20 table; `download.py` fetches the zip, checks its MD5 and extracts the table.
A second Borealis deposit (hdl:10864/11372, file 16487) has the same table unzipped, but
that copy is corrupt as deposited (the first 386 MB of 395 MB are zeros; only the
dictionaries and footnotes at the end survive) and no reader opens it.

`pipeline/nhs2011.py` streams the table with `pyivt` and writes Toronto's rows
(`pipeline/out/toronto_nhs_2011.csv`: the CD, the CSD and 3,665 DAs, the characteristics
in `measures.NHS_2011`); `census2011.py` joins them to the profile's DAs. pyivt 0.0.5
on PyPI cannot read this older table (its `_Sort` and `_Decimals` member fields;
`to_arrow()` stops with "referenced member text is not a byte vector" and
`pipeline/nhs_probe.py` reproduces it); the fix is a small patch to pyivt's
`members.rs`, sent upstream. pyivt is a Rust extension, so on a machine without a
Rust toolchain build it under WSL and run `nhs2011.py` there (`make PYIVT_PYTHON="wsl -e
/home/<user>/pyivt/.venv/bin/python" ...`); the script imports only pyivt and pyarrow.
Beyond 20/20 Browser opens the table too; `canivt` 0.5.0 (R) does not read it in
practice (it takes the geography count for 256, recovers no geography codes, and declines
the 155.6 M-cell grid). The NHS DA figures follow StatCan's own rule: DAs whose global
non-response rate was 50% or more (266 of them; the table's data-quality flag) are
nulled, and 20 of the 3,685 DAs are absent from the table altogether.

| File | Size | URL |
|---|---|---|
| `98-316-XWE2011001-1501.zip` – Census Profile 2011, dissemination areas, Canada (15 provincial CSVs; `-ONT.csv` is 891,059,541 B, 9.4 M rows) | 155,904,986 B | https://www12.statcan.gc.ca/census-recensement/2011/dp-pd/prof/details/download-telecharger/comprehensive/comp_download.cfm?LANG=E&CTLG=98-316-XWE2011001&FMT=CSV1501 |
| `gda_000b11a_e.zip` – 2011 DA cartographic boundary file, shapefile, English (EPSG:4269) | 150,420,759 B | https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/files-fichiers/gda_000b11a_e.zip |
| `2016_92-156_DALand_ADsup_csv.zip` – 2016↔2011 DA correspondence with land-area share | 427,653 B | https://www12.statcan.gc.ca/census-recensement/2011/geo/ref/files-fichiers/2016/2016_92-156_DALand_ADsup_csv.zip |
| `NHSprofile_Can_PR_CD_CSD_DA.zip` – NHS semi-custom profile 2011, Canada/PR/CD/CSD/DA, Beyond 20/20 (`.IVT` inside, 394,820,739 B; 59,408 geographies × 2,620 characteristics) | 101,809,139 B, MD5 56fa06ade0708b35c102e6a895cb3145 | https://borealisdata.ca/api/access/datafile/7750 (dataset doi:10.5683/SP3/8BFD0R) |

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

Housing stock and pipeline (downloaded 2026-10-30), for the forecast model: apartment
building registrations (3,611 buildings, 328,273 units), rental demolition and
replacement approvals (165, from 2017), development applications (8,622 from 2008, one
row per address) and the affordable rental housing pipeline (277 projects, no dates, so
a snapshot only). `make city` runs `pipeline/city_layers.py`, which places each record
in a 2021 DA and the figures files' neighbourhood (by address for the first two, by
coordinates for the others; development applications' X, Y are NAD27 MTM 10,
EPSG:2019), reads unit counts from the development applications' descriptions, and
writes `pipeline/city/*.csv` (committed) and `pipeline/city/manifest.json` with match
rates and checks. The City's quarterly social and affordable housing counts have no
geography, so they aren't used.

Listing pages:
- Profile: https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm?Lang=E
  → "Comprehensive download files" → "Canada, provinces, territories, CDs, CSDs and DAs – Ontario only" → CSV.
  (The older `.../download-telecharger/comp/page_dl-tc.cfm?Lang=E` URL now returns 404.)
- Boundaries: https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21
  → English, Cartographic, Dissemination areas, Shapefile.

**Download note:** www12.statcan.gc.ca serves a Cloudflare bot challenge, so scripted
downloads usually get HTTP 403. `download.py` detects this, never saves the challenge
page, and prints the URLs; open them in a browser and save to `pipeline/raw/`.

Building permits (downloaded 2026-10-30), for the forecast model: the City's cleared
permits 2000-2016 and since 2017 and its active permits (Open Data, through CKAN;
`download.py`). `make permits` runs `pipeline/permits.py`, which keeps one row per
permit, counts units created on building permits and units lost on those and on
demolition permits, counts a project's units once where companion permits repeat them
(about 2,300 units), places each permit by address in a 2021 DA and the figures files'
neighbourhood, and writes `pipeline/permits/by_nbhd.csv` (committed: units by
neighbourhood, year issued and year completed) and `pipeline/out/permits_by_da.csv`.
GEO_ID alone places 30-90% of a year's units, because towers get new addresses; the
address-string and nearest-number fallbacks bring every issue year since 2000 to at
least 87%. Completion years are rough: the 2000-2016 file has no permit closed in 2007,
and thousands of old permits were closed administratively in 2025-2026.
`pipeline/permits/manifest.json` holds the run's checks against census household change
and the CMA's permits in StatCan table 34-10-0292. The dwelling check reads total private
dwellings from the raw 2011, 2016 and 2021 profiles once and caches them in
`pipeline/out/toronto_dwellings.csv`.

School test results (downloaded 2026-10-31), for the forecast model: Ontario's School
Information and Student Demographics files, one per school year from 2017-18
(data.ontario.ca, Open Government Licence - Ontario; `download.py` saves them to
`pipeline/raw/schools/`). `make schools` runs `pipeline/schools.py`, which places each
school by its coordinates in a 2021 DA and neighbourhood and writes
`pipeline/schools/schools.csv` (committed: 828 schools in the City, every school year,
with EQAO results and demographic shares), `pipeline/schools/by_nbhd.csv` (committed: the
Grade 3 and 6 score by neighbourhood and test year, by the nearest schools to each DA and
by the schools inside the neighbourhood) and `manifest.json` (checks). The files write
shares as "62%", as integer percents and as fractions, sometimes in one column; the
2019-20 and 2020-21 files repeat the 2018-19 results (no tests in the pandemic), which
the script confirms value for value before dropping them, so the test years are 2018,
2019 and 2022-2025. The 2023-24 file is preliminary. No attendance areas are published.

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
