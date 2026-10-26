"""Build Toronto DA income GeoJSON + breaks.json from raw StatCan downloads.

Steps
  1. Stream the Ontario Census Profile CSV (8.8 GB, inside the zip) and keep
     only Toronto rows (CD 3520) for the six target characteristics.
  2. Pivot to one row per DA; derive per-measure suppression flags.
  3. Join to DA cartographic boundaries, reproject to EPSG:4326.
  4. Quantile breaks, city-wide medians and percentile ranks.
  5. Tag each DA with its City of Toronto neighbourhood (DAs have no names).
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "out"
WEB = HERE.parent / "web" / "public"

PROFILE_ZIP = RAW / "98-401-X2021006_Ontario_eng_CSV.zip"
PROFILE_CSV = "98-401-X2021006_English_CSV_data_Ontario.csv"
BOUNDARY = f"zip://{(RAW / 'lda_000b21a_e.zip').as_posix()}!lda_000b21a_e.shp"
EXTRACT = OUT / "toronto_profile_long.csv"
NEIGHBOURHOODS = RAW / "toronto_neighbourhoods_4326.geojson"
METRIC_CRS = 2952  # NAD83(CSRS) / MTM zone 10, the City of Toronto's projection

TORONTO_CSD = "3520005"
TORONTO_CD = "3520"
EXPECTED_DAS = 3700

# short property name -> CHARACTERISTIC_NAME (after strip). The household
# count row is named "Total - Private households by household size - 100% data".
TARGETS = {
    "med_hh_tot": "Median total income of household in 2020 ($)",
    "med_hh_at": "Median after-tax income of household in 2020 ($)",
    "med_ind_tot": "Median total income in 2020 among recipients ($)",
    "med_ind_at": "Median after-tax income in 2020 among recipients ($)",
    "pop21": "Population, 2021",
    "hh": "Total - Private households by household size - 100% data",
}
MEASURES = ["med_hh_tot", "med_hh_at", "med_ind_tot", "med_ind_at"]
N_CLASSES = 6

# Row prefixes (CENSUS_YEAR,"DGUID...) for Toronto DAs and CSDs in CD 3520.
DA_PREFIX = f'2021,"2021S0512{TORONTO_CD}'.encode()
CSD_PREFIX = f'2021,"2021A0005{TORONTO_CD}'.encode()
NAME_BYTES = [n.encode("latin-1") for n in TARGETS.values()]


def extract() -> pd.DataFrame:
    """Stream the profile once and cache the Toronto subset as a small CSV."""
    if EXTRACT.exists() and EXTRACT.stat().st_mtime > PROFILE_ZIP.stat().st_mtime:
        print(f"using cached {EXTRACT.name}")
    else:
        print(f"streaming {PROFILE_CSV} (several minutes) ...")
        kept, total = [], 0
        with zipfile.ZipFile(PROFILE_ZIP) as z, z.open(PROFILE_CSV) as f:
            header = f.readline().decode("latin-1")
            for line in f:
                total += 1
                if (line.startswith(DA_PREFIX) or line.startswith(CSD_PREFIX)) and any(
                    n in line for n in NAME_BYTES
                ):
                    kept.append(line)
        print(f"  scanned {total:,} data rows, kept {len(kept):,}")
        rows = csv.reader(io.StringIO(b"".join(kept).decode("latin-1")))
        cols = next(csv.reader([header]))
        # SYMBOL is repeated after every value column; we only need the first.
        out = [
            (r[1], r[2], r[3], r[8], r[9].strip(), r[11], r[12])
            for r in rows
            if r[9].strip() in TARGETS.values()
        ]
        assert cols[11] == "C1_COUNT_TOTAL" and cols[12] == "SYMBOL", cols
        OUT.mkdir(exist_ok=True)
        pd.DataFrame(
            out,
            columns=["DGUID", "ALT_GEO_CODE", "GEO_LEVEL", "CHARACTERISTIC_ID",
                     "CHARACTERISTIC_NAME", "C1_COUNT_TOTAL", "SYMBOL"],
        ).to_csv(EXTRACT, index=False)
    return pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)


def pivot(long: pd.DataFrame):
    print("\nmatched characteristics (CHARACTERISTIC_ID: name):")
    for key, name in TARGETS.items():
        ids = sorted(long.loc[long.CHARACTERISTIC_NAME == name, "CHARACTERISTIC_ID"].unique())
        print(f"  {key:12s} {ids}: {name!r}")
        if len(ids) != 1:
            sys.exit(f"expected exactly one CHARACTERISTIC_ID for {name!r}, got {ids}")

    # ".." / "x" / "F" / blank (and anything non-numeric) -> null
    long["value"] = pd.to_numeric(long.C1_COUNT_TOTAL.str.strip(), errors="coerce")
    key_of = {v: k for k, v in TARGETS.items()}
    long["key"] = long.CHARACTERISTIC_NAME.map(key_of)

    print("\nSYMBOL values by measure (blank = published):")
    print(long.pivot_table(index="key", columns="SYMBOL", values="value",
                           aggfunc="size", fill_value=0).to_string())

    csd = long[long.GEO_LEVEL == "Census subdivision"]
    csd_ids = sorted(csd.ALT_GEO_CODE.unique())
    print(f"\nCSDs inside CD {TORONTO_CD}: {csd_ids}")
    if csd_ids != [TORONTO_CSD]:
        sys.exit(f"CD {TORONTO_CD} is not coterminous with CSD {TORONTO_CSD}; "
                 "need a DA->CSD lookup instead of the DAUID prefix")
    city = csd.set_index("key").value

    da = long[long.GEO_LEVEL == "Dissemination area"]
    dups = da.duplicated(["ALT_GEO_CODE", "key"]).sum()
    if dups:
        sys.exit(f"{dups} duplicate DA x characteristic rows")
    wide = da.pivot(index="ALT_GEO_CODE", columns="key", values="value")
    wide.index.name = "DAUID"
    return wide[list(TARGETS)], city


def assign_neighbourhoods(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Tag each DA with the City of Toronto neighbourhood (158) covering most of it.

    DAs have no names of their own; this is context, not a DA name. When the
    dominant neighbourhood covers < 90% of the DA, the runner-up is kept too.
    """
    nb = gpd.read_file(NEIGHBOURHOODS)[["AREA_NAME", "AREA_SHORT_CODE", "geometry"]].to_crs(METRIC_CRS)
    ov = gpd.overlay(gdf[["DAUID", "geometry"]].to_crs(METRIC_CRS), nb, how="intersection", keep_geom_type=True)
    ov["area"] = ov.area
    ov["share"] = ov.area / ov.groupby("DAUID").area.transform("sum")
    ov = ov.sort_values(["DAUID", "share"], ascending=[True, False])
    first = ov.groupby("DAUID").nth(0).set_index("DAUID")
    second = ov.groupby("DAUID").nth(1).set_index("DAUID")
    out = gdf.set_index("DAUID")
    out["nbhd"] = first.AREA_NAME
    out["nbhd_id"] = first.AREA_SHORT_CODE.astype(int)
    split = first.share < 0.9
    out["nbhd2"] = second.AREA_NAME.where(split.reindex(second.index, fill_value=False))
    missing = out.nbhd.isna().sum()
    if missing:
        sys.exit(f"{missing} DAs fall in no City neighbourhood")
    print(f"\nneighbourhoods: {out.nbhd.nunique()} used; "
          f"{int((first.share >= 0.95).sum())} DAs >= 95% in one; "
          f"{int(out.nbhd2.notna().sum())} DAs < 90% (shown as 'mostly X, partly Y')")
    return out.reset_index()


def main():
    long = extract()
    wide, city = pivot(long)

    gdf = gpd.read_file(BOUNDARY, engine="pyogrio",
                        where=f"DAUID LIKE '{TORONTO_CD}%'", columns=["DAUID"])
    n = len(gdf)
    print(f"\nToronto DAs in boundary file: {n:,}  (profile DAs: {len(wide):,})")
    if abs(n - EXPECTED_DAS) > 0.1 * EXPECTED_DAS:
        sys.exit(f"DA count {n} is far from ~{EXPECTED_DAS}; stopping")
    unmatched = set(gdf.DAUID) ^ set(wide.index)
    if unmatched:
        print(f"  WARNING: {len(unmatched)} DAUIDs not in both sources: {sorted(unmatched)[:10]}")

    gdf = gdf.merge(wide, left_on="DAUID", right_index=True, how="left")
    gdf = assign_neighbourhoods(gdf)
    gdf = gdf.to_crs(4326)

    pop_da, pop_city = gdf.pop21.sum(), city["pop21"]
    print(f"population: sum of DAs {pop_da:,.0f} vs CSD {pop_city:,.0f}")

    breaks = {"classes": N_CLASSES, "method": "quantile", "measures": {}}
    for m in MEASURES:
        v = gdf[m]
        gdf[f"sup_{m}"] = v.isna()
        valid = v.dropna()
        # method="nearest" keeps every break an actual DA value
        q = np.quantile(valid, np.linspace(0, 1, N_CLASSES + 1), method="nearest")
        # share of DAs with an equal or lower value (ties take the max rank)
        gdf[f"pct_{m}"] = (v.rank(method="max", pct=True) * 100).round().clip(lower=1)
        breaks["measures"][m] = {
            "label": TARGETS[m],
            "breaks": [int(x) for x in q],
            "city_median": int(city[m]),          # official CSD 3520005 value
            "median_of_das": int(valid.median()),  # unweighted median of DA medians
            "n": int(valid.size),
            "suppressed": int(v.isna().sum()),
        }
        if len(set(q)) != len(q):
            print(f"  WARNING: duplicate breaks for {m}: {q}")

    int_cols = list(TARGETS) + [f"pct_{m}" for m in MEASURES]
    for c in int_cols:
        gdf[c] = gdf[c].astype("Int64")
    gdf = gdf.rename(columns={"DAUID": "dauid"})

    print("\nsummary (non-null values):")
    print(gdf[list(TARGETS)].describe().T[["count", "min", "25%", "50%", "75%", "max"]]
          .astype("Int64").to_string())
    print("\nsuppressed DAs per measure:")
    for m in MEASURES:
        print(f"  {m:12s} {int(gdf[f'sup_{m}'].sum()):5d}")
    print(f"  all four     {int(gdf[[f'sup_{m}' for m in MEASURES]].all(axis=1).sum()):5d}")

    OUT.mkdir(exist_ok=True)
    out = OUT / "toronto_da.geojson"
    out.unlink(missing_ok=True)
    gdf.to_file(out, driver="GeoJSON", engine="pyogrio",
                layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})
    print(f"\nwrote {out} ({out.stat().st_size / 1e6:.1f} MB, {len(gdf):,} features)")

    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "breaks.json").write_text(json.dumps(breaks, indent=2) + "\n")
    print(f"wrote {WEB / 'breaks.json'}")
    print(json.dumps(breaks["measures"], indent=2))


if __name__ == "__main__":
    main()
