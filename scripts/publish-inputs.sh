#!/usr/bin/env bash
# Upload the three Statistics Canada files the data-refresh workflow can't download itself
# (www12.statcan.gc.ca refuses scripts) to this repository's `pipeline-inputs` release, where
# `python pipeline/download.py --inputs` fetches them. Run once from a machine that has them
# (`make publish-inputs`), and again only if they change: after the 2026 Census rebuild.
#
#   pipeline/raw/lda_000b21a_e.zip         2021 dissemination area boundaries (download.py
#                                          prints its URL; save it from a browser)
#   pipeline/out/toronto_dwellings.csv     Toronto's DA dwelling counts, 2011 to 2021, that
#                                          permits.py caches from the census profiles on its
#                                          first run
#   pipeline/out/toronto_da_geom.geojson   Toronto's 2021 DAs, written by build.py (make data)
#
# Needs the GitHub CLI (https://cli.github.com), logged in (`gh auth login`). Without it, make
# the release on GitHub instead: Releases, Draft a new release, tag `pipeline-inputs`, attach
# the three files, untick "Set as the latest release", Publish.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=pipeline-inputs
FILES=(pipeline/raw/lda_000b21a_e.zip pipeline/out/toronto_dwellings.csv pipeline/out/toronto_da_geom.geojson)

command -v gh >/dev/null || { echo "Needs the GitHub CLI (https://cli.github.com); or make the release by hand (see this script's header)." >&2; exit 1; }
for f in "${FILES[@]}"; do
  [ -s "$f" ] || { echo "Missing $f: see this script's header for where it comes from." >&2; exit 1; }
done

if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --title "Pipeline inputs (data, not a release of the site)" --latest=false --notes \
"Files the scheduled data refresh (.github/workflows/data-refresh.yml) needs but can't download itself, because Statistics Canada's www12 site refuses scripts. \`python pipeline/download.py --inputs\` fetches them; \`scripts/publish-inputs.sh\` uploads them.

- lda_000b21a_e.zip: 2021 Census dissemination area boundary file, as published.
- toronto_dwellings.csv: total private dwellings by Toronto dissemination area in the 2011, 2016 and 2021 Census Profiles.
- toronto_da_geom.geojson: Toronto's 2021 dissemination areas, from the boundary file.

Source: Statistics Canada, 2011, 2016 and 2021 Censuses of Population. Reproduced and distributed on an \"as is\" basis with the permission of Statistics Canada, under the Statistics Canada Open Licence (https://www.statcan.gc.ca/en/terms-conditions/open-licence)."
fi
gh release upload "$TAG" "${FILES[@]}" --clobber
echo "Uploaded to the $TAG release: ${FILES[*]}"
