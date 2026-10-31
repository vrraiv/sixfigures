"""2006 Census on the City's 158 neighbourhoods (a model input, not part of the site):
pipeline/census/da_2006.csv (each 2006 DA's neighbourhood), pipeline/census/nbhd_2006.csv
(the maps' measures by neighbourhood) and pipeline/census/manifest.json (checks, city values).

    python pipeline/census2006.py

Inputs: pipeline/out/toronto_profile_2006.csv (profile2006.py, which needs pyivt) and two
browser downloads from www12.statcan.gc.ca (it has a bot challenge) in pipeline/raw:
  gda_000a06a_e.zip                 2006 DA boundary file, digital (the cartographic one,
                                    gda_000b06a_e.zip, works too: the overlay counts land only)
  2011_92-156_DALand_ADsup_txt.zip  2011<->2006 DA correspondence: DAUID2011, DAUID2006, a
                                    relationship flag (1 one-to-one, 2 one 2011 DA was many
                                    2006 DAs, 3 many were one, 4 many to many) and the % of
                                    the 2011 DA's land in the 2006 DA

Each 2006 DA goes to the neighbourhood covering most of it (build.assign_neighbourhoods, as
for 2011-2021). The correspondence only checks that: a DA unchanged in 2011 should land
where the 2011 figures file puts it.

Profile cells: the IVT stores a suppressed statistic as 0, so a median or average of 0 is
suppressed (small populations; average rent where a DA has 30 or fewer tenant households;
total household income, median and average, in 27 high-income DAs whose after-tax median
and income groups are published).
In DAs whose short-form non-response was 25% or more (2nd data-quality digit 3) the 100%
data (population, households, age, dwelling type) come through as 0 and are nulled; long-form
suppression (4th digit 3) already comes through empty. Some boundary DAs aren't in the
profile at all, so a neighbourhood's population and households are sums of the DAs with
counts (das_without_counts says how many lack them).

Measures: those measures.COMPARABLE_2006 marks same or near, aggregated as insights.py does
for 2011-2021 (insights.aggregate: pooled counts for shares, income medians interpolated
from pooled groups where those reproduce the city median). The four it marks differs are
kept under their own names (avg_rent, avg_value, avg_own_cost, lico_at), weighted means on
their bases. Dollars are as published: income in 2005, rent, values and costs in 2006.
"""
import json
import sys
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

import insights
from build import assign_neighbourhoods
from measures import COMPARABLE_2006, INCOME_GROUPS_2006, MEASURES

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "census"
PROFILE = HERE / "out" / "toronto_profile_2006.csv"
BOUNDARY_ZIP = RAW / "gda_000a06a_e.zip"
CORR_ZIP = RAW / "2011_92-156_DALand_ADsup_txt.zip"
CORR_TXT = "2011_92-156_DAland_ADsup.txt"
WEB = HERE.parent / "web" / "public"
FIGURES11 = WEB / "data" / "figures" / "2011" / "common.json"

TORONTO_CSD = "3520005"
PUBLISHED_POP = 2_503_281  # Toronto (C), 2006 Census population count
EXPECTED_DAS = 3577  # in the boundary file
SHORT_SUPPRESSED, LONG_SUPPRESSED = (1, "3"), (3, "3")  # (flag digit, value)
AGES_0_14 = [f"n_{s}{a}" for s in "mf" for a in ("0_4", "5_9", "10_14")]
AGES_65 = [f"n_{s}{a}" for s in "mf" for a in ("65_69", "70_74", "75_79", "80_84", "85")]
# 100% (short-form) data in the 2006 profile
SHORT_FORM = ["pop06", "hh", "n_age_tot", *AGES_0_14, *AGES_65, "n_struct", "n_detached", "n_apt5"]
MEASURES_2006 = [m for m in MEASURES if COMPARABLE_2006[m] in ("same", "near")]
# Published only as averages or another low-income line: own names, weighted means on these bases
AVERAGES = {"avg_rent": "n_tenant_hh", "avg_value": "n_owner_hh", "avg_own_cost": "n_owner_hh", "lico_at": "pop"}
MONEY = {m for m in MEASURES if MEASURES[m]["unit"] == "money"} | {"avg_rent", "avg_value", "avg_own_cost"}


def derive(df: pd.DataFrame) -> pd.DataFrame:
    """The measures' counts and values from the profile cells (DAs or the CSD row)."""
    d = df.rename(columns={"pop06": "pop"})
    n = {
        "n_age0_14": d[AGES_0_14].sum(axis=1, min_count=len(AGES_0_14)),
        "n_age65": d[AGES_65].sum(axis=1, min_count=len(AGES_65)),
        "n_built_old": d.n_built_pre46 + d.n_built_46_60,
        "n_shelter30": d.n_owner30 + d.n_tenant30,
        "n_shelter": d.n_owner_hh + d.n_tenant_hh,
    }
    cols = {**d, **n}
    v = {m: cols[num] / cols[den].where(cols[den] > 0) * 100
         for m, (num, den, _) in insights.shares_for("2006").items() if num in cols and den in cols}
    v["owner30"] = d.n_owner30 / d.n_owner_hh.where(d.n_owner_hh > 0) * 100
    v["tenant30"] = d.n_tenant30 / d.n_tenant_hh.where(d.n_tenant_hh > 0) * 100
    return pd.concat([d, pd.DataFrame({**n, **v}, index=d.index)], axis=1)


def load_profile() -> tuple[pd.DataFrame, pd.DataFrame]:
    """(2006 Toronto DAs, the CSD row): profile cells with suppression nulled, indexed by DAUID."""
    p = pd.read_csv(PROFILE, dtype={"geo_code": str})
    p = pd.concat([p, p.label.str.split().str[-1].rename("dq")], axis=1)
    das = p[p.level == "DA"].set_index("geo_code")
    csd = p[p.level == "CSD"].set_index("geo_code")
    if len(csd) != 1:
        sys.exit(f"{PROFILE.name}: {len(csd)} CSD rows")
    print(f"{PROFILE.name}: {len(das):,} DAs; data-quality flags {das.dq.value_counts().to_dict()}")
    short = das.dq.str[SHORT_SUPPRESSED[0]] == SHORT_SUPPRESSED[1]
    long_ = das.dq.str[LONG_SUPPRESSED[0]] == LONG_SUPPRESSED[1]
    print(f"  short form suppressed (non-response >= 25%): {int(short.sum())} DAs, population cells "
          f"{das.loc[short, 'pop06'].tolist()} -> nulled with the rest of the 100% data")
    das.loc[short, SHORT_FORM] = np.nan
    empty = das.loc[long_, "med_hh_tot"].isna().all() and das.loc[long_, "n_renter"].isna().all()
    print(f"  long form suppressed: {int(long_.sum())} DAs ({'cells already empty' if empty else 'CELLS NOT EMPTY'})")
    if not empty:
        sys.exit("long-form-suppressed DAs carry values; check the extract")
    stats = [c for c in das if c.startswith(("med_", "avg_"))]
    zeros = (das[stats] == 0).sum()
    print(f"  statistics stored as 0 (suppressed) -> nulled: {zeros[zeros > 0].to_dict()}")
    das[stats] = das[stats].mask(das[stats] == 0)
    # Low-income prevalence can truly be 0; null it only where income itself is suppressed.
    das.loc[das.med_ind_tot.isna(), "lico_at"] = np.nan
    return das, csd


def correspondence() -> pd.DataFrame:
    c = pd.read_csv(zipfile.ZipFile(CORR_ZIP).open(CORR_TXT), header=None, dtype=str,
                    names=["da11", "da06", "flag", "pct"])
    c = c[c.da11.str.startswith("3520") | c.da06.str.startswith("3520")].copy()
    c["flag"] = c.flag.astype(int)
    c["pct"] = c.pct.astype(float)
    return c


def average(wide: pd.DataFrame, m: str, base: str) -> tuple[pd.Series, pd.Series]:
    """Weighted mean of a published average by nbhd_id, withheld below insights.MIN_COVERAGE."""
    b, nb = wide[base], wide.nbhd_id
    total = b.groupby(nb).sum(min_count=1)
    has = wide[m].notna() & (b > 0)
    coverage = b[has].groupby(nb[has]).sum().reindex(total.index, fill_value=0) / total
    v = (wide[m] * b)[has].groupby(nb[has]).sum() / b[has].groupby(nb[has]).sum()
    return v.reindex(total.index).where(coverage >= insights.MIN_COVERAGE), coverage


def corr(a: pd.Series, b: pd.Series) -> dict:
    ok = a.notna() & b.notna()
    return {"n": int(ok.sum()), "r": round(float(np.corrcoef(a[ok], b[ok])[0, 1]), 3),
            "rho": round(float(a[ok].rank().corr(b[ok].rank())), 3)}


def main():
    if not PROFILE.exists():
        sys.exit(f"{PROFILE} missing: run pipeline/profile2006.py (needs pyivt)")
    for f in (BOUNDARY_ZIP, CORR_ZIP):
        if not f.exists():
            sys.exit(f"{f.name} missing: download it from www12.statcan.gc.ca in a browser (see this script's docstring)")
    raw, csd = load_profile()
    das, city = derive(raw), derive(csd).iloc[0]
    checks = {}

    # Boundaries and neighbourhoods
    gdf = gpd.read_file(f"zip://{BOUNDARY_ZIP.as_posix()}!{BOUNDARY_ZIP.stem}.shp", engine="pyogrio",
                        where=f"CSDUID = '{TORONTO_CSD}'", columns=["DAUID", "CSDUID"])[["DAUID", "geometry"]]
    if len(gdf) != EXPECTED_DAS:
        sys.exit(f"2006 boundary DAs in Toronto: {len(gdf)}, expected {EXPECTED_DAS}")
    if not das.index.isin(gdf.DAUID).all():
        sys.exit("profile DAs missing from the boundary file")
    gdf = assign_neighbourhoods(gdf)
    lookup = gdf.set_index("DAUID")[["nbhd_id", "nbhd"]]
    absent = lookup.index.difference(das.index)
    no_counts = absent.union(das.index[das["pop"].isna()])

    # Population against the published count; what's missing
    pop11 = json.loads(FIGURES11.read_text())
    pop11 = pd.Series(pop11["pop11"], index=pop11["dauid"], dtype=float)
    gap = PUBLISHED_POP - das["pop"].sum()
    checks["population"] = {
        "published": PUBLISHED_POP, "csd_row": int(city["pop"]), "sum_of_das": int(das["pop"].sum()),
        "gap": int(gap), "das_in_boundary": len(gdf), "das_in_profile": len(das),
        "das_not_in_profile": len(absent), "das_short_form_suppressed": int(das["pop"].isna().sum()),
        "pop_2011_of_das_without_2006_counts": int(pop11.reindex(no_counts).sum()),
        "households": {"csd_row": int(city.hh), "sum_of_das": int(das.hh.sum())},
    }
    print(f"\npopulation: published {PUBLISHED_POP:,}, CSD row {city['pop']:,.0f}, sum of DAs {das['pop'].sum():,.0f} "
          f"(gap {gap:,.0f}, {gap / PUBLISHED_POP:.2%}); {len(absent)} boundary DAs not in the profile and "
          f"{int(das['pop'].isna().sum())} short-form suppressed held {checks['population']['pop_2011_of_das_without_2006_counts']:,} people in 2011")
    print(f"households: CSD row {city.hh:,.0f}, sum of DAs {das.hh.sum():,.0f}")

    # The assignment against 2011, through the correspondence
    nb11 = json.loads(FIGURES11.read_text())
    nb11 = pd.Series(nb11["nbhd_id"], index=nb11["dauid"])
    c = correspondence()
    print(f"\ncorrespondence: Toronto 2011 DAs by flag {c.groupby('da11').flag.first().value_counts().sort_index().to_dict()}")
    same = c[c.flag == 1]
    agree1 = (same.da06.map(lookup.nbhd_id) == same.da11.map(nb11))
    split = c[c.flag == 3]  # many 2011 DAs were one 2006 DA
    agree3 = (split.da06.map(lookup.nbhd_id) == split.da11.map(nb11))
    checks["assignment_vs_2011"] = {
        "unchanged_das": len(same), "same_neighbourhood": round(float(agree1.mean()), 4),
        "split_das_children": len(split), "children_in_parent_neighbourhood": round(float(agree3.mean()), 4),
    }
    print(f"unchanged DAs in the same neighbourhood as in 2011: {int(agree1.sum()):,} of {len(same):,} ({agree1.mean():.2%})")
    print(f"2011 DAs split from one 2006 DA, in its neighbourhood: {int(agree3.sum())} of {len(split)} ({agree3.mean():.2%})")
    if agree1.mean() < 0.97:
        sys.exit("unchanged DAs disagree with 2011's neighbourhoods; check the boundary file and the overlay")

    # City shares from the DA counts against the CSD row
    wide = insights.tenure_bases(das.join(lookup.nbhd_id).copy())
    pooled = derive(raw.sum(min_count=1, numeric_only=True).to_frame().T)
    city_check = {}
    for m in MEASURES_2006:
        if m in insights.shares_for("2006") or m in ("owner30", "tenant30", "shelter30"):
            city_check[m] = {"csd": round(float(city[m]), 1), "pooled_das": round(float(pooled[m].iloc[0]), 1)}
    checks["city_shares_csd_vs_pooled_das"] = city_check
    print("\ncity shares, CSD row vs pooled DAs:", {m: (v["csd"], v["pooled_das"]) for m, v in city_check.items()})

    # Neighbourhood figures
    ids = sorted(lookup.nbhd_id.unique())
    if len(ids) != 158:
        sys.exit(f"{len(ids)} neighbourhoods, expected 158")
    names = lookup.drop_duplicates("nbhd_id").set_index("nbhd_id").nbhd
    out = pd.DataFrame(index=pd.Index(ids, name="nbhd_id"))
    out["nbhd"] = names
    out["das"] = lookup.groupby("nbhd_id").size()
    out["das_without_counts"] = lookup.loc[no_counts].groupby("nbhd_id").size().reindex(ids, fill_value=0)
    out["pop"] = das["pop"].groupby(wide.nbhd_id).sum(min_count=1)
    out["hh"] = das.hh.groupby(wide.nbhd_id).sum(min_count=1)
    methods, coverage = {}, {}
    print(f"\n{'measure':12s} shown/158  min coverage")
    for m in MEASURES_2006:
        use = True
        if m in INCOME_GROUPS_2006:
            err = insights.groups_check(wide, "2006", m, city[m])
            use = err is not None and abs(err) <= insights.GROUPS_TOLERANCE
            methods[m] = {"groups_vs_published_city_median": None if err is None else round(err, 4),
                          "method": "groups" if use else "da_median"}
            print(f"  {m}: city median from DA income groups {err * 100:+.1f}% off the published one"
                  f" -> {'interpolated' if use else 'DA-median method'}")
        v, cov = insights.aggregate(wide, "2006", m, use)
        out[m] = v.reindex(ids)
        coverage[m] = round(float(cov.reindex(ids).min()), 3)
        print(f"{m:12s} {int(out[m].notna().sum()):3d}        {cov.reindex(ids).min():.2f}")
    for m, base in AVERAGES.items():
        v, cov = average(wide, m, base)
        out[m] = v.reindex(ids).round(0 if m in MONEY else 1)
        coverage[m] = round(float(cov.reindex(ids).min()), 3)
        print(f"{m:12s} {int(out[m].notna().sum()):3d}        {cov.reindex(ids).min():.2f}")

    # Against the same neighbourhoods in 2011 (insights.json)
    ins = json.loads((WEB / "insights.json").read_text())
    order = [n["id"] for n in ins["nbhd"]]
    vs11 = {}
    for m in MEASURES_2006:
        y11 = pd.Series(ins["measures"][m]["values"]["2011"], index=order, dtype=float)
        vs11[m] = corr(out[m], y11.reindex(ids))
    checks["vs_2011_neighbourhoods"] = vs11
    print("\n2006 vs 2011 by neighbourhood (r):", {m: v["r"] for m, v in vs11.items()})

    OUT.mkdir(exist_ok=True)
    da = lookup.copy()
    da["in_profile"] = da.index.isin(das.index).astype(int)
    da["dq"] = das.dq.reindex(da.index)
    da["pop"] = das["pop"].reindex(da.index).astype("Int64")
    da.index.name = "dauid"
    da.sort_index().to_csv(OUT / "da_2006.csv", lineterminator="\n")
    for m in out.columns:
        if m in MONEY or m in ("das", "das_without_counts", "pop", "hh"):
            out[m] = out[m].round(0).astype("Int64")
    out.to_csv(OUT / "nbhd_2006.csv", lineterminator="\n")
    city_values = {m: (round(float(city[m])) if m in MONEY else round(float(city[m]), 1)) for m in MEASURES_2006 + list(AVERAGES)}
    manifest = {
        "built": date.today().isoformat(),
        "files": {f.name: {"bytes": f.stat().st_size} for f in (PROFILE, BOUNDARY_ZIP, CORR_ZIP)},
        "dollars": {"income": "2005", "rent, value, owner costs": "2006"},
        "comparability": {m: COMPARABLE_2006[m] for m in MEASURES_2006},
        "city": city_values,
        "income_median_method": methods,
        "min_coverage": insights.MIN_COVERAGE,
        "lowest_coverage": coverage,
        "checks": checks,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nwrote {OUT / 'da_2006.csv'} ({len(da):,} DAs), {OUT / 'nbhd_2006.csv'} ({len(out)} neighbourhoods), manifest.json")


if __name__ == "__main__":
    main()
