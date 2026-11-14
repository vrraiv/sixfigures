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
  "Toronto, Ontario" (or `--geo Canada`) for the income and census years 2005-2021 from table 18-10-0005-01
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

## Rebuilding without the raw files

Each script that reads a Statistics Canada profile keeps Toronto's rows of it, a few megabytes,
in `pipeline/extracts/` (`extracts.py`, and the README there lists them). They are committed, and
a script uses an extract that holds every characteristic `measures.py` names instead of the raw
file, whatever the two files' dates. So a fresh checkout, a laptop without WSL or a cloud session
can run

```sh
make deps
make from-extracts    # insights.py -> explorer_data.py -> affinity.py
```

and rebuild the neighbourhood figures and what is made from them, with no www12 download, no
pyivt and no tippecanoe. The one download is the City's neighbourhood outlines, which a script
can fetch. The DA figures, breaks and tiles still take `make data`: they need the boundary files.

`make extracts` collects the extracts on a machine that still has them in `pipeline/out/`, loads
each as the rebuild will, and says what is missing. An extract is rewritten only when it lacks a
characteristic: the script that reads it stops and names the raw file to put in `pipeline/raw/`.

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
`pipeline/extracts/toronto_profile_2006.csv`: the characteristics in `measures.CHARS_2006`
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
(`pipeline/extracts/toronto_nhs_2011.csv`: the CD, the CSD and 3,665 DAs, the characteristics
in `measures.NHS_2011`); `census2011.py` joins them to the profile's DAs. pyivt 0.0.5
on PyPI cannot read this older table (its `_Sort` and `_Decimals` member fields;
`to_arrow()` stops with "referenced member text is not a byte vector" and
`pipeline/nhs_probe.py` reproduces it); the fix is a small patch to pyivt's
`members.rs`, kept here as `pipeline/pyivt/legacy-member-fields.patch`. It applies to
pyivt commit `ea428cc` (v0.0.5 plus 11 commits, 30 October 2026), the version these
scripts were written against. `make pyivt` (`pipeline/pyivt/build.sh`, in WSL, Linux or
macOS; needs Rust 1.88 or later from https://rustup.rs) clones pyivt at that commit,
applies the patch and installs it with pyarrow in `~/pyivt/.venv`; then run
`nhs2011.py` with that Python (`make PYIVT_PYTHON=~/pyivt/.venv/bin/python ...`, or from
Windows `PYIVT_PYTHON="wsl -e /home/<user>/pyivt/.venv/bin/python"`); the script imports
only pyivt and pyarrow. Checked on 13 November 2026 with a fresh build (pyarrow 26.0.1,
Python 3.14): `nhs2011.py`, `profile2006.py` and `demography_ivt.py` reproduced the four
files written on 30-31 October byte for byte. pyivt 0.0.6 and later include the fix
upstream, but changed the export interface these scripts use, so they stay on the pinned
commit.
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
`make school-insights` runs `pipeline/school_insights.py`, which writes the School Insights
page's `web/public/schools.json` (committed) from those files: the scored schools' results
and demographic shares by test year, the City's figures (checked against the manifest),
both neighbourhood methods and simplified neighbourhood outlines for the page's map.

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

CMHC (a model input, not part of the site): `make cmhc` runs `download.py`, which adds new
editions to `pipeline/raw/cmhc/`, then `pipeline/cmhc.py`, which writes `pipeline/cmhc/`
(committed). `download.py` fetches the monthly starts, completions and under-construction
tables by census subdivision (from January 2021; March 2021 is not on CMHC's server), the
October Rental Market Survey summary through the Housing Market Information Portal's
table export (the request the `cmhc` R package makes: by zone from 2010, for the City
from 2006), and CMHC's 2017 zone boundaries from the bucket that package uses. Outputs:
`starts_monthly.csv` and `starts_annual.csv` (City of Toronto; by dwelling type from 2023),
`rms_city.csv` and `rms_zones.csv` (with CMHC's a-d quality grades), `zone_nbhd.csv`
(each neighbourhood's 2021 renter households by zone) and `rms_nbhd.csv` (zone average
rent and vacancy weighted by them). Checks in `manifest.json`: each month's figures add
up to the year to date, later editions never revise them, the 17 zones add up to the
City's units exactly and to its average rent within $3, and 2020-2025 starts (119,597)
match the units on City permits issued in those years (116,521). The zone figures match
CMHC's published 2025 Toronto tables. One zone boundary moved: in 2012 about 2,800 units
went from Scarborough East to Scarborough Central, so before 2012 `rms_nbhd.csv` gives
both zones' neighbourhoods their combined figure; the script stops if the units show
another move (`ZONE_MOVES` in `cmhc.py`).

Housing Insights: `make housing-insights` runs `pipeline/housing_insights.py`, which writes
`web/public/housing.json` (committed) from the committed permits, City, CMHC and StatCan
series outputs and the households in the figures files. Those outputs aren't make
prerequisites (their rules would rerun the slow steps or a download); the script stops if
one is missing. It checks itself against the manifests: units created on permits issued
match `cma_check` each year, net units issued in 2016-2020 against the 2016-2021 change in
households match `census_check` (83,604, 48,090, r 0.901), and the 2025 RMS average rent is
$1,916.

## Getting around: Bike Share, ride-hail, subway delays, bicycle counters

Four City of Toronto Open Data packages, all published monthly, feed `/insights/transport/`.
Each script's docstring has the detail; the points that took finding:

- **Bike Share trips** (`bikeshare.py`, `make bikeshare`). One zip per year, 2017 on
  (`bike-share-toronto-ridership-data`; 24 MB for 2017, 90 to 390 MB from 2019). The files
  change layout from year to year: quarterly then monthly then one file a year, a zip
  inside the 2022 zip, five date formats (1/4/2017 is 1 April in one quarter's file and
  4 January in the next), and July to December 2017 without station numbers. The script
  settles each file's date format by the months the file is named for, and stops if none
  fits. Trips under a minute are left out (148,440 of 44.3 million). The counts by station
  and month are committed in `pipeline/bikeshare/` (2 MB), and a year whose zip isn't on
  disk keeps its rows, so nothing needs the 1.8 GB again; `make download` skips the zips
  (`download.ON_REQUEST`).
- **Where a station is.** The trip files have a station's number and name only. Current
  stations come from Bike Share's live list (GBFS); 88 removed ones are placed at the
  intersection in their name (the City's intersection file), 11 by hand (`bikeshare.HAND`:
  the Toronto Islands' seasonal docks, which leave the live list each winter, among them),
  and 41 have no place. `stations.csv` is committed and keeps a removed station's last
  known place, so the list gets no worse as stations go. By year, 98.1% to 100% of trips
  that start at a numbered station start at one with a place.
- **Members and casual riders.** From October 2021 the "Casual Member" label spreads
  until every trip of August to December 2023 carries it; the 2024 files, in a new layout,
  have 7% in January. `transport_insights.SPLIT_UNKNOWN` blanks the split for October 2021
  to December 2023. The counts in `pipeline/bikeshare/` are as published.
- **Ride-hail** (`transport.py`). The daily summary (`summary_stats.csv`) of trips that
  start or end in Toronto, 2018 on; fares, waits and active vehicles from 2020. May 2025
  has days missing, so the page shows trips a day. The trip files (by hour and pickup and
  drop-off ward, 30 to 55 MB a year) and the vehicle-hours files (0.5 to 1.6 GB a year)
  aren't used.
- **Subway delays** (`transport.py`). One row per incident, 2014 on, in Excel files to 2024
  and a CSV from 2025. 35% of incidents held a train (`Min Delay` above 0); the others
  are logged with no delay. 1.8% are logged against two lines or none ("other").
- **Bicycle counters** (`transport.py`). 26 sites, most installed since 2022, and most with
  gaps of months. Only four (Sherbourne at Gerrard and at Wellesley, Yonge at Bloor and
  at St Clair) have counted in both directions on 20 days or more of every month since
  April 2023, and the series is those four added, so a new counter doesn't read as more
  cycling. It ends where they stop covering every month, which can be a month or two
  before the file does.

## Forecast backtests

`make forecast` runs `pipeline/forecast/schools.py` (one-year forecasts of each
school's Grade 3 and Grade 6 score) and `pipeline/forecast/value.py` (five-year
forecasts of each neighbourhood's dwelling value against the City's), with the shared
fitting and scoring in `pipeline/forecast/fit.py` (numpy, and LightGBM for boosting). The targets, rungs,
folds, predictors and the rule that picks a rung are in `docs/forecast-spec.md`; the
scores and predictions go to `pipeline/out/model/`. `schools.py --holdout` scores
2024 to 2025: once, after the rung is chosen.

`make demography` runs `pipeline/demography.py`, which writes
`pipeline/demography/nbhd.csv` (committed): population in ten-year age bands and by
period of immigration (2006 to 2021), and dwellings by structure type, bedrooms and
condition and owners with a mortgage (2011 to 2021), and the owner-weighted average
value of dwellings (2006 to 2021, with the City's in manifest.json), by neighbourhood,
for the dwelling-value model's demographic, dwelling and previous-change rungs. Run `pipeline/demography_ivt.py` first, with pyivt (under
WSL, as for `nhs2011.py`), for the 2006 and 2011 NHS counts. It checks itself against
insights.json's age and recent-immigrant shares.

`make trreb` runs `pipeline/trreb.py`, which reads TRREB's quarterly Community Housing
Market Reports for the City's three regions (`pipeline/raw/trreb_community`, Q4 2011
on) and writes `pipeline/trreb/community.csv` (committed): each community's sales,
dollar volume, and average and median sale price by quarter, for the dwelling-value
model's market rungs. `nbhd_map.csv` gives the community holding each of the 158
neighbourhoods (TRREB's communities are the City's 140 of before 2022). Reading the
reports is slow; the page text is cached in `pipeline/out/trreb_pages.json`.

`make price-insights` runs `pipeline/price_insights.py`, which writes
`web/public/prices.json` for the Sale Prices Insights page (`/insights/prices/`): each
community's sales and median sale price by quarter, the City's and each region's sales
and average sale price, and the 158 neighbourhoods' outlines with their community.

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
- **Zeros that aren't values:** where too few households answered, the 2016 profile and
  the 2011 NHS publish 0 rather than a suppression marker (2021 uses `x` or `..`): a
  median dwelling value, owner cost or rent of $0, or an average household income of $0
  beside a median in the tens of thousands (six 2016 DAs). No dollar figure here can be
  $0, so `measures.null_unpublished` nulls every one (278, 278 and 1,288 DAs for value,
  owner cost and rent in 2016). It also nulls published percentages above 100 (one 2016
  `owner30` of 150; three 2011 `tenant30` of 111 to 120). Percentages for the same
  households (`owner30`, `tenant30`, `subsidized`) are kept on the DA maps as published,
  0% included, as in 2021, which also publishes 0% for many DAs whose median rent it
  suppresses. The neighbourhood figures leave those placeholders out
  (`insights.PLACEHOLDER_ZERO`): a 0% beside a withheld median is not a value, and
  averaged in it pulls a neighbourhood's share down.
- **City check:** `insights.check_city` aggregates every DA as one neighbourhood and
  prints a warning where the result is more than a point (rates) or 3% (dollars) from the
  city value StatCan publishes. A measure on the wrong base shows up there: the share of
  income from government transfers is weighted by the DAs' total income (households x
  average household income), not by people.
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
