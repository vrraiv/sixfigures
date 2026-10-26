# Rebuild everything from raw downloads:  make data
# Run from WSL/Linux/macOS (tippecanoe has no native Windows build).
PYTHON ?= python3

RAW      := pipeline/raw
GEOJSON  := pipeline/out/toronto_da.geojson
PMTILES  := web/public/toronto_da.pmtiles
BREAKS   := web/public/breaks.json
SEARCH   := web/public/search.json
STATCAN  := $(RAW)/98-401-X2021006_Ontario_eng_CSV.zip $(RAW)/lda_000b21a_e.zip
TORONTO  := $(RAW)/toronto_neighbourhoods_4326.geojson $(RAW)/toronto_address_points_4326.csv \
            $(RAW)/toronto_intersections_4326.csv

.PHONY: data download tiles search deps clean

data: $(PMTILES) $(SEARCH)

deps:
	$(PYTHON) -m pip install -r pipeline/requirements.txt

download:
	$(PYTHON) pipeline/download.py

$(STATCAN) $(TORONTO):
	$(PYTHON) pipeline/download.py

$(GEOJSON) $(BREAKS) &: $(STATCAN) $(RAW)/toronto_neighbourhoods_4326.geojson pipeline/build.py
	$(PYTHON) pipeline/build.py

tiles: $(PMTILES)

$(PMTILES): $(GEOJSON)
	@command -v tippecanoe >/dev/null || { echo "tippecanoe not found; see pipeline/README.md"; exit 1; }
	tippecanoe -o $@ -l da -zg --drop-densest-as-needed --coalesce-smallest-as-needed --force $<
	@ls -l $@

search: $(SEARCH)

$(SEARCH): $(RAW)/lda_000b21a_e.zip $(RAW)/toronto_address_points_4326.csv \
           $(RAW)/toronto_intersections_4326.csv pipeline/search_index.py
	$(PYTHON) pipeline/search_index.py

clean:
	rm -rf pipeline/out
