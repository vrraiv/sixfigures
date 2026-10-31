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

.PHONY: data download tiles search overlays deps clean cpi breaks permits

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
$(INSIGHTS): $(FIGURES) $(FIGURES11) $(BREAKS) $(BREAKS11) $(NHS11) pipeline/insights.py pipeline/measures.py pipeline/cpi.json
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

# 2006 Census on the 158 neighbourhoods (a model input, not part of the site). The
# profile extract ($(PROFILE06)) isn't a prerequisite, so this never needs pyivt.
CENSUS06 := pipeline/census/manifest.json
.PHONY: census2006

census2006: $(CENSUS06)

$(RAW)/gda_000a06a_e.zip $(RAW)/2011_92-156_DALand_ADsup_txt.zip:
	@echo "$@: download it from www12.statcan.gc.ca in a browser (see pipeline/census2006.py)"; exit 1

$(CENSUS06): $(RAW)/gda_000a06a_e.zip $(RAW)/2011_92-156_DALand_ADsup_txt.zip $(RAW)/toronto_neighbourhoods_4326.geojson \
             $(FIGURES11) $(INSIGHTS) pipeline/census2006.py pipeline/insights.py
	$(PYTHON) pipeline/census2006.py

clean:
	rm -rf pipeline/out
