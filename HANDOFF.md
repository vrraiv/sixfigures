# Handoff: what is left after the review

Rewritten 13 November 2026, at the end of the local session that finished the data rebuild and
worked through the review's open items (branch `handoff-rebuild-and-review`). The first version
of this file listed all of them; this one lists only what was not done, or was done and could not
be checked. Delete it when these are settled.

## Done in that session, for reference

- **The data rebuild.** The seven extracts are in `pipeline/extracts/`; `make from-extracts`
  rebuilt `insights.json`; only `owner30`, `tenant30` and `subsidized` changed, in 2011, 2016 and
  2021. The city check passes for 2016 and 2021; 2011 has its own tolerance (2.5 points), because
  the NHS's nulled DAs put five rates 1.6 to 2.1 points under the city.
- **The pyivt fix** is `pipeline/pyivt/legacy-member-fields.patch`, built by `make pyivt`; a fresh
  build reproduced the four files the Beyond 20/20 scripts write, byte for byte.
- **Review groups A to F**: see the branch's commits, one per group.

## For the owner to look at

1. **The names of the kinds of neighbourhood** (`pipeline/affinity.py`, `NAMES`). The rebuild
   moved five centres. Three kinds kept their names under a new centre (Family apartment suburbs,
   Fast-building apartment areas, Settled house suburbs); two are new and were named in the
   session: **Older house neighbourhoods** (31: the old "Older family streets" with half of
   "Settled house suburbs") and **Ageing north-east suburbs** (8: Agincourt, Milliken, Steeles,
   L'Amoreaux East, Malvern East, Pleasant View, Hillcrest Village). "Older working suburbs" is
   gone: its members joined three other kinds. The names and one-line descriptions are an
   editorial call.
2. **West Humber-Clairville's heat figure rests on three passes** (+2.28) now that a pass counts
   only where it covers half of a neighbourhood; Mount Olive-Silverstone-Jamestown's on four. The
   page says so. If three is too few to publish, withhold it in `trees_insights.py`.
3. **The school forecasts** sit 1.41 (Grade 3) and 0.86 (Grade 6) points above the scores they
   start from. The page now states it and why; the forecasts were not re-centred, since they are
   frozen and centring cost skill on the holdout. Centring future forecasts is still open.
4. **The search** now takes neighbourhood names. Postal codes and landmarks get a message that
   says what the search knows; there is no data on the site to find them with.

## Done but not checked where it runs

- **The data refresh workflow** (`.github/workflows/data-refresh.yml`) was split in two: the
  refresh runs read-only and passes its changes as a patch to a second job, the only one with
  write access. It parses, and nothing more: it has not run. Its next scheduled run is 12 December
  2026; run it by hand before then (Actions, Data refresh, Run workflow) and check that the pull
  request appears with the same files as before.
- **Both workflows now use Python 3.14 and `pipeline/requirements.lock`** (pip freeze from the
  PC's WSL environment). CI's first run on the pull request shows whether every pinned version
  installs on the runner.
- **The Content-Security-Policy** in `web/public/_headers` was checked on the built site under
  `vite preview`, every page, with no violation. Cloudflare can add scripts of its own (Web
  Analytics): if that is on, the policy blocks its beacon; allow its host or leave it blocked.
- **The canonical addresses and the social card** assume the site is served at
  `https://sixfigures.vikramrai.com` (`ORIGIN` in `scripts/site-nav.mjs`).
- **The phone layouts** (the sideways header, the found address above the sheet) were checked in
  a headless browser at phone sizes, not on a phone.

## Not done

- **Working tree.** On the PC, seven files under `web/public/` (breaks.json, two `avg_hh_tot`
  figure files, the two income CSVs and the two DA `.pmtiles`) still show as modified from an
  earlier `make data`: the text files differ in line endings only and the tiles by two or three
  bytes. They were left alone and are not in any commit; `git restore web/public` puts them back.
- **Chart marks other than bars and lines** (scatter dots, histogram columns) still give their
  figures on hover or tap only. Bar and line charts now carry a table.
- **`exports.py` and `cpi.json` are still not prerequisites of the build** in the Makefile. The
  comment there says why (`make breaks` reapplies them without the raw files); making them
  prerequisites would send a CPI update through a full rebuild.
- **Outputs still differ between machines**: `pipeline/places.py` takes DA outlines from the
  boundary file where it is present and from the z13 tiles where it isn't (the heat figures moved
  by up to 0.17 between the two in a trial), and most scripts stamp `"built": today`. The tree
  page's DA outlines (`trees_da.json`) were kept as committed for that reason.
- **`trreb.py`** still skips its row check for a report with no district totals; **`trees.py`**
  still asks the network for the scene list with every scene cached; **address matching** exists
  three ways (`permits.py`, `city_layers.py`, `rentals.py`) and **`corr()`** is defined six times.
- **`ENROLMENT_YEAR`** in `forecast_pages.py` is still a constant ("2024-25").
- **A full `make trees`** was not run: the street-tree file is live and would move the tree
  counts. Only the Landsat passes were read again, for the heat rule.

## Working notes

- **This PC**: Node is not installed system-wide. A portable Node 22 is in
  `%LOCALAPPDATA%\Programs\node-v22.23.5-win-x64`; put it on the PATH, or install Node properly.
  The repository's path has an `&` in it, which breaks npm's script shims on Windows:
  `npm test` works, `npm run build` does not; run `node node_modules/vite/bin/vite.js build`
  and `node scripts/check-size.mjs` instead. The pipeline runs in WSL
  (`. ~/.venvs/toronto-dash/bin/activate`); the patched pyivt is in `~/pyivt/.venv`.
- **Tests:** `make test` runs `python -m unittest discover -s pipeline/tests` and `npm test`.
- **Browser checks:** Chromium and Playwright render the MapLibre maps headlessly in software, so
  frame rates mean nothing there. A full-viewport Playwright screenshot can show a blank map
  above the phone details sheet when the page is fine: clip to the map, or use the CDP call
  `Page.captureScreenshot` with `fromSurface: true`.
- **The phone sheet's structure is deliberate:** the background is on `.sheet` and the scrolling
  is on `#sheet-body` with no background (a scrolling box with its own opaque background blanked
  the map canvas above it in Chromium).
