"""CSV downloads of the DA figures shown on the map (web/public/data/)."""
from pathlib import Path

import pandas as pd

from distributions import CPI_FACTOR, CPI_FACTOR_CENSUS, real_change
from measures import MEASURES, years

WEB_DATA = Path(__file__).parent.parent / "web" / "public" / "data"
PLACE = ["dauid", "nbhd_id", "nbhd", "nbhd2"]


def _ints(df: pd.DataFrame) -> pd.DataFrame:
    """Whole numbers for every float column except the rates (one decimal)."""
    rates = [m for m, s in MEASURES.items() if s["unit"] == "rate"]
    def fix(c):
        if c.dtype.kind != "f" and str(c.dtype) != "Float64":
            return c
        is_rate = any(c.name == f"{m}_change" or c.name.startswith(f"{m}_20") for m in rates)
        if is_rate and not c.name.endswith("_pctl"):
            return c.round(1)
        return c.round().astype("Int64")
    return df.apply(fix)


def write_csvs(gdf: pd.DataFrame, g16: pd.DataFrame, out: Path = WEB_DATA):
    """One row per DA. Columns are documented in the README ("Data downloads").

    gdf / g16: the 2021 and 2016 DA tables as written to the GeoJSON (lower-case dauid).
    """
    out.mkdir(parents=True, exist_ok=True)
    d21 = gdf[PLACE + ["pop21", "hh"]].copy()
    d21["same_boundary_2016"] = gdf["rel"].astype(int)
    # Columns are suffixed with the year the figure refers to (measures.years);
    # rates keep one decimal and their change is in percentage points.
    for m, spec in MEASURES.items():
        y16, y21 = years(m)
        d21[f"{m}_{y21}"] = gdf[m]
        d21[f"{m}_{y21}_pctl"] = gdf[f"pct_{m}"]
        d21[f"{m}_{y16}"] = gdf[f"v16_{m}"]
        d21[f"{m}_{y16}_pctl"] = gdf[f"p16_{m}"]
        d21[f"{m}_change"] = (gdf[m] - gdf[f"v16_{m}"]).astype("Float64").round(1)
        if spec["unit"] == "money":
            d21[f"{m}_change_real"] = real_change(gdf, m)
        d21[f"{m}_change_pctl"] = gdf[f"pct_{m}"] - gdf[f"p16_{m}"]
    d16 = g16[PLACE + ["pop16", "hh"]].copy()
    d16["same_boundary_2021"] = g16["rel"].astype(int)
    for m in MEASURES:
        y16 = years(m)[0]
        d16[f"{m}_{y16}"] = g16[m]
        d16[f"{m}_{y16}_pctl"] = g16[f"pct_{m}"]
    for name, df in (("toronto_da_income_2021.csv", d21), ("toronto_da_income_2016.csv", d16)):
        path = out / name
        _ints(df.sort_values("dauid")).to_csv(path, index=False, lineterminator="\n")
        print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB, {len(df):,} rows; real change at x{CPI_FACTOR} for incomes, x{CPI_FACTOR_CENSUS} for census-dated dollars)")
