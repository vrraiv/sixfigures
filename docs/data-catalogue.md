# Data catalogue and update schedule

Every dataset behind the site: who publishes it, how often it changes, what the site
holds now, which pages use it, and how to refresh it. The second half is the update
schedule. Status as of **2026-11-12**.

For how each source was checked and processed, see the script named in the last column
(each has a docstring and writes a `manifest.json`), [`pipeline/README.md`](../pipeline/README.md)
and, for the forecast model's sources, [`data-sources.md`](data-sources.md).

## How a refresh works

- **`pipeline/download.py` keeps what is already on disk.** To get a newer copy of a
  file, delete it from `pipeline/raw/` first. Files that change upstream are listed
  under "Refresh with" below.
- **Three sources are downloaded by hand**, because their sites block scripts or
  publish PDFs: TRREB's reports, EQAO's results, and Statistics Canada's census files on
  `www12.statcan.gc.ca` (bot challenge; `download.py` prints the URLs when it is refused).
- **A few sources need a line of code per new edition:** Inside Airbnb scrape dates,
  Ontario's school files, the Landsat summers and the crime rate periods (each noted
  below).
- **After any page's data is rebuilt, rebuild the two explorers**, which read every page:
  `make explorer` then `make neighbourhoods`. `affinity.py` prints `no name for the type
  centred on …` if a rebuild moved a neighbourhood type's centre; name it in its `NAMES`.
- **Then check and ship:** `npm test`, `npm run build`, look over the changed pages,
  commit. Merging to `main` deploys (see the README's Deploy section).

## Catalogue

"On the site" is the latest period the site holds. "Upstream" is how often the
publisher changes it.

### Census (Statistics Canada)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Census Profile by dissemination area (DA), 2021 and 2016 (`98-401-X2021006`, `98-401-X2016044`) | every five years | 2021 | Census map, Census Insights, Data and Neighbourhood Explorers, the census measures every page correlates with | by hand (www12); `make data` |
| 2011 Census and National Household Survey by DA; 2006 Census Profile by DA (Borealis copies of the DLI files) | never | 2011, 2006 | 2011 map, Census Insights, Neighbourhood Explorer's "Since 2006" | static |
| DA boundary files (2006, 2011, 2016, 2021), DA correspondence files, 2021 FSA boundaries | with each census | 2021 | maps, search, every neighbourhood figure built from DAs | by hand (www12) |
| Consumer Price Index, annual average, Toronto (`18-10-0005`, Web Data Service) | annual, in January | the census years 2005 to 2021 | restating earlier censuses' dollars (`cpi.json`) | `make cpi` (only needed with a new census) |
| City and CMA series: population estimates, tax-file income, labour force, CMA building permits (`17-10-0155`, `11-10-0239`, `14-10-0459`, `34-10-0292`, Web Data Service) | annual or monthly; revised | as retrieved 2026-10-30 | Housing Insights (context), forecasts | `python pipeline/series.py`, then `make housing-insights` |

Open Government Licence – Canada (Statistics Canada Open Licence for the Web Data Service).

### Sale prices (TRREB)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Community Housing Market Reports, Toronto Central, East and West: sales and median price by community, all home types | **quarterly**, posted 8 to 12 weeks after the quarter ends (Q4 2025 on 26 Feb 2026, Q1 2026 on 4 June, Q2 2026 on 23 Sept) | 2011 Q4 to 2026 Q2 | Sale Prices; a yearly figure (the mean of four quarters, complete years only) in the Data and Neighbourhood Explorers; correlations on Safety and Trees | by hand: the three PDFs (`Toronto{Central,East,West}Q{q}{yyyy}.pdf` from trreb.ca) into `pipeline/raw/trreb_community/`; `make trreb`, `make price-insights` |
| Market Watch, City of Toronto, May (median and average price, all home types) | monthly | May 2011, 2016, 2021, 2026 | the City's 2026 dwelling-value nowcast (Forecasts) | by hand, read into `docs/forecast-spec.md`; not needed again until the next value forecast |


### Schools (Ontario)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| School Information and Student Demographics, one file per school year (data.ontario.ca): enrolment, location, Grade 3 and 6 results, demographics | annual; a preliminary file, then a final one (2024-25 final posted September 2026) | school years to 2024-25 | Schools, School Forecasts, the explorers, correlations on other pages | add the file to `SCHOOLS` in `download.py` and `SCHOOLRAW` in the `Makefile`; `make schools`, `make school-insights` |
| EQAO Achievement Results, Grade 3 and 6, by school | annual, late September to October (the 2024-25 release was held back by the Minister until later in the fall) | 2025-26, in the forecasts only | School Forecasts (scoring the frozen forecast) | by hand from eqao.com/about-eqao/open-data into `pipeline/raw/eqao/`; `make eqao` (reads the 2025-26 files by name: extend it for 2026-27) |

Open Government Licence – Ontario.

### Housing (City of Toronto, CMHC)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Building permits, cleared (2000-2016, since 2017) and active | daily | retrieved 2026-10-30 (2026 partial) | Housing, the explorers, New building theme | delete `toronto_permits_*.csv`; `make permits` |
| Development applications; apartment building registration; rental demolition and replacement; affordable rental pipeline | daily to quarterly | retrieved 2026-10-30 | Housing, the explorers | delete those four raw files; `make city` |
| CMHC starts, completions and under construction by census subdivision | monthly | to September 2026 | Housing | `make cmhc` (fetches new months itself) |
| CMHC Rental Market Survey (October) by zone and City | annual; each October survey is published that winter | to the October 2025 survey | Housing, the explorers | `make cmhc` |
| CMHC survey zone boundaries (2017) | rarely | 2017 | Housing (zone to neighbourhood) | static |

Then `make housing-insights`. City data: Open Government Licence – Toronto.

### Safety (Toronto Police Service, City of Toronto)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Neighbourhood Crime Rates (counts, rates and population by neighbourhood and year) | annual; 2025 posted 20 February 2026 | to 2025 | Safety (checks every count against it) | delete `toronto_neighbourhood_crime_rates_4326.csv` |
| Community Safety Indicators (assault, break and enter, auto theft, robbery, theft over); shootings and firearm discharges; homicides | quarterly | complete years to 2025 | Safety, the explorers, correlations on Trees | delete those three raw files |
| Collisions with people killed or seriously injured (KSI) | daily, with records arriving months to over a year late | to 2025 (the latest year runs low) | Safety, the explorers | delete `toronto_ksi_4326.csv` |

Then `make crime`, `make safety`, `make trees-page`. The site only shows complete years,
so a quarterly upstream change needs no quarterly refresh. `crime.py`'s five-year
`PERIODS` end at 2021-2025: when 2026 is complete, decide how the rates' periods move on.

### Trees and heat

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Street Tree Data (City) | irregular (last 4 June 2026) | that copy | Trees, the explorers | delete `toronto_street_trees_4326.csv`; `make trees` |
| 2018 Tree Canopy Study land cover (City) | one-off; no newer study published | 2018 | Trees, the explorers | static until a new study |
| 2008 tree cover by neighbourhood (Wellbeing Toronto) | never | 2008 | Trees (canopy change) | static |
| Landsat 8 and 9 summer surface temperature (USGS, through Microsoft Planetary Computer) | every summer | summers 2022-2025 (11 clear passes) | Trees, the explorers | extend `SUMMERS` in `trees.py`; `make trees` |

Then `make trees-page`. Landsat data courtesy of the U.S. Geological Survey.

### Elections (City of Toronto)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Mayoral results by voting subdivision, voter statistics, subdivision boundaries | each election | 2022 general election, 2023 by-election | the explorers, correlations on Safety and Trees | `make elections` |

The 26 October 2026 general election's results are posted, but its voting subdivision
boundaries are not, and its subdivisions are renumbered; add it when
`elections-subdivisions` gets a 2026 layer (`elections.py` explains). The next general
election is October 2030.

### Short-term rentals

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| Inside Airbnb listings for Toronto (CC BY 4.0) | **quarterly** scrapes (mid-December, March, June, September); the site lists only the last 12 months, older ones are by request | 12 Dec 2025 to 16 Sept 2026 | the explorers (Housing costs theme), correlations on Safety and Trees | add the date to `INSIDEAIRBNB_DATES` in `download.py` and `SNAPSHOTS` in `rentals.py`; `python pipeline/download.py`; `make rentals` |
| Short-term rental registrations (City) | daily snapshot, no history | 11 Nov 2026 | compared with the latest scrape | delete `toronto_str_registrations.csv`; `make rentals` |

Fetch every new scrape within a year of its date, or it can only be had by request.

### Geography and search (City of Toronto)

| Data | Upstream | On the site | Used by | Refresh with |
|---|---|---|---|---|
| 158 neighbourhoods (and the historical 140) | when the City redraws them (last 2022) | 158 | every page | check yearly that the package is unchanged |
| City wards (25) | after a ward boundary review | 25 wards | map overlays, rental registrations | `make overlays` if changed |
| Address points; centreline intersections | daily | 2026-10-26 copies | the map's address search | delete both raw files; `make search` |

### Ingested, not on the site

CIMD 2021 and ON-Marg 2021 (deprivation indexes by DA; next editions will follow the 2026
Census), DineSafe inspections, and the demography and permits model inputs. No schedule
until a page uses them.

## Update schedule

The quarterly run is driven by TRREB and Inside Airbnb; everything else is annual or
follows the census. Each run ends with the explorers and the checks in "How a refresh
works".

### Quarterly

Run in the **first half of March, June, October and December**, when TRREB's report for
the previous quarter is usually up (Q4 by early March, Q1 by mid-June, Q2 by early
October, Q3 by mid-December) and Inside Airbnb has posted its latest scrape. If TRREB's
PDFs aren't up yet, wait a week rather than shipping half the run.

1. TRREB: download the quarter's three PDFs; `make trreb`, `make price-insights`.
2. Inside Airbnb: add the new scrape date; `python pipeline/download.py`; delete and
   refetch the registrations; `make rentals`.
3. Pages that correlate with prices and rentals: `make safety`, `make trees-page`.
4. `make explorer`, `make neighbourhoods`; tests, build, commit.

The explorers' yearly sale price only changes in March (when Q4 completes a year), so
the June, October and December runs mostly move the Sale Prices page.

### Annual

| When | What | Why then |
|---|---|---|
| **March**, with the quarterly run | Safety: all five police files, `make crime`, `make safety` | the Neighbourhood Crime Rates file for the past year is posted in February |
| **March**, with the quarterly run | Housing: permits, City housing files, `make cmhc`, `series.py`, `make housing-insights` | closes the past year's permits and starts; the Rental Market Survey and population estimates are out by then |
| **October** | Schools: EQAO's results by hand, Ontario's school file if a new one is posted, `make schools`, `make school-insights`, `make eqao` | EQAO publishes in late September or October |
| **October** | Trees: street trees, the new summer's Landsat passes, `make trees`, `make trees-page` | the summer's scenes are in by then |
| **October** | Search: address points and intersections, `make search` | yearly is enough for new addresses |
| **October** | Check the neighbourhood and ward packages are unchanged | |

March and October are then the two big runs of the year, each with the explorers rebuilt
once at the end.

### Census cycle and one-offs

| When | What |
|---|---|
| When the City posts the 2026 voting subdivisions | Add the 26 October 2026 election (`elections.py`). |
| 10 February 2027 | 2026 Census population and dwelling counts. |
| 5 May 2027 | Age; type of dwellings (detached houses, tall apartments). |
| 14 July 2027 | Income; families and households. |
| 8 September 2027 | Housing (tenure, shelter costs, dwelling value, condos, period built, crowding). **Score the Dwelling Value Forecast** against it. |
| 28 September 2027 | Mobility (movers); poverty (low income, LIM-AT, is probably here). |
| Late September to October 2027 | EQAO 2026-27: **score the 2026 to 2027 School Forecast**. |
| 27 October 2027 | Immigration. |
| 1 December 2027 | Education (degrees). Every census measure on the site is then out. |
| Early 2028 | **The 2026 Census rebuild**: 2026 DA boundaries and the 2021 to 2026 correspondence, the landing map on 2026 with 2021 to 2026 change, Census Insights and the Neighbourhood Explorer's history extended, the CPI for income year 2025, new tiles and search. A project, not a routine run. |
| October 2030 | Next municipal general election. |

Census dates are from Statistics Canada's
[2026 Census key content release schedule](https://www.statcan.gc.ca/sites/default/files/documents/2026-09/census-2026-key-content-release-schedule.pdf).
In 2021 the DA-level profile grew with each release; the 2026 boundary and
correspondence files' dates aren't confirmed.

The census rebuild could be split: a first pass after 8 September 2027 would put income
and housing, most of the landing map, on 2026, with the rest following in December.
