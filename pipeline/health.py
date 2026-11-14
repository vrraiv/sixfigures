"""Deprivation indexes and food-premises inspections, by DA and neighbourhood.

    python pipeline/health.py

Reads three files (fetched into pipeline/raw/; see SOURCES) and writes
pipeline/health/:

  by_da.csv           Toronto's 3,743 2021 DAs (dauid, nbhd_id) with two area
                      deprivation indexes, each four principal-component factor
                      scores and their Ontario-wide DA quintiles (1 least, 5 most
                      marginalized/deprived; higher scores mean more):
                        onmarg_*  Ontario Marginalization Index 2021 (PHO and
                                  St. Michael's MAP Centre): hd households and
                                  dwellings (was residential instability), mr
                                  material resources (was material deprivation),
                                  al age and labour force (was dependency), rn
                                  racialized and newcomer populations (was ethnic
                                  concentration)
                        cimd_*    Canadian Index of Multiple Deprivation 2021,
                                  Ontario index (StatCan): ri residential
                                  instability, ec ethno-cultural composition, ed
                                  economic dependency, sv situational vulnerability
                      A score's column is the dimension (onmarg_mr), its quintile
                      the same with _q (onmarg_mr_q). CIMD has no row for 17
                      Toronto DAs (blank): StatCan dropped DAs with a total
                      non-response rate of 50% or more and suppressed DAs under
                      40 people. ON-Marg scores all 3,743, including 9 with no
                      2021 population
  by_nbhd.csv         the 158 neighbourhoods (nbhd_id): for each dimension of
                      both indexes, the population-weighted mean DA score (the
                      dimension's name, as in by_da.csv) and the share of the
                      population living in DAs in Ontario's most marginalized
                      quintile (_q5), weighted by 2021 population (common.json's
                      pop21, as places.common() reads it) over the DAs the
                      index scores; pop21 and each index's covered population
                      (onmarg_pop, cimd_pop). A mean of DA scores is not the score
                      a principal-component analysis of neighbourhood totals would
                      give (OCHPP publishes such a neighbourhood ON-Marg; see
                      below), and the quintiles stay Ontario's DA quintiles
  dinesafe_by_nbhd.csv
                      Toronto Public Health's DineSafe inspections by
                      neighbourhood and year of inspection (nbhd_id, year):
                      establishments inspected, inspections, inspections by
                      outcome (pass, conditional pass, closed), infractions by
                      severity (minor, significant, crucial, and admin: no
                      severity given, e.g. no certified food handler on site,
                      no licence) and convictions with fines and their total. The
                      City's file is a rolling window of about the last three
                      years (2023-11-10 to 2026-11-09 when retrieved), so the
                      first and last years are partial and the totals change
                      with each refresh; it has no establishment type
  manifest.json       sources, retrieval dates, MD5s, row counts, match rates and
                      checks
and pipeline/out/health_dinesafe.csv, one row per establishment with its placement.

ON-Marg's terms allow non-commercial use with credit and forbid modifying its
content without written permission, so its columns are not committed: by_da.csv
and by_nbhd.csv carry CIMD (Statistics Canada Open Licence) and the ON-Marg
columns go to pipeline/out/health_onmarg_by_da.csv and _by_nbhd.csv (gitignored).
The checks in manifest.json still use both.

Checks (manifest.json): every DAUID in common.json is found in both files (CIMD
less its 17 dropped DAs) and ON-Marg's Pop2021 equals pop21 in all 3,743; Toronto's
population by Ontario quintile; each dimension against the census figures file
closest to one of its inputs (material resources ~ government transfers r 0.90,
age and labour force ~ 65+ r 0.91, households and dwellings ~ renters r 0.78),
which also shows the DAs line up with common.json's order; the matching
dimensions of the two indexes (r 0.84 to 0.96); and each against the LIM-AT
low-income share (lim_at.json), DA by DA and by neighbourhood (pop21-weighted).
Material resources tracks LIM-AT only loosely (r 0.58 by DA, 0.35 by
neighbourhood): downtown DAs of students and young renters have high low income
but few of the index's other inputs (no diploma, transfers, lone parents), and
2020 incomes include pandemic benefits. On the 2021 run every DA was found.

Placement:
  - DAs are matched on DAUID; DAs sit in neighbourhoods by the 2021 figures file
    (common.json's nbhd_id), as in places.py
  - a DineSafe establishment has one latitude/longitude on every row; it is
    placed in a DA by point-in-polygon with places.place(). An inspection is one
    (establishment, inspection date) and an infraction one row with an
    infraction type (rows of an inspection without one say none was found). An
    inspection's outcome is the same on all its rows; one "Temporarily Not
    Operating" counts in inspections only. Convictions are spelled two ways
    ("Conviction - Fined", "Conviction: Fined"); pending charges are not counted.
    places.py reads DAs from the PMTiles, whose
    simplified edges leave slivers: 28 of 20,118 establishments (0.14%), all
    within 0.4 m of a DA, go unplaced and are left out

SOURCES (retrieved 2026-11-11):
  - ON-Marg 2021, DA sheet DA_2021 (20,468 Ontario DAs) of
    https://www.publichealthontario.ca/-/media/Data-Files/index-on-marg.xlsx
    (2,608,641 B, Last-Modified 2025-12-09), linked from PHO's ON-Marg page and
    OCHPP's onmargON.php. Built from the 2021 Census Profile. Terms: the file's
    Disclaimers sheet allows use "without permission for non-commercial purposes
    only" with credit to Public Health Ontario and St. Michael's Hospital, and no
    "changes and/or modifications ... to the content" without written
    permission; PHO's site terms grant personal, non-commercial use. by_da.csv
    repeats the values unchanged (rounded); by_nbhd.csv is our derivation, not
    theirs. Cite: Matheson FI, Moloney G, van Ingen T. 2021 Ontario
    marginalization index. Toronto, ON: St. Michael's Hospital (Unity Health
    Toronto); 2023. Joint publication with Public Health Ontario.
  - CIMD 2021, Ontario index, StatCan 45-20-0001 (released 2023-11-10,
    corrected 2024-10-22; now archived, and the latest edition), from
    https://www150.statcan.gc.ca/n1/pub/45-20-0001/2023001/csv/on_scores_quintiles_csv-eng.zip
    (www150, unlike www12, takes scripts). Statistics Canada Open Licence. Its
    scores are the Ontario index's, not the national one's; the Ontario index
    drops 10 of the 32 input variables (on_notes_EN.csv). CIMD's own DA
    population is the long-form sample count, so pop21 weights both indexes
  - DineSafe, City of Toronto Open Data package dinesafe, resource Dinesafe.csv
    (refreshed daily), Open Government Licence - Toronto

Not used:
  - Ontario Community Health Profiles Partnership (ontariohealthprofiles.ca):
    chronic-disease prevalence (diabetes and high blood pressure FY2021/22,
    asthma 2021/22, COPD and congestive heart failure 2022/23, 2+ and 4+ chronic
    conditions, mental health and addiction visits CY2023), ED visits 2021-23 and
    2023-25, hospitalizations 2021-23, premature mortality 2021-23 and cancer
    screening 2021-24, all for the 158 neighbourhoods (the site's data since
    2020-01-27 is on the 158 model; 2015-17 tables are on the 140). Each Excel
    table opens only after a click-through "Agree" to OCHPP's terms, which allow
    use "only for non-profit, community-based purposes relating to health or
    wellbeing", require attribution and forbid commercial use. Accepting those
    is the site owner's decision, so the tables are not fetched
  - Wellbeing Toronto - Health (CKAN wellbeing-toronto-health): 140
    neighbourhoods, last refreshed 2014
"""
import datetime as dt
import json
import sys
import zipfile
from pathlib import Path

import pandas as pd

import places
from download import md5

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "health"
DETAIL = HERE / "out"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures" / "2021"

FILES = {
    "onmarg": RAW / "index-on-marg-2021.xlsx",
    "cimd": RAW / "cimd_2021_on_csv.zip",
    "dinesafe": RAW / "toronto_dinesafe.csv",
}
ONMARG = {  # by_da.csv suffix -> ON-Marg 2021 column stem
    "hd": "households_dwellings", "mr": "material_resources",
    "al": "age_labourforce", "rn": "racialized_NC_pop",
}
CIMD = {  # by_da.csv suffix -> CIMD 2021 column stem
    "ri": "Residential instability", "ec": "Ethno-cultural composition",
    "ed": "Economic dependency", "sv": "Situational vulnerability",
}
SEVERITY = {"M - Minor": "minor", "S - Significant": "significant", "C - Crucial": "crucial"}
STATUS = {"Pass": "pass", "Conditional Pass": "conditional", "Closed": "closed"}


def onmarg(dauids: pd.Series) -> pd.DataFrame:
    m = pd.read_excel(FILES["onmarg"], sheet_name="DA_2021", dtype={"DAUID": str})
    out = pd.DataFrame({"dauid": m.DAUID, "onmarg_pop": m.Pop2021})
    for k, v in ONMARG.items():
        out[f"onmarg_{k}"] = m[f"{v}_DA21"]
        out[f"onmarg_{k}_q"] = m[f"{v}_q_DA21"]
    return out[out.dauid.isin(dauids)]


def cimd(dauids: pd.Series) -> pd.DataFrame:
    with zipfile.ZipFile(FILES["cimd"]) as z, z.open("on_scores_quintiles_EN.csv") as f:
        c = pd.read_csv(f, dtype={"Dissemination Area (DA)": str})
    out = pd.DataFrame({"dauid": c["Dissemination Area (DA)"], "cimd_pop": c["DA Population"]})
    for k, v in CIMD.items():
        out[f"cimd_{k}"] = c[f"{v} Scores"]
        out[f"cimd_{k}_q"] = c[f"{v} Quintiles"]
    return out[out.dauid.isin(dauids)]


def by_nbhd(da: pd.DataFrame) -> pd.DataFrame:
    """Population-weighted mean score and share in quintile 5, per dimension."""
    rows = {}
    for index, dims in (("onmarg", ONMARG), ("cimd", CIMD)):
        scored = da[da[f"{index}_{next(iter(dims))}"].notna()]
        w = scored.pop21
        g = scored.assign(w=w).groupby("nbhd_id")
        rows[f"{index}_pop"] = g.w.sum()
        for k in dims:
            col = f"{index}_{k}"
            rows[col] = (scored[col] * w).groupby(scored.nbhd_id).sum() / rows[f"{index}_pop"]
            rows[f"{col}_q5"] = (w * (scored[f"{col}_q"] == 5)).groupby(scored.nbhd_id).sum() / rows[f"{index}_pop"]
    out = pd.DataFrame(rows)
    out.insert(0, "pop21", da.groupby("nbhd_id").pop21.sum())
    return out.reset_index()


def figure(measure: str, da: pd.DataFrame) -> pd.Series:
    """A 2021 figures file's DA values (in common.json's order), e.g. lim_at: the
    LIM-AT low-income share (%) of people in private households."""
    v = json.loads((FIGURES / f"{measure}.json").read_text())["v"]
    if len(v) != len(da):
        sys.exit(f"{measure}.json has {len(v)} values for {len(da)} DAs")
    return pd.to_numeric(pd.Series(v, index=da.index), errors="coerce")


def corr(x: pd.Series, y: pd.Series) -> dict:
    ok = x.notna() & y.notna()
    x, y = x[ok], y[ok]
    return {"n": int(ok.sum()), "r": round(float(x.corr(y)), 3), "rho": round(float(x.rank().corr(y.rank())), 3)}


def dinesafe() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    d = pd.read_csv(FILES["dinesafe"], low_memory=False)
    d["date"] = pd.to_datetime(d.inspectionDate, errors="coerce")
    est = d.drop_duplicates("estId")[["estId", "estName", "address", "latitude", "longitude"]]
    if (d.groupby("estId")[["latitude", "longitude"]].nunique() > 1).any().any():
        sys.exit("an establishment has more than one location")
    est = places.place(est, "longitude", "latitude")
    d = d.merge(est[["estId", "dauid", "nbhd_id"]], on="estId", how="left")
    d["year"] = d.date.dt.year
    insp = d.drop_duplicates(["estId", "inspectionDate"])
    p = insp[insp.nbhd_id.notna()]
    g = p.groupby(["nbhd_id", "year"])
    out = pd.DataFrame({"establishments": g.estId.nunique(), "inspections": g.size()})
    for k, v in STATUS.items():
        out[f"insp_{v}"] = (p.inspectionStatus == k).groupby([p.nbhd_id, p.year]).sum()
    f = d[d.nbhd_id.notna() & d.typeDesc.notna()]
    sev = f.severity.map(SEVERITY).fillna("admin")
    gi = [f.nbhd_id, f.year]
    out["infractions"] = f.groupby(gi).size()
    for v in (*SEVERITY.values(), "admin"):
        out[f"infr_{v}"] = (sev == v).groupby(gi).sum()
    fined = f.OutcomeDesc.fillna("").str.match(r"Conviction\s*[-:]\s*Fined")
    out["convictions_fined"] = fined.groupby(gi).sum()
    out["fines"] = f.amountFined.where(fined).groupby(gi).sum()
    out = out.fillna(0).round().astype(int).reset_index()
    infr = d[d.typeDesc.notna()]
    check = {
        "rows": int(len(d)), "establishments": int(len(est)), "inspections": int(len(insp)),
        "infractions": int(len(infr)),
        "window": [d.date.min().date().isoformat(), d.date.max().date().isoformat()],
        "establishments_placed": round(float(est.nbhd_id.notna().mean()), 4),
        "inspections_placed": round(float(insp.nbhd_id.notna().mean()), 4),
        "inspection_outcomes": {k: int(v) for k, v in insp.inspectionStatus.value_counts().items()},
        "infraction_severity": {k: int(v) for k, v in
                                infr.severity.map(SEVERITY).fillna("admin").value_counts().items()},
        "fine_outcomes": {k: int(v) for k, v in d.OutcomeDesc.value_counts().items()},
        "boundaries": places.da_polygons().attrs["source"],
    }
    return out, est, check


def split(df: pd.DataFrame, onmarg: bool = False) -> pd.DataFrame:
    """The columns of one index: CIMD (committed) or ON-Marg (pipeline/out/ only)."""
    keep = "onmarg_" if onmarg else "cimd_"
    return df[[c for c in df.columns if not c.startswith(("onmarg_", "cimd_")) or c.startswith(keep)]]


def main() -> int:
    missing = [p.name for p in FILES.values() if not p.exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)
    DETAIL.mkdir(exist_ok=True)
    manifest = {"built": dt.date.today().isoformat(), "files": {
        k: {"name": p.name, "bytes": p.stat().st_size, "md5": md5(p),
            "retrieved": dt.date.fromtimestamp(p.stat().st_mtime).isoformat()} for k, p in FILES.items()}}
    checks = {}

    common = places.common()
    om, cm = onmarg(common.dauid), cimd(common.dauid)
    da = common[["dauid", "nbhd_id", "pop21"]].merge(om, on="dauid", how="left").merge(cm, on="dauid", how="left")
    if len(da) != len(common):
        sys.exit("duplicate DAUIDs in an index")
    da["lim_at"] = figure("lim_at", da)
    city = da.pop21.sum()
    for index, dims, df in (("onmarg", ONMARG, om), ("cimd", CIMD, cm)):
        first = f"{index}_{next(iter(dims))}"
        scored = da[first].notna()
        checks[index] = {
            "das": int(len(common)), "das_found": int(len(df)), "das_scored": int(scored.sum()),
            "pop21_covered": round(float(da.pop21[scored].sum() / city), 4),
            "unscored": da.loc[~scored, ["dauid", "pop21"]].to_dict(orient="records"),
            # Toronto's population by Ontario quintile, per dimension
            "pop_share_by_quintile": {k: {int(q): round(float(s), 3) for q, s in
                                          (da.pop21.groupby(da[f"{index}_{k}_q"]).sum() / city).items()}
                                      for k in dims},
            "vs_lim_at_da": {k: corr(da[f"{index}_{k}"], da.lim_at) for k in dims},
        }
    checks["onmarg"]["scored_zero_pop"] = da.loc[(da.pop21 == 0) & da.onmarg_mr.notna(), "dauid"].tolist()
    checks["onmarg"]["pop_equals_pop21"] = int((da.onmarg_pop == da.pop21).sum())
    checks["cimd"]["pop_vs_pop21"] = {"sum_cimd_pop": int(da.cimd_pop.sum()),
                                      "sum_pop21_scored": int(da.pop21[da.cimd_ri.notna()].sum())}
    # each dimension against the census measure closest to one of its inputs
    # (|r| 0.53 to 0.92 on the 2021 run; near 0 if the DAs didn't line up), DA by DA
    checks["vs_census_da"] = {}
    for col, m in (("onmarg_mr", "transfers"), ("onmarg_mr", "degree"), ("onmarg_hd", "renter"),
                   ("onmarg_al", "age65"), ("onmarg_rn", "imm_recent"), ("cimd_sv", "degree"),
                   ("cimd_ri", "renter"), ("cimd_ed", "age65"), ("cimd_ec", "imm_recent")):
        checks["vs_census_da"][f"{col}~{m}"] = corr(da[col], figure(m, da))
    # matching dimensions of the two indexes, DA by DA
    checks["onmarg_vs_cimd_da"] = {f"{a}~{b}": corr(da[f"onmarg_{a}"], da[f"cimd_{b}"])
                                   for a, b in (("hd", "ri"), ("rn", "ec"), ("al", "ed"), ("mr", "sv"))}

    nb = by_nbhd(da)
    li = (da.pop21 * da.lim_at / 100).groupby(da.nbhd_id).sum() / da.pop21.where(da.lim_at.notna()).groupby(
        da.nbhd_id).sum()
    nbi = nb.set_index("nbhd_id")
    checks["vs_lim_at_nbhd"] = {"note": "LIM-AT share of pop21 in DAs with a value, against each index",
                                **{f"onmarg_{k}": corr(nbi[f"onmarg_{k}"], li * 100) for k in ONMARG},
                                **{f"cimd_{k}": corr(nbi[f"cimd_{k}"], li * 100) for k in CIMD}}
    checks["nbhds"] = int(nb.nbhd_id.nunique())
    print(f"ON-Marg: {checks['onmarg']['das_scored']} of {len(common)} DAs; "
          f"CIMD: {checks['cimd']['das_scored']}")
    print("material resources vs LIM-AT, DA:", checks["onmarg"]["vs_lim_at_da"]["mr"],
          "nbhd:", checks["vs_lim_at_nbhd"]["onmarg_mr"])
    print("ON-Marg vs CIMD:", checks["onmarg_vs_cimd_da"])

    ds, est, checks["dinesafe"] = dinesafe()
    est.to_csv(DETAIL / "health_dinesafe.csv", index=False)
    tot = ds.groupby("nbhd_id")[["establishments", "inspections", "infractions"]].sum()
    pop = places.population()
    checks["dinesafe"]["top_nbhds_by_inspections"] = {int(k): int(v) for k, v in
                                                      tot.inspections.nlargest(5).items()}
    checks["dinesafe"]["nbhds"] = int(tot.index.nunique())
    checks["dinesafe"]["infractions_per_inspection_vs_onmarg_mr"] = corr(
        tot.infractions / tot.inspections, nbi.onmarg_mr)
    checks["dinesafe"]["inspections_vs_pop21"] = corr(tot.inspections, pop)
    print("dinesafe:", {k: v for k, v in checks["dinesafe"].items() if not isinstance(v, dict)})
    unplaced = est[est.nbhd_id.isna()]
    for _, r in unplaced.head(10).iterrows():
        print(f"  unplaced: {r.estName} | {r.address} | {r.latitude}, {r.longitude}")

    cols = ["dauid", "nbhd_id"] + [c for c in da.columns if c.startswith(("onmarg_", "cimd_"))
                                   and not c.endswith("_pop")]
    out = da[cols].copy()
    for c in cols[2:]:
        out[c] = out[c].astype("Int64") if c.endswith("_q") else out[c].round(3)
    # ON-Marg's terms (non-commercial, no modification of the content) keep its
    # values out of the committed files: they go to pipeline/out/ (gitignored)
    split(out).to_csv(OUT / "by_da.csv", index=False)
    split(out, True).to_csv(DETAIL / "health_onmarg_by_da.csv", index=False)
    for c in nb.columns:
        if c.endswith("_q5"):
            nb[c] = nb[c].round(3)
        elif c.endswith("pop") or c == "pop21":
            nb[c] = nb[c].round().astype(int)
        elif c != "nbhd_id":
            nb[c] = nb[c].round(3)
    split(nb).to_csv(OUT / "by_nbhd.csv", index=False)
    split(nb, True).to_csv(DETAIL / "health_onmarg_by_nbhd.csv", index=False)
    ds["nbhd_id"] = ds.nbhd_id.astype(int)
    ds["year"] = ds.year.astype(int)
    ds.to_csv(OUT / "dinesafe_by_nbhd.csv", index=False)
    manifest["rows"] = {"by_da": len(out), "by_nbhd": len(nb), "dinesafe_by_nbhd": len(ds)}
    manifest["checks"] = checks
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
