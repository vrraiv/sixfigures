"""CMHC housing supply and rental market for the City of Toronto (model inputs, not part
of the site): pipeline/cmhc/*.csv and pipeline/cmhc/manifest.json.

    python pipeline/cmhc.py

Reads pipeline/raw/cmhc/, which download.py fills:
  scu/scu-YYYY-MM.xlsx      Starts, completions and under construction by census
                            subdivision (Housing Information Monthly), from January 2021.
                            March 2021 is not on CMHC's server; its starts and completions
                            come from the year-to-date totals around it.
  rms/rms_zones_YYYY.csv    Rental Market Survey summary, October, by survey zone in the
                            Toronto CMA (from 2010), row and apartment, all bedroom types
  rms/rms_city_YYYY.csv     the same for the City as a whole (from 2006)
  RMS2017_3.gdb             CMHC's 2017 survey-zone boundaries (ZONE_2017)

Writes:
  starts_monthly.csv   City of Toronto starts and completions in the month and units under
                       construction at its end, total and (from the 2023 layout) by
                       dwelling type; 2020 from the 2021 editions' previous-year columns
  starts_annual.csv    the year totals (each December edition's year to date)
  rms_city.csv         the City's vacancy, availability, average and median rent, rent
                       change and units by year, with CMHC's quality grades (a-d)
  rms_zones.csv        the same for the 17 zones in the City
  zone_nbhd.csv        each neighbourhood's 2021 renter households by zone (DAs placed in
                       the zone covering most of them)
  rms_nbhd.csv         each neighbourhood's zone average rent and vacancy by year, weighted
                       by those renter shares; withheld where suppressed zones hold more
                       than half its weight

Zones are CMHC's, not the City's neighbourhoods: a neighbourhood's figure is its zones'
figure, so neighbourhoods in one zone get the same value. The survey covers purpose-built
rental (row and apartment structures of 3+ units), not condominiums or secondary units.
"""
import csv
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

from build import METRIC_CRS

HERE = Path(__file__).parent
RAW = HERE / "raw" / "cmhc"
OUT = HERE / "cmhc"
WEB = HERE.parent / "web" / "public"
FIGURES21 = WEB / "data" / "figures" / "2021"
GEOM21 = HERE / "out" / "toronto_da_geom.geojson"
PERMITS = HERE / "permits" / "by_nbhd.csv"

TORONTO_CSD = "Toronto C"
TORONTO_MET = 2270
CITY_ZONES = 17
SCU_GAPS = {"2021-03"}  # editions CMHC doesn't have online
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
TYPES = {"single": "single", "semi": "semi", "row": "row", "apt": "apt", "apartment": "apt", "total": "total"}
ACTIVITIES = {"starts": "starts", "completions": "completions", "under construction": "uc"}
RMS_COLS = ["vacancy", "availability", "avg_rent", "median_rent", "rent_change", "units"]
MIN_WEIGHT = 0.5
XLSX = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_xlsx(path: Path) -> dict:
    """{sheet name: rows of cell strings} (the standard library is enough for these tables)."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{XLSX}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{XLSX}t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).iter(f"{XLSX}sheet"):
        target = rels[s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")].lstrip("/")
        rows = []
        for row in ET.fromstring(z.read(target if target.startswith("xl/") else "xl/" + target)).iter(f"{XLSX}row"):
            vals = {}
            for c in row.iter(f"{XLSX}c"):
                v = c.find(f"{XLSX}v")
                if c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(f"{XLSX}t"))
                elif v is None:
                    continue
                else:
                    val = shared[int(v.text)] if c.get("t") == "s" else v.text
                letters = re.match(r"[A-Z]+", c.get("r")).group(0)
                vals[sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(letters))) - 1] = val
            rows.append([vals.get(i) for i in range(max(vals) + 1)] if vals else [])
        out[s.get("name")] = rows
    return out


def count(v) -> float:
    v = (v or "").strip().replace(",", "")
    if v in ("-", "--"):
        return 0.0
    try:
        return float(v)
    except ValueError:
        return np.nan  # ** (not available) or blank


def parse_scu(path: Path, year: int, month: int) -> list:
    """The Toronto C row of one edition: [(year, month, activity, type, period, value)]."""
    for name, rows in read_xlsx(path).items():
        for i, r in enumerate(rows):
            if len(r) > 1 and (r[1] or "").strip() == TORONTO_CSD:
                break
        else:
            continue
        # Three header rows above the first data row: activity[/type], period, year
        first = next(j for j, row in enumerate(rows) if len(row) > 1 and row[1] and j > 3
                     and any(count(x) == count(x) for x in row[2:]))
        act_row, per_row, yr_row = rows[first - 3], rows[first - 2], rows[first - 1]
        out = []
        for c in range(2, len(r)):
            label = (act_row[c] if c < len(act_row) else None) or ""
            act, _, typ = label.partition("/")
            act, typ = ACTIVITIES.get(act.strip().lower()), TYPES.get((typ or "total").strip().lower())
            per = ((per_row[c] if c < len(per_row) else None) or "").strip().lower()
            yr = (yr_row[c] if c < len(yr_row) else None) or ""
            if act is None or typ is None or not yr.strip().isdigit():
                sys.exit(f"{path.name} ({name}): can't read column {c}: {label!r} / {per!r} / {yr!r}")
            if not per.endswith(MONTHS[month - 1]):
                sys.exit(f"{path.name}: column {c} is for {per!r}, not {MONTHS[month - 1]}")
            out.append((int(yr), month, act, typ, "ytd" if " to " in per else "month", count(r[c])))
        if not {y for y, *_ in out} <= {year, year - 1}:
            sys.exit(f"{path.name}: years {sorted({y for y, *_ in out})}")
        return out
    sys.exit(f"{path.name}: no {TORONTO_CSD!r} row")


def starts() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    files = sorted((RAW / "scu").glob("scu-*.xlsx"))
    if not files:
        sys.exit(f"no editions in {RAW / 'scu'}: run pipeline/download.py")
    rec = []
    for f in files:
        y, m = map(int, f.stem.split("-")[1:])
        rec += [(y, *r) for r in parse_scu(f, y, m)]
    df = pd.DataFrame(rec, columns=["edition", "year", "month", "activity", "type", "period", "value"])
    editions = sorted({f.stem[4:] for f in files})
    expected = pd.period_range(editions[0], editions[-1], freq="M").strftime("%Y-%m")
    gaps = sorted(set(expected) - set(editions))
    if set(gaps) - SCU_GAPS:
        sys.exit(f"editions missing: {sorted(set(gaps) - SCU_GAPS)} (rerun download.py)")
    print(f"{len(files)} editions, {editions[0]} to {editions[-1]}; missing {gaps}; "
          f"by dwelling type from {df[df.type != 'total'].edition.min()}")

    cur = df[df.year == df.edition]
    prev = df[df.year == df.edition - 1]
    # Revisions: a month's figure in its own edition against the next year's previous-year column
    both = cur.merge(prev, on=["year", "month", "activity", "type", "period"], suffixes=("", "_later"))
    rev = both.assign(d=both.value_later - both.value)
    checks = {"editions": len(files), "first": editions[0], "last": editions[-1], "missing_editions": gaps,
              "revisions_in_next_year_edition": {
                  a: {"months_compared": int(len(g)), "max_abs": float(g.d.abs().max()) if len(g) else None}
                  for a, g in rev[(rev.type == "total")].groupby("activity")}}
    # 2020 only exists as the 2021 editions' previous-year columns
    data = pd.concat([cur, prev[prev.year < cur.year.min()]])
    wide = data.pivot_table(index=["year", "month"], columns=["activity", "type", "period"], values="value", aggfunc="first")
    months = pd.period_range(f"{wide.index[0][0]}-{wide.index[0][1]:02d}", editions[-1], freq="M")
    wide = wide.reindex(pd.MultiIndex.from_tuples([(p.year, p.month) for p in months], names=["year", "month"]))

    # Fill a missing edition's month (and, from the next edition's previous-year columns,
    # the same month a year earlier) from the year-to-date totals around it
    for g in gaps:
        y, m = map(int, g.split("-"))
        for yy in (y, y - 1):
            for act in ("starts", "completions"):
                if (yy, m + 1) not in wide.index or (yy, m - 1) not in wide.index:
                    continue
                ytd = wide.loc[(yy, m + 1), (act, "total", "ytd")] - wide.loc[(yy, m + 1), (act, "total", "month")]
                wide.loc[(yy, m), (act, "total", "month")] = ytd - wide.loc[(yy, m - 1), (act, "total", "ytd")]
                wide.loc[(yy, m), (act, "total", "ytd")] = ytd
    # Each month's figures add up to its year to date
    ok = {}
    for act in ("starts", "completions"):
        cum = wide[(act, "total", "month")].groupby(level="year").cumsum()
        diff = (cum - wide[(act, "total", "ytd")]).abs()
        ok[act] = float(diff.max())
    checks["months_sum_to_year_to_date_max_abs_diff"] = ok
    print(f"months against year to date (max abs difference): {ok}; revisions: {checks['revisions_in_next_year_edition']}")

    monthly = pd.DataFrame(index=wide.index)
    for act in ("starts", "completions", "uc"):
        period = "month"
        for typ in ("total", "single", "semi", "row", "apt"):
            col = (act, typ, period)
            if col in wide:
                monthly[act if typ == "total" else f"{act}_{typ}"] = wide[col]
    typed = {}
    for act in ("starts", "completions", "uc"):
        parts = [f"{act}_{t}" for t in ("single", "semi", "row", "apt") if f"{act}_{t}" in monthly]
        if parts:
            has = monthly[parts].notna().all(axis=1)
            typed[act] = float((monthly.loc[has, parts].sum(axis=1) - monthly.loc[has, act]).abs().max())
    checks["dwelling_types_sum_to_total_max_abs_diff"] = typed
    print(f"dwelling types against totals (max abs difference): {typed}")
    monthly.index = [f"{y}-{m:02d}" for y, m in monthly.index]
    monthly = monthly.rename_axis("month").reset_index()

    dec = wide.xs(12, level="month")
    annual = pd.DataFrame({"starts": dec[("starts", "total", "ytd")], "completions": dec[("completions", "total", "ytd")],
                           "uc_december": dec[("uc", "total", "month")]})
    last = wide.index[-1]
    if last[1] != 12:  # the current year so far
        annual.loc[last[0]] = [wide.loc[last, ("starts", "total", "ytd")], wide.loc[last, ("completions", "total", "ytd")], np.nan]
        checks["partial_year"] = f"{last[0]} to month {last[1]}"
    annual.index.name = "year"
    return monthly, annual.reset_index(), checks


def read_rms(path: Path) -> tuple[pd.DataFrame, int]:
    """(rows of one HMIP summary export, its October year)."""
    lines = path.read_text(encoding="latin-1").splitlines()
    year = int(re.search(r"October (\d{4})", lines[1]).group(1))
    rows = []
    for r in csv.reader(lines[3:]):
        if not r or not any(x.strip() for x in r):
            break
        vals, quals = [], []
        for k in range(len(RMS_COLS)):
            v = r[1 + 2 * k].strip() if 1 + 2 * k < len(r) else ""
            vals.append(count(v) if v not in ("**", "++", "") else np.nan)
            quals.append((r[2 + 2 * k].strip() if 2 + 2 * k < len(r) else "") or ("++" if v == "++" else ("**" if v == "**" else "")))
        rows.append([r[0].strip(), *vals, *quals])
    return pd.DataFrame(rows, columns=["name", *RMS_COLS, *[f"{c}_q" for c in RMS_COLS]]), year


def rms() -> tuple[pd.DataFrame, pd.DataFrame, gpd.GeoDataFrame, dict]:
    zones_geo = gpd.read_file(RAW / "RMS2017_3.gdb", layer="ZONE_2017", engine="pyogrio",
                              where=f"MET_CODE = '{TORONTO_MET}'")
    zones_geo["ZONE_CODE"] = zones_geo.ZONE_CODE.astype(int)
    city_geo = zones_geo[zones_geo.ZONE_CODE <= CITY_ZONES].sort_values("ZONE_CODE")
    names = dict(zip(city_geo.ZONE_NAME_EN.str.strip(), city_geo.ZONE_CODE))
    out = []
    for f in sorted((RAW / "rms").glob("rms_zones_*.csv")):
        t, year = read_rms(f)
        if f"_{year}." not in f.name:
            sys.exit(f"{f.name} holds October {year}")
        t = t[t.name.isin(names)]
        if len(t) != CITY_ZONES:
            sys.exit(f"{f.name}: {len(t)} of the {CITY_ZONES} City zones ({sorted(set(names) - set(t.name))} missing)")
        out.append(t.assign(year=year, zone_code=t.name.map(names)))
    zones = pd.concat(out).rename(columns={"name": "zone"})
    city = []
    for f in sorted((RAW / "rms").glob("rms_city_*.csv")):
        t, year = read_rms(f)
        city.append(t.assign(year=year).drop(columns="name"))
    city = pd.concat(city)
    # The zones add up to the City
    z = zones.groupby("year").apply(lambda g: pd.Series({
        "units": g.units.sum(),
        "avg_rent": np.average(g.avg_rent[g.avg_rent.notna()], weights=g.units[g.avg_rent.notna()])}), include_groups=False)
    cmp_ = city.set_index("year")[["units", "avg_rent"]].join(z.add_suffix("_zones"), how="inner")
    checks = {"zone_years": [int(zones.year.min()), int(zones.year.max())],
              "city_years": [int(city.year.min()), int(city.year.max())],
              "units_zones_vs_city_max_abs_diff": float((cmp_.units - cmp_.units_zones).abs().max()),
              "avg_rent_units_weighted_zones_vs_city_max_abs_diff": round(float((cmp_.avg_rent - cmp_.avg_rent_zones).abs().max()), 1),
              "suppressed_zone_years": {c: int(zones[c].isna().sum()) for c in ("vacancy", "avg_rent", "units")}}
    print(f"\nRMS zones {checks['zone_years']}, City {checks['city_years']}; zones vs City: units max diff "
          f"{checks['units_zones_vs_city_max_abs_diff']:.0f}, average rent max diff ${checks['avg_rent_units_weighted_zones_vs_city_max_abs_diff']}")
    print(f"suppressed zone-years: {checks['suppressed_zone_years']}")
    return zones, city, city_geo, checks


def crosswalk(city_geo: gpd.GeoDataFrame, zones: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Each neighbourhood's 2021 renter households by zone."""
    common = json.loads((FIGURES21 / "common.json").read_text())
    renter = json.loads((FIGURES21 / "renter.json").read_text())["v"]
    da = pd.DataFrame({"dauid": common["dauid"], "nbhd_id": common["nbhd_id"], "hh": common["hh"], "renter_pct": renter})
    da["renters"] = da.hh * da.renter_pct / 100
    g = gpd.read_file(GEOM21, engine="pyogrio")[["dauid", "geometry"]].to_crs(METRIC_CRS)
    ov = gpd.overlay(g, city_geo[["ZONE_CODE", "geometry"]].to_crs(METRIC_CRS), how="intersection", keep_geom_type=True)
    ov["a"] = ov.area
    share = ov.groupby(["dauid", "ZONE_CODE"]).a.sum() / ov.groupby("dauid").a.sum()
    best = share.reset_index().sort_values("a", ascending=False).drop_duplicates("dauid").set_index("dauid")
    da["zone_code"] = da.dauid.map(best.ZONE_CODE)
    unplaced = int(da.zone_code.isna().sum())
    if unplaced:
        sys.exit(f"{unplaced} 2021 DAs in no City zone")
    cw = da.groupby(["nbhd_id", "zone_code"]).renters.sum().rename("renters").reset_index()
    cw["share"] = cw.renters / cw.groupby("nbhd_id").renters.transform("sum")
    cw["zone_code"] = cw.zone_code.astype(int)
    # Census renter households by zone against CMHC's purpose-built universe (2021)
    u21 = zones[zones.year == 2021].set_index("zone_code").units
    r21 = da.groupby("zone_code").renters.sum()
    r21.index = r21.index.astype(int)
    checks = {"das": len(da), "das_95pct_in_one_zone": int((best.a >= 0.95).sum()),
              "neighbourhoods": int(cw.nbhd_id.nunique()),
              "neighbourhoods_in_one_zone_90pct": int((cw.groupby("nbhd_id").share.max() >= 0.9).sum()),
              "zone_units_2021_vs_census_renters": {
                  "r": round(float(np.corrcoef(u21.reindex(r21.index), r21)[0, 1]), 3),
                  "units": int(u21.sum()), "renter_households": int(r21.sum())}}
    print(f"\nzones: {checks['das_95pct_in_one_zone']:,} of {len(da):,} DAs >= 95% in one zone; "
          f"{checks['neighbourhoods_in_one_zone_90pct']} of {checks['neighbourhoods']} neighbourhoods >= 90% in one zone")
    print(f"2021 CMHC units vs census renter households by zone: r {checks['zone_units_2021_vs_census_renters']['r']} "
          f"({checks['zone_units_2021_vs_census_renters']['units']:,} units, {checks['zone_units_2021_vs_census_renters']['renter_households']:,} renter households)")
    return cw, checks


def by_nbhd(cw: pd.DataFrame, zones: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for year, z in zones.groupby("year"):
        zz = cw.merge(z[["zone_code", "avg_rent", "vacancy"]], on="zone_code")
        for nid, g in zz.groupby("nbhd_id"):
            row = {"year": year, "nbhd_id": nid}
            for m in ("avg_rent", "vacancy"):
                ok = g[m].notna()
                w = g.share[ok].sum()
                row[m] = np.average(g[m][ok], weights=g.share[ok]) if w >= MIN_WEIGHT else np.nan
                row[f"{m}_weight"] = round(w, 3)
            rows.append(row)
    out = pd.DataFrame(rows)
    out["avg_rent"] = out.avg_rent.round(0).astype("Int64")
    out["vacancy"] = out.vacancy.round(1)
    return out


def main():
    monthly, annual, sc = starts()
    checks = {"starts": sc}
    if PERMITS.exists():  # units on City permits issued in the year, against CMHC starts
        p = pd.read_csv(PERMITS)
        p = p[p.basis == "issued"].groupby("year").created.sum()
        both = annual.set_index("year").join(p.rename("permit_units"), how="inner").dropna(subset=["uc_december"])
        checks["starts"]["vs_permit_units_issued"] = {
            "by_year": {int(y): {"starts": int(r.starts), "permit_units": int(r.permit_units)} for y, r in both.iterrows()},
            "total": {"years": f"{both.index.min()}-{both.index.max()}", "starts": int(both.starts.sum()),
                      "permit_units": int(both.permit_units.sum())}}
        print("CMHC starts vs units on permits issued (starts lag permits):", checks["starts"]["vs_permit_units_issued"])
    zones, city, city_geo, rc = rms()
    checks["rms"] = rc
    cw, cc = crosswalk(city_geo, zones)
    checks["zone_nbhd"] = cc
    nb = by_nbhd(cw, zones)
    withheld = nb.groupby("year").avg_rent.apply(lambda s: int(s.isna().sum())).to_dict()
    checks["rms_nbhd_withheld_avg_rent"] = {int(k): v for k, v in withheld.items()}
    print(f"neighbourhood average rent withheld by year: {withheld}")

    OUT.mkdir(exist_ok=True)
    def save(df, name):
        df.to_csv(OUT / name, index=False, lineterminator="\n", float_format="%.10g")
    for c in monthly.columns[1:]:
        monthly[c] = monthly[c].astype("Int64")
    save(monthly, "starts_monthly.csv")
    save(annual.astype({c: "Int64" for c in ("starts", "completions", "uc_december")}), "starts_annual.csv")
    cols = ["year", *RMS_COLS, *[f"{c}_q" for c in RMS_COLS]]
    save(city[cols].sort_values("year").astype({"units": "Int64"}), "rms_city.csv")
    save(zones[["year", "zone_code", "zone", *cols[1:]]].sort_values(["year", "zone_code"]).astype({"units": "Int64"}), "rms_zones.csv")
    cw["renters"] = cw.renters.round(0).astype(int)
    cw["share"] = cw.share.round(4)
    save(cw, "zone_nbhd.csv")
    save(nb, "rms_nbhd.csv")
    files = {}
    for sub in ("scu", "rms"):
        fs = sorted((RAW / sub).iterdir())
        files[sub] = {"files": len(fs), "bytes": sum(f.stat().st_size for f in fs)}
    manifest = {"built": date.today().isoformat(), "raw": files,
                "sources": {"scu": "CMHC Housing Information Monthly, starts, completions and under construction by CSD",
                            "rms": "CMHC Rental Market Survey via the HMIP table export (2.1.31.3), October, row and apartment, all bedrooms",
                            "zones": "CMHC RMS 2017 zone boundaries (RMS2017_3.gdb, ZONE_2017)"},
                "checks": checks}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nwrote {', '.join(sorted(p.name for p in OUT.iterdir()))} to {OUT}")


if __name__ == "__main__":
    main()
