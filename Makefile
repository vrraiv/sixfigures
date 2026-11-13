# Rebuild everything from raw downloads:  make data
# Run from WSL/Linux/macOS (tippecanoe has no native Windows build).
PYTHON ?= python3
# pipeline/nhs2011.py needs pyivt (a Rust extension, with the legacy member-field
# fix; see pipeline/README.md). Point this at a Python that has it, e.g. a WSL venv:
#   make PYIVT_PYTHON="wsl -e /home/me/pyivt/.venv/bin/python" pipeline/out/toronto_nhs_2011.csv
PYIVT_PYTHON ?= $(PYTHON)

RAW       := pipeline/raw
GEOJSON   := pipeline/out/toronto_da.geojson
GEOJSON16 := pipeline/out/toronto_da_2016.geojson
# geometry-only copies the tiles are cut from; the figures go to web/public/data/figures
GEOM      := pipeline/out/toronto_da_geom.geojson
GEOM16    := pipeline/out/toronto_da_2016_geom.geojson
GEOM11    := pipeline/out/toronto_da_2011_geom.geojson
FIGURES   := web/public/data/figures/2021/common.json
FIGURES11 := web/public/data/figures/2011/common.json
PMTILES   := web/public/toronto_da.pmtiles
PMTILES16 := web/public/toronto_da_2016.pmtiles
PMTILES11 := web/public/toronto_da_2011.pmtiles
BREAKS    := web/public/breaks.json
BREAKS11  := web/public/breaks_2011.json
INSIGHTS  := web/public/insights.json
SEARCH    := web/public/search.json
OVERLAYS  := web/public/overlays.pmtiles
BASEMAP   := web/public/basemap.pmtiles
CORR      := $(RAW)/2021_92-156-X_DALand_ADsup.zip
STATCAN   := $(RAW)/98-401-X2021006_Ontario_eng_CSV.zip $(RAW)/lda_000b21a_e.zip \
             $(RAW)/98-401-X2016044_ONTARIO_eng_CSV.zip $(RAW)/lda_000b16a_e.zip $(CORR)
# 2011: the DA profile zip holds one CSV per province (Deflate64: unzip, not Python)
PROFILE11 := $(RAW)/98-316-XWE2011001-1501-ONT.csv
STATCAN11 := $(PROFILE11) $(RAW)/gda_000b11a_e.zip $(RAW)/2016_92-156_DALand_ADsup_csv.zip
# the NHS (2011 long form) DA table, a Beyond 20/20 file, and Toronto's rows of it
NHSIVT11  := $(RAW)/NHSprofile_Can_PR_CD_CSD_DA.IVT
NHS11     := pipeline/out/toronto_nhs_2011.csv
# 2006 Census DA profile (Beyond 20/20) and Toronto's rows of it (census2006.py
# places them in neighbourhoods)
PROFILEIVT06 := $(RAW)/94-581-XCB2006002.IVT
PROFILE06    := pipeline/out/toronto_profile_2006.csv
TORONTO   := $(RAW)/toronto_neighbourhoods_4326.geojson $(RAW)/toronto_address_points_4326.csv \
             $(RAW)/toronto_intersections_4326.csv $(RAW)/toronto_wards_4326.geojson

# City building permits, and their units by neighbourhood and year (a model input,
# not part of the site)
PERMITRAW := $(RAW)/toronto_permits_cleared_2000_2016.csv $(RAW)/toronto_permits_cleared_2017.csv \
             $(RAW)/toronto_permits_active.csv
PERMITS   := pipeline/permits/by_nbhd.csv

.PHONY: data download tiles search overlays basemap deps clean cpi breaks permits

data: $(PMTILES) $(PMTILES16) $(PMTILES11) $(SEARCH) $(OVERLAYS) $(INSIGHTS)

deps:
	$(PYTHON) -m pip install -r pipeline/requirements.txt

download:
	$(PYTHON) pipeline/download.py

$(STATCAN) $(TORONTO) $(RAW)/98-316-XWE2011001-1501.zip $(RAW)/gda_000b11a_e.zip \
$(RAW)/2016_92-156_DALand_ADsup_csv.zip $(NHSIVT11) $(PERMITRAW):
	$(PYTHON) pipeline/download.py

$(NHS11): $(NHSIVT11) pipeline/nhs2011.py pipeline/measures.py
	$(PYIVT_PYTHON) pipeline/nhs2011.py

$(PROFILEIVT06):
	$(PYTHON) pipeline/download.py

$(PROFILE06): $(PROFILEIVT06) pipeline/profile2006.py pipeline/measures.py
	$(PYIVT_PYTHON) pipeline/profile2006.py

$(PROFILE11): $(RAW)/98-316-XWE2011001-1501.zip
	unzip -o -q $< '*-ONT.csv' -d $(RAW)
	touch $@

# 2011 Census (short form) and NHS (long form) on 2011 DAs, for the /2011/ page;
# its colour classes come from breaks.json.
$(GEOM11) $(FIGURES11) $(BREAKS11) &: $(STATCAN11) $(NHS11) $(BREAKS) $(RAW)/toronto_neighbourhoods_4326.geojson \
                                      pipeline/census2011.py pipeline/measures.py pipeline/figures.py
	$(PYTHON) pipeline/census2011.py

# The Insights page: the 158 neighbourhoods in each census, from the DAs (the profile
# extracts in pipeline/out, the figures files' neighbourhood assignment, the city values).
$(INSIGHTS): $(FIGURES) $(FIGURES11) $(BREAKS) $(BREAKS11) $(NHS11) pipeline/insights.py pipeline/measures.py pipeline/cpi.json \
             pipeline/school_insights.py
	$(PYTHON) pipeline/insights.py

permits: $(PERMITS)

# Units created and lost on permits, placed by address in 2021 DAs and the
# figures files' neighbourhoods; checked against census household change
$(PERMITS): $(PERMITRAW) $(RAW)/toronto_address_points_4326.csv $(RAW)/lda_000b21a_e.zip $(FIGURES) $(FIGURES11) \
            pipeline/permits.py
	$(PYTHON) pipeline/permits.py

# build.py also applies cpi.json and writes the CSVs, but a change to those alone
# only needs `make breaks`, not a rebuild of the GeoJSON and tiles.
$(GEOJSON) $(GEOJSON16) $(GEOM) $(GEOM16) $(BREAKS) $(FIGURES) &: $(STATCAN) $(RAW)/toronto_neighbourhoods_4326.geojson \
                                     pipeline/build.py pipeline/census2016.py pipeline/distributions.py \
                                     pipeline/measures.py pipeline/figures.py
	$(PYTHON) pipeline/build.py

# Refresh the CPI from StatCan's Web Data Service, then re-apply it (and the
# histograms and CSV downloads) from pipeline/out without the raw downloads.
cpi:
	$(PYTHON) pipeline/cpi.py
	$(PYTHON) pipeline/refresh.py

breaks:
	$(PYTHON) pipeline/refresh.py

tiles: $(PMTILES) $(PMTILES16) $(PMTILES11)

$(PMTILES): $(GEOM)
$(PMTILES16): $(GEOM16)
$(PMTILES11): $(GEOM11)
# No tile size limit: with one, tippecanoe drops DAs from the whole-city view
# rather than exceed 500 KB a tile. scripts/check-size.mjs budgets the result.
$(PMTILES) $(PMTILES16) $(PMTILES11):
	@command -v tippecanoe >/dev/null || { echo "tippecanoe not found; see pipeline/README.md"; exit 1; }
	tippecanoe -o $@ -l da -zg --no-tile-size-limit --force $<
	@ls -l $@

# Neighbourhood, ward and (if lfsa000b21a_e.zip was downloaded) FSA outlines and
# labels, one tile layer per GeoJSON that overlays.py writes.
overlays: $(OVERLAYS)

$(OVERLAYS): $(RAW)/toronto_neighbourhoods_4326.geojson $(RAW)/toronto_wards_4326.geojson              $(wildcard $(RAW)/lfsa000b21a_e.zip) pipeline/overlays.py
	$(PYTHON) pipeline/overlays.py
	@command -v tippecanoe >/dev/null || { echo "tippecanoe not found; see pipeline/README.md"; exit 1; }
	tippecanoe -q -o $@ -Z9 -z14 -r1 --no-tile-size-limit --detect-shared-borders --force 	  $$(for f in pipeline/out/overlays/*.geojson; do printf -- '-L %s:%s ' "$$(basename $$f .geojson)" "$$f"; done)
	@ls -l $@

# The street map under the census maps: a Toronto cut of the Protomaps basemap, fetched over
# the network and committed. Not part of `data`: it is redone when the streets should be
# refreshed (delete the file, or change the script), not with each census.
basemap: $(BASEMAP)

$(BASEMAP): pipeline/basemap.py
	$(PYTHON) pipeline/basemap.py
	@ls -l $@

search: $(SEARCH)

$(SEARCH): $(RAW)/lda_000b21a_e.zip $(RAW)/lda_000b16a_e.zip $(CORR) \
           $(RAW)/toronto_address_points_4326.csv $(RAW)/toronto_intersections_4326.csv \
           pipeline/search_index.py
	$(PYTHON) pipeline/search_index.py

# City housing stock and pipeline by neighbourhood (model inputs, not part of the
# site): apartment registrations, rental demolitions, development applications,
# the affordable rental pipeline
CITYRAW := $(RAW)/toronto_apartment_buildings.csv $(RAW)/toronto_rental_demolition.csv \
           $(RAW)/toronto_development_applications.csv $(RAW)/toronto_affordable_pipeline_4326.csv
CITY    := pipeline/city/manifest.json
.PHONY: city

city: $(CITY)

$(CITYRAW):
	$(PYTHON) pipeline/download.py

$(CITY): $(CITYRAW) $(RAW)/toronto_address_points_4326.csv $(RAW)/lda_000b21a_e.zip $(FIGURES) pipeline/city_layers.py
	$(PYTHON) pipeline/city_layers.py

# School test results by school and neighbourhood (a model input), and the School Insights
# page's schools.json. They read the committed 2021 figures files and insights.json without
# rebuilding them.
SCHOOLRAW := $(addprefix $(RAW)/schools/sif_,2017_18.xlsx 2018_19.xlsx 2019_20.xlsx 2020_21.xlsx \
             2021_22.xlsx 2022_23.xlsx 2023_24.xlsx 2024_25.xlsx)
SCHOOLS   := pipeline/schools/manifest.json
SCHOOLINS := web/public/schools.json
.PHONY: schools school-insights housing-insights

schools: $(SCHOOLS)

school-insights: $(SCHOOLINS)

$(SCHOOLRAW):
	$(PYTHON) pipeline/download.py

$(SCHOOLS): $(SCHOOLRAW) $(RAW)/lda_000b21a_e.zip pipeline/schools.py
	$(PYTHON) pipeline/schools.py

$(SCHOOLINS): $(SCHOOLS) $(RAW)/toronto_neighbourhoods_4326.geojson pipeline/school_insights.py
	$(PYTHON) pipeline/school_insights.py

# The Housing Insights page's housing.json, from the committed permits, City, CMHC and
# StatCan outputs.
HOUSINGINS := web/public/housing.json
housing-insights: $(HOUSINGINS)

# Its inputs aren't prerequisites: they are committed, and their own rules would rerun
# build.py, permits.py, city_layers.py or a CMHC download. The script stops if one is missing.
$(HOUSINGINS): pipeline/housing_insights.py pipeline/school_insights.py
	$(PYTHON) pipeline/housing_insights.py

# The Sale Prices Insights page's prices.json, from the committed TRREB community figures
# (make trreb). The script stops if they are missing.
PRICEINS := web/public/prices.json
.PHONY: price-insights
price-insights: $(PRICEINS)

$(PRICEINS): pipeline/price_insights.py pipeline/housing_insights.py pipeline/school_insights.py
	$(PYTHON) pipeline/price_insights.py

# 2006 Census on the 158 neighbourhoods (a model input). insights.py adds its comparable
# measures to insights.json; since this reads insights.json, its output isn't a prerequisite
# there (a cycle): after `make census2006`, run `python pipeline/insights.py`. The
# profile extract ($(PROFILE06)) isn't a prerequisite, so this never needs pyivt.
CENSUS06 := pipeline/census/manifest.json
.PHONY: census2006

census2006: $(CENSUS06)

$(RAW)/gda_000a06a_e.zip $(RAW)/2011_92-156_DALand_ADsup_txt.zip:
	$(PYTHON) pipeline/download.py

$(CENSUS06): $(RAW)/gda_000a06a_e.zip $(RAW)/2011_92-156_DALand_ADsup_txt.zip $(RAW)/toronto_neighbourhoods_4326.geojson \
             $(FIGURES11) $(INSIGHTS) pipeline/census2006.py pipeline/insights.py
	$(PYTHON) pipeline/census2006.py

# CMHC starts, completions and under construction for the City, and the Rental Market
# Survey by zone (model inputs, not part of the site). `download.py --cmhc` fetches new
# editions each run, so `make cmhc` always runs.
.PHONY: cmhc

cmhc: $(GEOM)
	$(PYTHON) pipeline/download.py --cmhc
	$(PYTHON) pipeline/cmhc.py

# Age groups and period of immigration by neighbourhood (a model input):
# pipeline/demography/nbhd.csv. The 2006 and 2011 NHS counts come from the Beyond 20/20
# tables via pyivt, as for nhs2011.py: run `$(PYIVT_PYTHON) pipeline/demography_ivt.py`
# first (under WSL where pyivt has no Windows wheel).
.PHONY: demography

demography:
	$(PYTHON) pipeline/demography.py

# TRREB sale prices by community (a model input): pipeline/trreb/community.csv, from
# the quarterly Community Housing Market Reports in pipeline/raw/trreb_community.
.PHONY: trreb

trreb:
	$(PYTHON) pipeline/trreb.py

# The forecast backtests (docs/forecast-spec.md): scores and predictions in
# pipeline/out/model/. Their inputs are committed; the scripts stop if one is missing.
# The schools holdout was spent on 2026-11-03, so it is always scored now; --live
# checks the frozen forecasts in pipeline/model/ and never overwrites them.
.PHONY: forecast forecast-pages eqao

forecast:
	$(PYTHON) pipeline/forecast/schools.py --holdout --live
	$(PYTHON) pipeline/forecast/value.py

# The Forecasts pages' forecasts.json, from the model outputs (make forecast).
forecast-pages:
	$(PYTHON) pipeline/forecast_pages.py

# EQAO's 2025-26 school results for the schools forecast (the zips are downloaded by
# hand: see pipeline/eqao.py). Run before make forecast.
eqao:
	$(PYTHON) pipeline/eqao.py

# Neighbourhood layers (exploratory model inputs, not yet on the site), each placed
# with pipeline/places.py and written with its checks to pipeline/<layer>/manifest.json.
# Their raw files come from `make download`; each script stops if one is missing.
#   crime      police crime, shootings, homicides and KSI collisions by neighbourhood
#              and year, checked against the police's Neighbourhood Crime Rates
#   health     CIMD 2021 by DA and neighbourhood, DineSafe by neighbourhood (ON-Marg
#              is computed but kept in pipeline/out/ for its licence)
#   rentals    Inside Airbnb listings by snapshot and neighbourhood; City short-term rental
#              registrations by ward and neighbourhood against the latest snapshot
#   elections  the 2022 mayoral election and 2023 by-election by voting subdivision,
#              2021 DA and neighbourhood (special polls allocated within the ward)
#   trees      street trees, 2018 canopy share and Landsat summer surface temperature by
#              DA and neighbourhood (trees.py fetches and caches its Landsat windows from
#              Planetary Computer in pipeline/raw/landsat/)
LAYERS := crime health rentals elections trees
.PHONY: layers $(LAYERS)

layers: $(LAYERS)

$(LAYERS):
	$(PYTHON) pipeline/$@.py

# The Safety Insights page's safety.json, from pipeline/crime/ (make crime) and the other
# committed neighbourhood layers (schools.json, prices.json, pipeline/trees, elections, rentals).
.PHONY: safety
safety:
	$(PYTHON) pipeline/safety_insights.py

# Canopy change 2008 to 2018 alone (pipeline/trees/canopy_change_nbhd.csv), without the canopy and
# Landsat steps of `make trees`.
.PHONY: canopy-change
canopy-change:
	$(PYTHON) pipeline/trees.py --canopy-change

# The Trees and Heat page's trees.json, from pipeline/trees/ (make trees) and the layers
# safety.json correlates with, plus pipeline/crime/rates.csv.
.PHONY: trees-page
trees-page:
	$(PYTHON) pipeline/trees_insights.py

# The Data Explorer's catalogue and per-source data (web/public/explorer/), from the pages'
# JSON files and pipeline/elections and pipeline/rentals. Run after any of them is rebuilt.
.PHONY: explorer
explorer:
	$(PYTHON) pipeline/explorer_data.py

# The Neighbourhood Explorer's neighbourhoods.json: percentile ranks by theme and the kinds of
# neighbourhood, from the Data Explorer's files. Run after `make explorer`.
.PHONY: neighbourhoods
neighbourhoods:
	$(PYTHON) pipeline/affinity.py

# Scheduled refreshes (docs/data-catalogue.md): download what's new from the scripted sources,
# rebuild only the pages whose inputs changed. .github/workflows/data-refresh.yml runs the same
# script on a schedule and opens a pull request.
#   refresh-quarterly  TRREB's latest quarter and Inside Airbnb's latest scrape
#   refresh-safety     the police's crime files and KSI collisions (March, once the year is complete)
#   refresh-housing    permits, the City's housing files, CMHC and the StatCan series (March)
#   publish-inputs     upload the StatCan files housing needs to the pipeline-inputs release, for
#                      the workflow (once; scripts/publish-inputs.sh)
.PHONY: refresh-quarterly refresh-safety refresh-housing publish-inputs
refresh-quarterly:
	$(PYTHON) pipeline/data_refresh.py prices rentals

refresh-safety:
	$(PYTHON) pipeline/data_refresh.py safety

refresh-housing:
	$(PYTHON) pipeline/data_refresh.py housing

publish-inputs:
	bash scripts/publish-inputs.sh

clean:
	rm -rf pipeline/out
