"""The DA figures the browser joins to the map, one small JSON file per measure
and census (web/public/data/figures/<year>/), plus the geometry-only GeoJSON the
tiles are cut from.

The tiles carry nothing but each DA's number, so a zoom level of them is a few
hundred KB rather than several MB, and the browser attaches the figures through
feature state. The opening view needs common.json (place names, population,
households, boundary flag) and the one file of the measure on show; the details
panel fetches the rest of that measure's group as needed.

Every file lists DAs in the same order as common.json's dauid array.
"""
import json
from pathlib import Path

import pandas as pd

from measures import MEASURES

FIGURES = Path(__file__).parent.parent / "web" / "public" / "data" / "figures"
COMMON = {
    "2021": ["nbhd", "nbhd_id", "nbhd2", "pop21", "hh", "rel"],
    "2016": ["nbhd", "nbhd_id", "nbhd2", "pop16", "hh", "rel"],
    "2011": ["nbhd", "nbhd_id", "nbhd2", "pop11", "hh", "rel"],
}
GEOMETRY = ["dauid", "geometry"]


def _col(s: pd.Series) -> list:
    """Plain numbers and strings; null for a suppressed value."""
    out = []
    for v in s.tolist():
        if v is None or v is pd.NA or (isinstance(v, float) and v != v):
            out.append(None)
        elif isinstance(v, float) and v.is_integer():
            out.append(int(v))
        else:
            out.append(v)
    return out


def _write(path: Path, data: dict):
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")


def write_year(year: str, df: pd.DataFrame, measures=tuple(MEASURES), out: Path = FIGURES):
    """One census's files: df is its DA table as written to the GeoJSON (lower-case dauid)."""
    df = df.sort_values("dauid")
    d = out / year
    d.mkdir(parents=True, exist_ok=True)
    for stale in d.glob("*.json"):
        stale.unlink()
    _write(d / "common.json", {"dauid": df.dauid.tolist(), **{c: _col(df[c]) for c in COMMON[year]}})
    for m in measures:
        data = {"v": _col(df[m]), "pct": _col(df[f"pct_{m}"])}
        if year == "2021":
            # 2016 values and percentiles sit on boundary-identical 2021 DAs.
            data["v16"] = _col(df[f"v16_{m}"])
            data["p16"] = _col(df[f"p16_{m}"])
        _write(d / f"{m}.json", data)
    size = sum(f.stat().st_size for f in d.glob("*.json"))
    print(f"wrote {d} ({len(measures) + 1} files, {size / 1e3:.0f} kB, {len(df):,} DAs)")


def write_figures(gdf: pd.DataFrame, g16: pd.DataFrame, out: Path = FIGURES):
    """The 2021 and 2016 files (the 2011 page's come from census2011.py)."""
    write_year("2021", gdf, out=out)
    write_year("2016", g16, out=out)
