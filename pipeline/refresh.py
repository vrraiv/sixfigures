"""Rebuild the derived outputs from pipeline/out without the raw downloads.

Re-applies the CPI factor and histograms to web/public/breaks.json and rewrites
the CSV downloads, from the GeoJSON that build.py wrote. Run after `make cpi`:

    python pipeline/refresh.py [--out pipeline/out]
"""
import argparse
import json
from pathlib import Path

import pandas as pd

from distributions import add_distributions
from exports import write_csvs
from figures import write_figures
from measures import MEASURES

HERE = Path(__file__).parent
BREAKS = HERE.parent / "web" / "public" / "breaks.json"


def properties(path: Path) -> pd.DataFrame:
    df = pd.DataFrame([f["properties"] for f in json.loads(path.read_text())["features"]])
    num = [c for c in df if c in MEASURES or c.split("_", 1)[-1] in MEASURES]
    return df.astype({c: "Float64" for c in num})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=HERE / "out", help="directory with build.py's GeoJSON")
    args = ap.parse_args()
    gdf = properties(args.out / "toronto_da.geojson")
    g16 = properties(args.out / "toronto_da_2016.geojson")
    breaks = json.loads(BREAKS.read_text())
    same = gdf.rel == 1
    comparable = {m: same & gdf[m].notna() & gdf[f"v16_{m}"].notna() for m in MEASURES}
    for m in MEASURES:  # the GeoJSON must be the one these breaks were built from
        assert int(comparable[m].sum()) == breaks["measures"][m]["change"]["comparable"], m
    add_distributions(breaks, gdf, g16, comparable)
    BREAKS.write_text(json.dumps(breaks, indent=2) + "\n")
    print(f"wrote {BREAKS} (CPI x{breaks['cpi']['factor']}, {breaks['cpi']['geography']})")
    write_csvs(gdf, g16)
    write_figures(gdf, g16)


if __name__ == "__main__":
    main()
