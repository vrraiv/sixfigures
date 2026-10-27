# Rebuild everything from raw downloads:  make data
# Run from WSL/Linux/macOS (tippecanoe has no native Windows build).
PYTHON ?= python3

RAW       := pipeline/raw
GEOJSON   := pipeline/out/toronto_da.geojson
GEOJSON16 := pipeline/out/toronto_da_2016.geojson
PMTILES   := web/public/toronto_da.pmtiles
PMTILES16 := web/public/toronto_da_2016.pmtiles
BREAKS    := web/public/breaks.json
SEARCH    := web/public/search.json
CORR      := $(RAW)/2021_92-156-X_DALand_ADsup.zip
STATCAN   := $(RAW)/98-401-X2021006_Ontario_eng_CSV.zip $(RAW)/lda_000b21a_e.zip \
             $(RAW)/98-401-X2016044_ONTARIO_eng_CSV.zip $(RAW)/lda_000b16a_e.zip $(CORR)
TORONTO   := $(RAW)/toronto_neighbourhoods_4326.geojson $(RAW)/toronto_address_points_4326.csv \
             $(RAW)/toronto_intersections_4326.csv

.PHONY: data download tiles search deps clean cpi breaks

data: $(PMTILES) $(PMTILES16) $(SEARCH)

deps:
	$(PYTHON) -m pip install -r pipeline/requirements.txt

download:
	$(PYTHON) pipeline/download.py

$(STATCAN) $(TORONTO):
	$(PYTHON) pipeline/download.py

# build.py also applies cpi.json and writes the CSVs, but a change to those alone
# only needs `make breaks`, not a rebuild of the GeoJSON and tiles.
$(GEOJSON) $(GEOJSON16) $(BREAKS) &: $(STATCAN) $(RAW)/toronto_neighbourhoods_4326.geojson \
                                     pipeline/build.py pipeline/census2016.py pipeline/distributions.py
	$(PYTHON) pipeline/build.py

# Refresh the CPI from StatCan's Web Data Service, then re-apply it (and the
# histograms and CSV downloads) from pipeline/out without the raw downloads.
cpi:
	$(PYTHON) pipeline/cpi.py
	$(PYTHON) pipeline/refresh.py

breaks:
	$(PYTHON) pipeline/refresh.py

tiles: $(PMTILES) $(PMTILES16)

$(PMTILES): $(GEOJSON)
$(PMTILES16): $(GEOJSON16)
$(PMTILES) $(PMTILES16):
	@command -v tippecanoe >/dev/null || { echo "tippecanoe not found; see pipeline/README.md"; exit 1; }
	tippecanoe -o $@ -l da -zg --drop-densest-as-needed --coalesce-smallest-as-needed --force $<
	@ls -l $@

search: $(SEARCH)

$(SEARCH): $(RAW)/lda_000b21a_e.zip $(RAW)/lda_000b16a_e.zip $(CORR) \
           $(RAW)/toronto_address_points_4326.csv $(RAW)/toronto_intersections_4326.csv \
           pipeline/search_index.py
	$(PYTHON) pipeline/search_index.py

clean:
	rm -rf pipeline/out
