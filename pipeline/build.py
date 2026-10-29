"""Build Toronto DA income GeoJSON + breaks.json from raw StatCan downloads.

Steps
  1. Stream the Ontario Census Profile CSV (8.8 GB, inside the zip) and keep
     only Toronto rows (CD 3520) for the characteristics in measures.py.
  2. Pivot to one row per DA; compute the shares (renters, shelter costs). A
     suppressed value is null, and so absent from the tiles (no flag needed).
  3. Join to DA cartographic boundaries, reproject to EPSG:4326.
  4. Quantile breaks, city-wide medians and percentile ranks.
  5. Tag each DA with its City of Toronto neighbourhood (DAs have no names).
  6. Load the 2016 Census (census2016.py); give boundary-identical 2021 DAs their
     2016 values and percentiles; pooled 2016+2021 breaks and change breaks.
  7. CPI factor and histograms for the popup charts (distributions.py); CSV
     downloads (exports.py).
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

import census2016
from distributions import add_distributions
from exports import write_csvs
from measures import CHARS_2021, MEASURES, MONEY, derive_city_shares, derive_shares, label, targets

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

TARGETS = targets(CHARS_2021)  # (CHARACTERISTIC_ID, CHARACTERISTIC_NAME) -> key
N_CLASSES = 6

# Row prefixes (CENSUS_YEAR,"DGUID...) for Toronto DAs and CSDs in CD 3520.
DA_PREFIX = f'2021,"2021S0512{TORONTO_CD}'.encode()
CSD_PREFIX = f'2021,"2021A0005{TORONTO_CD}'.encode()
NAME_BYTES = [n.encode("latin-1") for _, n in TARGETS]


def extract() -> pd.DataFrame:
    """Stream the profile once and cache the Toronto subset as a small CSV."""
    if EXTRACT.exists() and EXTRACT.stat().st_mtime > PROFILE_ZIP.stat().st_mtime:
        long = pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)
        # a cache from before a characteristic was added to measures.py is stale
        if set(TARGETS) <= set(zip(long.CHARACTERISTIC_ID, long.CHARACTERISTIC_NAME)):
            print(f"using cached {EXTRACT.name}")
            return long
        print(f"{EXTRACT.name} lacks some characteristics in measures.py")
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
        if (r[8], r[9].strip()) in TARGETS
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
    found = set(zip(long.CHARACTERISTIC_ID, long.CHARACTERISTIC_NAME))
    for (i, name), key in TARGETS.items():
        print(f"  {key:12s} {i:>5s}: {name[:90]!r}")
        if (i, name) not in found:
            sys.exit(f"characteristic {i} {name!r} not in the profile; check measures.py")

    # ".." / "x" / "F" / blank (and anything non-numeric) -> null
    long["value"] = pd.to_numeric(long.C1_COUNT_TOTAL.str.strip(), errors="coerce")
    long["key"] = [TARGETS[k] for k in zip(long.CHARACTERISTIC_ID, long.CHARACTERISTIC_NAME)]

    print("\nSYMBOL values by measure (blank = published):")
    print(long.pivot_table(index="key", columns="SYMBOL", values="value",
                           aggfunc="size", fill_value=0).to_string())

    csd = long[long.GEO_LEVEL == "Census subdivision"]
    csd_ids = sorted(csd.ALT_GEO_CODE.unique())
    print(f"\nCSDs inside CD {TORONTO_CD}: {csd_ids}")
    if csd_ids != [TORONTO_CSD]:
        sys.exit(f"CD {TORONTO_CD} is not coterminous with CSD {TORONTO_CSD}; "
                 "need a DA->CSD lookup instead of the DAUID prefix")
    city = derive_city_shares(csd.set_index("key").value)

    da = long[long.GEO_LEVEL == "Dissemination area"]
    dups = da.duplicated(["ALT_GEO_CODE", "key"]).sum()
    if dups:
        sys.exit(f"{dups} duplicate DA x characteristic rows")
    wide = da.pivot(index="ALT_GEO_CODE", columns="key", values="value")
    wide.index.name = "DAUID"
    return derive_shares(wide[list(TARGETS.values())]), city


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



# Change classes (2016 -> 2021) are in measures.py, in dollars or percentage
# points. The middle class is "little or no change": 2021 medians are rounded
# (to $1,000 above $80,000) while 2016 medians are not, so small differences
# are noise. Percentile-rank change classes are shared by every measure.
POINTS_BREAKS = [-20, -10, -3, 3, 10, 20]


def class_breaks(v: pd.Series) -> tuple[np.ndarray, bool]:
    """[min, q1/6 ... q5/6, max] over the pooled DA values. When a sixth or more
    of DAs are exactly 0 (no condos, no new dwellings), quantiles would repeat 0:
    then the first class is 0 alone and the other five split the positive values
    ([0, smallest positive, q1/5 ... q4/5, max]). method="nearest" keeps every
    break an actual DA value."""
    if (v == 0).mean() >= 1 / N_CLASSES:
        q = np.quantile(v[v > 0], np.linspace(0, 1, N_CLASSES), method="nearest")
        q, zero_class = np.concatenate([[0], q]), True
    else:
        q, zero_class = np.quantile(v, np.linspace(0, 1, N_CLASSES + 1), method="nearest"), False
    if len(set(q)) != len(q):
        print(f"  WARNING: duplicate breaks: {q}")
    return q, zero_class


def write_geojson(gdf: gpd.GeoDataFrame, path: Path):
    path.unlink(missing_ok=True)
    gdf.to_file(path, driver="GeoJSON", engine="pyogrio",
                layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB, {len(gdf):,} features)")


def year_stats(v: pd.Series, city_value, unit: str) -> dict:
    valid = v.dropna()
    num = int if unit == "money" else lambda x: round(float(x), 1)
    return {
        "city": num(city_value),                # official CSD 3520005 value
        "median_of_das": num(valid.median()),   # unweighted median of DA values
        "n": int(valid.size),
        "suppressed": int(v.isna().sum()),
    }


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
    for m in MEASURES:
        # share of DAs with an equal or lower value (ties take the max rank)
        gdf[f"pct_{m}"] = (gdf[m].rank(method="max", pct=True) * 100).round().clip(lower=1)

    # ---- 2016 Census (income year 2015) ----
    g16, city16 = census2016.load_2016()
    g16 = assign_neighbourhoods(g16).to_crs(4326)
    corr = census2016.correspondence()
    rel = corr.groupby("da21").flag.first()
    gdf["rel"] = gdf.DAUID.map(rel).astype(int)
    same = gdf.rel == census2016.REL_SAME
    by16 = g16.set_index("DAUID")
    for m in MEASURES:
        # Only boundary-identical DAs carry 2016 figures; the browser computes
        # the change from these, so no change is ever shown across a redraw.
        gdf[f"v16_{m}"] = gdf.DAUID.where(same).map(by16[m])
        gdf[f"p16_{m}"] = gdf.DAUID.where(same).map(by16[f"pct_{m}"])
    # 2016 DA unchanged in 2021 (1) or redrawn (0)
    g16["rel"] = g16.DAUID.isin(corr.loc[corr.flag == census2016.REL_SAME, "da16"]).astype(int)

    breaks = {"classes": N_CLASSES, "method": "quantile, pooled 2016+2021", "measures": {}}
    print("\nclass counts under pooled breaks, and change summary:")
    comparables = {}
    for m in MEASURES:
        q, zero_class = class_breaks(pd.concat([gdf[m], g16[m]]).dropna())
        comparable = same & gdf[m].notna() & gdf[f"v16_{m}"].notna()
        comparables[m] = comparable
        d = (gdf[m] - gdf[f"v16_{m}"])[comparable]
        dp = (gdf[f"pct_{m}"] - gdf[f"p16_{m}"])[comparable]
        unit = MEASURES[m]["unit"]
        num = int if unit == "money" else lambda x: round(float(x), 1)
        cb_d, cb_p = MEASURES[m]["change"], POINTS_BREAKS
        breaks["measures"][m] = {
            "unit": unit,
            "label": label(CHARS_2021, m),
            "label_2016": label(census2016.CHARS_2016, m),
            "breaks": [num(x) for x in q],
            **({"zero_class": True} if zero_class else {}),
            "y2021": year_stats(gdf[m], city[m], unit),
            "y2016": year_stats(g16[m], city16[m], unit),
            "change": {
                "value": cb_d,
                "points": cb_p,
                "comparable": int(comparable.sum()),
                "boundary_changed": int((~same).sum()),
                "not_published": int((same & ~comparable).sum()),
                "median_value": num(d.median()),
                "median_points": int(dp.median()),
            },
        }
        counts = lambda v: np.bincount(np.digitize(v.dropna(), q[1:-1]), minlength=6).tolist()
        print(f"  {m:12s} 2016 {counts(g16[m])}  2021 {counts(gdf[m])}")
        print(f"  {'':12s} change $ classes {np.bincount(np.digitize(d, cb_d), minlength=7).tolist()}"
              f"  pts classes {np.bincount(np.digitize(dp, cb_p), minlength=7).tolist()}"
              f"  comparable {int(comparable.sum())}, boundary changed {int((~same).sum())},"
              f" not published {int((same & ~comparable).sum())}")
    add_distributions(breaks, gdf, g16, comparables)

    # Rates stay floats with one decimal; everything else is a whole number.
    int21 = ["pop21", "hh"] + [f"{p}_{m}" for m in MEASURES for p in ("pct", "p16")] + MONEY + [f"v16_{m}" for m in MONEY]
    for c in int21:
        gdf[c] = gdf[c].astype("Int64")
    for c in ["pop16", "hh"] + [f"pct_{m}" for m in MEASURES] + MONEY:
        g16[c] = g16[c].astype("Int64")
    gdf = gdf.rename(columns={"DAUID": "dauid"})
    g16 = g16.rename(columns={"DAUID": "dauid"})

    print("\n2021 summary (non-null values):")
    print(gdf[["pop21", "hh", *MEASURES]].astype(float).describe().T[["count", "min", "25%", "50%", "75%", "max"]]
          .round(1).to_string())
    print("\n2021 suppressed DAs per measure:")
    for m in MEASURES:
        print(f"  {m:12s} {int(gdf[m].isna().sum()):5d}")
    print(f"  all          {int(gdf[list(MEASURES)].isna().all(axis=1).sum()):5d}")

    OUT.mkdir(exist_ok=True)
    write_geojson(gdf, OUT / "toronto_da.geojson")
    write_geojson(g16, OUT / "toronto_da_2016.geojson")

    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "breaks.json").write_text(json.dumps(breaks, indent=2) + "\n")
    print(f"wrote {WEB / 'breaks.json'}")
    write_csvs(gdf, g16)


if __name__ == "__main__":
    main()
