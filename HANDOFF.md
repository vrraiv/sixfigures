# Handoff: finish the data rebuild, then the rest of the review

Written 13 November 2026 at the end of a cloud session that did the repo's first code and UX
review. It is for whoever picks this up next, in a local session with the raw downloads in
`pipeline/raw/`. Delete this file once both parts below are done.

**Where things stand.** The review's first round of fixes is merged (PR #77, commits `68a1943`
and `100ee74`). One step could not be done in the cloud, because Statistics Canada refuses
scripted downloads of the census profiles: rebuilding three neighbourhood measures from the raw
files. The owner tried it once on a laptop and hit warnings and a pyarrow problem; nothing from
that run was committed. Part 1 is that step. Part 2 is everything else the review found and
nobody has fixed yet.

Line numbers below are as of `main` at `9fd38f2`. Where a line may have drifted, the function or
identifier named is the thing to search for.

---

## Part 1: finish the data rebuild

### What it is for

`pipeline/insights.py` used to average a placeholder 0% into the neighbourhood figures for three
measures: `owner30`, `tenant30` and `subsidized`. Where too few owner or tenant households
answered, the census profile withholds the median owner cost or rent and prints these
percentages as 0. The code now leaves those out (`PLACEHOLDER_ZERO` and `published()` in
`insights.py`), with tests in `pipeline/tests/test_insights.py`. The committed
`web/public/insights.json` still holds the old values for those three measures, because the
weights (owner and renter household counts) are not in the repository.

### Steps

1. Confirm the checkout has the fixes: `git log --oneline -3` shows `9fd38f2` or `100ee74`.
2. If an earlier run left files changed, start clean: `git status`, then
   `git restore web/public pipeline` (this discards rebuilt outputs, which is the point).
3. `make data`
4. `make explorer neighbourhoods`
5. Check the result (next section), name the neighbourhood kinds (section after), `make test`,
   then commit and open a pull request. The live site changes only on merge.

### What a correct rebuild looks like

These are checks, not hopes. If one fails, stop and find out why before committing.

- **Map data should not change at all.** `web/public/data/figures/**`, `breaks.json`,
  `breaks_2011.json` and the three CSVs under `web/public/data/` were regenerated in the cloud
  with the pipeline's own functions, after that path reproduced the committed files byte for
  byte without the fix. `git status` after `make data` should show none of them modified. If
  they are, suspect library versions (see "Known trouble").
- **In `insights.json`, only three measures should change:** `owner30`, `tenant30`,
  `subsidized`, in 2011, 2016 and 2021. `avg_hh_tot` and `transfers` were already corrected and
  should come out identical. This prints what moved:

  ```python
  import json, subprocess
  old = json.loads(subprocess.run(["git", "show", "HEAD:web/public/insights.json"], capture_output=True, text=True).stdout)
  new = json.load(open("web/public/insights.json"))
  for m in old["measures"]:
      for y, a in old["measures"][m]["values"].items():
          b = new["measures"][m]["values"][y]
          n = sum(x != z for x, z in zip(a, b))
          if n:
              print(m, y, n, "changed;", sum(z is None for z in b) - sum(x is None for x in a), "more withheld")
  ```

- **Expected direction and size** (a reviewer's estimates from committed data with approximate
  weights; treat as rough): neighbourhood `tenant30` rises where many DAs had placeholders.
  Highland Creek 2016 was 16.5% and should land near 43%; Bridle Path-Sunnybrook-York Mills 2021
  was 33.7% and should land near 51%. Some neighbourhoods may become withheld, because
  placeholder DAs now count as uncovered and a figure needs half the measure's base covered.
- **The city check.** `insights.py` now ends with `check_city()`: every DA aggregated as one
  neighbourhood, compared with the city value StatCan publishes. It prints
  `WARNING: N measures don't reproduce the city value from the DAs:` and one line per miss. It
  never stops the build. Its tolerances (`CITY_TOLERANCE`: 1 point for rates, 3% for dollars)
  were set without the raw 2011 data, so:
  - lines for **2011** may be legitimate: the NHS nulls DAs with high non-response, so the
    remaining DAs need not add up to the city. Judge each, then either widen the tolerance for
    2011 or leave the warning;
  - a line for **2016 or 2021** means a measure is still on the wrong base or still counts a
    placeholder. `tenant30` should now be within about 0.3 of the city (46.7 against 46.8 in
    2016, 39.7 against 40.0 in 2021).

### Naming the neighbourhood kinds

`pipeline/affinity.py` clusters the 158 neighbourhoods into eight kinds and names each by the
neighbourhood nearest its centre (`NAMES`, about line 102). The clustering is weak (silhouette
about 0.10), so a change to one measure regroups it. When a centre moves, the kind falls back to
a label like "Higher on units proposed, surface heat" and the script prints
`no name for the type centred on <neighbourhood>`.

The cloud session regenerated `neighbourhoods.json` once with only the transfers fix and then
**put the committed file back**, so the page would not go live with fallback names. In that
trial:

| Before (committed) | n | What happened |
|---|---|---|
| Family apartment suburbs (Eglinton East) | 33 | kept, 35 |
| Affluent house neighbourhoods (Lawrence Park South) | 29 | same 29 members, centre moved to Edenbridge-Humber Valley, so the name was lost |
| Settled house suburbs (Thistletown-Beaumond Heights) | 27 | kept |
| New condo districts (Harbourfront-CityPlace) | 16 | kept |
| Older family streets (East End-Danforth) | 14 | kept |
| Older working suburbs (Clairlea-Birchmount) | 14 | 12 merged into a new kind of 20 centred on Briar Hill-Belgravia |
| Fast-building apartment areas (Newtonbrook West) | 13 | 8 joined that kind of 20; 5 formed a new kind centred on Moss Park |
| Inner-city neighbourhoods (Trinity-Bellwoods) | 12 | kept |

The tenant-share fix will move it again, so expect a different result. After
`make neighbourhoods`: for each "no name" line, add an entry to `NAMES` keyed by the new centre
(a name and a one-line description; the printed `high` and `low` measures say what sets the kind
apart), then run `make neighbourhoods` again until it prints none. A kind whose members are
unchanged can keep its old name under the new key. Naming is an editorial call for the owner.

Until this is committed, the Neighbourhood Explorer still uses the old transfer figures, so it
disagrees with the Data Explorer on that one measure.

### Known trouble

The owner's first attempt reported "a couple of warnings" and "a pyarrow issue"; the text was
not captured. Start by getting both verbatim.

- The warnings may be `check_city()`'s (above), which are informational.
- `pipeline/requirements.txt` has lower bounds only and no lock file. The cloud run used
  Python 3.13.18, pandas 3.1.1, numpy 2.5.4, geopandas 1.2.0, pyogrio 0.13.0, scipy 1.18.1,
  **without pyarrow installed**, and the pipeline's functions and tests ran clean there. pandas 3
  stores text columns differently when pyarrow is present, which can change dtype-sensitive code
  (`.str[...]`, `astype`, joins on string keys). Compare `pip show pandas pyarrow` on the laptop
  and on the PC that built the committed data. If they differ, the quickest test is a virtual
  environment matching the PC.
- `make` must be GNU Make 4.3 or later (the Makefile uses `&:` grouped targets). Stock macOS
  make is 3.81.
- `nhs2011.py` and `profile2006.py` need a patched `pyivt` (see `pipeline/README.md`); it is
  neither pinned nor vendored. If the cached extracts in `pipeline/out/` exist, they are reused.

---

## Part 2: review items still open

Status marks: **[R]** reproduced in a browser or recomputed from committed data during the
review; **[C]** confirmed by a reviewer agent (by script or an unambiguous code path) and not
re-checked; **[S]** suspected, unproven.

None of Part 2 depends on Part 1 except the forecasts group.

### A. Things that break (front end)

1. **[R] Neighbourhood Explorer throws for seven neighbourhoods with no school figure.**
   `web/src/neighbourhoods.js`, `renderAlike()` (line 168) and `recompute()` (line 96). Open
   `/insights/neighbourhoods/#nb=170&by=schools`: `TypeError: Cannot read properties of undefined
   (reading 'name')`. The seven: Yonge-Bay Corridor, Bay-Cloverhill, Wellington Place, Fort
   York-Liberty Village, Humber Bay Shores, Briar Hill-Belgravia, Bridle Path-Sunnybrook-York
   Mills. Also: untick every theme but Schools and the page prints "average about NaN". Fix:
   guard an empty `order` as `renderThemes` does; skip NaN pairs in `typical` and `cityMean`.
2. **[R] Malformed links kill pages.** `web/src/main.js` line 26 (`hashParams.get("m") in
   MEASURES`) and the `at=` parse just below; `web/src/y2011.js` lines 42-44; the same pattern
   with `obj[key]` truthiness in `explorer.js:52`, `trees.js:77`, `housing.js:67`, `safety.js:72`,
   `prices.js:89`, `fc-schools.js:20`, `fc-value.js:15`, `neighbourhoods.js:440`. `#m=constructor`
   throws at startup; `#at=13/443.7/-79.4` throws "Invalid LngLat"; in the explorer `pf=x` sets
   NaN and every draw throws. Fix: `Object.hasOwn`, range-check zoom, lat and lng, clamp `pf`/`pt`.
3. **[R] Silent load failures.** Every entry module does `await fetch(...).then(r => r.json())`
   at top level with no `r.ok` check and no catch: `main.js:60`, `y2011.js:21`, `insights.js:8`,
   `schools.js:9`, `trees.js:10`, `housing.js:10`, `safety.js:11`, `prices.js:9`,
   `neighbourhoods.js:19`, `explorer-core.js:9`, `forecasts.js:8`. A failed request leaves a
   blank map or empty headings with no message. The explorer caches a rejected promise, so it
   never retries. Fix: one shared `loadJSON()` that checks `r.ok`, a try/catch per entry that
   writes a visible message, no cached rejections. Add `breaks.json` to the census page's inline
   preloader while there.
4. **[R] Low and medium map detail no longer thin the basemap.** `web/src/quality.js:67` and
   `web/src/diag.js:237` match `l.source === "openmaptiles"`; the source has been `"protomaps"`
   since commit `1284e2c`, with different layer ids. Fix: import `SOURCE` from
   `scripts/basemap-style.mjs`, rewrite `PRUNE` for Protomaps ids, and add a test that pruning
   hides at least one layer. In `diag.js` also: the `d` key skips the 2011 source, and line 276
   throws when calibration returned `{rest: null}`.
5. **[C] Wrong-year popup.** `main.js` `showDetails()` (line 806) reads `view` and
   `select.value` after its `await`. Click a DA in 2021, switch to 2016 before its figures
   arrive, and the popup is headed "2016 boundary" with 2021 values. Partly addressed:
   `closeDetails()` now bumps `detailsToken`. Still to do: bump it in `setView`, and bail after
   the await if the source or measure changed. `goTo()` (line 1040) has the same gap **[S]**.
6. **[C] Controls ignored on slow connections.** `main.js` (about line 956) and `y2011.js`
   (about line 403) attach the measure, change-basis and year listeners only on MapLibre's
   `load`, which waits for every tile. Change a control before then and the map ignores it while
   the hash records it. Fix: attach at `style.load`, or re-sync from the controls on `load`.
7. **[C] Stale colours under a new legend.** `main.js` 149-162 and 398-423; `y2011.js` 77-89.
   If a measure's figures fail to load, the legend and title change but the colours stay the old
   measure's, and re-selecting the same option fires no `change`. Fix: clear the class state or
   revert the select on failure, and offer a retry.
8. **[C] Pins and selections dropped off-screen.** `main.js` lines 512, 762, 886 validate with
   `querySourceFeatures`, which only sees tiles in view. A shared `da=B&vs=A` link drops the pin
   when A is outside the recipient's view. Fix: validate against the loaded figures instead.
9. **[R] 2011 measure menu shows raw keys.** `web/src/y2011.js:33` labels only two groups; the
   menu shows "income", "low", "housing", "costs". Fix: share the census page's group labels.
10. **[R] "Median year built" chart starts at zero.** `web/src/housing.js:410`
    (`ya = Math.min(0, sy[0])`) and the rank bars at 296-298. Values 1928-2022 sit in the top
    few percent. Fix: use the data's range when `unit === "year"`.
11. **[C] 2011 linked area has no fallback.** `y2011.js` about line 347, unlike `main.js`
    about 871-879: a shared link to a DA outside a phone's opening view opens nothing.
12. **[C] Snapshot can leave the map at double resolution.** `main.js` about 1338 and 1380,
    `snapshot.js:24-47`: two overlapping `grabMap` calls restore the wrong pixel ratio.
13. **[C] Pinned pixel ratio and uncancelled auto-detail.** `quality.js:132` and 163-183,
    `snapshot.js:25`, `43`: the map stays blurry after browser zoom; a manual "low" chosen while
    auto is measuring gets overwritten.

### B. Charts and figures that mislead (front end)

1. **[C] Explorer "fifths" split ties arbitrarily.** `web/src/explorer-two.js:58-73` with
   `nbtools.js:85-89`. With a zero-heavy first measure (cyclists killed or seriously injured: 99
   of 158 are zero) the first three "fifths" are all zero and the sentence about them can flip
   direction with the tie order. Fix: one group for tied values.
2. **[C] Change classes are not symmetric about zero.** `web/src/figures.js:77` (`classIndex`,
   `value >= s`) and `pipeline/build.py` about 270: −3 points is "Within ±3" while +3 is the next
   class up. Fix: mirror the comparison for negative stops in both places.
3. **[C] Canopy-change map colours small gains as losses.** `web/src/trees.js` lines 19, 61,
   182, 191: sixths of neighbourhoods put the red-to-green break at the median (+0.29), not zero.
4. **[C] Hard-coded years that must track the data.** `housing.js:23` (`LAST = 2025` while
   `housing.json` ships a `partial` block), `schools.js:35` (assumes six test years),
   `safety.js:33`, `housing.js:30`; and in the pipeline `safety_insights.py:93`,
   `trees_insights.py:214`, `forecast_pages.py:75`. After the next annual rebuild the pages will
   call the wrong year "the last complete year".
5. **[C] Smaller wording errors.** `schools.js:483` says "across the 158 neighbourhoods" when
   about 140-150 have a figure; `explorer-one.js:54-57` puts a negative tick on non-negative
   measures and prints a percentage-point gap as "%"; `units.js:27` lowercases candidates' names
   ("tory share"); `main.js:648` says "Since 2016" for incomes dated 2015 and 2020.
6. **[C] Heat figures for two north-west neighbourhoods rest on a pass that only clips them.**
   `pipeline/trees.py`, `lst_summary()` and `lst_by_pass()`: a DA needs half its pixels clear, a
   neighbourhood needs nothing. Mount Olive-Silverstone-Jamestown publishes −0.11 against +0.39
   from its four full passes. Needs the Landsat rasters to fix and rebuild.
7. **[C] DA tree shares with no minimum count.** `pipeline/trees_insights.py:118-122`: 21 DAs
   publish a large-tree share of exactly 0% or 100% from fewer than ten trees.

### C. Map page design (reproduced; these are judgement calls)

- **Search takes addresses and intersections only.** Neighbourhood names, postal codes and
  landmarks get a generic hint, and "yonge" suggests Yonge Blvd.
- **The details heading is "DA 35204616".** Someone who typed their address gets a census code
  as the title; the neighbourhood or address would read better first.
- **Long pages have no section navigation.** Trees is about 15,700px on a phone.
- **No social preview tags or canonical links** on any page.
- **On a phone held sideways** the header and controls take 276 of 342px, so the map starts
  below the fold.
- **On a phone, a searched address is zoomed to 15**, so the strip above the sheet shows only
  part of its area. Fitting with bottom padding for the sheet would show all of it.

### D. Accessibility (reproduced with axe-core and by keyboard)

- Three selects have no accessible name on phones: `#measure` on Safety and Trees, `#nb` on the
  Neighbourhood Explorer (their label is hidden at narrow widths).
- No skip link: 15 tab stops before the search box on every page.
- Contrast below 4.5:1: white text on table-cell fills (`#2a78d6` 4.41, `#d75e52` 3.74,
  `#5ea852` 2.91 on Trees) and `--ink-3` (`#75756f`) on tinted backgrounds (4.18 to 4.24).
- `aria-sort` on `<button>` instead of `<th>` in the schools table (`schools.js:559`); card
  buttons whose `aria-label` omits their visible text (Census and School Insights).
- Scrollable tables are not keyboard focusable (`.tbl-wrap`).
- **[C]** Chart values exist only in hover tooltips (`charts.js:9-42`): nothing on focus, SVGs
  are `aria-hidden`. Four pages have no neighbourhood finder, so a neighbourhood outside the
  top-ten lists cannot be picked by keyboard.
- **[C]** Segmented buttons rebuild their own markup when pressed (`charts.js:45-51`,
  `explorer.js:71-88`) and drop focus to `<body>`; arrowing through the explorer's measure list
  is impossible on Windows and Linux.
- **[C]** The map canvas label always says "median income"; suggestion options never get
  `aria-selected`; focus is lost after closing the snapshot dialog (`main.js` about 899, 1125,
  1265).
- Small targets on phones: section sub-navigation links 22px tall, table sort buttons 17px,
  20px checkboxes; 10 to 11px text in footers and chart labels.

### E. Pipeline robustness and process

1. **[R] No tests run on pull requests.** `.github/workflows/data-refresh.yml` is the only
   workflow. A small workflow running `npm test`, `npm run build` and
   `python -m unittest discover -s pipeline/tests` on pull requests would have caught most of
   round one.
2. **[C] Unpinned dependencies.** `pipeline/requirements.txt` is `>=` only with no lock file,
   actions are pinned by tag, and the refresh job holds write permissions throughout.
3. **[C] Truncated downloads accepted.** `pipeline/download.py`, `fetch()` (about line 367): a
   body shorter than its Content-Length is saved as complete, and the on-disk check then accepts
   it. Fix: compare bytes written with Content-Length.
4. **[C] Any TRREB failure reads as "not posted yet".** `download.py` about 464-488 and 641. A
   changed URL would stall prices silently. Fix: treat only a 404 that way.
5. **[C] Makefile staleness.** No `.DELETE_ON_ERROR`; the figures sentinel is written first, so
   an interrupted run looks current; `exports.py` and `cpi.json` are not prerequisites;
   `explorer` and `neighbourhoods` are manual, so `make data` can leave them stale.
6. **[C] `build.py` prints instead of checking.** About lines 208-217: the README says DA
   populations are checked against the city total "before continuing"; the code prints both.
7. **[C] Outputs differ between machines.** `pipeline/places.py:50-63` places points against the
   boundary file locally and against z13 tiles in CI; several scripts stamp `"built": today`.
8. **[C] Catalogue duplicated between Python and JS.** `explorer_data.py:129` reads
   `web/src/catalogue.js` with a single-line regex and silently skips what it cannot parse.
9. **[C] Tooltip names are parsed as HTML.** `charts.js:18`, `108`: names are escaped once, then
   decoded by the attribute and assigned to `innerHTML`. No committed name contains markup today.
   Fix: build tips as text, and add a Content-Security-Policy in `web/public/_headers`, which
   sets no security headers at present.
10. **[R] `scripts/check-size.mjs` reports a stale first-load figure.** Its exclusion list names
    ten page bundles; six pages added since are counted, and the figure is printed, not enforced.
11. **[C]** `series.py:117` treats any StatCan error as "series doesn't exist"; `trreb.py`
    183-194 skips its row check when a report has no district totals; `trees.py` 494-504 needs
    the network even with every scene cached; address matching exists three ways (`permits.py`,
    `city_layers.py`, `rentals.py`) and `corr()` is defined six times with two meanings.

### F. Forecasts (owner's decisions; the second needs model outputs)

1. **[R] The dwelling-value forecast is not frozen.** `pipeline/forecast/value.py` writes
   `value_live.csv` to the git-ignored `pipeline/out/model/` and recomputes it every run;
   `forecast_pages.py:153` publishes from there. Only the school forecasts are under
   `pipeline/model/` with a compare-or-refuse guard. Fix: freeze it the same way and pin the
   2026 window.
2. **[R] School forecasts drift upward.** In the frozen files the enrolment-weighted mean of
   `ridge - score0` is +1.41 points (Grade 3) and +0.86 (Grade 6) for 2026-27. The reviewer
   attributes it to transforming back from the logit scale (`forecast/schools.py:206`) and found
   that re-centring lowers published skill from 20.2% to 18.6% on the 2024-25 holdout. Either
   centre the predicted changes to zero, or publish the implied city change beside the scores.
3. **[C]** `forecast/fit.py:139-143`: once a forward-only rung leads, challengers are judged on
   one fold (a 0.01 edge can win despite a reverse-fold error of 25); `fit.py:97` lets a NaN
   cross-validation error win `argmin`; `forecast/schools.py:298-323` refits frozen forecasts
   from current inputs, so a revised Ministry file blocks `make forecast` from then on.

### Looked at and found sound

No injection path from URLs or search input into the page; class breaks, percentiles, histograms
and inflation factors recompute exactly from the committed figures; DA ids are strings
throughout; the frozen school forecasts reproduce byte for byte with no look-ahead; crime rates,
election totals, rents and rentals recompute from committed files; no `shell=True`, no unsafe
archive extraction; `npm audit` reports nothing.

---

## Working notes for the next session

- **Tests:** `make test` runs `python -m unittest discover -s pipeline/tests` and `npm test`
  (which includes `scripts/data-invariants.test.mjs`, the checks on the committed figures).
- **Browser checks:** `npm run build && npx vite preview`. Chromium and Playwright render the
  MapLibre maps headlessly in software, so frame rates mean nothing there.
- **A screenshot trap:** a Playwright full-viewport screenshot can show a blank map above the
  phone details sheet when the page itself is fine. Capture with the CDP call
  `Page.captureScreenshot` and `fromSurface: true`, or clip to the map.
- **The phone sheet's structure is deliberate:** the background is on `.sheet` and the scrolling
  is on `#sheet-body` with no background. A scrolling box with its own opaque background blanked
  the map canvas above it in Chromium here. Worth one look on a real phone; nobody has yet.
- **Regenerating map data without the raw files:** the tail of `build.main()` and
  `census2011.main()` runs on tables rebuilt from `web/public/data/figures/`. Done by hand in the
  cloud session, it reproduced the committed figures, breaks and CSVs exactly. That is how the
  $0 incomes and over-100% shares were corrected, and it is an option again if a future fix
  touches only DA-level values.
