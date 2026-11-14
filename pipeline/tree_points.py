"""Trees seen from the air: how tall they are and whose land they stand on.

    python pipeline/tree_points.py          # make tree-points

Reads the City's "Topographic Mapping - Physical location of trees"
(pipeline/raw/toronto_topo_trees.zip, download.py): one point for each tree its
software finds in aerial laser scanning (LiDAR), on public and private land alike,
with a height (DERIVED_HE, metres) and, where the land has a public owner, who
(DERIVED_OW). Writes pipeline/treepoints/, which is committed:

  by_nbhd.csv   nbhd_id, points, area_ha, per_ha, height_median, tall_share (points
                TALL metres or taller), public_share, and the points in each owner
                group (road, parks, conservation, other_public, unlisted)
  city.csv      band (height, metres), and the points in each owner group
  manifest.json the file read, when the City last replaced it, the points' own dates,
                the points left out and the checks

What the file is, and isn't (14 November 2026: 1,249,665 points).
  - Not a count of trees. It finds crowns that stand out from above, and misses small
    trees and those beside tall buildings: in the Yonge-Bay Corridor it has 3.6 points a
    hectare where the City's street-tree inventory alone has 9.0. Across neighbourhoods
    its points per hectare track the 2018 canopy (Spearman 0.95), so it measures much
    the same thing as canopy does. What it adds is height and ownership.
  - One extraction. Every point's geometry date is January or May 2021; the portal
    replaces the file quarterly, but its contents have not moved. The readme doesn't say
    when the LiDAR was flown, and calls the method "in development". The refresh reruns
    this script each quarter and changes nothing until the City issues a new extraction;
    the manifest's `points_dated` then shows it.
  - Ownership. DERIVED_OW is filled for 41% of points. The readme calls it "derived
    ownership" and says no more; a point without one is taken here as on land with no
    public owner listed (private land, for the most part), and the page says "no public
    owner listed", not "private".

Owner groups (OWNERS, by what the text holds, first match): road (any owner's
"Corridor": road allowances and highways), conservation (the Toronto & Region
Conservation Authority's land, the Zoo included), parks (any owner's "Parks, Forestry &
Recreation"), other_public (every other owner named), unlisted.

Heights under MIN_M or over MAX_M metres are left out as not trees (a pole, a crane, a
bird): the manifest counts them. Points are placed in neighbourhoods by places.place.
"""
import json
import sys
import urllib.request
from pathlib import Path

import geopandas as gpd
import pandas as pd

from places import da_polygons, place

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "treepoints"
SRC = RAW / "toronto_topo_trees.zip"
PACKAGE = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=topographic-mapping-physical-location-of-trees"
TALL = 15  # metres: about a five-storey building, and near the top third of the points
MIN_M, MAX_M = 2, 50
BANDS = [2, 5, 10, 15, 20, 25, 30, 50]
OWNERS = [("road", "corridor"), ("conservation", "conservation authority"), ("parks", "parks, forestry"), ("other_public", "")]
GROUPS = [*(k for k, _ in OWNERS), "unlisted"]


def owner_group(text) -> str:
    if text is None or pd.isna(text) or not str(text).strip():
        return "unlisted"
    t = str(text).lower()
    return next(k for k, needle in OWNERS if needle in t)


def band(h: float) -> str:
    lo = max(b for b in BANDS[:-1] if h >= b)
    hi = BANDS[BANDS.index(lo) + 1]
    return f"{lo} to {hi} m" if hi < BANDS[-1] else f"{lo} m or more"


def refreshed() -> str | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(PACKAGE, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
            return json.load(r)["result"]["last_refreshed"][:10]
    except Exception:
        return None


def main() -> int:
    if not SRC.exists():
        sys.exit(f"{SRC} is missing: python pipeline/download.py --toronto {SRC.name}")
    g = gpd.read_file(f"zip://{SRC.as_posix()}!TOPO_TREE_WGS84.shp", columns=["DERIVED_HE", "DERIVED_OW", "LAST_GEOME"])
    need = {"DERIVED_HE", "DERIVED_OW", "LAST_GEOME"} - set(g.columns)
    if need:
        sys.exit(f"{SRC.name} has no {sorted(need)}: the City has changed the file's layout")
    total = len(g)
    if total < 500_000:
        sys.exit(f"only {total:,} tree points in {SRC.name}")
    dated = g.LAST_GEOME.astype(str).str[:4].add("-").add(g.LAST_GEOME.astype(str).str[4:6]).value_counts().sort_index()
    h = pd.to_numeric(g.DERIVED_HE, errors="coerce")
    ok = h.between(MIN_M, MAX_M)
    left_out = {"no_height": int(h.isna().sum()), f"under_{MIN_M}_m": int((h < MIN_M).sum()), f"over_{MAX_M}_m": int((h > MAX_M).sum())}
    t = pd.DataFrame({"lon": g.geometry.x, "lat": g.geometry.y, "h": h, "group": g.DERIVED_OW.map(owner_group)})[ok]
    t = place(t)
    outside = int(t.nbhd_id.isna().sum())
    t = t[t.nbhd_id.notna()].assign(nbhd_id=lambda d: d.nbhd_id.astype(int))
    if len(t) < 0.98 * total:
        sys.exit(f"only {len(t):,} of {total:,} points are trees in a neighbourhood")

    das = da_polygons()
    area = das.assign(ha=das.geometry.area / 1e4).groupby("nbhd_id").ha.sum()
    by = t.groupby("nbhd_id")
    n = pd.DataFrame({"points": by.size(), "height_median": by.h.median().round(2),
                      "tall_share": by.h.apply(lambda s: (s >= TALL).mean()).round(4)})
    counts = t.pivot_table(index="nbhd_id", columns="group", values="h", aggfunc="size", fill_value=0).reindex(columns=GROUPS, fill_value=0)
    n = n.join(counts)
    n["area_ha"] = area.reindex(n.index).round(1)
    n["per_ha"] = (n.points / n.area_ha).round(2)
    n["public_share"] = (1 - n.unlisted / n.points).round(4)
    if len(n) != 158:
        sys.exit(f"{len(n)} neighbourhoods have tree points, not 158")
    cols = ["points", "area_ha", "per_ha", "height_median", "tall_share", "public_share", *GROUPS]
    OUT.mkdir(exist_ok=True)
    n[cols].reset_index().to_csv(OUT / "by_nbhd.csv", index=False, lineterminator="\n")
    order = [band(b) for b in BANDS[:-1]]
    city = (t.assign(band=t.h.map(band)).pivot_table(index="band", columns="group", values="h", aggfunc="size", fill_value=0)
            .reindex(index=order, columns=GROUPS, fill_value=0))
    city.reset_index().to_csv(OUT / "city.csv", index=False, lineterminator="\n")

    share = t.group.value_counts(normalize=True).reindex(GROUPS).round(4)
    manifest = {
        "built": pd.Timestamp.today().date().isoformat(),
        "file": {"name": SRC.name, "bytes": SRC.stat().st_size, "replaced_by_the_city": refreshed()},
        "points": total, "points_dated": {k: int(v) for k, v in dated.items()},
        "left_out": {**left_out, "outside_the_neighbourhoods": outside}, "kept": int(len(t)),
        "tall_m": TALL, "height_median_m": round(float(t.h.median()), 2), "tall_share": round(float((t.h >= TALL).mean()), 4),
        "owner_share": {k: float(v) for k, v in share.items()},
        "height_median_by_owner_m": {k: round(float(v), 2) for k, v in t.groupby("group").h.median().reindex(GROUPS).items()},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {OUT}: {len(t):,} of {total:,} points kept (dated {', '.join(dated.index)}); median height {manifest['height_median_m']} m, "
          f"{manifest['tall_share']:.1%} at {TALL} m or more; no public owner listed for {share['unlisted']:.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
