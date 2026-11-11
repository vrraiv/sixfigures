"""Crime and traffic injuries, by neighbourhood and year.

    python pipeline/crime.py

Reads five City of Toronto Open Data files (download.py fetches them; checked
2026-11-11 against the CKAN API) and writes pipeline/crime/:

  by_nbhd.csv      nbhd_id, year, category, count; only non-zero rows (a missing
                   row within a category's years, in manifest.json, is a zero).
                   Categories:
                     assault, auto_theft, break_and_enter, robbery, theft_over
                         Community Safety Indicators rows (the old Major Crime
                         Indicators), by REPORT year. A row is an offence or
                         victim, so one occurrence can be several rows; the
                         Neighbourhood Crime Rates file counts the same way
                     shootings_all       shooting events and firearm discharges
                                         (the Crime Rates file's SHOOTING).
                                         Discharges run 51-116 a year to 2014,
                                         then 166-323: recording changed with
                                         the 2014 records system, so compare
                                         shootings_all only from 2015
                     shootings           events where a bullet hit someone
                                         (109-224 a year since 2004; 2014, the
                                         changeover year, has 76)
                     shooting_killed, shooting_injured   persons, from those events
                     homicides           victims (a row each; an event with two
                                         victims is two), and by method:
                                         homicides_shooting, _stabbing, _other
                     ksi_collisions      collisions where someone was killed or
                                         seriously injured; _fatal, and those
                                         involving a _pedestrian, _cyclist or
                                         _motorcyclist (the collision's flags)
                     ksi_persons         persons killed or seriously injured
                                         (injury Fatal or Major), and by road
                                         user: ksi_persons_pedestrian, _cyclist,
                                         _motorcyclist, _driver, _passenger,
                                         _other (other and micromobility)
                     ksi_killed          persons killed, and by the same road users
                   Shootings, homicides and collisions are by OCCURRENCE year (the
                   only date they carry).
  rates.csv        nbhd_id, category, period, count, per_100k: annual rate per
                   100,000 residents over five-year periods (2006-10, 2011-15,
                   2016-20, 2021-25, where the category covers all five years
                   and they are complete), on the 2021 Census population
                   (places.population()) for every period. Single years are
                   too noisy for most neighbourhoods
  population.csv   nbhd_id, year, population: the Environics Analytics estimates
                   the police divide by in the Neighbourhood Crime Rates file,
                   2014-2025. The file states only 2025's; the others are
                   count / rate (see ncr())
  manifest.json    files and retrieval dates, years covered and complete,
                   rows, records without a neighbourhood, checks

Sources (Toronto Police Service, except KSI from Transportation Services, which
gets it from the police), Open Government Licence - Toronto on CKAN (the police
dataset notes cite the Ontario licence):
  neighbourhood-crime-rates            "neighbourhood-crime-rates - 4326.csv": the
        158 neighbourhoods (HOOD_ID = nbhd_id, names identical to insights.json),
        counts, rates and population 2014-2025 for the five CSI categories,
        homicide, shooting, bicycle theft and theft from motor vehicle
  major-crime-indicators               "Community Safety Indicators.csv": since
        July 2026 the package is titled Community Safety Indicators (CSI_CATEGORY);
        its older resource major-crime-indicators.csv (MCI_CATEGORY, last
        modified 2025-10-08) is no longer updated. Reported 2014 on
  shootings-firearm-discharges         "shootings-firearm-discharges - 4326.csv", 2004 on
  police-annual-statistical-report-homicide   "Homicides - 4326.csv", 2004 on
        (the lower-case "homicide - 4326.csv" resources stopped in 2023)
  motor-vehicle-collisions-involving-killed-or-seriously-injured-persons
        "Motor Vehicle Collisions with KSI Data - 4326.csv": one row per person
        involved, 2006 on; the City's right of way only (no 400-series highways
        or private property); records arrive months to over a year late, so the
        latest year is low
All are on CKAN; the police ArcGIS portal (data.torontopolice.on.ca) serves the
same tables and is not needed.

Placement: the police files carry HOOD_158 and the KSI file a 158-model
neighbourhood name; those are used. The police offset each point to the
nearest intersection node, and assign the neighbourhood from the true
location: 2,253 nodes carry occurrences from two or more neighbourhoods
(intersections on neighbourhood boundaries). So a point-in-polygon on the
published points (places.place, run here as a check) disagrees on boundary
streets, and would be wrong there; it only places the KSI rows without a
neighbourhood name. Records the police couldn't locate, or located outside
the City, are HOOD_158 "NSA" and are left out (counted in the manifest).
Sexual assaults are not in the CSI file at all, and the points are at
intersections, not addresses, so there is no DA-level table: a DA is too small
for an offset point to fall in reliably.

Checks: the CSI, shooting and homicide counts are recomputed by neighbourhood
and year and compared with the Neighbourhood Crime Rates file (published
2026-02-20, the point files 2026-07-20, so revisions since then show up as
small differences); placement by point-in-polygon against the provided
neighbourhood; the Environics population against the 2021 Census.
"""
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import places

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "crime"
INSIGHTS = HERE.parent / "web" / "public" / "insights.json"

# local name -> (CKAN package, resource), as in download.py's TORONTO
FILES = {
    "ncr": ("toronto_neighbourhood_crime_rates_4326.csv", "neighbourhood-crime-rates",
            "neighbourhood-crime-rates - 4326.csv"),
    "csi": ("toronto_community_safety_indicators.csv", "major-crime-indicators", "Community Safety Indicators.csv"),
    "shootings": ("toronto_shootings_4326.csv", "shootings-firearm-discharges",
                  "shootings-firearm-discharges - 4326.csv"),
    "homicides": ("toronto_homicides_4326.csv", "police-annual-statistical-report-homicide", "Homicides - 4326.csv"),
    "ksi": ("toronto_ksi_4326.csv", "motor-vehicle-collisions-involving-killed-or-seriously-injured-persons",
            "Motor Vehicle Collisions with KSI Data - 4326.csv"),
}
CSI = {"Assault": "assault", "Auto Theft": "auto_theft", "Break and Enter": "break_and_enter",
       "Robbery": "robbery", "Theft Over": "theft_over"}
# Neighbourhood Crime Rates column stem for each recomputed category
NCR = {"assault": "ASSAULT", "auto_theft": "AUTOTHEFT", "break_and_enter": "BREAKENTER", "robbery": "ROBBERY",
       "theft_over": "THEFTOVER", "shootings_all": "SHOOTING", "homicides": "HOMICIDE"}
ROAD_USERS = {"pedestrian": "pedestrian", "cyclist": "cyclist", "motorcyclist": "motorcyclist", "driver": "driver",
              "passenger": "passenger", "other": "other", "other_micromobility": "other"}  # owner: not at the scene
PERIODS = [(2006, 2010), (2011, 2015), (2016, 2020), (2021, 2025)]


def path(k: str) -> Path:
    return RAW / FILES[k][0]


def hood(s: pd.Series) -> pd.Series:
    """HOOD_158 as a number; NSA (not specified area) as NaN."""
    return pd.to_numeric(s.astype(str).str.strip().replace("NSA", np.nan), errors="coerce")


def complete_through(last: pd.Timestamp) -> int:
    """The last whole calendar year the data reach."""
    return last.year if (last.month, last.day) == (12, 31) else last.year - 1


def counts(df: pd.DataFrame, cat: str, mask=None, weight=None) -> pd.DataFrame:
    d = df[df.nbhd_id.notna()] if mask is None else df[df.nbhd_id.notna() & mask]
    w = d[weight].fillna(0) if weight else pd.Series(1, index=d.index)
    g = w.groupby([d.nbhd_id.astype(int), d.year.astype(int)]).sum()
    return g[g > 0].rename("count").reset_index().assign(category=cat)


def placement(df: pd.DataFrame, lon: str, lat: str) -> dict:
    """Point-in-polygon (places.place) against the file's own neighbourhood."""
    p = places.place(df[[lon, lat]], lon, lat)
    has = df.nbhd_id.notna() & df[lon].notna()
    return {"records_with_both": int(has.sum()),
            "agree": round(float((p.nbhd_id[has] == df.nbhd_id[has]).mean()), 4),
            "point_outside_das": int(p.nbhd_id[has].isna().sum()),
            "unassigned_with_point_inside_das": int((df.nbhd_id.isna() & p.nbhd_id.notna()).sum())}


def csi() -> tuple[pd.DataFrame, dict]:
    c = pd.read_csv(path("csi"), usecols=["EVENT_UNIQUE_ID", "REPORT_DATE", "REPORT_YEAR", "OCC_YEAR",
                                          "CSI_CATEGORY", "HOOD_158", "LONG_WGS84", "LAT_WGS84"], dtype={"HOOD_158": str})
    c["nbhd_id"] = hood(c.HOOD_158)
    c["year"] = c.REPORT_YEAR
    c["category"] = c.CSI_CATEGORY.map(CSI)
    if c.category.isna().any():
        sys.exit(f"unknown CSI categories {c.CSI_CATEGORY[c.category.isna()].unique()}")
    last = pd.to_datetime(c.REPORT_DATE).max()
    # nodes whose occurrences the police put in more than one neighbourhood
    pts = c[c.nbhd_id.notna() & c.LONG_WGS84.notna()]
    multi = pts.groupby(["LONG_WGS84", "LAT_WGS84"]).nbhd_id.nunique()
    info = {"rows": len(c), "occurrences": int(c.EVENT_UNIQUE_ID.nunique()),
            "rows_by_category": {k: int(v) for k, v in c.category.value_counts().items()},
            "years": [int(c.year.min()), int(c.year.max())], "through": last.date().isoformat(),
            "complete_through": complete_through(last),
            "rows_reported_since_2014_occurred_before": int((c.OCC_YEAR < 2014).sum()),
            "nsa": int(c.nbhd_id.isna().sum()), "no_coordinates": int(c.LONG_WGS84.isna().sum()),
            "offset_nodes": int(len(multi)), "offset_nodes_in_several_nbhds": int((multi > 1).sum()),
            "rows_at_those_nodes": int(pts.set_index(["LONG_WGS84", "LAT_WGS84"]).index.isin(multi[multi > 1].index).sum()),
            "placement": placement(c, "LONG_WGS84", "LAT_WGS84")}
    rows = [counts(c, v, c.category == v) for v in CSI.values()]
    return pd.concat(rows), info


def shootings() -> tuple[pd.DataFrame, dict]:
    s = pd.read_csv(path("shootings"), dtype={"HOOD_158": str})
    s["nbhd_id"] = hood(s.HOOD_158)
    s["year"] = s.OCC_YEAR
    last = pd.to_datetime(s.OCC_DATE).max()
    hit = s.EVENT_TYPE == "Shooting"
    info = {"rows": len(s), "events": int(s.EVENT_UNIQUE_ID.nunique()),
            "by_type": {k: int(v) for k, v in s.EVENT_TYPE.value_counts().items()},
            "years": [int(s.year.min()), int(s.year.max())], "through": last.date().isoformat(),
            "complete_through": complete_through(last), "nsa": int(s.nbhd_id.isna().sum()),
            "nsa_by_year": {int(k): int(v) for k, v in s[s.nbhd_id.isna()].groupby("year").size().items()},
            "placement": placement(s, "LONG_WGS84", "LAT_WGS84")}
    rows = [counts(s, "shootings_all"), counts(s, "shootings", hit),
            counts(s, "shooting_killed", weight="DEATH"), counts(s, "shooting_injured", weight="INJURIES")]
    return pd.concat(rows), info


def homicides() -> tuple[pd.DataFrame, dict]:
    h = pd.read_csv(path("homicides"), dtype={"HOOD_158": str})
    h["nbhd_id"] = hood(h.HOOD_158)
    h["year"] = h.OCC_YEAR
    last = pd.to_datetime(h.OCC_DATE, unit="ms").max()  # epoch milliseconds, UTC
    info = {"rows": len(h), "events": int(h.EVENT_UNIQUE_ID.nunique()),
            "by_type": {k: int(v) for k, v in h.HOMICIDE_TYPE.value_counts().items()},
            "years": [int(h.year.min()), int(h.year.max())], "through": last.date().isoformat(),
            "complete_through": complete_through(last), "nsa": int(h.nbhd_id.isna().sum()),
            "placement": placement(h, "LONG_WGS84", "LAT_WGS84")}
    rows = [counts(h, "homicides")] + [counts(h, f"homicides_{t.lower()}", h.HOMICIDE_TYPE == t)
                                        for t in ("Shooting", "Stabbing", "Other")]
    return pd.concat(rows), info


def ksi(ids: dict) -> tuple[pd.DataFrame, dict]:
    k = pd.read_csv(path("ksi"), low_memory=False)
    k["date"] = pd.to_datetime(k.accdate)
    k["year"] = k.date.dt.year
    k["named_id"] = k.neighbourhood.map(ids)
    unknown = k.neighbourhood.notna() & k.named_id.isna()
    if unknown.any():
        sys.exit(f"KSI neighbourhood names not in insights.json: {k.neighbourhood[unknown].unique()}")
    # every column describing the collision is the same on its rows (checked below)
    flags = ["pedestrian", "cyclist", "motorcyclist", "acclass", "neighbourhood", "longitude"]
    varying = {f: int((k.groupby("collision_id")[f].nunique(dropna=False) > 1).sum()) for f in flags}
    if any(varying.values()):
        sys.exit(f"collision fields vary within a collision: {varying}")
    p = places.place(k, "longitude", "latitude")
    k["nbhd_id"] = k.named_id.fillna(p.nbhd_id)
    chk = k.assign(nbhd_id=k.named_id)
    k["user"] = k.road_user.map(ROAD_USERS)
    k["ksi"] = k.injury.isin(["Major", "Fatal"])
    k["killed"] = k.injury == "Fatal"
    col = k.drop_duplicates("collision_id")
    has_ksi = k.groupby("collision_id").ksi.any()
    last = k.date.max()
    info = {"rows": len(k), "collisions": int(len(col)), "persons_ksi": int(k.ksi.sum()),
            "persons_killed": int(k.killed.sum()),
            "fatal_collisions": int((col.acclass == "Fatal Injury").sum()),
            "collisions_without_a_ksi_person": int((~has_ksi).sum()),
            "acclass": {str(a): int(v) for a, v in col.acclass.value_counts(dropna=False).items()},
            "years": [int(k.year.min()), int(k.year.max())], "through": last.date().isoformat(),
            "complete_through": complete_through(last),
            "note": "records reach the City months to over a year late; the latest complete year is low",
            "collisions_by_year": {int(a): int(v) for a, v in col.groupby("year").size().items()},
            "collisions_without_name": int(col.named_id.isna().sum()),
            "collisions_without_name_placed_by_point": int((col.named_id.isna() & col.nbhd_id.notna()).sum()),
            "collisions_unplaced": int(col.nbhd_id.isna().sum()),
            "placement": placement(chk.drop_duplicates("collision_id"), "longitude", "latitude")}
    rows = [counts(col, "ksi_collisions"), counts(col, "ksi_collisions_fatal", col.acclass == "Fatal Injury")]
    rows += [counts(col, f"ksi_collisions_{f}", col[f].astype(bool)) for f in ("pedestrian", "cyclist", "motorcyclist")]
    users = list(dict.fromkeys(ROAD_USERS.values()))
    for what in ("ksi", "killed"):
        name = "ksi_persons" if what == "ksi" else "ksi_killed"
        rows.append(counts(k, name, k[what]))
        rows += [counts(k, f"{name}_{u}", k[what] & (k.user == u)) for u in users]
    return pd.concat(rows), info


def ncr() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Neighbourhood Crime Rates, long (nbhd_id, year, stem, count, rate), the
    population behind the rates, and how consistently the rates imply it.

    The file states population for its last year only (POPULATION_2025); each
    earlier year's is count / rate x 100,000, from the category with the most
    occurrences there (assault, never zero in a neighbourhood-year)."""
    n = pd.read_csv(path("ncr"))
    cols = [c for c in n.columns if c[-4:].isdigit() and "_RATE_" not in c and not c.startswith("POPULATION")]
    long = n.melt(id_vars="HOOD_ID", value_vars=cols, value_name="count")
    long[["stem", "year"]] = long.variable.str.rsplit("_", n=1, expand=True)
    long["year"] = long.year.astype(int)
    long["rate"] = [n.at[i, f"{s}_RATE_{y}"] for i, s, y in
                    zip(long.index % len(n), long.stem, long.year)]
    long = long.rename(columns={"HOOD_ID": "nbhd_id"}).drop(columns="variable")
    nz = long[(long["count"] > 0) & (long.rate > 0)].copy()
    nz["implied"] = nz["count"] / nz.rate * 1e5
    pop = nz.sort_values("count").groupby(["nbhd_id", "year"]).implied.last().round().astype(int)
    spread = (nz.implied - nz.set_index(["nbhd_id", "year"]).index.map(pop)).abs()
    stated = n.set_index("HOOD_ID").POPULATION_2025
    check = {"implied_vs_other_categories_max_abs_diff": round(float(spread.max()), 2),
             "implied_2025_vs_stated_max_abs_diff": int((pop.xs(2025, level="year") - stated).abs().max()),
             "total_by_year": {int(y): int(v) for y, v in pop.groupby(level="year").sum().items()}}
    pop = pop.rename("population").reset_index()[["nbhd_id", "year", "population"]]
    return long, pop, check


def agreement(mine: pd.DataFrame, ref: pd.DataFrame) -> dict:
    """Recomputed counts against the Neighbourhood Crime Rates file, cell by cell
    over every neighbourhood and year it covers."""
    out = {}
    for cat, stem in NCR.items():
        r = ref[ref.stem == stem].set_index(["nbhd_id", "year"])["count"]
        m = mine[mine.category == cat].set_index(["nbhd_id", "year"])["count"]
        a, b = r.align(m, join="left", fill_value=0)
        d = b - a
        out[cat] = {"cells": int(len(a)), "exact": round(float((d == 0).mean()), 4),
                    "within_1": round(float((d.abs() <= 1).mean()), 4),
                    "ncr_total": int(a.sum()), "recomputed_total": int(b.sum()),
                    "abs_diff": int(d.abs().sum()), "r": round(float(a.corr(b)), 4)}
    return out


def rates(by: pd.DataFrame, info: dict) -> pd.DataFrame:
    pop = places.population()
    ids = pop.index.astype(int)
    rows = []
    for cat, g in by.groupby("category"):
        first, last = info[cat]
        s = g.set_index(["nbhd_id", "year"])["count"]
        for a, b in PERIODS:
            if a < first or b > last:
                continue
            c = s[s.index.get_level_values("year").to_series().between(a, b).values].groupby(level=0).sum()
            c = c.reindex(ids, fill_value=0)
            rows.append(pd.DataFrame({"nbhd_id": ids, "category": cat, "period": f"{a}-{b}", "count": c.values,
                                      "per_100k": (c.values / (b - a + 1) / pop.values * 1e5).round(1)}))
    return pd.concat(rows)


def main() -> int:
    missing = [p.name for p in map(path, FILES) if not p.exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)
    ins = json.loads(INSIGHTS.read_text())
    ids = {d["name"]: d["id"] for d in ins["nbhd"]}
    manifest = {"built": dt.date.today().isoformat(), "files": {
        k: {"name": path(k).name, "package": pkg, "resource": res, "bytes": path(k).stat().st_size,
            "retrieved": dt.date.fromtimestamp(path(k).stat().st_mtime).isoformat()}
        for k, (_, pkg, res) in FILES.items()}}
    checks = {}

    ref, pop, checks["ncr_population"] = ncr()
    n = pd.read_csv(path("ncr"), usecols=["HOOD_ID", "AREA_NAME"])
    checks["neighbourhoods"] = {
        "ncr_rows": len(n), "ids_match_figures": set(n.HOOD_ID) == set(places.common().nbhd_id),
        "names_match_insights": bool((n.AREA_NAME == n.HOOD_ID.map({v: k for k, v in ids.items()})).all())}
    if not checks["neighbourhoods"]["ids_match_figures"]:
        sys.exit("Neighbourhood Crime Rates ids differ from the figures file's 158 neighbourhoods")

    parts, info, cover = [], {}, {}
    for name, fn in (("csi", csi), ("shootings", shootings), ("homicides", homicides), ("ksi", lambda: ksi(ids))):
        df, inf = fn()
        print(f"{name}: {json.dumps(inf)}")
        info[name] = inf
        for cat in df.category.unique():
            cover[cat] = (inf["years"][0], inf["complete_through"])
        parts.append(df)
    by = pd.concat(parts)[["nbhd_id", "year", "category", "count"]]
    by["count"] = by["count"].round().astype(int)
    by = by.sort_values(["category", "nbhd_id", "year"])
    checks.update(info)
    checks["ncr_agreement"] = agreement(by, ref)
    for k, v in checks["ncr_agreement"].items():
        print(f"  vs Neighbourhood Crime Rates, {k}: {v}")

    # the rates' population: Environics (the police's) against the 2021 Census
    p21 = places.population()
    e21 = pop[pop.year == 2021].set_index("nbhd_id").population.reindex(p21.index)
    checks["population_2021"] = {"census": int(p21.sum()), "environics": int(e21.sum()),
                                 "r": round(float(p21.corr(e21)), 4),
                                 "ratio_range": [round(float((e21 / p21).min()), 3), round(float((e21 / p21).max()), 3)]}
    print(f"population 2021: {checks['population_2021']}; NCR: {checks['ncr_population']}")

    rt = rates(by, cover)
    by.to_csv(OUT / "by_nbhd.csv", index=False)
    rt.to_csv(OUT / "rates.csv", index=False)
    pop.sort_values(["nbhd_id", "year"]).to_csv(OUT / "population.csv", index=False)
    manifest["categories"] = {k: {"years_complete": list(v), "basis": "report year" if k in CSI.values() else "occurrence year"}
                              for k, v in sorted(cover.items())}
    manifest["rows"] = {"by_nbhd": len(by), "rates": len(rt), "population": len(pop)}
    manifest["checks"] = checks
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(manifest["rows"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
