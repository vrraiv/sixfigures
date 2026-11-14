# Six Figures: notes for working in this repository

A static site about the City of Toronto and its 158 neighbourhoods. A Python pipeline
(`pipeline/`, run from WSL, Linux or macOS) turns public data into JSON and tiles under
`web/public/`; a Vite site (`web/`, `scripts/`) reads them. Merging to `main` deploys.

Where things are written down:

- `README.md`: what every page shows and how the site is built.
- `docs/data-catalogue.md`: every dataset, how often its publisher updates it, what the
  site holds, how to refresh it, and the refresh schedule.
- `pipeline/README.md`: sources, quirks and processing notes for each script.
- Each pipeline script's docstring: what it reads, what it writes and why.

Checks before a pull request: `npm test`, `npm run build`, and
`python -m unittest discover -s pipeline/tests` (`make test` runs the tests). Open pull
requests against `main`, not against another open branch: a pull request merged into a
branch that has already been merged never reaches the site.

## Adding a new data source

Work through all of these. The last three sections are the ones that get forgotten.

### 1. The data

- Register each raw file in `pipeline/download.py` (`TORONTO` for the City's portal). Put
  files too large for a routine download in `ON_REQUEST`.
- Write one script that reads the raw files and writes small tables to its own folder,
  `pipeline/<source>/`, with a `manifest.json` of what was read and when. Commit those
  tables, so that the page's figures rebuild on any checkout without the raw files.
- `.gitignore` ignores every `*.csv`. Add an exception for the new folder
  (`!pipeline/<source>/*.csv`) and confirm with `git status` that the tables are staged.
  A page can build and pass its checks locally while its tables were never committed.
- Keep only whole periods (a month or year the file covers to its end), and say in the
  docstring what was left out and how much. Make the script stop, not guess, when a file's
  layout has changed.
- Place points in neighbourhoods with `pipeline/places.py`, as the other layers do.
- Add tests in `pipeline/tests/` for the parsing rules that took finding, and a check on
  the page's committed file in `scripts/data-invariants.test.mjs`.

### 2. The page

- A script `pipeline/<page>_insights.py` writes `web/public/<page>.json` from the
  committed tables; add Makefile targets for it and for the source script.
- The page itself: `web/insights/<page>/index.html` and `web/src/<page>.js`. Sale prices
  (`prices.js`) is the simplest to copy from.
- Register it in three places: `vite.config.js` (the `__<PAGE>_VERSION__` define, the
  build input and the count of pages in the comment), `scripts/site-nav.mjs` (the header
  link and its `blurb`, which is also the landing page's card), and the About page's lists
  of topics and sources.
- Say on the page what the data can't show, and credit the source in the page's footer.
- To put a label inside a sentence, use `lc` (`web/src/catalogue.js`, or `web/src/units.js`
  for the Explorers' labels): it lowers the first letter only and leaves a leading
  abbreviation alone. Never call `.toLowerCase()` on a label: it turned "TTC" into "tTC",
  "CMHC" into "cmhc" and "LIM-AT" into "lim-at".

### 3. The two Explorers

- Add the neighbourhood measures to `pipeline/explorer_data.py` (a source in `SOURCES`
  and a function that calls `b.add`). The Data Explorer's page needs no change.
- For the Neighbourhood Explorer, add a theme, or measures to a theme, in
  `pipeline/affinity.py`'s `THEMES`. Leave out a measure that restates another.
- The kinds of neighbourhood are locked in `pipeline/kinds/` until the 2026 Census is
  fully released. A new theme goes in `NOT_TYPED` until they are cut again, so the kinds
  keep resting on what they were cut from. Never recut or rename them for a new source.
  After rebuilding, confirm that `type`, `next` and the types' names in
  `web/public/neighbourhoods.json` are unchanged.

### 4. Check the README

- Add a paragraph for the page under Details: what it shows, its sources and periods,
  what the data can't show, and its files.
- Update the lists and counts that name every topic: the About section's list of what is
  published and what the site offers, the header's Topics, the Data Explorer's number of
  measures and its sources, the Neighbourhood Explorer's number of measures and themes,
  and the average affinity of two neighbourhoods if it moved.
- Update "Rebuild the data" if the refresh schedule changed, and the build's size if it
  changed much.
- Add the source to `docs/data-catalogue.md` (a table row for each dataset and the
  schedule) and its quirks to `pipeline/README.md`.

### 5. Check the landing page

- `web/index.html`: the meta description and the opening paragraph each list the site's
  subjects. Add the new one.
- The landing page's card for the page is its `blurb` in `scripts/site-nav.mjs`: make sure
  it says what the page now holds, and revise it when a page gains a new kind of data.
- `web/about/index.html`: the opening list, the Topics list and "Where the data comes
  from".
- If the new data changes what a search box or a control accepts, say so wherever the
  landing and About pages describe it.

### 6. Set up the refresh at the right frequency

- Find out how often the publisher updates the data (the portal's `refresh_rate` and the
  files' dates), and how long after a period ends its data appears.
- Add a part to `PARTS` in `pipeline/data_refresh.py`: the files to fetch fresh
  (`toronto`) and once (`toronto_once`), the scripts to run (`build`), the folders it
  writes (`dirs`), the tables that count as a change (`data`) and the pages to rebuild
  (`pages`). Add its line to `NEWS` so the pull request says what is new.
- Schedule it in `.github/workflows/data-refresh.yml`: a `cron` line matched to the
  publisher's rhythm, a few days after new data usually appears; the part chosen in
  "Choose the parts" (by `github.event.schedule` when it has its own cron); and a
  `workflow_dispatch` input so it can be run by hand. Monthly sources run on the 18th;
  quarterly ones on the 12th and 26th of March, June, October and December.
- If the publisher keeps only the current file (the TTC's schedule), the refresh is what
  builds the history: have the script add each new period to its table and keep the old.
- Test it before merging: `gh workflow run data-refresh.yml --ref <branch> -f <part>=true`
  with the other parts off. With the data current it should report "nothing new" and open
  no pull request. If it reports a change, the committed tables don't match what the
  script produces.
- Add a `make refresh-<part>` target, and the run to the schedule in
  `docs/data-catalogue.md`.
