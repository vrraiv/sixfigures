# Rebuild everything from raw downloads:  make data
# Run from WSL/Linux/macOS (tippecanoe has no native Windows build).
PYTHON ?= python3

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
SEARCH    := web/public/search.json
OVERLAYS  := web/public/overlays.pmtiles
CORR      := $(RAW)/2021_92-156-X_DALand_ADsup.zip
STATCAN   := $(RAW)/98-401-X2021006_Ontario_eng_CSV.zip $(RAW)/lda_000b21a_e.zip \
             $(RAW)/98-401-X2016044_ONTARIO_eng_CSV.zip $(RAW)/lda_000b16a_e.zip $(CORR)
# 2011: the DA profile zip holds one CSV per province (Deflate64: unzip, not Python)
PROFILE11 := $(RAW)/98-316-XWE2011001-1501-ONT.csv
STATCAN11 := $(PROFILE11) $(RAW)/gda_000b11a_e.zip $(RAW)/2016_92-156_DALand_ADsup_csv.zip
TORONTO   := $(RAW)/toronto_neighbourhoods_4326.geojson $(RAW)/toronto_address_points_4326.csv \
             $(RAW)/toronto_intersections_4326.csv $(RAW)/toronto_wards_4326.geojson

.PHONY: data download tiles search overlays deps clean cpi breaks

data: $(PMTILES) $(PMTILES16) $(PMTILES11) $(SEARCH) $(OVERLAYS)

deps:
	$(PYTHON) -m pip install -r pipeline/requirements.txt

download:
	$(PYTHON) pipeline/download.py

$(STATCAN) $(TORONTO) $(RAW)/98-316-XWE2011001-1501.zip $(RAW)/gda_000b11a_e.zip \
$(RAW)/2016_92-156_DALand_ADsup_csv.zip $(RAW)/NHSprofile_Can_PR_CD_CSD_DA.IVT:
	$(PYTHON) pipeline/download.py

$(PROFILE11): $(RAW)/98-316-XWE2011001-1501.zip
	unzip -o -q $< '*-ONT.csv' -d $(RAW)
	touch $@

# 2011 Census (short form) on 2011 DAs, for the /2011/ page; its colour classes
# come from breaks.json.
$(GEOM11) $(FIGURES11) $(BREAKS11) &: $(STATCAN11) $(BREAKS) $(RAW)/toronto_neighbourhoods_4326.geojson \
                                      pipeline/census2011.py pipeline/measures.py pipeline/figures.py
	$(PYTHON) pipeline/census2011.py

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

clean:
	rm -rf pipeline/out
