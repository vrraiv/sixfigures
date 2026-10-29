"""2016 Census (income year 2015) for Toronto DAs, and the 2016<->2021 DA correspondence.

The 2016 profile CSV differs from 2021: UTF-8 with BOM, no DGUID, numeric
GEO_LEVEL, GEO_CODE (POR) = CSDUID + DA suffix (so Toronto DAs are exactly the
DA rows whose ALT_GEO_CODE starts with CSD 3520005), suppression markers inline in the
value column, and medians are not rounded. DA rows carry the 8-digit DAUID in
GEO_CODE (POR) and CSDUID + DA suffix in ALT_GEO_CODE, which pins them to CSD 3520005.
"""
import csv
import io
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

from measures import CHARS_2016, MEASURES, derive_city_shares, derive_shares, null_unpublished_2016, targets

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "out"

PROFILE_ZIP = RAW / "98-401-X2016044_ONTARIO_eng_CSV.zip"
PROFILE_CSV = "98-401-X2016044_ONTARIO_English_CSV_data.csv"
BOUNDARY = f"zip://{(RAW / 'lda_000b16a_e.zip').as_posix()}!lda_000b16a_e.shp"
CORR_ZIP = RAW / "2021_92-156-X_DALand_ADsup.zip"
CORR_CSV = "2021_92-156-X_DAland_ADsup/2021_92-156-X_DAland_ADsup.csv"
EXTRACT = OUT / "toronto_profile_2016_long.csv"

TORONTO_CSD = "3520005"
EXPECTED_DAS = 3702  # Toronto 2016 DAs referenced by the correspondence file

TARGETS = targets(CHARS_2016)  # (Member ID, name) -> key
PREFIX = b'2016,"3520'  # Toronto CD, CSD and DA rows; exact CSD filter applied after parsing
NAME_BYTES = [n.encode() for _, n in TARGETS]

# DARELFLAG in the correspondence file (direction checked against the data):
# 1 = 1:1 (same DA), 3 = several 2021 DAs from one 2016 DA (split),
# 4 = many-to-many (boundaries redrawn among several DAs).
REL_SAME, REL_SPLIT, REL_MANY = 1, 3, 4


def extract() -> pd.DataFrame:
    if EXTRACT.exists() and EXTRACT.stat().st_mtime > PROFILE_ZIP.stat().st_mtime:
        long = pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)
        # a cache from before a characteristic was added to measures.py is stale
        if set(TARGETS) <= set(zip(long.MEMBER_ID, long.NAME)):
            print(f"using cached {EXTRACT.name}")
            return long
        print(f"{EXTRACT.name} lacks some characteristics in measures.py")
    print(f"streaming {PROFILE_CSV} (several minutes) ...")
    kept, total = [], 0
    with zipfile.ZipFile(PROFILE_ZIP) as z, z.open(PROFILE_CSV) as f:
        header = f.readline().decode("utf-8-sig")
        for line in f:
            total += 1
            if line.startswith(PREFIX) and any(n in line for n in NAME_BYTES):
                kept.append(line)
    print(f"  scanned {total:,} data rows, kept {len(kept):,}")
    cols = next(csv.reader([header]))
    assert cols[1] == "GEO_CODE (POR)" and cols[11].startswith("Dim: Sex (3): Member ID: [1]: Total"), cols
    rows = csv.reader(io.StringIO(b"".join(kept).decode("utf-8")))
    out = [(r[1], r[2], r[7], r[9], r[8].strip(), r[11]) for r in rows if (r[9], r[8].strip()) in TARGETS]
    OUT.mkdir(exist_ok=True)
    pd.DataFrame(out, columns=["GEO_CODE", "GEO_LEVEL", "ALT_GEO_CODE", "MEMBER_ID", "NAME", "VALUE"]).to_csv(EXTRACT, index=False)
    return pd.read_csv(EXTRACT, dtype=str, keep_default_na=False)


def load_2016():
    """Returns (gdf of 2016 Toronto DAs with values, city-wide CSD values)."""
    long = extract()
    print("\n2016 matched characteristics (Member ID: name):")
    found = set(zip(long.MEMBER_ID, long.NAME))
    for (i, name), key in TARGETS.items():
        print(f"  {key:12s} {i:>5s}: {name[:90]!r}")
        if (i, name) not in found:
            sys.exit(f"Member ID {i} {name!r} not in the 2016 profile; check measures.py")
    long["value"] = pd.to_numeric(long.VALUE.str.strip(), errors="coerce")
    long["key"] = [TARGETS[k] for k in zip(long.MEMBER_ID, long.NAME)]
    print("non-numeric 2016 values by measure:",
          long[long.value.isna()].groupby(["key", "VALUE"]).size().to_dict())

    csd = derive_city_shares(long[long.GEO_CODE == TORONTO_CSD].set_index("key").value)
    da = long[(long.GEO_LEVEL == "4") & long.ALT_GEO_CODE.str.startswith(TORONTO_CSD)]
    if da.duplicated(["GEO_CODE", "key"]).any():
        sys.exit("duplicate 2016 DA x characteristic rows")
    wide = derive_shares(da.pivot(index="GEO_CODE", columns="key", values="value")[list(TARGETS.values())])
    wide = null_unpublished_2016(wide)
    wide.index.name = "DAUID"
    if len(wide) != EXPECTED_DAS:
        sys.exit(f"2016 DA count {len(wide)} != {EXPECTED_DAS}")

    # the where-clause field must be among the columns read, or pyogrio returns nothing
    gdf = gpd.read_file(BOUNDARY, engine="pyogrio", where=f"CSDUID = '{TORONTO_CSD}'", columns=["DAUID", "CSDUID"])[["DAUID", "geometry"]]
    if set(gdf.DAUID) != set(wide.index):
        sys.exit("2016 boundary DAs and profile DAs differ")
    gdf = gdf.merge(wide, left_on="DAUID", right_index=True)
    print(f"2016 Toronto DAs: {len(gdf):,}; population: sum of DAs {gdf.pop16.sum():,.0f} vs CSD {csd['pop16']:,.0f}")
    for m in MEASURES:
        gdf[f"pct_{m}"] = (gdf[m].rank(method="max", pct=True) * 100).round().clip(lower=1)
    print("2016 suppressed DAs per measure:", {m: int(gdf[m].isna().sum()) for m in MEASURES})
    return gdf, csd


def correspondence() -> pd.DataFrame:
    """Toronto rows of the 2021->2016 DA correspondence (with land-area share)."""
    c = pd.read_csv(zipfile.ZipFile(CORR_ZIP).open(CORR_CSV), dtype=str, encoding="latin-1")
    c.columns = ["da21", "da16", "flag", "pct", "g21", "g16"]
    c = c[c.da21.str.startswith("3520")].copy()
    c["flag"] = c.flag.astype(int)
    c["pct"] = pd.to_numeric(c.pct)
    counts = c.groupby("da21").flag.first().value_counts().sort_index().to_dict()
    print(f"\ncorrespondence: 2021 DAs by relationship flag {counts}")
    return c
