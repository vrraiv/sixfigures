"""2011 Census for Toronto DAs: pipeline/out/toronto_da_2011_geom.geojson (the
tiles' geometry, DA numbers only), web/public/data/figures/2011/ (the figures the
page joins to them), web/public/breaks_2011.json and
web/public/data/toronto_da_income_2011.csv.

    python pipeline/census2011.py

The 2011 profile (98-316-XWE2011001, dissemination areas, one CSV per province)
has no characteristic IDs or DGUIDs: Geo_Code is the 8-digit DAUID, rows are
matched by (Topic, Characteristic) with the indent stripped, Flag_total carries
the suppression markers (x, F, ...), and Total is the count. It holds only the
100% (short-form) data; the long form was the voluntary National Household
Survey that year, whose DA figures StatCan published only as a Beyond 20/20
table (NHSprofile_Can_PR_CD_CSD_DA.IVT, in pipeline/raw).

Colour classes come from web/public/breaks.json, the pooled 2016+2021 quantiles,
so a colour means the same value on the 2011 page as on the main map. The
2016<->2011 correspondence file flags each 2011 DA kept unchanged in 2016 (`rel`).
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

from build import assign_neighbourhoods
from distributions import histogram
from exports import PLACE, _ints
from figures import GEOMETRY, write_year
from measures import AGE_SUMS_2011, CHARS_2011, MEASURES, SHARES, SHARES_2011, derive_shares, label

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "out"
WEB = HERE.parent / "web" / "public"

PROFILE_CSV = RAW / "98-316-XWE2011001-1501-ONT.csv"  # unzipped from 98-316-XWE2011001-1501.zip (Deflate64)
BOUNDARY = f"zip://{(RAW / 'gda_000b11a_e.zip').as_posix()}!gda_000b11a_e.shp"
CORR_ZIP = RAW / "2016_92-156_DALand_ADsup_csv.zip"
CORR_CSV = "2016_92-156_DAland_ADsup.csv"
EXTRACT = OUT / "toronto_profile_2011_long.csv"

TORONTO_CSD = "3520005"
EXPECTED_DAS = 3685
PREFIX = b"3520"  # Toronto CD = CSD (checked against the boundary file)
TARGETS = {(t, c): k for k, (t, c) in CHARS_2011.items()}
NAME_BYTES = [c.encode("latin-1") for _, c in TARGETS]
# Shares the 2011 profile supports (counts for the rest are NHS, not here).
SHARES_ALL = {**SHARES_2011, **{m: s for m, s in SHARES.items() if s[0] in CHARS_2011}}
REL_SAME = 1


def extract() -> pd.DataFrame:
    if EXTRACT.exists() and EXTRACT.stat().st_mtime > PROFILE_CSV.stat().st_mtime:
        long = pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)
        if set(TARGETS) <= set(zip(long.TOPIC, long.NAME)):
            print(f"using cached {EXTRACT.name}")
            return long
        print(f"{EXTRACT.name} lacks some characteristics in measures.py")
    print(f"streaming {PROFILE_CSV.name} (a minute or two) ...")
    kept, total = [], 0
    with open(PROFILE_CSV, "rb") as f:
        header = f.readline().decode("latin-1")
        for line in f:
            total += 1
            if line.startswith(PREFIX) and any(n in line for n in NAME_BYTES):
                kept.append(line)
    print(f"  scanned {total:,} data rows, kept {len(kept):,}")
    cols = next(csv.reader([header.strip()]))
    assert cols[:8] == ["Geo_Code", "Prov_name", "Geo_nom", "Topic", "Characteristic", "Note", "Total", "Flag_total"], cols
    rows = csv.reader(io.StringIO(b"".join(kept).decode("latin-1")))
    out = [(r[0], r[3], r[4].strip(), r[6], r[7]) for r in rows if (r[3], r[4].strip()) in TARGETS]
    OUT.mkdir(exist_ok=True)
    pd.DataFrame(out, columns=["DAUID", "TOPIC", "NAME", "TOTAL", "FLAG"]).to_csv(EXTRACT, index=False)
    return pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)


def load_2011():
    """Returns (gdf of 2011 Toronto DAs with values, city-wide values)."""
    long = extract()
    print("\n2011 matched characteristics (Topic: name):")
    found = set(zip(long.TOPIC, long.NAME))
    for (t, c), key in TARGETS.items():
        print(f"  {key:12s} {t[:28]}: {c!r}")
        if (t, c) not in found:
            sys.exit(f"{t!r} / {c!r} not in the 2011 profile; check measures.py")
    long["value"] = pd.to_numeric(long.TOTAL.str.strip(), errors="coerce")
    long["key"] = [TARGETS[k] for k in zip(long.TOPIC, long.NAME)]
    print("2011 flags by measure:", long[long.FLAG.str.strip() != ""].groupby(["key", "FLAG"]).size().to_dict())
    if long.duplicated(["DAUID", "key"]).any():
        sys.exit("duplicate 2011 DA x characteristic rows")
    wide = long.pivot(index="DAUID", columns="key", values="value")[list(TARGETS.values())]
    for total, parts in AGE_SUMS_2011.items():
        wide[total] = wide[parts].sum(axis=1, min_count=len(parts))
    # City-wide shares from the DA counts (100% data: exact but for random rounding).
    city = derive_shares(wide.sum(min_count=1).to_frame().T, SHARES_ALL).iloc[0]
    wide = derive_shares(wide, SHARES_ALL)
    if len(wide) != EXPECTED_DAS:
        sys.exit(f"2011 DA count {len(wide)} != {EXPECTED_DAS}")

    gdf = gpd.read_file(BOUNDARY, engine="pyogrio", where=f"CSDUID = '{TORONTO_CSD}'", columns=["DAUID", "CSDUID"])[["DAUID", "geometry"]]
    if set(gdf.DAUID) != set(wide.index):
        sys.exit("2011 boundary DAs and profile DAs differ")
    gdf = gdf.merge(wide, left_on="DAUID", right_index=True)
    print(f"2011 Toronto DAs: {len(gdf):,}; population: sum of DAs {gdf.pop11.sum():,.0f}")
    return gdf, city


def correspondence() -> pd.DataFrame:
    """Toronto rows of the 2016->2011 DA correspondence (with land-area share)."""
    c = pd.read_csv(zipfile.ZipFile(CORR_ZIP).open(CORR_CSV), dtype=str, encoding="latin-1")
    c.columns = ["da16", "da11", "flag", "pct"]
    c = c[c.da16.str.startswith("3520")].copy()
    c["flag"] = c.flag.astype(int)
    counts = c.groupby("da16").flag.first().value_counts().sort_index().to_dict()
    print(f"\ncorrespondence: 2016 DAs by relationship flag {counts}")
    return c


def main():
    gdf, city = load_2011()
    gdf = assign_neighbourhoods(gdf).to_crs(4326)
    corr = correspondence()
    # 2011 DA unchanged in 2016 (1) or redrawn (0)
    gdf["rel"] = gdf.DAUID.isin(corr.loc[corr.flag == REL_SAME, "da11"]).astype(int)
    measures = [m for m in MEASURES if m in gdf]
    for m in measures:
        gdf[f"pct_{m}"] = (gdf[m].rank(method="max", pct=True) * 100).round().clip(lower=1)
    print("2011 suppressed DAs per measure:", {m: int(gdf[m].isna().sum()) for m in measures})

    main_breaks = json.loads((WEB / "breaks.json").read_text())["measures"]
    breaks = {"classes": 6, "method": "quantile, pooled 2016+2021 (breaks.json)", "measures": {}}
    for m in measures:
        b = main_breaks[m]
        h = b["hist"]["2021"]
        v = gdf[m].dropna()
        breaks["measures"][m] = {
            "unit": b["unit"],
            "label": SHARES_ALL[m][2] if m in SHARES_ALL else label(CHARS_2011, m),
            "breaks": b["breaks"],
            **({"zero_class": True} if b.get("zero_class") else {}),
            "y2011": {"city": round(float(city[m]), 1), "median_of_das": round(float(v.median()), 1),
                      "n": int(v.size), "suppressed": int(gdf[m].isna().sum())},
            "hist": {"2011": histogram(gdf[m], h["width"], lo=h["lo"], hi=h["lo"] + h["width"] * len(h["counts"]))},
        }
        print(f"  {m:12s} city {city[m]:.1f}  DAs {v.size}")

    for c in ["pop11", "hh"] + [f"pct_{m}" for m in measures]:
        gdf[c] = gdf[c].astype("Int64")
    gdf = gdf.rename(columns={"DAUID": "dauid"})
    OUT.mkdir(exist_ok=True)
    path = OUT / "toronto_da_2011_geom.geojson"
    path.unlink(missing_ok=True)
    gdf[GEOMETRY].to_file(path, driver="GeoJSON", engine="pyogrio", layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB, {len(gdf):,} features)")
    write_year("2011", gdf, measures)
    (WEB / "breaks_2011.json").write_text(json.dumps(breaks, indent=2) + "\n")
    print(f"wrote {WEB / 'breaks_2011.json'}")

    d11 = gdf[PLACE + ["pop11", "hh"]].copy()
    d11["same_boundary_2016"] = gdf["rel"].astype(int)
    for m in measures:
        d11[f"{m}_2011"] = gdf[m]
        d11[f"{m}_2011_pctl"] = gdf[f"pct_{m}"]
    csv_path = WEB / "data" / "toronto_da_income_2011.csv"
    _ints(d11.sort_values("dauid")).to_csv(csv_path, index=False, lineterminator="\n")
    print(f"wrote {csv_path} ({csv_path.stat().st_size / 1e3:.0f} kB, {len(d11):,} rows)")


if __name__ == "__main__":
    main()
