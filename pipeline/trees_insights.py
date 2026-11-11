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
                    and from diversity_by_nbhd.csv: shannon, species_n, maple (Norway
                    maple, % of street trees), species_top, genus, family (the
                    commonest species', genus' and family's %), genus_name,
                    family_name, meets (the 10-20-30 rule)
                    and gap_ha, gap_pts: hectares and points of canopy short of 40%
                    of the area (0 at or above)
  goal              the City's target (40% canopy cover by 2050, city-wide), the
                    City's gap in hectares on this measure, the sum of the
                    neighbourhoods' gaps, how many are at or above 40%, and the
                    City's own published 2018 estimate (28.4-31%, a different
                    method from the land-cover polygons used here, which give 26.2%)
                    and chg, chg_ts: its change in canopy 2008 to 2018 less the
                    city's, with 2018 as the tree class or as tree plus shrub
  change            canopy change 2008 to 2018 (canopy_change_nbhd.csv): the
                    city's shares and changes on both readings and the study's
                    point-sampling estimates; by neighbourhood its tree cover in
                    2008 and 2018 (tree, tree plus shrub), its 140-model group and
                    whether it shares that group's figures; how many of the 140
                    rose and fell on each reading and on both; the two readings'
                    correlation; and the check against the study's Table 35
  days              each Landsat pass (as in passes): by neighbourhood, its mean
                    surface temperature (lst) and difference from that day's city
                    mean (anom); null where clouds or the scene's edge left it
                    without a figure (lst_by_pass_nbhd.csv)
  species_city      the 20 commonest species city-wide (species, common name,
                    genus, % and trees), the counts of species, genera and
                    families, the commonest genus and family with their %, and ash's (Fraxinus) %
  species           each neighbourhood's 12 commonest species as [index into
                    names, trees]
  pop               2021 Census population by neighbourhood (for the average
                    resident's heat in each income fifth)
  passes            the Landsat passes: date, platform, the city's mean surface
                    temperature over its clear DA pixels and the clear share
  da_fit            canopy against heat over the 3,743 DAs: least-squares slope
                    (C per 10 points of canopy), intercept, Pearson r and n. DAs
                    are the finer test: within a neighbourhood, the leafier
                    streets are the cooler ones
  spread            by neighbourhood, the 10th to 90th percentile range of its
                    DAs' heat (C): how much hotter its hottest streets are than
                    its coolest; null for the 11 with fewer than SPREAD_MIN_DAS (12)
                    DAs
  other             the measures the page correlates with, as safety_insights.py
                    builds them (school score, sale price, turnout, short-term
                    rentals; canopy and heat are this page's own), and crime:
                    assaults and shootings in which someone was hit, per 100,000
                    residents a year, 2021-2025 (crime.py's rates.csv)

and web/public/trees_da.json, loaded when the page's "Inside the neighbourhood"
section is first drawn (about 0.6 MB, 0.23 MB compressed, so it stays out of the first load): for each
neighbourhood in insights.json's order, its DAs' outlines as SVG path data in a
box of its own (width DA_W, north up; the DA outlines from places.da_polygons(),
simplified to DA_SIMPLIFY metres) and their figures: dauid, pop21, canopy,
trees_ha, large, dbh, heat, lst, as in by_da.csv. A DA belongs to the
neighbourhood the 2021 figures file assigns it, so a neighbourhood drawn from its
DAs can differ slightly from its official outline where a DA straddles two.
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
OUT_DA = WEB / "trees_da.json"
DA_W = 400  # px, each neighbourhood's box
DA_SIMPLIFY = 4  # metres
SPREAD_MIN_DAS = 12
GOAL = 40  # per cent canopy cover, city-wide, by 2050
GOAL_SOURCE = "https://www.toronto.ca/legdocs/mmis/2021/ie/bgrd/backgroundfile-173560.pdf"


def da_shapes(ids: list[int], d: pd.DataFrame) -> list[dict]:
    """Each neighbourhood's DAs as SVG paths in a box of their own, with their figures."""
    import places
    g = places.da_polygons().merge(d.drop(columns=["nbhd_id"]).astype({"dauid": str}), on="dauid", how="left")
    pop = places.common().set_index("dauid").pop21
    g["geometry"] = g.geometry.simplify(DA_SIMPLIFY, preserve_topology=True)
    out = []
    for nid in ids:
        sub = g[g.nbhd_id == nid].sort_values("dauid")
        x0, y0, x1, y1 = sub.total_bounds
        k = DA_W / max(x1 - x0, y1 - y0)
        w, h = round((x1 - x0) * k), round((y1 - y0) * k)

        def ring(coords):
            pts = [(round((x - x0) * k), round((y1 - y) * k)) for x, y in coords]
            pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
            return "M" + "L".join(f"{x} {y}" for x, y in pts[:-1]) + "Z"

        paths = []
        for geom in sub.geometry:
            polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
            paths.append("".join(ring(p.exterior.coords) + "".join(ring(r.coords) for r in p.interiors) for p in polys))
        col = lambda c, f=1, k=1: [None if pd.isna(v) else round(float(v) * f, k) for v in sub[c]]
        out.append({"w": w, "h": h, "dauid": sub.dauid.tolist(), "path": paths,
                    "pop": [int(pop[x]) for x in sub.dauid], "canopy": col("canopy_share", 100),
                    "trees_ha": col("trees_per_ha"), "large": col("large_share", 100), "dbh": col("dbh_median", 1, 0),
                    "heat": col("lst_anom", 1, 2), "lst": col("lst_c", 1, 2)})
    return out


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
    dv = pd.read_csv(TREES / "diversity_by_nbhd.csv").set_index("nbhd_id").reindex(ids)
    nb.update({"shannon": col(dv.shannon, 2), "species_n": dv.species_n.astype(int).tolist(),
               "maple": col(dv.norway_maple_share * 100), "genus": col(dv.top_genus_share * 100),
               "genus_name": dv.top_genus.tolist(), "family_name": dv.top_family.tolist(),
               "family": col(dv.top_family_share * 100), "species_top": col(dv.top_species_share * 100),
               "meets": dv.meets_10_20_30.astype(bool).tolist()})
    sc = pd.read_csv(TREES / "species_city.csv")
    fam = sc.groupby("family").trees.sum().sort_values(ascending=False) / sc.trees.sum()
    gen = sc.groupby("genus").trees.sum().sort_values(ascending=False) / sc.trees.sum()
    species_city = {"top": [{"species": r.species, "common": r.common, "genus": r.genus, "share": round(r.share * 100, 2),
                             "trees": int(r.trees)} for r in sc.head(20).itertuples()],
                    "n": int(len(sc)), "genera": int(sc.genus.nunique()), "families": int(sc.family.nunique()),
                    "top_genus": [gen.index[0], round(float(gen.iloc[0]) * 100, 1)],
                    "top_family": [fam.index[0], round(float(fam.iloc[0]) * 100, 1)],
                    "ash": round(float(gen.get("Fraxinus", 0)) * 100, 1)}
    # each neighbourhood's 12 commonest species as [name index, trees], names in `names`
    sb = pd.read_csv(TREES / "species_by_nbhd.csv")
    names = sorted(sb.common.fillna(sb.species).unique())
    ix = {k: j for j, k in enumerate(names)}
    lists = {nid: [[ix[c if isinstance(c, str) else sp], int(t)] for sp, c, t in zip(g.species, g.common, g.trees)]
             for nid, g in sb.groupby("nbhd_id")}
    species_lists = {"names": names, "nbhd": [lists.get(i, []) for i in ids]}
    # the City's target: 40 per cent canopy cover by 2050, city-wide (Strategic Forest Management
    # Plan 2012-2022; reaffirmed by Council in December 2021)
    gap = (GOAL / 100 * n.area_ha - n.canopy_ha).clip(lower=0)
    nb.update({"gap_ha": col(gap, 0), "gap_pts": col((GOAL - n.canopy_share * 100).clip(lower=0))})
    goal = {"target": GOAL, "year": 2050, "city_gap_ha": round(float(GOAL / 100 * n.area_ha.sum() - n.canopy_ha.sum())),
            "nbhd_gap_ha": round(float(gap.sum())), "above": int((n.canopy_share * 100 >= GOAL).sum()),
            "published_2018": "28.4-31", "source": GOAL_SOURCE}
    lp = pd.read_csv(TREES / "lst_by_pass_nbhd.csv")
    days = []
    for p in manifest["landsat"]["scenes_used"]:
        d1 = lp[lp.date == p["date"]].set_index("nbhd_id").reindex(ids)
        days.append({"date": p["date"], "anom": col(d1.lst_anom, 2), "lst": col(d1.lst_c, 2)})
    # canopy change 2008 to 2018 (trees.py's canopy_change): each neighbourhood's change on the two
    # readings of 2018, less the city's change on that reading
    cc = pd.read_csv(TREES / "canopy_change_nbhd.csv").set_index("nbhd_id").reindex(ids)
    ck = manifest["checks"]["canopy_change"]
    cp = ck["city_pct"]
    city_chg = {"tree": round(cp["tree_2018"] - cp["tree_2008"], 2), "treeshrub": round(cp["treeshrub_2018"] - cp["tree_2008"], 2)}
    nb.update({"chg": col(cc.change_tree - city_chg["tree"], 2), "chg_ts": col(cc.change_treeshrub - city_chg["treeshrub"], 2)})
    change = {"city": cp, "city_change": city_chg, "sampled": {"2008": 26.6, "2018": 28.4},  # the study's point-sampling estimates
              "tree_2008": col(cc.tree_2008), "tree_2018": col(cc.tree_2018), "treeshrub_2018": col(cc.treeshrub_2018),
              "group": cc.hood_140.astype(int).tolist(), "shared": cc.shared.astype(bool).tolist(),
              "counts": {"tree": ck["tree_only"], "treeshrub": ck["tree_and_shrub"], "rose_on_both": ck["rose_on_both"],
                         "fell_on_both": ck["fell_on_both"], "n": ck["neighbourhoods_140"]},
              "r": ck["changes_r"], "table35": ck.get("vs_study_table35"),
              "study": "https://www.toronto.ca/legdocs/mmis/2020/ie/bgrd/backgroundfile-141368.pdf"}
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

    q = d.groupby("nbhd_id").lst_anom.quantile([0.1, 0.9]).unstack()
    # percentiles of a handful of DAs are noise: under SPREAD_MIN_DAS (11 neighbourhoods) no figure
    count = d.groupby("nbhd_id").size()
    spread = (q[0.9] - q[0.1]).where(count >= SPREAD_MIN_DAS).reindex(ids)

    out = {"built": pd.Timestamp.today().date().isoformat(),
           "retrieved": manifest["files"]["street_trees"]["retrieved"],
           "city": city, "nbhd": nb, "pop": pop.astype(int).tolist(), "passes": passes, "da_fit": da_fit,
           "spread": [None if pd.isna(v) else round(float(v), 2) for v in spread],
           "species_city": species_city, "goal": goal, "days": days, "change": change, "species": species_lists, "other": other}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    das = da_shapes(ids, d)
    if sum(len(x["dauid"]) for x in das) != len(d):
        sys.exit("DAs in trees_da.json don't add up to by_da.csv")
    OUT_DA.write_text(json.dumps({"built": out["built"], "nbhd": das}, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_DA} ({OUT_DA.stat().st_size:,} bytes)")
    print("city:", city)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
