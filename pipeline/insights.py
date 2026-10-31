"""The Insights page's figures: web/public/insights.json.

    python pipeline/insights.py

Every measure on the maps, for the City's 158 neighbourhoods in the 2011, 2016
and 2021 censuses, plus the city's own values. One method for all three years,
so changes compare like with like (the City publishes official figures on the
158 neighbourhoods for 2021 only; its 2016 and 2011 profiles use the older 140):
each DA counts toward the neighbourhood its figures file assigns it (the one
covering most of its area), and

  - a share computed from counts (renters, condominiums, movers, ...) is the sum
    of its numerators over the sum of its denominators;
  - an income median (household or individual, total or after tax) is
    interpolated within the income group that holds it, from the DAs' pooled
    group counts (measures.INCOME_GROUPS), where those groups reproduce the
    published city median (GROUPS_TOLERANCE); where they don't (2011 household
    income), where the median falls in the open top group, or for dwelling value, owner costs and rent, whose groups the
    profiles don't publish, it is the weighted median of the DA medians on the
    measure's own base (households, owner or renter households, people);
  - a published rate or average is the weighted mean of the DA values on the same
    kind of base.

A neighbourhood's figure is withheld when DAs holding less than half of the
measure's base in it (households, owner or renter households, people) have one (suppression, and in 2011 the NHS's non-response rule).
City values are StatCan's, from breaks.json and breaks_2011.json.

2006 is added for the measures measures.COMPARABLE_2006 marks the same or near
(comparability_2006 records which), from pipeline/census/nbhd_2006.csv and its
manifest's city values (census2006.py, which aggregates the same way). That file
isn't a make prerequisite: census2006.py reads insights.json, so it would be a
cycle; rerun this after `make census2006`.

Reads the cached profile extracts in pipeline/out (build.py, census2016.py,
census2011.py and nhs2011.py write them) and the figures files for the DA to
neighbourhood assignment.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

import csv
import io
import zipfile

import build
import census2011
import census2016
from measures import INCOME_DATED, INCOME_GROUPS, INCOME_GROUPS_2006, MEASURES, NHS_2011, SHARES, SHARES_2011

HERE = Path(__file__).parent
OUT_DIR = HERE / "out"
WEB = HERE.parent / "web" / "public"
FIGURES = WEB / "data" / "figures"
OUT = WEB / "insights.json"
CENSUS06 = HERE / "census"
CPI = json.loads((HERE / "cpi.json").read_text())
YEARS = ["2011", "2016", "2021"]
INCOME_YEAR = {"2011": "2010", "2016": "2015", "2021": "2020"}
MIN_COVERAGE = 0.5
# An income median is interpolated from the DAs' income groups only where those
# groups reproduce StatCan's city median: the 2011 NHS DA household groups are
# sparse (they cover about 70% of households) and put it 8-10% high.
GROUPS_TOLERANCE = 0.03
# The income groups by year, with 2006 (census2006.py aggregates it here; not on the page).
GROUPS = {**INCOME_GROUPS, "2006": INCOME_GROUPS_2006}

# Base of each measure that isn't a share of counts: (method, weight column).
# owners / renters are households by tenure (the profile's tenure counts).
AGG = {
    "med_hh_tot": ("median", "hh"), "med_hh_at": ("median", "hh"), "avg_hh_tot": ("mean", "hh"),
    "med_ind_tot": ("median", "pop"), "med_ind_at": ("median", "pop"),
    "lim_at": ("mean", "pop"), "transfers": ("mean", "pop"),
    "owner30": ("mean", "owners"), "tenant30": ("mean", "renters"), "subsidized": ("mean", "renters"),
    "value": ("median", "owners"), "own_cost": ("median", "owners"), "rent": ("median", "renters"),
    "age0_14": ("mean", "pop"), "age65": ("mean", "pop"),  # published percentages in 2016 and 2021
}


def wmedian(v: np.ndarray, w: np.ndarray) -> float:
    order = np.argsort(v)
    v, w = v[order], w[order]
    c = np.cumsum(w)
    return float(v[np.searchsorted(c, c[-1] / 2)])


def load(year: str) -> pd.DataFrame:
    """The year's DAs with values and counts, indexed by DAUID, with nbhd_id."""
    if year == "2021":
        wide, _ = build.pivot(build.extract(), keep_counts=True)
        wide = wide.rename(columns={"pop21": "pop"})
    elif year == "2016":
        g, _ = census2016.load_2016(keep_counts=True)
        wide = pd.DataFrame(g.drop(columns="geometry")).set_index("DAUID").rename(columns={"pop16": "pop"})
    else:
        g, _ = census2011.load_2011(keep_counts=True)
        wide = pd.DataFrame(g.drop(columns="geometry")).set_index("DAUID").rename(columns={"pop11": "pop"})
    common = json.loads((FIGURES / year / "common.json").read_text())
    nb = pd.Series(common["nbhd_id"], index=common["dauid"])
    wide = wide.join(nb.rename("nbhd_id"), how="left")
    if wide.nbhd_id.isna().any():
        sys.exit(f"{year}: {int(wide.nbhd_id.isna().sum())} DAs without a neighbourhood")
    wide = tenure_bases(wide)
    groups = income_groups(year)
    return wide.join(groups, how="left")


def tenure_bases(wide: pd.DataFrame) -> pd.DataFrame:
    """Adds owners and renters (households by tenure), the bases of the owner and renter measures."""
    renters = wide["n_renter"]
    owners = wide["n_tenure"] - wide["n_renter"]
    # A DA without tenure counts (suppressed, or nulled for NHS non-response)
    # still holds owners and renters: estimate them from its households and its
    # neighbourhood's known split, so it counts as uncovered, not as absent.
    known = owners.notna() & wide.hh.notna()
    frac = (owners[known].groupby(wide.nbhd_id[known]).sum()
            / wide.hh[known].groupby(wide.nbhd_id[known]).sum())
    est = wide.hh * wide.nbhd_id.map(frac)
    wide["owners"] = owners.fillna(est)
    wide["renters"] = renters.fillna(wide.hh - est)
    return wide


def income_groups(year: str) -> pd.DataFrame:
    """The DAs' income-group counts (columns b<ID>), cached in pipeline/out."""
    ids = sorted({i for ids_, _ in INCOME_GROUPS[year].values() for i in ids_})
    cols = [f"b{i}" for i in ids]
    if year == "2011":
        nhs = pd.read_csv(census2011.NHS_CSV, dtype={"geo_code": str, "dq": str, "level": str})
        das = nhs[nhs.level == "DA AD"].set_index("geo_code")
        low = das.dq.str[census2011.GNR_FLAG] == "1"
        out = das[cols].astype(float)
        out[low] = np.nan  # as census2011.py does for the NHS figures
        return out
    cache = OUT_DIR / f"toronto_income_groups_{year}.csv"
    if cache.exists():
        df = pd.read_csv(cache, dtype={"DAUID": str}).set_index("DAUID")
        if list(df.columns) == cols:
            print(f"using cached {cache.name}")
            return df
    want = {str(i) for i in ids}
    print(f"streaming the {year} profile for income groups (several minutes) ...")
    rows = []
    if year == "2021":
        zpath, member, prefix, enc = build.PROFILE_ZIP, build.PROFILE_CSV, build.DA_PREFIX, "latin-1"
        da_col, id_col, val_col = 2, 8, 11
    else:
        zpath, member, prefix, enc = census2016.PROFILE_ZIP, census2016.PROFILE_CSV, census2016.PREFIX, "utf-8"
        da_col, id_col, val_col = 1, 9, 11
    with zipfile.ZipFile(zpath) as z, z.open(member) as f:
        f.readline()
        for line in f:
            if not line.startswith(prefix):
                continue
            r = next(csv.reader([line.decode(enc)]))
            if year == "2016" and r[2] != "4":
                continue
            if r[id_col] in want:
                rows.append((r[da_col], f"b{r[id_col]}", pd.to_numeric(r[val_col].strip(), errors="coerce")))
    df = pd.DataFrame(rows, columns=["DAUID", "key", "value"]).pivot(index="DAUID", columns="key", values="value")[cols]
    df.to_csv(cache)
    print(f"  {len(df):,} DAs -> {cache.name}")
    return df


def interpolated_median(counts: np.ndarray, edges: list) -> float | None:
    """Median from grouped counts, linear within its group; None in the open top group."""
    total = counts.sum()
    if not total > 0:
        return None
    c = np.cumsum(counts)
    k = int(np.searchsorted(c, total / 2))
    lo, hi = edges[k], edges[k + 1]
    if hi is None:
        return None
    before = c[k - 1] if k else 0
    return lo + (total / 2 - before) / counts[k] * (hi - lo)


def shares_for(year: str) -> dict:
    return {**SHARES, **(SHARES_2011 if year in ("2006", "2011") else {})}


def groups_check(wide: pd.DataFrame, year: str, m: str, published: float) -> float | None:
    """The city median interpolated from all DAs' income groups, as a fraction off the published one."""
    ids, edges = GROUPS[year][m]
    est = interpolated_median(wide[wide[m].notna()][[f"b{i}" for i in ids]].sum().to_numpy(dtype=float), edges)
    return None if est is None else (est - published) / published


def aggregate(wide: pd.DataFrame, year: str, m: str, use_groups: bool = True) -> tuple[pd.Series, pd.Series]:
    """(value, coverage) by nbhd_id."""
    share = shares_for(year).get(m)
    # Coverage on the measure's own base (renter households for rent, ...);
    # households for shares, whose denominators are missing where suppressed.
    base = "hh" if share or m not in AGG else AGG[m][1]
    b = wide[base].where(wide[base].notna(), np.nan)
    total = b.groupby(wide.nbhd_id).sum(min_count=1)
    has = wide[m].notna() & b.notna()
    coverage = b[has].groupby(wide.nbhd_id[has]).sum().reindex(total.index, fill_value=0) / total
    hh_total = total
    groups = GROUPS[year].get(m) if use_groups else None
    if groups:
        ids, edges = groups
        cols = [f"b{i}" for i in ids]
        pooled = wide[has][cols].groupby(wide.nbhd_id[has]).sum(min_count=1)
        how, wcol = AGG[m]
        out, fell_back = {}, []
        for nid, row in pooled.iterrows():
            v_ = interpolated_median(row.to_numpy(dtype=float), edges)
            if v_ is None:
                d = wide[has & (wide.nbhd_id == nid)]
                w, x = d[wcol].to_numpy(dtype=float), d[m].to_numpy(dtype=float)
                ok = np.isfinite(w) & (w > 0) & np.isfinite(x)
                v_ = wmedian(x[ok], w[ok]) if ok.any() else None
                fell_back.append(nid)
            if v_ is not None:
                out[nid] = v_
        if fell_back:
            print(f"  {year} {m}: {len(fell_back)} neighbourhoods' medians in the open top group (DA-median method)")
        v = pd.Series(out, dtype=float).round(0)
    elif share and share[0] in wide and share[1] in wide:
        num, den = share[0], share[1]
        ok = wide[num].notna() & wide[den].notna() & has
        g = wide[ok].groupby("nbhd_id")
        v = (g[num].sum() / g[den].sum().where(lambda s: s > 0) * 100).clip(upper=100).round(1)
    else:
        how, wcol = AGG[m]
        out = {}
        for nid, d in wide[has].groupby("nbhd_id"):
            w = d[wcol].to_numpy(dtype=float)
            v_ = d[m].to_numpy(dtype=float)
            ok = np.isfinite(w) & (w > 0) & np.isfinite(v_)
            if not ok.any():
                continue
            out[nid] = wmedian(v_[ok], w[ok]) if how == "median" else float(np.average(v_[ok], weights=w[ok]))
        v = pd.Series(out, dtype=float)
        v = v.round(0) if MEASURES[m]["unit"] == "money" else v.round(1)
    v = v.reindex(hh_total.index).where(coverage >= MIN_COVERAGE)
    return v, coverage


def main():
    names = json.loads((FIGURES / "2021" / "common.json").read_text())
    nbhds = sorted({(i, n) for i, n in zip(names["nbhd_id"], names["nbhd"])})
    ids = [i for i, _ in nbhds]
    if len(ids) != 158:
        sys.exit(f"expected 158 neighbourhoods, found {len(ids)}")

    # A point inside each neighbourhood, for the page's links to the maps.
    nb = gpd.read_file(build.NEIGHBOURHOODS)[["AREA_SHORT_CODE", "geometry"]]
    pts = nb.to_crs(build.METRIC_CRS).representative_point().to_crs(4326)
    at = {int(c): [round(p.y, 5), round(p.x, 5)] for c, p in zip(nb.AREA_SHORT_CODE, pts)}
    breaks = json.loads((WEB / "breaks.json").read_text())["measures"]
    breaks11 = json.loads((WEB / "breaks_2011.json").read_text())["measures"]
    data = {y: load(y) for y in YEARS}

    # 2006: the comparable measures (census2006.py)
    nb06 = pd.read_csv(CENSUS06 / "nbhd_2006.csv").set_index("nbhd_id").reindex(ids)
    man06 = json.loads((CENSUS06 / "manifest.json").read_text())
    comparable06 = {m: c for m, c in man06["comparability"].items() if c in ("same", "near")}

    out = {
        "years": ["2006", *YEARS],
        "income_years": {"2006": "2005", **INCOME_YEAR},
        "cpi": {y: CPI[y] for y in ["2005", "2006", "2010", "2011", "2015", "2016", "2020", "2021"]},
        "min_coverage": MIN_COVERAGE,
        "nbhd": [{"id": i, "name": n, "at": at[i]} for i, n in nbhds],
        "measures": {},
    }
    print(f"\n{'measure':12s} " + "  ".join(f"{y}: shown/158, min cov" for y in YEARS))
    for m in MEASURES:
        city = {"2011": breaks11[m]["y2011"]["city"], "2016": breaks[m]["y2016"]["city"], "2021": breaks[m]["y2021"]["city"]}
        entry = {"city": city, "values": {}, "source": {"2011": breaks11[m].get("source", "census")}}
        line = []
        for y in YEARS:
            use = True
            if m in INCOME_GROUPS[y]:
                err = groups_check(data[y], y, m, city[y])
                use = err is not None and abs(err) <= GROUPS_TOLERANCE
                print(f"  {y} {m}: city median from DA income groups {err * 100:+.1f}% off the published one"
                      f" -> {'interpolated' if use else 'DA-median method'}")
                entry.setdefault("method", {})[y] = "groups" if use else "da_median"
            v, cov = aggregate(data[y], y, m, use)
            v = v.reindex(ids)
            entry["values"][y] = [None if pd.isna(x) else (int(x) if MEASURES[m]["unit"] == "money" else float(x)) for x in v]
            line.append(f"{int(v.notna().sum()):3d}, {cov.reindex(ids).min():.2f}")
        if m in comparable06:
            entry["city"] = {"2006": man06["city"][m], **entry["city"]}
            entry["values"] = {"2006": [None if pd.isna(x) else (int(x) if MEASURES[m]["unit"] == "money" else float(x)) for x in nb06[m]],
                               **entry["values"]}
            entry["comparability_2006"] = comparable06[m]
            line.insert(0, f"{int(nb06[m].notna().sum()):3d}")
        out["measures"][m] = entry
        print(f"{m:12s} " + "      ".join(line))
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")

    print(f"\nwrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")

    # 2011 coverage: which neighbourhoods lose their NHS figures
    nhs_m = "med_hh_tot"
    withheld = [n for (i, n), x in zip(nbhds, out["measures"][nhs_m]["values"]["2011"]) if x is None]
    print(f"2011 {nhs_m}: {len(withheld)} neighbourhoods withheld: {withheld}")


if __name__ == "__main__":
    main()
