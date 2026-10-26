# Data pipeline

`make data` (from the repo root, in WSL/Linux/macOS) runs:

1. `pipeline/download.py` – fetches the two raw zips into `pipeline/raw/` (gitignored).
2. `pipeline/build.py` – streams the profile CSV, filters to Toronto, pivots, joins to
   boundaries, writes `pipeline/out/toronto_da.geojson` and `web/public/breaks.json`.
3. `tippecanoe` – writes `web/public/toronto_da.pmtiles`.

Setup in WSL (keep the Linux venv off `/mnt/c`, which is OneDrive-synced and already
holds the Windows `.venv`; Ubuntu 24.04's system pip refuses installs under PEP 668):

```sh
python3 -m venv ~/.venvs/toronto-dash && . ~/.venvs/toronto-dash/bin/activate && make deps
```

Then install tippecanoe (below).

## Sources (downloaded 2026-10-26)

| File | Size | URL |
|---|---|---|
| `98-401-X2021006_Ontario_eng_CSV.zip` – Census Profile 2021, CDs/CSDs/DAs, Ontario only | 757,020,277 B (8.78 GB CSV inside) | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=006_Ontario |
| `lda_000b21a_e.zip` – 2021 DA cartographic boundary file, shapefile, English | 197,042,003 B | https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lda_000b21a_e.zip |

Listing pages:
- Profile: https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm?Lang=E
  → "Comprehensive download files" → "Canada, provinces, territories, CDs, CSDs and DAs – Ontario only" → CSV.
  (The older `.../download-telecharger/comp/page_dl-tc.cfm?Lang=E` URL now returns 404.)
- Boundaries: https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21
  → English, Cartographic, Dissemination areas, Shapefile.

**Download note:** www12.statcan.gc.ca serves a Cloudflare bot challenge, so scripted
downloads usually get HTTP 403. `download.py` detects this, never saves the challenge
page, and prints the URLs; open them in a browser and save to `pipeline/raw/`.

## Processing notes

- **Encoding:** the profile CSV is Latin-1, not UTF-8.
- **Layout:** long format; `C1_COUNT_TOTAL` is followed by its own `SYMBOL` column. Suppressed
  cells have a blank value and `SYMBOL = "x"`. Any non-numeric value (`..`, `x`, `F`, blank) is
  treated as null and flagged `sup_<measure> = true`.
- **Toronto filter:** the DA boundary file has no CSDUID column, so DAs are selected by
  `DAUID LIKE '3520%'` (Toronto CD). `build.py` checks that CD 3520 contains only CSD 3520005,
  and that DA populations sum to the CSD total, before continuing.
- **City-wide median** in `breaks.json` is the official CSD 3520005 value from the profile
  (`city_median`); `median_of_das` is the unweighted median of DA medians, for reference.
- **Breaks:** 6-class quantiles over non-null DA values (`numpy.quantile(method="nearest")`,
  so each break is an actual DA value); array is `[min, q1/6 … q5/6, max]`.
- **Percentile rank** `pct_<measure>`: `rank(pct=True) × 100`, rounded, among non-null DAs.

## Row counts (2026-10-26 build)

| | rows |
|---|---|
| Profile CSV data rows scanned | 55,503,576 |
| Rows kept (CD 3520 DAs + CSD, 6 characteristics) | 22,464 |
| Toronto DAs in boundary file / in profile | 3,743 / 3,743 |
| DAs with suppressed income (all four measures together) | 68 |
| DAs with suppressed household count | 9 |
| Population: sum of DAs = CSD 3520005 | 2,794,356 |

Matched characteristics (`CHARACTERISTIC_ID`: name): 243 median total household income,
244 median after-tax household income, 113 median total income among recipients,
115 median after-tax income among recipients, 1 Population 2021,
50 "Total - Private households by household size - 100% data".

## Output properties (`da` layer)

`dauid`, `med_hh_tot`, `med_hh_at`, `med_ind_tot`, `med_ind_at`, `pop21`, `hh`,
`sup_<measure>` (bool), `pct_<measure>` (0–100). Nulls are omitted from the tiles.

## Installing tippecanoe

Windows has no native build; use WSL (admin PowerShell: `wsl --install -d Ubuntu`, reboot), then in Ubuntu:

```sh
sudo apt update && sudo apt install -y build-essential libsqlite3-dev zlib1g-dev make git python3-venv
git clone https://github.com/felt/tippecanoe && cd tippecanoe && make -j && sudo make install
tippecanoe --version   # needs >= 2.17 for direct .pmtiles output
```

macOS: `brew install tippecanoe`.
