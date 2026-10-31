"""The School Insights page's figures: web/public/schools.json.

    python pipeline/school_insights.py

Reads what pipeline/schools.py writes (pipeline/schools/schools.csv, by_nbhd.csv
and manifest.json), the neighbourhood names in insights.json and the
neighbourhood boundaries, and writes:

  years, preliminary  the test years and the preliminary one (2024)
  city                the City's score and six results each year: the means over
                      the scored schools weighted by enrolment, as schools.py
                      computes score_vs_city; the score matches the manifest's
  nbhd                the 158 neighbourhoods in insights.json's order: id, name
                      and an SVG path (simplified to about 40 m, in a 1000-wide
                      box, north up)
  by_nbhd             each method's score and six results by year, in that order
                      (inside also its school count)
  schools             the scored schools (English public and Catholic elementary,
                      no special condition) with a result in some test year:
                      number, name, type, neighbourhood index and map position at
                      its latest coordinates, and by year its enrolment, six
                      results and demographic shares (null where it has none)

Numbers are rounded to one decimal.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
SCHOOLS = HERE / "schools"
WEB = HERE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
NEIGHBOURHOODS = HERE / "raw" / "toronto_neighbourhoods_4326.geojson"
OUT = WEB / "schools.json"
METRIC_CRS = 2952
TESTS = ["g3_read", "g3_write", "g3_math", "g6_read", "g6_write", "g6_math"]
DEMOGRAPHICS = ["low_income", "no_degree", "not_english", "new_canada", "special_ed", "gifted"]
TYPES = ["Public", "Catholic"]
WIDTH = 1000
SIMPLIFY = 40  # metres


def r1(v):
    """One decimal, null for missing; whole numbers as integers."""
    if v is None or pd.isna(v):
        return None
    v = round(float(v), 1)
    return int(v) if v.is_integer() else v


def weighted(g: pd.DataFrame, c: str) -> float:
    ok = g[c].notna() & g.enrolment.notna()
    return float(np.average(g.loc[ok, c], weights=g.loc[ok, "enrolment"]))


def paths(ids: list[int]) -> tuple[list[str], dict]:
    """Each neighbourhood's outline as SVG path data, and the box's projection."""
    g = gpd.read_file(NEIGHBOURHOODS)
    g["nbhd_id"] = g.AREA_SHORT_CODE.astype(int)
    g = g.set_index("nbhd_id").loc[ids].to_crs(METRIC_CRS)
    g["geometry"] = g.geometry.simplify(SIMPLIFY, preserve_topology=True)
    x0, y0, x1, y1 = g.total_bounds
    k = WIDTH / (x1 - x0)
    height = round((y1 - y0) * k)

    def ring(coords) -> str:
        pts = [(round((x - x0) * k), round((y1 - y) * k)) for x, y in coords]
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        return "M" + "L".join(f"{x} {y}" for x, y in pts[:-1]) + "Z"

    out = []
    for geom in g.geometry:
        polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        out.append("".join(ring(p.exterior.coords) + "".join(ring(h.coords) for h in p.interiors) for p in polys))
    return out, {"crs": METRIC_CRS, "x0": x0, "y1": y1, "k": k, "width": WIDTH, "height": height}


def main() -> int:
    for f in (SCHOOLS / "schools.csv", SCHOOLS / "by_nbhd.csv", SCHOOLS / "manifest.json", INSIGHTS, NEIGHBOURHOODS):
        if not f.exists():
            sys.exit(f"{f} is missing (make schools; insights.json is committed)")
    manifest = json.loads((SCHOOLS / "manifest.json").read_text())
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    index = {i: k for k, i in enumerate(ids)}

    s = pd.read_csv(SCHOOLS / "schools.csv", dtype={"school_number": str, "DAUID": str})
    s = s[s.year.notna() & (s.level == "Elementary") & (s.language == "English") & s.type.isin(TYPES)
          & (s.special == "Not applicable") & s.nbhd_id.notna()].copy()
    s["year"] = s.year.astype(int)
    s = s[s[TESTS].notna().any(axis=1)]
    years = sorted(int(y) for y in s.year.unique())
    prelim = sorted({int(f["test_year"]) for f in manifest["files"].values() if f["preliminary"]})

    # The City: each result weighted by enrolment over the schools reporting it; the
    # score is their mean (schools.py's city()).
    city = {c: {str(y): weighted(s[s.year == y], c) for y in years} for c in TESTS}
    score = {str(y): float(np.mean([city[c][str(y)] for c in TESTS])) for y in years}
    for y in years:
        want = manifest["checks"]["city_score"][str(y)]
        if abs(score[str(y)] - want) > 0.01:
            sys.exit(f"{y}: city score {score[str(y)]:.2f}, manifest {want}")
    city_out = {"score": {y: r1(v) for y, v in score.items()},
                **{c: {y: r1(v) for y, v in city[c].items()} for c in TESTS}}

    by = pd.read_csv(SCHOOLS / "by_nbhd.csv")
    by_out = {}
    for method, g in by.groupby("method"):
        d = {}
        for c in ["score", *TESTS] + (["schools"] if method == "inside" else []):
            w = g.pivot(index="nbhd_id", columns="year", values=c).reindex(ids)
            d[c] = {str(y): [r1(v) for v in w[y]] for y in years}
        by_out[method] = d

    # Each school at its latest coordinates; per year its figures.
    latest = s.sort_values("year").drop_duplicates("school_number", keep="last").sort_values("name")
    nums = latest.school_number.tolist()
    shapes, proj = paths(ids)
    pts = gpd.GeoSeries(gpd.points_from_xy(latest.lon, latest.lat), crs=4326).to_crs(METRIC_CRS)
    xy = [[round((p.x - proj["x0"]) * proj["k"], 1), round((proj["y1"] - p.y) * proj["k"], 1)] for p in pts]
    per_year = {}
    for y in years:
        g = s[s.year == y].set_index("school_number").reindex(nums)
        per_year[str(y)] = {c: [r1(v) for v in g[c]] for c in ["enrolment", *TESTS, *DEMOGRAPHICS]}
    out = {
        "years": years,
        "preliminary": prelim,
        "built": manifest["built"],
        "tests": TESTS,
        "demographics": DEMOGRAPHICS,
        "city": city_out,
        "nbhd": [{"id": i, "name": n["name"], "path": p} for i, n, p in zip(ids, insights["nbhd"], shapes)],
        "map": {"width": proj["width"], "height": proj["height"]},
        "by_nbhd": by_out,
        "schools": {
            "number": nums,
            "name": latest.name.tolist(),
            "type": latest.type.tolist(),
            "nbhd": [index[int(i)] for i in latest.nbhd_id],
            "xy": xy,
            "years": per_year,
        },
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} kB; {len(nums)} schools, years {years}, "
          f"city score {city_out['score']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
