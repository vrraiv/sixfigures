"""The Sale Prices Insights page's figures: web/public/prices.json.

    python pipeline/price_insights.py

Reads TRREB's sales by community and quarter (pipeline/trreb/, from trreb.py), the
neighbourhood names in insights.json and the neighbourhood boundaries, and writes:

  quarters      "2011 Q4" to the latest, in order
  communities   TRREB's 140 Toronto communities (the City's neighbourhoods of before
                2022), each with its region and, by quarter, its sales and median
                sale price (null where TRREB withholds it: two sales or fewer)
  nbhd, map     the 158 neighbourhoods in insights.json's order with SVG outlines
                (school_insights.paths), each with its community's index
  households    each census's private households by neighbourhood
  city          by quarter, the City's sales and average sale price (dollar volume
                over sales, summed over the communities), and the same for each of
                TRREB's three Toronto regions

A community split across districts (its parts on separate rows) is one community
here: sales and dollar volume add, and its median is the parts' sales-weighted.
The script stops if a community has two rows in a quarter's district.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from housing_insights import households
from school_insights import paths

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
TRREB = HERE / "trreb"
OUT = WEB / "prices.json"
REGION = {"W": "West", "C": "Central", "E": "East"}


def main() -> int:
    for f in (TRREB / "community.csv", TRREB / "nbhd_map.csv", INSIGHTS):
        if not f.exists():
            sys.exit(f"{f} is missing (make trreb; insights.json is committed)")
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    d = pd.read_csv(TRREB / "community.csv")
    if d.duplicated(["year", "q", "district", "community"]).any():
        sys.exit("a community has two rows in one district and quarter")
    d["quarter"] = d.year.astype(str) + " Q" + d.q.astype(str)
    d["region"] = d.district.str[0].map(REGION)
    quarters = sorted(d.quarter.unique(), key=lambda s: (int(s[:4]), int(s[-1])))
    # One row per community and quarter: parts in different districts pooled.
    d["lm"] = np.log(d.med) * d.sales
    d["has"] = d.sales.where(d.med.notna(), 0)
    g = d.groupby(["community", "quarter"]).agg(sales=("sales", "sum"), vol=("vol", "sum"), lm=("lm", "sum"), has=("has", "sum"))
    g["med"] = np.exp(g.lm / g.has).where(g.has > 0)
    names = sorted(d.community.unique())
    region = d.groupby("community").region.agg(lambda s: s.mode()[0])
    sales = g.sales.unstack().reindex(index=names, columns=quarters)
    med = g.med.unstack().reindex(index=names, columns=quarters)
    nmap = pd.read_csv(TRREB / "nbhd_map.csv").set_index("nbhd").community
    nb_names = [n["name"] for n in insights["nbhd"]]
    if nmap.reindex(nb_names).isna().any():
        sys.exit("a neighbourhood has no community")
    shapes, proj = paths(ids)

    def city(rows: pd.DataFrame) -> dict:
        s = rows.groupby("quarter").agg(sales=("sales", "sum"), vol=("vol", "sum")).reindex(quarters)
        return {"sales": [int(v) for v in s.sales], "avg": [round(v) for v in s.vol / s.sales]}

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "quarters": quarters,
        "communities": [{"name": n, "region": region[n],
                         "sales": [None if pd.isna(v) else int(v) for v in sales.loc[n]],
                         "med": [None if pd.isna(v) else round(v) for v in med.loc[n]]} for n in names],
        "nbhd": [{"id": i, "name": n, "path": pth, "c": names.index(nmap[n])} for i, n, pth in zip(ids, nb_names, shapes)],
        "map": {"width": proj["width"], "height": proj["height"]},
        "households": households(ids),
        "city": {"all": city(d), **{r: city(d[d.region == r]) for r in REGION.values()}},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    c = out["city"]["all"]
    print(f"Wrote {OUT}: {len(quarters)} quarters ({quarters[0]} to {quarters[-1]}), {len(names)} communities; "
          f"{quarters[-1]}: {c['sales'][-1]:,} sales, average ${c['avg'][-1]:,}; {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
