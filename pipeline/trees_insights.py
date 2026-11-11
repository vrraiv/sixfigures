"""The Trees and Heat Insights page's figures: web/public/trees.json.

    python pipeline/trees_insights.py

Reads what trees.py writes (pipeline/trees/by_nbhd.csv, by_da.csv and
manifest.json), the neighbourhoods and 2021 figures that safety_insights.py
reads, and the other neighbourhood layers, and writes:

  built, retrieved  this file's date and the street-tree file's retrieval date
  city              the City's street trees, area, canopy area and share, and
                    the share of measured trees 50 cm or more across (trees-
                    weighted over the neighbourhoods)
  nbhd              by neighbourhood, in insights.json's order: trees, area_ha,
                    canopy_ha, canopy (share of area, %), trees_ha (street trees
                    per hectare), large (% of measured trees 50 cm or more), dbh
                    (median trunk diameter, cm), heat (lst_anom: summer surface
                    temperature against the city's, C), lst (lst_c, C), scenes
                    (Landsat passes behind heat), species and species_share (the
                    commonest street tree and its share)
  pop               2021 Census population by neighbourhood (for the average
                    resident's heat in each income fifth)
  passes            the Landsat passes: date, platform, the city's mean surface
                    temperature over its clear DA pixels and the clear share
  da_fit            canopy against heat over the 3,743 DAs: least-squares slope
                    (C per 10 points of canopy), intercept, Pearson r and n. DAs
                    are the finer test: within a neighbourhood, the leafier
                    streets are the cooler ones
  other             the measures the page correlates with, as safety_insights.py
                    builds them (school score, sale price, turnout, short-term
                    rentals; canopy and heat are this page's own), and crime:
                    assaults and shootings in which someone was hit, per 100,000
                    residents a year, 2021-2025 (crime.py's rates.csv)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from safety_insights import COMMON, INSIGHTS, WEB, other_measures, r1

HERE = Path(__file__).parent
TREES = HERE / "trees"
OUT = WEB / "trees.json"


def main() -> int:
    for f in (TREES / "by_nbhd.csv", TREES / "by_da.csv", TREES / "manifest.json", INSIGHTS, COMMON):
        if not f.exists():
            sys.exit(f"{f} is missing (make trees)")
    manifest = json.loads((TREES / "manifest.json").read_text())
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    n = pd.read_csv(TREES / "by_nbhd.csv").set_index("nbhd_id").reindex(ids)
    if n.trees.isna().any():
        sys.exit("trees by_nbhd.csv is missing neighbourhoods")
    c = json.loads(COMMON.read_text())
    pop = pd.DataFrame({k: c[k] for k in ("nbhd_id", "pop21")}).groupby("nbhd_id").pop21.sum().reindex(ids)

    d = pd.read_csv(TREES / "by_da.csv")
    ok = d.canopy_share.notna() & d.lst_anom.notna()
    x, y = d.canopy_share[ok] * 100, d.lst_anom[ok]
    slope, intercept = np.polyfit(x, y, 1)
    da_fit = {"slope_per_10": round(float(slope * 10), 2), "intercept": round(float(intercept), 2),
              "r": round(float(np.corrcoef(x, y)[0, 1]), 3), "n": int(ok.sum())}
    print("DA fit:", da_fit)

    col = lambda s, k=1: [None if pd.isna(v) else round(float(v), k) for v in s]
    nb = {
        "trees": n.trees.astype(int).tolist(), "area_ha": col(n.area_ha), "canopy_ha": col(n.canopy_ha),
        "canopy": col(n.canopy_share * 100), "trees_ha": col(n.trees_per_ha), "large": col(n.large_share * 100),
        "dbh": col(n.dbh_median, 0), "heat": col(n.lst_anom, 2), "lst": col(n.lst_c, 2),
        "scenes": n.lst_scenes.astype(int).tolist(), "species": n.top_species_common.fillna("").tolist(),
        "species_share": col(n.top_species_share * 100),
    }
    w = n.trees
    city = {"trees": int(n.trees.sum()), "area_ha": round(float(n.area_ha.sum()), 1),
            "canopy_ha": round(float(n.canopy_ha.sum()), 1),
            "canopy": round(float(n.canopy_ha.sum() / n.area_ha.sum() * 100), 1),
            "trees_ha": round(float(n.trees.sum() / n.area_ha.sum()), 2),
            "large": round(float((n.large_share * w).sum() / w.sum() * 100), 1)}
    passes = [{"date": p["date"], "platform": p["platform"], "city_c": p["city_mean_c"], "clear": p["clear"]}
              for p in manifest["landsat"]["scenes_used"]]

    other = [o for o in other_measures(insights, ids) if o["key"] not in ("canopy", "heat")]
    rates = pd.read_csv(HERE / "crime" / "rates.csv")
    for key, cat, label, short in (("assault", "assault", "Assaults per 100,000 residents a year, 2021-2025", "Assaults"),
                                   ("shootings", "shootings", "Shootings in which someone was hit, per 100,000 a year, 2021-2025",
                                    "Shootings")):
        s = rates[(rates.category == cat) & (rates.period == "2021-2025")].set_index("nbhd_id").per_100k.reindex(ids)
        other.append({"key": key, "label": label, "short": short, "unit": "rate", "source": "Toronto Police Service (crime.py)",
                      "values": [r1(v) for v in s]})

    out = {"built": pd.Timestamp.today().date().isoformat(),
           "retrieved": manifest["files"]["street_trees"]["retrieved"],
           "city": city, "nbhd": nb, "pop": pop.astype(int).tolist(), "passes": passes, "da_fit": da_fit, "other": other}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print("city:", city)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
