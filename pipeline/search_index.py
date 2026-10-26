"""Build web/public/search.json: an offline address + intersection -> DA lookup.

Sources (City of Toronto Open Data, Open Government Licence - Toronto):
  - Address Points (Municipal) - Toronto One Address Repository
  - Centreline Intersection file
Each official address point is placed in a 2021 DA by point-in-polygon against
the StatCan DA boundaries, so the browser never geocodes: it only looks up
exact official addresses. Intersections keep every DA within SNAP_M metres,
because most intersections sit on DA boundaries (DAs are bounded by streets).

Layout (compact JSON, decoded by web/src/search.js):
  das:     [[dauid, west, south, east, north, x, y], ...]  bbox + interior point
  munis:   former-municipality names
  streets: [[name, nums, da_rle, muni_rle], ...]          one row per street name
           nums   = "1,3,5A,11-19"  official number tokens, sorted
           *_rle  = "idx" or "idx*count" runs, ";"-separated, aligned with nums
  names:   extra street names that only occur in intersections
  x:       [[street_ids ".", lon*1e5, lat*1e5, da_ids "."], ...]
           street_ids index streets first, then names (len(streets) + i)
"""
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE.parent / "web" / "public" / "search.json"
BOUNDARY = f"zip://{(RAW / 'lda_000b21a_e.zip').as_posix()}!lda_000b21a_e.shp"
ADDRESSES = RAW / "toronto_address_points_4326.csv"
INTERSECTIONS = RAW / "toronto_intersections_4326.csv"
METRIC_CRS = 2952
SNAP_M = 15  # an intersection "touches" every DA within this distance
SKIP_CLASSES = {"Pseudo Intersection-Overpass/Underpass"}


def rle(values) -> str:
    runs, prev, n = [], None, 0
    for v in values:
        if v == prev:
            n += 1
            continue
        if prev is not None:
            runs.append(f"{prev}*{n}" if n > 1 else str(prev))
        prev, n = v, 1
    if prev is not None:
        runs.append(f"{prev}*{n}" if n > 1 else str(prev))
    return ";".join(runs)


def number_key(tok: str):
    m = re.match(r"(\d+)(.*)", tok)
    return (int(m.group(1)), m.group(2))


def load_das() -> gpd.GeoDataFrame:
    da = gpd.read_file(BOUNDARY, engine="pyogrio", where="DAUID LIKE '3520%'", columns=["DAUID"])
    return da.to_crs(METRIC_CRS).sort_values("DAUID").reset_index(drop=True)


def main():
    da = load_das()
    da_idx = {d: i for i, d in enumerate(da.DAUID)}
    da_ll = da.to_crs(4326)
    bounds = da_ll.bounds.round(5)
    rep = da.representative_point().to_crs(4326)  # inside the polygon, for popups
    das = [[d, *b, round(p.x, 5), round(p.y, 5)]
           for d, b, p in zip(da.DAUID, bounds.itertuples(index=False), rep)]

    # ---- addresses ----
    a = pd.read_csv(ADDRESSES, dtype=str, usecols=[
        "ADDRESS_NUMBER", "LINEAR_NAME_FULL", "ADDRESS_FULL", "MUNICIPALITY_NAME", "ADDRESS_CLASS_DESC", "geometry"])
    n_points = len(a)
    xy = a.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0])
    pts = gpd.GeoDataFrame(a, geometry=gpd.points_from_xy(xy.str[0], xy.str[1]), crs=4326).to_crs(METRIC_CRS)
    j = gpd.sjoin(pts, da, predicate="within", how="inner").drop(columns=["geometry", "index_right"])
    print(f"address points: {n_points:,}; inside a Toronto DA: {len(j):,}")
    # One record per (address, former municipality, DA). The same string in two
    # former municipalities stays as two records (the user picks one); the rare
    # same-municipality split keeps every DA as a candidate.
    j = j.drop_duplicates(["ADDRESS_FULL", "MUNICIPALITY_NAME", "DAUID"])
    split = j.duplicated(["ADDRESS_FULL", "MUNICIPALITY_NAME"], keep=False)
    print(f"address records: {len(j):,} ({j.ADDRESS_FULL.nunique():,} distinct strings); "
          f"same-municipality multi-DA addresses: {j[split].ADDRESS_FULL.nunique()}")
    munis = sorted(j.MUNICIPALITY_NAME.dropna().unique())
    muni_idx = {m: i for i, m in enumerate(munis)}
    j["k"] = j.ADDRESS_NUMBER.map(number_key)
    j = j.sort_values(["LINEAR_NAME_FULL", "k", "MUNICIPALITY_NAME", "DAUID"])
    streets = []
    for name, g in j.groupby("LINEAR_NAME_FULL", sort=True):
        streets.append([
            name,
            ",".join(g.ADDRESS_NUMBER),
            rle(g.DAUID.map(da_idx)),
            rle(g.MUNICIPALITY_NAME.map(muni_idx).fillna(-1).astype(int)),
        ])
    street_idx = {s[0]: i for i, s in enumerate(streets)}

    # ---- intersections ----
    it = pd.read_csv(INTERSECTIONS, usecols=["INTERSECTION_DESC", "CLASSIFICATION_DESC", "geometry"])
    it = it[~it.CLASSIFICATION_DESC.isin(SKIP_CLASSES) & it.INTERSECTION_DESC.notna()]
    parts = it.INTERSECTION_DESC.map(
        lambda d: sorted({p.strip() for p in d.split("/") if p.strip() and not p.strip()[0].isdigit()}))
    it = it[parts.map(len) >= 2].assign(parts=parts)
    names = sorted({p for ps in it.parts for p in ps} - set(street_idx))
    name_idx = {n: len(streets) + i for i, n in enumerate(names)}
    ids = {**street_idx, **name_idx}
    geom = [shape(json.loads(g)).representative_point() for g in it.geometry]
    ig = gpd.GeoDataFrame(it.drop(columns="geometry"), geometry=geom, crs=4326).to_crs(METRIC_CRS)
    near = gpd.sjoin(ig.assign(geometry=ig.buffer(SNAP_M)), da, predicate="intersects", how="left")
    cand = near.groupby(level=0).DAUID.apply(lambda s: sorted(da_idx[d] for d in s.dropna()))
    ig["das"] = cand
    ig = ig[ig.das.map(len) > 0]
    ll = ig.to_crs(4326).geometry
    x = [[".".join(str(ids[p]) for p in ps), round(pt.x * 1e5), round(pt.y * 1e5), ".".join(map(str, ds))]
         for ps, pt, ds in zip(ig.parts, ll, ig.das)]
    single = sum(1 for e in x if "." not in e[3])
    print(f"intersections kept: {len(x):,}; inside one DA: {single:,}; "
          f"on a boundary (>1 DA within {SNAP_M} m): {len(x) - single:,}")

    doc = {"v": 1, "das": das, "munis": munis, "streets": streets, "names": names, "x": x}
    OUT.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")

    # Round-trip sample for web/src/search.test.mjs: real points -> expected DA.
    sample = j.sample(20000, random_state=7)
    (HERE / "out").mkdir(exist_ok=True)
    (HERE / "out" / "search_sample.json").write_text(json.dumps(
        [[r.ADDRESS_FULL, r.MUNICIPALITY_NAME, r.DAUID] for r in sample.itertuples()]), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
