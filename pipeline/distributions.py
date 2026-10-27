"""Inflation factor and per-measure histograms for breaks.json.

Kept apart from build.py (pandas/numpy only) so refresh.py can rebuild them from
pipeline/out without the raw downloads, e.g. after `make cpi`.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from measures import MEASURES

# Annual-average CPI for the two income years, from table 18-10-0005-01
# (pipeline/cpi.py writes it). Census incomes are for the calendar year before
# each census, so 2015 incomes are restated in 2020 dollars.
CPI = json.loads((Path(__file__).parent / "cpi.json").read_text())
CPI_FACTOR = round(CPI["2020"] / CPI["2015"], 4)

# Histogram bin widths (measures.py): about 20-35 bins between the 1st and 99th
# percentiles. Change bins put zero on a bin edge, and the class breaks fall on
# edges too.
POINTS_WIDTH = 2


def histogram(v: pd.Series, width: int, lo: int | None = None, hi: int | None = None) -> dict:
    """Counts in bins of `width` from `lo` to `hi` (default: the 1st and 99th
    percentiles, rounded out to the width); the first and last bins are open-ended."""
    v = v.dropna().to_numpy(dtype=float)
    if lo is None:
        lo = int(np.floor(np.percentile(v, 1) / width) * width)
    if hi is None:
        hi = int(np.ceil(np.percentile(v, 99) / width) * width)
    n = (hi - lo) // width
    idx = np.clip(np.floor((v - lo) / width).astype(int), 0, n - 1)
    return {"lo": lo, "width": width, "counts": np.bincount(idx, minlength=n).tolist()}


def real_change(gdf: pd.DataFrame, m: str) -> pd.Series:
    """2021 median minus the 2016 median restated in 2020 dollars."""
    return gdf[m] - gdf[f"v16_{m}"] * CPI_FACTOR


def add_distributions(breaks: dict, gdf: pd.DataFrame, g16: pd.DataFrame, comparable: dict):
    """Add the CPI factor, real-dollar change stats and histograms to breaks.

    `comparable[m]` is the boolean mask of 2021 DAs with a change for measure m.
    Change histograms are keyed like the page's change-basis menu: "real",
    "dollars" and "points" (percentile rank) for money, "pp" and "points" for rates.
    """
    breaks["cpi"] = {**CPI, "factor": CPI_FACTOR}
    for m, spec in MEASURES.items():
        c = comparable[m]
        diff = (gdf[m] - gdf[f"v16_{m}"])[c]
        points = (gdf[f"pct_{m}"] - gdf[f"p16_{m}"])[c]
        meta = breaks["measures"][m]
        # one axis for both years, so the two charts can be compared
        w, cw = spec["width"], spec["change_width"]
        top = int(np.ceil(np.percentile(pd.concat([gdf[m], g16[m]]).dropna(), 99) / w) * w)
        if spec["unit"] == "money":
            real = real_change(gdf, m)[c]
            meta["change"]["median_real"] = int(round(real.median()))
            change = {"dollars": histogram(diff, cw), "real": histogram(real, cw)}
        else:
            top = min(top, 100)
            change = {"pp": histogram(diff, cw)}
        meta["hist"] = {
            "2016": histogram(g16[m], w, lo=0, hi=top),
            "2021": histogram(gdf[m], w, lo=0, hi=top),
            "change": {**change, "points": histogram(points, POINTS_WIDTH)},
        }
