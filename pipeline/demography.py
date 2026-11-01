"""Age groups, period of immigration and dwelling characteristics by neighbourhood,
for the forecast model:
pipeline/demography/nbhd.csv and manifest.json.

    python pipeline/demography.py

Reads the DA profiles of 2021 and 2016 (the zips download.py fetches), the 2011
census profile CSV, and the 2006 and 2011 NHS extracts that demography_ivt.py
writes from the two Beyond 20/20 tables (run that first, under WSL). Each DA counts
toward its neighbourhood as on the Census Insights page (the figures files'
nbhd_id for 2011 to 2021, pipeline/census/da_2006.csv for 2006); NHS DAs with a
global non-response rate of 50% or more, and 2006 DAs whose short form was
suppressed, are left out, as there.

Counts per neighbourhood and census (one row each):
  age_tot          population by age groups (100% data)
  a0_14 ... a75    population in ten-year bands from five-year groups:
                   0-14, 15-24, 25-34, 35-44, 45-54, 55-64, 65-74, 75+
  imm_base         population in private households by immigrant status (sample)
  non_imm, imm, npr  non-immigrants, immigrants, non-permanent residents
  imm_0_5, imm_5_10  immigrants who arrived in the five years before the census,
                   and in the five years before that (2016-21 and 2011-15 for 2021;
                   2011-16 and 2006-10; 2006-11 and 2001-05; 2001-06 and 1996-2000)

  dw_tot, detached, attached  occupied private dwellings, single-detached, and
                   semi-detached, row and duplex (100% data)
  bed_tot, bed3    dwellings by number of bedrooms, and those with 3 or more
  rep_tot, rep_major  dwellings by condition, and those needing major repairs
  own_tot, own_mort   owner households, and those with a mortgage (each DA's
                   published percentage applied to its owners)
The dwelling counts are 2011 to 2021 only (2011: structure types from the census
profile, the rest from the NHS); 2006 has no bedroom counts or mortgage shares.

Checks: the City's age bands add up to its total; the neighbourhood shares aged
0-14 and 65+ and the share of recent immigrants reproduce insights.json's figures
for every census (to 0.15 points; the 2016 and 2021 age shares there are the DAs'
published percentages weighted by population, so to 0.6 and on average 0.15), and
the DA sums are close to the City rows.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUTDIR = HERE / "out"
WEB = HERE.parent / "web" / "public"
FIGURES = WEB / "data" / "figures"
OUT = HERE / "demography"
TORONTO_CSD = "3520005"

FIVE = ["0_4", "5_9", "10_14", "15_19", "20_24", "25_29", "30_34", "35_39", "40_44", "45_49", "50_54",
        "55_59", "60_64", "65_69", "70_74", "75_79", "80_84", "85"]
BANDS = {"a0_14": FIVE[0:3], "a15_24": FIVE[3:5], "a25_34": FIVE[5:7], "a35_44": FIVE[7:9], "a45_54": FIVE[9:11],
         "a55_64": FIVE[11:13], "a65_74": FIVE[13:15], "a75": FIVE[15:]}
IMM = ["imm_base", "non_imm", "imm", "npr", "imm_0_5", "imm_5_10"]
# Dwelling counts in (base, part) pairs, each pooled over the DAs with both. 2011 to
# 2021 only: the 2006 profile has no bedroom counts or mortgage shares.
DWELL = [("dw_tot", "detached"), ("dw_tot", "attached"), ("bed_tot", "bed3"), ("rep_tot", "rep_major"), ("own_tot", "own_mort")]
DWELL_COLS = ["dw_tot", "detached", "attached", "bed_tot", "bed3", "rep_tot", "rep_major", "own_tot", "own_mort"]
COLS = ["age_tot", *BANDS, *IMM, *DWELL_COLS]


def five_label(k: str) -> str:
    return "85 years and over" if k == "85" else f"{k.replace('_', ' to ')} years"


# 2021 CHARACTERISTIC_ID / 2016 Member ID -> (key, label)
IDS = {
    "2021": {8: ("age_tot", "Total - Age groups of the population"), **{i: (f"y{k}", five_label(k)) for i, k in zip([10, 11, 12, *range(14, 24), *range(25, 30)], FIVE)},
             1527: ("imm_base", "Total - Immigrant status and period of immigration"), 1528: ("non_imm", "Non-immigrants"),
             1529: ("imm", "Immigrants"), 1536: ("imm_0_5", "2016 to 2021"), 1535: ("imm_5_10", "2011 to 2015"),
             1537: ("npr", "Non-permanent residents"),
             41: ("dw_tot", "Total - Occupied private dwellings by structural type"), 42: ("detached", "Single-detached house"),
             43: ("semi", "Semi-detached house"), 44: ("row", "Row house"), 45: ("duplex", "Apartment or flat in a duplex"),
             1421: ("bed_tot", "Total - Occupied private dwellings by number of bedrooms"), 1425: ("bed3", "3 bedrooms"),
             1426: ("bed4", "4 or more bedrooms"), 1449: ("rep_tot", "Total - Occupied private dwellings by dwelling condition"),
             1451: ("rep_major", "Major repairs needed"), 1482: ("own_tot", "Total - Owner households in non-farm"),
             1483: ("mort_pct", "% of owner households with a mortgage")},
    "2016": {8: ("age_tot", "Total - Age groups and average age of the population"), **{i: (f"y{k}", five_label(k)) for i, k in zip([10, 11, 12, *range(14, 24), *range(25, 30)], FIVE)},
             1140: ("imm_base", "Total - Immigrant status and period of immigration"), 1141: ("non_imm", "Non-immigrants"),
             1142: ("imm", "Immigrants"), 1149: ("imm_0_5", "2011 to 2016"), 1148: ("imm_5_10", "2006 to 2010"),
             1150: ("npr", "Non-permanent residents"),
             41: ("dw_tot", "Total - Occupied private dwellings by structural type"), 42: ("detached", "Single-detached house"),
             45: ("semi", "Semi-detached house"), 46: ("row", "Row house"), 47: ("duplex", "Apartment or flat in a duplex"),
             1624: ("bed_tot", "Total - Occupied private dwellings by number of bedrooms"), 1628: ("bed3", "3 bedrooms"),
             1629: ("bed4", "4 or more bedrooms"), 1651: ("rep_tot", "Total - Occupied private dwellings by dwelling condition"),
             1653: ("rep_major", "Major repairs needed"), 1671: ("own_tot", "Total - Owner households in non-farm"),
             1672: ("mort_pct", "% of owner households with a mortgage")},
}


def read_zip(year: str) -> pd.DataFrame:
    """Toronto's DA and City rows for the IDS of 2021 or 2016: geo_code x key."""
    if year == "2021":
        z, name = RAW / "98-401-X2021006_Ontario_eng_CSV.zip", "98-401-X2021006_English_CSV_data_Ontario.csv"
        prefixes = (b'2021,"2021S05123520', b'2021,"2021A00053520005"')
    else:
        z, name = RAW / "98-401-X2016044_ONTARIO_eng_CSV.zip", "98-401-X2016044_ONTARIO_English_CSV_data.csv"
        prefixes = (b'2016,"3520',)
    ids = IDS[year]
    rows = {}
    with zipfile.ZipFile(z) as zf, zf.open(name) as f:
        header = next(csv.reader([f.readline().decode("latin-1").lstrip("﻿")]))
        if year == "2021":
            gi, ii, ni, vi = (header.index(c) for c in ("ALT_GEO_CODE", "CHARACTERISTIC_ID", "CHARACTERISTIC_NAME", "C1_COUNT_TOTAL"))
        else:
            gi, ii, ni = 1, header.index("Member ID: Profile of Dissemination Areas (2247)"), header.index("DIM: Profile of Dissemination Areas (2247)")
            vi = header.index("Dim: Sex (3): Member ID: [1]: Total - Sex")
        for line in f:
            if not line.startswith(prefixes):
                continue
            r = next(csv.reader([line.decode("latin-1")]))
            cid = int(r[ii])
            if cid not in ids:
                continue
            key, label = ids[cid]
            if not r[ni].strip().startswith(label):
                sys.exit(f"{year} characteristic {cid} is {r[ni]!r}, not {label!r}")
            code = r[gi]
            if year == "2016" and not (len(code) == 8 or code == TORONTO_CSD):
                continue
            try:
                v = float(r[vi])
            except ValueError:
                v = np.nan  # x, .., F: no figure
            rows.setdefault(code, {})[key] = v
    return pd.DataFrame.from_dict(rows, orient="index")


def read_2011() -> pd.DataFrame:
    """Age groups from the 2011 census profile CSV, immigration from the NHS extract."""
    topics = {"Age characteristics": {"Total population by age groups": "age_tot", **{five_label(k): f"y{k}" for k in FIVE}},
              "Household and dwelling characteristics": {
                  "Total number of occupied private dwellings by structural type of dwelling": "dw_tot",
                  "Single-detached house": "detached", "Semi-detached house": "semi", "Row house": "row", "Apartment, duplex": "duplex"}}
    rows = {}
    with open(RAW / "98-316-XWE2011001-1501-ONT.csv", "rb") as f:
        f.readline()
        for line in f:
            if not line.startswith(b"3520") or not (b"Age characteristics" in line or b"Household and dwelling" in line):
                continue
            r = next(csv.reader([line.decode("latin-1")]))
            label = r[4]
            names = topics.get(r[3], {})
            if label.strip() not in names or (r[3] == "Age characteristics" and label.startswith("      ")):
                continue  # single years of age are indented further
            key = names[label.strip()]
            row = rows.setdefault(r[0], {})
            if key in row:
                sys.exit(f"2011: {r[0]} has {label.strip()!r} twice")
            row[key] = float(r[6]) if r[6] not in ("", "x", "..", "F") else np.nan
    age = pd.DataFrame.from_dict(rows, orient="index")
    nhs = pd.read_csv(OUTDIR / "demography_nhs2011.csv", dtype={"geo_code": str, "dq": str}).set_index("geo_code")
    das = nhs[nhs.level == "DA AD"]
    das = das[das.dq.str[3] != "1"]  # global non-response 50% or more
    nhs_cols = [*IMM, "rep_tot", "rep_major", "bed_tot", "bed3", "bed4", "own_tot", "mort_pct"]
    return age.join(pd.concat([das, nhs.loc[[TORONTO_CSD]]])[nhs_cols], how="outer")


def read_2006() -> pd.DataFrame:
    """As census2006.py: a DA whose short form was suppressed (non-response of 25% or
    more, by its data-quality flag) counts as having no figures."""
    from census2006 import PROFILE, SHORT_SUPPRESSED
    d = pd.read_csv(OUTDIR / "demography_2006.csv", dtype={"geo_code": str}).set_index("geo_code")
    p = pd.read_csv(PROFILE, dtype={"geo_code": str}, usecols=["geo_code", "level", "label"])
    dq = p[p.level == "DA"].set_index("geo_code").label.str.split().str[-1]
    short = dq.index[dq.str[SHORT_SUPPRESSED[0]] == SHORT_SUPPRESSED[1]]
    d.loc[d.index.intersection(short)] = np.nan
    out = pd.DataFrame(index=d.index)
    out["age_tot"] = d.age_tot
    for k in FIVE:
        out[f"y{k}"] = d[f"m{k}"] + d[f"f{k}"]
    out[IMM] = d[IMM]
    return out


def bands(d: pd.DataFrame) -> pd.DataFrame:
    out = d[["age_tot", *IMM]].copy()
    for b, ks in BANDS.items():
        out[b] = d[[f"y{k}" for k in ks]].sum(axis=1, min_count=len(ks))
    if "dw_tot" in d:
        same = ["dw_tot", "detached", "bed_tot", "rep_tot", "rep_major", "own_tot"]
        out[same] = d[same]
        out["attached"] = d[["semi", "row", "duplex"]].sum(axis=1, min_count=3)
        out["bed3"] = d[["bed3", "bed4"]].sum(axis=1, min_count=2)
        out["own_mort"] = d.mort_pct / 100 * d.own_tot  # the published share applied to the DA's owners
    else:
        out[DWELL_COLS] = np.nan
    return out[COLS]


def nbhd_of(year: str) -> pd.DataFrame:
    """Each DA's neighbourhood and households (null where the census has none)."""
    if year == "2006":
        d = pd.read_csv(HERE / "census" / "da_2006.csv", dtype={"dauid": str}).set_index("dauid")
        return pd.DataFrame({"nbhd_id": d.nbhd_id, "hh": 1.0})  # 2006's suppression is applied in read_2006
    c = json.loads((FIGURES / year / "common.json").read_text())
    return pd.DataFrame({"nbhd_id": c["nbhd_id"], "hh": [np.nan if v is None else v for v in c["hh"]]}, index=c["dauid"])


def by_nbhd(d: pd.DataFrame, nb: pd.DataFrame) -> pd.DataFrame:
    """Sums by neighbourhood over the DAs with every count of the group (and, as
    insights.aggregate requires for shares, a household count)."""
    d = d.join(nb, how="inner")
    out = pd.DataFrame(index=sorted(d.nbhd_id.unique()))
    age_ok = d[["age_tot", *BANDS]].notna().all(axis=1) & d.hh.notna()
    imm_ok = d[IMM].notna().all(axis=1) & d.hh.notna()
    for c in ["age_tot", *BANDS]:
        out[c] = d[age_ok].groupby("nbhd_id")[c].sum()
    for c in IMM:
        out[c] = d[imm_ok].groupby("nbhd_id")[c].sum()
    for base, part in DWELL:
        ok = d[base].notna() & d[part].notna() & d.hh.notna()
        g = d[ok].groupby("nbhd_id")
        out[part] = g[part].sum() if ok.any() else np.nan
        out[f"{part}_base"] = g[base].sum() if ok.any() else np.nan
    for base in ("dw_tot", "bed_tot", "rep_tot", "own_tot"):  # the base column: its first pair's DAs
        first = next(p for b, p in DWELL if b == base)
        out[base] = out.pop(f"{first}_base")
    for base, part in DWELL:  # a later pair on the same base must have pooled the same DAs
        if f"{part}_base" in out:
            if not np.allclose(out.pop(f"{part}_base").fillna(0), out[base].fillna(0)):
                sys.exit(f"{part}: pooled over different DAs from {base}")
    return out


def main() -> int:
    for f in (OUTDIR / "demography_2006.csv", OUTDIR / "demography_nhs2011.csv"):
        if not f.exists():
            sys.exit(f"{f} is missing: run pipeline/demography_ivt.py under WSL (see its docstring)")
    ins = json.loads((WEB / "insights.json").read_text(encoding="utf-8"))
    ids = [n["id"] for n in ins["nbhd"]]
    frames, checks = [], {}
    for year, read in (("2006", read_2006), ("2011", read_2011), ("2016", lambda: read_zip("2016")), ("2021", lambda: read_zip("2021"))):
        raw = read()
        d = bands(raw)
        city = d.loc[TORONTO_CSD].copy()
        if city[["age_tot", *BANDS]].isna().all():  # the 2011 DA file has no City row: its DAs' sums stand in
            city[["age_tot", *BANDS]] = d.drop(index=TORONTO_CSD)[["age_tot", *BANDS]].dropna().sum()
        nb = by_nbhd(d.drop(index=TORONTO_CSD), nbhd_of(year)).reindex(ids)
        need = COLS if year != "2006" else ["age_tot", *BANDS, *IMM]
        if nb[need].isna().any().any():
            sys.exit(f"{year}: neighbourhoods without a figure: {nb[nb[need].isna().any(axis=1)].index.tolist()[:5]}")
        ck = {"bands_vs_total": float(city[list(BANDS)].sum() / city.age_tot - 1),
              "das_vs_city": {c: float(nb[c].sum() / city[c] - 1) for c in ("age_tot", "imm_base", "imm_0_5")}}
        # insights.json's shares, from the same DAs and bases
        mine = {"age0_14": nb.a0_14 / nb.age_tot * 100, "age65": (nb.a65_74 + nb.a75) / nb.age_tot * 100,
                "imm_recent": nb.imm_0_5 / nb.imm_base * 100}
        if year != "2006":
            mine["detached"] = nb.detached / nb.dw_tot * 100
        ck["max_diff_vs_insights"], ck["mean_diff_vs_insights"] = {}, {}
        for m, v in mine.items():
            want = np.array(ins["measures"][m]["values"][year], float)
            diff = np.abs(v.round(1).values - want)
            ck["max_diff_vs_insights"][m] = float(np.nanmax(diff))
            ck["mean_diff_vs_insights"][m] = float(np.nanmean(diff))
        checks[year] = ck
        print(f"{year}: City age bands {ck['bands_vs_total']:+.2%} of its total; DA sums vs City "
              + ", ".join(f"{c} {x:+.2%}" for c, x in ck["das_vs_city"].items())
              + "; difference from insights.json, largest and mean: "
              + ", ".join(f"{m} {x:.2f} {ck['mean_diff_vs_insights'][m]:.3f}" for m, x in ck["max_diff_vs_insights"].items()))
        # insights.json's age shares for 2016 and 2021 are the DAs' published percentages
        # weighted by population, not pooled counts: the two agree only to rounding.
        tol = {m: 0.15 if m in ("imm_recent", "detached") or year in ("2006", "2011") else 0.6 for m in mine}
        bad = {m: x for m, x in ck["max_diff_vs_insights"].items() if x > tol[m] or ck["mean_diff_vs_insights"][m] > 0.15}
        if bad or abs(ck["bands_vs_total"]) > 0.005:
            sys.exit(f"{year}: check failed: {bad or ck['bands_vs_total']}")
        frames.append(nb[COLS].round(0).astype("Int64").assign(year=int(year)).rename_axis("nbhd_id").reset_index())
    out = pd.concat(frames)[["nbhd_id", "year", *COLS]]
    OUT.mkdir(exist_ok=True)
    out.to_csv(OUT / "nbhd.csv", index=False, lineterminator="\n")
    (OUT / "manifest.json").write_text(json.dumps({"columns": COLS, "checks": checks}, indent=2) + "\n")
    print(f"wrote {OUT / 'nbhd.csv'} ({len(out)} rows) and manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
