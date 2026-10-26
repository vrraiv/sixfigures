# Rebuild everything from raw StatCan downloads:  make data
# Run from WSL/Linux/macOS (tippecanoe has no native Windows build).
PYTHON ?= python3

RAW      := pipeline/raw
GEOJSON  := pipeline/out/toronto_da.geojson
PMTILES  := web/public/toronto_da.pmtiles
BREAKS   := web/public/breaks.json
RAW_ZIPS := $(RAW)/98-401-X2021006_Ontario_eng_CSV.zip $(RAW)/lda_000b21a_e.zip

.PHONY: data download tiles deps clean

data: $(PMTILES)

deps:
	$(PYTHON) -m pip install -r pipeline/requirements.txt

download:
	$(PYTHON) pipeline/download.py

$(RAW_ZIPS):
	$(PYTHON) pipeline/download.py

$(GEOJSON) $(BREAKS) &: $(RAW_ZIPS) pipeline/build.py
	$(PYTHON) pipeline/build.py

tiles: $(PMTILES)

$(PMTILES): $(GEOJSON)
	@command -v tippecanoe >/dev/null || { echo "tippecanoe not found; see pipeline/README.md"; exit 1; }
	tippecanoe -o $@ -l da -zg --drop-densest-as-needed --coalesce-smallest-as-needed --force $<
	@ls -l $@

clean:
	rm -rf pipeline/out
