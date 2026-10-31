# Data sources for the forecast model

A catalogue of the data beyond the census profiles already in the pipeline, what
each would do for the forecasts, and the order to ingest it in. Checked
2026-10-30: every table number, dataset and file below was looked up then
(StatCan's Web Data Service, the City's CKAN API, Borealis), not taken from
memory. Anything not confirmed says so.

## What the model needs

- **Targets.** The 27 measures on the maps (`pipeline/measures.py`): incomes,
  low income and transfers, housing costs and tenure, dwelling types and age,
  education, mobility, immigration, age groups. Also the elementary school
  score (Grade 3 and 6 test results, below), on its own annual timeline.
- **Panel unit.** Two candidates:
  - *The City's 158 neighbourhoods.* Constant across every census already:
    each year's DAs carry a 158-model neighbourhood, and `insights.json` has
    the 2011, 2016 and 2021 figures, validated against the City's 2021 profile.
    Cheap, and every source below can be summed to it.
  - *2021 DAs.* About 3,700 units. Finer, but each earlier census has to be
    carried onto 2021 boundaries through the correspondence files (we have
    2016-2021 and 2016-2011; 2006-2011 is a manual download), and small-area
    noise is large (the 2011 NHS zeroes small cells).
- **Backtest.** Fit on 2006, 2011 and 2016, forecast 2021, score against the
  2021 Census. The 2020 income year is pandemic-affected (CERB), which the
  score has to be read with.
- **Live horizon.** Forecast 2025 to 2027 from 2021. The 2026 Census will score
  it: Statistics Canada plans all major 2026 releases by December 2027, first
  population and dwelling counts (expected early 2027); check the
  [release schedule](https://www.statcan.gc.ca/sites/default/files/documents/2026-09/census-2026-key-content-release-schedule.pdf)
  for the income and housing dates.

Each source below has a **role**:

| Role | Meaning |
|---|---|
| Target history | Another census of the targets themselves |
| Annual driver | Varies by small area between censuses; enters the model |
| City anchor | City- or metro-wide annual series that pins the overall level |
| Validation | Checks a result; not a model input |

and an **origin** flag for the backtest: **known** if it was available at the
forecast origin (2016 data for a 2016-to-2021 forecast), **oracle** if it is
only known after the fact (permits issued 2016-2021). A backtest using oracle
drivers is a conditional forecast, and has to be scored and labelled that way.

## Catalogue

### Statistics Canada (Web Data Service: scripted, no bot challenge)

| Source | Table | Years | Geography | Role | Origin | Check after ingest |
|---|---|---|---|---|---|---|
| Population estimates, July 1 | 17-10-0155 | 2001-2025 | CSD (Toronto C) | City anchor | known to origin year | 3.3-4.4% above the census counts in 2011, 2016 and 2021 (the estimates adjust for census undercoverage) |
| Income of individuals (T1 Family File, from tax records): median income by source | 11-10-0239 | 1976-2024 | CMA (Toronto) | City anchor (income after 2020) | known | 2015 and 2020 move with the census medians |
| Labour force characteristics, 3-month moving average | 14-10-0459 | 2011-2026 | CMA | City anchor | known | 2021 unemployment near census |
| Building permits by type of structure and work | 34-10-0292 | 2018-2026 | CMA (the 66 geographies are CMAs) | City anchor | oracle in backtest | sum of City permits within the CMA total |
| Consumer price index | 18-10-0005 | annual | Toronto | Restating dollars (in use, `cpi.json`) | known | already in the pipeline |
| Canadian Housing Statistics Program: ownership and property use | 46-10-0053, 46-10-0054 | 2018-2022 | CSD and CMA | Validation (owner share, investor-owned) | known | marked **inactive**: look for the replacement table before using |
| Components of population change | 17-10-0136 | 2001-2021 | CMA, 2016 boundaries | City anchor (migration) | known | inactive; check for the 2021-boundary successor |

City-level permits come from the City's data, not 34-10-0292. Each pull records
its retrieval date, as `cpi.json` does, because population estimates and
T1FF figures are revised.

Not available openly: T1 Family File income **below the CMA** (by census tract
or postal area) is a custom request to StatCan's Income Statistics Division,
probably paid. It would be the best annual driver for the income measures, so
it's worth an enquiry, but the plan doesn't depend on it.

### City of Toronto Open Data (CKAN API: scripted)

| Source | Dataset | Years | Geography | Role | Origin | Check after ingest |
|---|---|---|---|---|---|---|
| Cleared building permits | `building-permits-cleared-permits` (since 2017; 2000-2016 file) | 2000-today, daily | address (`GEO_ID`) to DA and neighbourhood | Annual driver: dwelling units created and lost | oracle in backtest | GEO_ID match rate to address points per year; units summed by census interval vs census dwelling change |
| Active building permits | `building-permits-active-permits` | today | address | Live driver (units in the pipe) | known for the live forecast | as above |
| Development applications | `development-applications` | 2008-today, daily | coordinates (X, Y; NAD27 MTM 10, EPSG:2019) | Live driver (proposed projects) | known | 8,622 applications in 26,648 rows (one per address); **no unit count field**, units only in the free-text description, so a parser and a match rate |
| Apartment building registration | `apartment-building-registration` | monthly | address | Annual driver (purpose-built rental stock: units, year built) | known | units vs census renter households by neighbourhood |
| Social and affordable housing units | `active-affordable-and-social-housing-units` | quarterly, 2020-2026 | city-wide totals only | Not usable by neighbourhood | | |
| Affordable rental housing pipeline | `upcoming-and-recently-completed-affordable-housing-units` | current snapshot (no dates) | coordinates | Driver (subsidized tenants) | today only | 277 projects; no history, so no backtest use |
| Demolition and replacement of rental units | `demolition-and-replacement-of-rental-housing-units` | quarterly | address | Driver (rental loss) | oracle in backtest | addresses match |
| Neighbourhood crime rates | `neighbourhood-crime-rates` | 2014-2025 | 158 neighbourhoods | Annual driver (exploratory) | known | 158 neighbourhoods, one row each |
| Short-term rental registrations | `short-term-rentals-registration` | current snapshot (no dates) | postal code | Exploratory | today only | 8,713 registrations; no history, so no backtest use |
| Toronto Employment Survey | `toronto-employment-survey-summary-tables` | annual | summary tables (geography to be checked) | City anchor (jobs) | known | |
| TTC routes and schedules (GTFS); transit-oriented communities | `ttc-routes-and-schedules`, `transit-oriented-communities` | current | stops, sites | Driver (new rapid transit near a DA) | known for opened lines | |
| Neighbourhood Profiles 2021 (158 model) | `neighbourhood-profiles` | 2021 | 158 neighbourhoods | Validation (already used) | | |

Permits need care: deduplicate by permit number across revisions, choose the
date that assigns units to a year (issued or completed; completed is closer to
when people move in), and check that old GEO_IDs still match today's address
points, since the 2000-2016 file may differ in schema and retired addresses
won't match.

### Earlier censuses (Borealis, Data Liberation Initiative copies)

| Source | File | Years | Geography | Role | Status |
|---|---|---|---|---|---|
| 2006 Census Profile, Canada to DAs | `94-581-XCB2006002.IVT`, Borealis file 27195 (doi:10.5683/SP3/RFXZIF), 237,696,851 B, public | 2006 (income year 2005), mandatory long form | DA (2006 boundaries) | Target history: a fourth census, and the only pre-2016 one without the NHS's non-response gaps | Sampled at five offsets: data throughout, header signature valid (the damaged 2011 file was zeros). Downloaded (MD5 checked) and read: 3,556 Toronto DAs (`pipeline/profile2006.py`) |
| 2006 DA boundaries (`gda_000a06a_e.zip`, digital); 2011-2006 DA correspondence (`2011_92-156_DALand_ADsup_txt.zip`) | StatCan `www12` | 2006 | DA | Joins 2006 DAs to neighbourhoods; checks the join against 2011 | Manual browser download (bot challenge). Done: `pipeline/census2006.py` -> `pipeline/census/nbhd_2006.csv`; all 3,519 unchanged DAs match their 2011 neighbourhood |

With 2006, the backtest can fit on two intervals (2006-2011, 2011-2016) and
score the third. The 2006 profile has income in 2005 dollars, and rent, values
and costs in 2006 dollars; `cpi.json` has neither year, but
`pipeline/series/18-10-0005.csv` does.

### CMHC (manual export)

| Source | Where | Years | Geography | Role | Origin |
|---|---|---|---|---|---|
| Rental Market Survey: average rent, vacancy, universe by zone | Housing Market Information Portal (export) | annual (years to check) | CMHC zones within the city (count to check) | Annual driver for rent and tenant measures | known |
| Starts, completions, under construction | [monthly CSD tables](https://www.cmhc-schl.gc.ca/en/professionals/housing-markets-data-and-research/housing-data/data-tables/housing-market-data/starts-completions-under-construction-census-subdivisions) | monthly | CSD (Toronto) | City anchor (new supply) | oracle in backtest |

Not found openly by census tract. Zones would need a zone-to-neighbourhood
lookup.

### Ontario Ministry of Education (data.ontario.ca: scripted, `download.py`, `pipeline/schools.py`)

| Source | Where | Years | Geography | Role | Origin |
|---|---|---|---|---|---|
| School Information and Student Demographics: enrolment, coordinates, EQAO results (share at the provincial standard in Grade 3 and 6 reading, writing and math, Grade 9 math, the Grade 10 literacy test), school demographics (low income, parents without a degree, language, special education) | [school-information-and-student-demographics](https://data.ontario.ca/en/dataset/school-information-and-student-demographics), one xlsx per school year, Open Government Licence - Ontario | school years 2017-18 to 2024-25; tests written 2018, 2019, 2022-2025 (2023-24 preliminary) | school (coordinates) | Target (elementary score); school demographics as drivers | known to the test year |

No tests were written in 2020 or 2021: the 2019-20 and 2020-21 files repeat the
2018-19 results (`schools.py` checks that they match value for value). Grade 9
math was two tests (academic and applied) until 2019 and one since, so the score
uses Grades 3 and 6 only: the mean of the six results, over the English public and
Catholic elementary schools without a special condition (about 410-430 of about
630 in the City report all six each year). No attendance areas are published (the
City's school "district" layers are trustee wards), so `by_nbhd.csv` gives the
score two ways: from each DA's nearest public and Catholic schools, weighted by
children (all 158 neighbourhoods; the primary target), and from the schools inside
the neighbourhood (140-142 of 158). The two correlate 0.89-0.92 by year. Between
the 2019 and 2025 tests, neighbourhood scores correlate 0.84 (nearest) and 0.82
(inside), schools 0.67; against the log of 2021 median household income, about
0.56-0.58.

### Not pursued

MPAC property assessments and TRREB sales are not open. Teranet and other
commercial price indices are licensed. Postal-code conversion files are
DLI-licensed.

## Ingestion plan

Raw downloads go to `pipeline/raw/` (ignored by git), with source, retrieval
date and checksum recorded; derived, model-ready tables go to
`pipeline/out/model/` keyed by year and by neighbourhood (and DA where the
source allows). Every script prints its own checks, as the census scripts do.

1. **StatCan series** (`pipeline/series.py`, one WDS fetcher for all tables):
   17-10-0155, 11-10-0239, 14-10-0459, 34-10-0292, and `cpi.json` extended to
   every year from 2005. Small: committed as CSVs with retrieval dates. A day.
2. **City permits to DAs** (`pipeline/permits.py`): both cleared-permit files
   and active permits, deduplicated, matched by GEO_ID to the address points
   already downloaded for search, summed to DA and neighbourhood by year,
   units created and lost by structure type. The GEO_ID match rate by year
   decides whether the 2000-2016 file is usable. The biggest single driver
   for dwelling change.
3. **City housing stock and pipeline** (`pipeline/city_layers.py`): apartment
   registration, affordable and social housing, rental demolition and
   replacement, development applications; same address matching.
4. **2006 Census** (done: `pipeline/profile2006.py` reads the IVT with the
   patched pyivt; `pipeline/census2006.py` places the DAs with the 2006
   boundaries and aggregates the measures to neighbourhoods as `insights.py`
   does for 2011-2021).
5. **CMHC** (manual export once a year): rental zones and rents, with a
   zone-to-neighbourhood lookup.
6. **Exploratory drivers** (crime rates, short-term rentals, transit): only if
   the first model leaves error that they could plausibly explain.
7. **School results** (done: `make schools` rebuilds `pipeline/schools/`): EQAO
   results and school demographics by school and year, and the Grade 3 and 6
   score by neighbourhood and test year.

## Decisions before modelling

- **Panel unit**: neighbourhoods first (recommended: constant geography,
  validated, fast), DAs later if the neighbourhood model works.
- **Backtest**: 2016-to-2021 with known-at-origin drivers only, and a second,
  conditional run with permits as oracle drivers, reported separately.
- **2006**: whether to add it (item 4), which doubles the history the backtest
  can learn from.
