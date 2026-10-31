"""The Housing Insights page's figures: web/public/housing.json.

    python pipeline/housing_insights.py

Reads the committed outputs of permits.py (pipeline/permits/), city_layers.py
(pipeline/city/), cmhc.py (pipeline/cmhc/) and series.py (pipeline/series/),
the households in the 2011, 2016 and 2021 figures files, the neighbourhood
names in insights.json and the neighbourhood boundaries, and writes:

  nbhd, map         the 158 neighbourhoods in insights.json's order with SVG
                    outlines (school_insights.paths)
  households        each census's private households by neighbourhood, each
                    year's DAs in that year's figures file's neighbourhoods (as
                    permits.py counts them)
  permits           units created, lost and net on building permits by year
                    issued, by neighbourhood and for the City (the placed
                    permits); the City's units created on permits that closed
                    within five years of issue, by year closed
  development       units on development applications by year submitted: by
                    neighbourhood, once a project (units_project_first); for the
                    City, by type without resubmissions (units_type_first)
  demolitions       rental units approved for demolition and their replacements
                    by year of Council approval, by neighbourhood and City
  apartments        registered apartment buildings by neighbourhood (units by
                    type, units-weighted median year built) and the City's units
                    by decade built
  affordable        the affordable rental pipeline's homes by status, by
                    neighbourhood and City
  cmhc              housing starts by year and month; the Rental Market Survey
                    for the City and its 17 zones by year, and each
                    neighbourhood's zone figures (cmhc.py)
  context           the StatCan series (population, prices, labour force, income,
                    CMA permits): each with its geography, unit and values

Partial years (permits and development to the retrieval date, CMHC monthly to
its latest month) are kept and named in `partial`. The script checks itself
against the permits, CMHC and series manifests and stops on a mismatch.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from school_insights import paths, r1

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
FIGURES = WEB / "data" / "figures"
INSIGHTS = WEB / "insights.json"
OUT = WEB / "housing.json"
FIRST_PERMIT_YEAR = 2000
STAGES = ["Pre-Planning", "Planning Applications Under Review", "Approved OPAs and Zoning By-Law Amendments",
          "Approved Site Plan Application", "Building Permit Application", "Issued Building Permit",
          "Started Construction", "Occupied"]
DEV_TYPES = {"OZ": "Rezoning", "SA": "Site plan", "SB": "Subdivision", "CD": "Condominium", "PL": "Part lot"}


def by_year(df: pd.DataFrame, col: str, ids: list[int], years: list[int]) -> dict:
    """{year: [value by neighbourhood]} with 0 where a neighbourhood has none."""
    w = df.pivot_table(index="nbhd_id", columns="year", values=col, aggfunc="sum", fill_value=0)
    w = w.reindex(index=ids, columns=years, fill_value=0)
    return {str(y): [r1(v) for v in w[y]] for y in years}


def households(ids: list[int]) -> dict:
    out = {}
    for y in ("2011", "2016", "2021"):
        c = json.loads((FIGURES / y / "common.json").read_text())
        hh = pd.Series(c["hh"], index=c["nbhd_id"], dtype=float).groupby(level=0).sum()
        out[y] = [r1(v) for v in hh.reindex(ids)]
    return out


def series(table: str) -> pd.DataFrame:
    return pd.read_csv(HERE / "series" / f"{table}.csv")


def context() -> list[dict]:
    """The StatCan rows: name, geography, unit, frequency, (period, value) pairs."""
    rows = []

    def add(name, geo, unit, freq, s, table):
        s = s.dropna()
        rows.append({"name": name, "geo": geo, "unit": unit, "freq": freq, "table": table,
                     "values": [[str(k), r1(v)] for k, v in s.items()]})

    p = series("17-10-0155")
    add("Population, July 1", "City of Toronto", "people", "annual", p.set_index("REF_DATE").VALUE, "17-10-0155")
    cpi = series("18-10-0005")
    for item, name in (("All-items", "Consumer price index"), ("Shelter", "CPI: shelter"),
                       ("Rented accommodation", "CPI: rented accommodation"),
                       ("Owned accommodation", "CPI: owned accommodation")):
        s = cpi[cpi["Products and product groups"] == item].set_index("REF_DATE").VALUE
        add(name, "Toronto CMA", "index, 2002=100", "annual", s[s.index >= 2000], "18-10-0005")
    lfs = series("14-10-0459")
    lfs = lfs[lfs["Data type"] == "Seasonally adjusted"]
    for item, name, unit in (("Unemployment rate", "Unemployment rate", "percent"),
                             ("Employment rate", "Employment rate", "percent"),
                             ("Employment", "Employment", "thousands")):
        add(name, "Toronto CMA", unit, "monthly, three-month moving average",
            lfs[lfs["Labour force characteristics"] == item].set_index("REF_DATE").VALUE, "14-10-0459")
    inc = series("11-10-0239")
    s = inc[(inc["Income source"] == "Total income") & (inc.Statistics == "Median income (excluding zeros)")]
    add("Median total income, people 15+", "Toronto CMA", "2024 constant dollars", "annual",
        s.set_index("REF_DATE").VALUE[lambda x: x.index >= 2000], "11-10-0239")
    bp = series("34-10-0292")
    bp = bp[(bp["Type of building"] == "Total residential") & (bp["Type of work"] == "New dwelling units total")
            & (bp.Variables == "Number of dwelling-units created")]
    yr = bp.assign(year=bp.REF_DATE.str[:4].astype(int)).groupby("year").VALUE.agg(["sum", "count"])
    add("New dwelling units on building permits", "Toronto CMA", "units", "annual (complete years)",
        yr[yr["count"] == 12]["sum"], "34-10-0292")
    return rows


def main() -> int:
    need = [HERE / "permits" / "by_nbhd.csv", HERE / "permits" / "manifest.json", HERE / "city" / "manifest.json",
            HERE / "cmhc" / "manifest.json", HERE / "series" / "manifest.json", INSIGHTS]
    missing = [str(f) for f in need if not f.exists()]
    if missing:
        sys.exit(f"missing: {missing}")
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    hh = households(ids)

    # building permits, by year issued
    pm = json.loads((HERE / "permits" / "manifest.json").read_text())
    p = pd.read_csv(HERE / "permits" / "by_nbhd.csv")
    iss = p[(p.basis == "issued") & (p.year >= FIRST_PERMIT_YEAR)]
    pyears = sorted(int(y) for y in iss.year.unique())
    city_iss = iss.groupby("year")[["created", "created_ground", "created_other", "lost", "net"]].sum()
    comp = p[(p.basis == "completed") & (p.year >= FIRST_PERMIT_YEAR)].groupby("year")[["created", "created_close5"]].sum()
    for y, v in pm["cma_check"].items():
        if round(float(city_iss.created.get(int(y), 0))) != v["city"]:
            sys.exit(f"permits {y}: {city_iss.created.get(int(y))} created, manifest {v['city']}")
    # net units issued vs census household change, 2016-2021, no lag (permits.py's check)
    net = iss.pivot_table(index="nbhd_id", columns="year", values="net", aggfunc="sum", fill_value=0)
    d = pd.Series(hh["2021"], index=ids) - pd.Series(hh["2016"], index=ids)
    s = net[[y for y in range(2016, 2021)]].sum(axis=1).reindex(ids, fill_value=0)
    want = pm["census_check"]["households 2016-2021 lag 0"]
    got = {"permits": round(float(s.sum())), "census": round(float(d.sum())), "pearson": round(float(s.corr(d)), 3)}
    if got != {k: want[k] for k in got}:
        sys.exit(f"census check {got}, manifest {want}")

    # development applications, by year submitted
    dv = pd.read_csv(HERE / "city" / "development.csv")
    dyears = sorted(int(y) for y in dv.year.unique())
    dev_city = {t: {str(y): r1(v) for y, v in dv[dv.type == t].groupby("year").units_type_first.sum().reindex(dyears, fill_value=0).items()}
                for t in DEV_TYPES}
    dev_apps = {str(y): int(v) for y, v in dv.groupby("year").applications.sum().items()}

    # rental demolitions, by year of Council approval
    dm = pd.read_csv(HERE / "city" / "demolitions.csv")
    dm = dm[dm.basis == "approved"]
    myears = sorted(int(y) for y in dm.year.unique())
    dm_city = dm.groupby("year")[["applications", "lost_total", "lost_affordable", "lost_mid_range", "lost_high_end",
                                  "replaced_total"]].sum().reindex(myears, fill_value=0)

    # apartment buildings
    ap = pd.read_csv(HERE / "city" / "apartments.csv")
    g = ap.groupby("nbhd_id")
    ap_n = pd.DataFrame({"buildings": g.buildings.sum(), "units": g.units.sum(), "private": g.units_private.sum(),
                         "social": g.units_social.sum(), "tchc": g.units_tchc.sum()}).reindex(ids)

    def median_built(x):
        x = x.dropna(subset=["year_built"]).sort_values("year_built")
        c = x.units.cumsum()
        return x.year_built[c >= c.iloc[-1] / 2].iloc[0] if len(x) and c.iloc[-1] else np.nan
    ap_n["median_built"] = pd.Series({k: median_built(v) for k, v in g}).reindex(ids)
    decade = ap.dropna(subset=["year_built"]).assign(decade=lambda x: (x.year_built // 10 * 10).astype(int).clip(lower=1900))
    ap_dec = decade.groupby("decade")[["units_private", "units_social", "units_tchc"]].sum()

    # affordable rental pipeline (a snapshot)
    af = pd.read_csv(HERE / "city" / "affordable.csv")
    if set(af.status) - set(STAGES):
        sys.exit(f"unknown affordable statuses: {set(af.status) - set(STAGES)}")
    af_n = af.pivot_table(index="nbhd_id", columns="status", values="affordable", aggfunc="sum", fill_value=0).reindex(index=ids, columns=STAGES, fill_value=0)
    af_city = af.groupby("status")[["projects", "affordable", "market_rent_controlled", "rgi", "supportive"]].sum().reindex(STAGES, fill_value=0)

    # CMHC
    cm = json.loads((HERE / "cmhc" / "manifest.json").read_text())
    rc = pd.read_csv(HERE / "cmhc" / "rms_city.csv")
    if rc.set_index("year").avg_rent.get(2025) != 1916:
        sys.exit(f"RMS 2025 average rent {rc.set_index('year').avg_rent.get(2025)}, expected 1916")
    rz = pd.read_csv(HERE / "cmhc" / "rms_zones.csv")
    rn = pd.read_csv(HERE / "cmhc" / "rms_nbhd.csv")
    zn = pd.read_csv(HERE / "cmhc" / "zone_nbhd.csv")
    main_zone = zn.sort_values("share").drop_duplicates("nbhd_id", keep="last").set_index("nbhd_id").zone_code.reindex(ids)
    ryears = sorted(int(y) for y in rn.year.unique())
    sm = pd.read_csv(HERE / "cmhc" / "starts_monthly.csv")
    sa = pd.read_csv(HERE / "cmhc" / "starts_annual.csv")
    last_month = sm.month.max()

    shapes, proj = paths(ids)
    rows = lambda df, cols: {c: [r1(v) for v in df[c]] for c in cols}
    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "retrieved": {"permits": pm["retrieved"], "city": json.loads((HERE / "city" / "manifest.json").read_text())["built"],
                      "cmhc_months_to": last_month},
        "partial": {"permits": pyears[-1], "development": dyears[-1], "starts": int(last_month[:4]) if not last_month.endswith("-12") else None},
        "nbhd": [{"id": i, "name": n["name"], "path": pth} for i, n, pth in zip(ids, insights["nbhd"], shapes)],
        "map": {"width": proj["width"], "height": proj["height"]},
        "households": hh,
        "permits": {
            "years": pyears,
            "created": by_year(iss, "created", ids, pyears),
            "lost": by_year(iss, "lost", ids, pyears),
            "net": by_year(iss, "net", ids, pyears),
            "city": {"year": pyears, **rows(city_iss.reindex(pyears, fill_value=0), ["created", "created_ground", "created_other", "lost", "net"])},
            "completed": {"year": [int(y) for y in comp.index], **rows(comp, ["created", "created_close5"])},
            "placed_share": pm["placed_share_of_units_created_by_issue_year"],
        },
        "development": {
            "years": dyears,
            "units": by_year(dv[dv.type.isin(DEV_TYPES)], "units_project_first", ids, dyears),
            "types": DEV_TYPES,
            "city": dev_city,
            "applications": dev_apps,
        },
        "demolitions": {
            "years": myears,
            "lost": by_year(dm, "lost_total", ids, myears),
            "city": {"year": myears, **rows(dm_city, list(dm_city.columns))},
        },
        "apartments": {
            **rows(ap_n.fillna(0), ["buildings", "units", "private", "social", "tchc"]),
            "median_built": [r1(v) for v in ap_n.median_built],
            "decades": {"decade": [int(x) for x in ap_dec.index], **rows(ap_dec, list(ap_dec.columns))},
        },
        "affordable": {
            "stages": STAGES,
            "nbhd": {st: [r1(v) for v in af_n[st]] for st in STAGES},
            "city": rows(af_city, list(af_city.columns)),
        },
        "cmhc": {
            "starts": {"year": sa.year.tolist(), **rows(sa, ["starts", "completions", "uc_december"])},
            "monthly": {"month": sm.month.tolist(), **rows(sm, ["starts", "completions", "uc"])},
            "rms_city": {"year": rc.year.tolist(), **rows(rc, ["vacancy", "avg_rent", "median_rent", "rent_change", "units"])},
            "zones": [{"code": int(code), "name": z.zone.iloc[0], "year": z.year.tolist(),
                       **rows(z, ["vacancy", "avg_rent", "rent_change", "units"])} for code, z in rz.sort_values("year").groupby("zone_code")],
            "nbhd_zone": [int(z) if pd.notna(z) else None for z in main_zone],
            "nbhd_years": ryears,
            "avg_rent": by_year(rn.rename(columns={}), "avg_rent", ids, ryears),
            "vacancy": by_year(rn, "vacancy", ids, ryears),
        },
        "context": context(),
    }
    # by_year fills missing with 0; CMHC withholds some neighbourhoods: keep those null
    for k in ("avg_rent", "vacancy"):
        w = rn.pivot(index="nbhd_id", columns="year", values=k).reindex(index=ids, columns=ryears)
        out["cmhc"][k] = {str(y): [r1(v) for v in w[y]] for y in ryears}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} kB; permits {pyears[0]}-{pyears[-1]}, development "
          f"{dyears[0]}-{dyears[-1]}, demolitions {myears[0]}-{myears[-1]}, RMS {ryears[0]}-{ryears[-1]}, "
          f"starts to {last_month}; census check {got}; CMHC built {cm.get('built', cm.get('retrieved'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
