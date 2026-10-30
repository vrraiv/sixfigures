"""City building permits: dwelling units created and lost, by neighbourhood and year.

    python pipeline/permits.py

Reads the City of Toronto's permit files (download.py fetches them from Open
Data: cleared permits 2000-2016, cleared permits since 2017, active permits)
and writes pipeline/permits/:

  by_nbhd.csv   nbhd_id, basis, year, then units created (total, ground-related
                housing, everything else), units lost, net, and permit counts
  manifest.json retrieval date, file sizes, exclusions and check results
and pipeline/out/permits_by_da.csv, the same totals by 2021 DA (DAUID; 2.5 MB,
so not committed; permits placed only by street have no DA).

Two bases, because the files give two dates and neither is clean:
  issued     the year the permit was issued; cleared and active permits alike,
             so it covers every issued permit not cancelled
  completed  the year a cleared permit closed (status Closed). Closing is
             often administrative: thousands of permits issued 2000-2016 closed
             in 2025-2026, and the 2000-2016 file has no permit closed in 2007.
             Units are split by how long the permit took to close
             (created_close5: within five years of issue).

Rules:
  - one value per permit number across the three files: rows with a dead
    status (DROP_STATUS) go first; the latest remaining revision supplies the
    units, the earliest issue date the year; a cleared row beats an active one,
    and the 2017+ file beats the 2000-2016 one
  - units created count on building permits (BUILDING); units lost on those and
    on demolition permits. Plumbing, drain, mechanical and fire permits repeat
    their building permit's count, so they are left out
  - EXCLUDE lists permits whose unit counts are wrong on their face
  - a permit is placed by its GEO_ID (an address point ID); failing that, by
    its address string; failing that, by the nearest address point on the same
    street with the same parity within NEAREST numbers; failing that, between
    two numbers up to FAR apart in one neighbourhood (a redeveloped block's
    retired number), or by a street (nearly) all in one neighbourhood. Towers
    often get new addresses, so GEO_ID alone places 30-90% of a year's units
    and the fallbacks matter. A string that names
    several former municipalities is settled by the permit's district
    (WARD_GRID's first letter). Address points sit in 2021 DAs by
    point-in-polygon (as in search_index.py), and DAs in neighbourhoods by the
    2021 figures file's assignment (as in insights.py), so the permit totals
    and the census figures share a footprint.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "permits"
DA_OUT = HERE / "out" / "permits_by_da.csv"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures"
BOUNDARY = f"zip://{(RAW / 'lda_000b21a_e.zip').as_posix()}!lda_000b21a_e.shp"
ADDRESSES = RAW / "toronto_address_points_4326.csv"
METRIC_CRS = 2952
# source -> file; later sources win when a permit appears twice
FILES = {
    "active": "toronto_permits_active.csv",
    "cleared_2000_2016": "toronto_permits_cleared_2000_2016.csv",
    "cleared_2017": "toronto_permits_cleared_2017.csv",
}
BUILDING = {
    "New Building", "New Houses", "Small Residential Projects", "Building Additions/Alterations",
    "Residential Building Permit", "Multiple Use Permit", "Non-Residential Building Permit",
    "Building Historical data - Converted",
}
DEMOLITION = "Demolition Folder (DM)"
DROP_STATUS = {"Cancelled", "Refused", "Application Withdrawn", "Abandoned", "Superseded"}
# Ground-related housing (houses, their added units, laneway suites); every
# other structure type counts as apartments and mixed use.
GROUND = re.compile(r"^(SFD|2 Unit|3\+ Unit|Duplex|Triplex|Converted House|Laneway|Other \(New Housing\))")
# Permits whose unit counts are wrong on their face (checked against the
# description; the largest counts in each file are printed on every run).
EXCLUDE = {
    "26 256637 BLD": "100,000 units on a change of use from a cafe to an arcade",
    "98 200593 000": "2,500 units on a retail building",
    "00 363746 CMB": "sprinkler shop drawings repeating the 642 units of 99 101936 COM next door",
}
NEAREST = 20  # house numbers
FAR = 200  # widest gap between two same-neighbourhood numbers that brackets a permit
STREET_SHARE = 0.9  # a street this much in one neighbourhood places a permit with no usable number
CLOSE_YEARS = 5
# WARD_GRID's first letter -> the former municipalities of that district
DISTRICT = {"S": {"former Toronto", "East York"}, "N": {"North York"},
            "E": {"Scarborough"}, "W": {"Etobicoke", "York"}}


def load() -> pd.DataFrame:
    frames = []
    for src, name in FILES.items():
        df = pd.read_csv(RAW / name, dtype=str, low_memory=False).drop(columns="_id", errors="ignore")
        frames.append(df.assign(source=src))
        print(f"{name}: {len(df):,} rows, {df.PERMIT_NUM.nunique():,} permits")
    df = pd.concat(frames, ignore_index=True)
    df["STATUS"] = df.STATUS.str.strip()
    for c, s in (("created", "DWELLING_UNITS_CREATED"), ("lost", "DWELLING_UNITS_LOST")):
        df[c] = pd.to_numeric(df[s], errors="coerce").fillna(0)
    df.loc[~df.PERMIT_TYPE.isin(BUILDING), "created"] = 0
    df.loc[~df.PERMIT_TYPE.isin(BUILDING | {DEMOLITION}), "lost"] = 0
    df = df[(df.created > 0) | (df.lost > 0)]
    print(f"rows with units on building or demolition permits: {len(df):,}")
    for src in FILES:
        top = df[df.source == src].nlargest(12, "created")
        print(f"  largest in {src}:")
        for r in top.itertuples():
            flag = "  EXCLUDED" if r.PERMIT_NUM in EXCLUDE else ""
            print(f"    {r.PERMIT_NUM} {r.created:6,.0f} {r.STREET_NUM} {r.STREET_NAME}: {str(r.DESCRIPTION)[:90]}{flag}")
    return df[~df.PERMIT_NUM.isin(EXCLUDE)]


def dedupe(df: pd.DataFrame) -> pd.DataFrame:
    live = df[~df.STATUS.isin(DROP_STATUS)].copy()
    live["rank"] = live.source.map({s: i for i, s in enumerate(FILES)})
    live["issued"] = pd.to_datetime(live.ISSUED_DATE.str[:10], errors="coerce")
    live["completed"] = pd.to_datetime(live.COMPLETED_DATE.str[:10], errors="coerce")
    first_issued = live.groupby("PERMIT_NUM").issued.min()
    one = (live.sort_values(["PERMIT_NUM", "rank", "REVISION_NUM"])
           .drop_duplicates("PERMIT_NUM", keep="last").set_index("PERMIT_NUM"))
    one["issued"] = first_issued
    print(f"permits after dropping {', '.join(sorted(DROP_STATUS))} and keeping one row each: "
          f"{len(one):,} (from {df.PERMIT_NUM.nunique():,}); units created {one.created.sum():,.0f}, lost {one.lost.sum():,.0f}")
    return one


def street_key(name, kind, direction) -> pd.Series:
    def clean(s):
        return s.fillna("").str.strip().str.upper()
    return clean(name) + "|" + clean(kind) + "|" + clean(direction)


def addresses() -> pd.DataFrame:
    """Address points with their 2021 DA and neighbourhood."""
    a = pd.read_csv(ADDRESSES, dtype=str, usecols=[
        "ADDRESS_POINT_ID", "LO_NUM", "LINEAR_NAME", "LINEAR_NAME_TYPE", "LINEAR_NAME_DIR",
        "MUNICIPALITY_NAME", "geometry"])
    xy = a.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0])
    pts = gpd.GeoDataFrame(a, geometry=gpd.points_from_xy(xy.str[0], xy.str[1]), crs=4326).to_crs(METRIC_CRS)
    da = gpd.read_file(BOUNDARY, engine="pyogrio", where="DAUID LIKE '3520%'", columns=["DAUID"]).to_crs(METRIC_CRS)
    j = gpd.sjoin(pts, da, predicate="within", how="inner").drop(columns=["geometry", "index_right"])
    common = json.loads((FIGURES / "2021" / "common.json").read_text())
    j["nbhd_id"] = j.DAUID.map(dict(zip(common["dauid"], common["nbhd_id"])))
    if j.nbhd_id.isna().any():
        sys.exit(f"{j.nbhd_id.isna().sum()} address points in DAs without a neighbourhood")
    j["street"] = street_key(j.LINEAR_NAME, j.LINEAR_NAME_TYPE, j.LINEAR_NAME_DIR)
    j["num"] = pd.to_numeric(j.LO_NUM, errors="coerce")
    print(f"address points: {len(a):,}; in a Toronto DA: {len(j):,}")
    return pd.DataFrame(j)


def place(p: pd.DataFrame, a: pd.DataFrame) -> pd.DataFrame:
    """Each permit's DAUID, nbhd_id and match method."""
    p = p.copy()
    p["DAUID"], p["nbhd_id"], p["method"] = None, np.nan, "unplaced"
    by_id = a.set_index("ADDRESS_POINT_ID")[["DAUID", "nbhd_id"]]
    gid = p.GEO_ID.str.strip()
    hit = gid.isin(by_id.index)
    p.loc[hit, ["DAUID", "nbhd_id"]] = by_id.loc[gid[hit]].to_numpy()
    p.loc[hit, "method"] = "geo_id"

    p["street"] = street_key(p.STREET_NAME, p.STREET_TYPE, p.STREET_DIRECTION)
    p["num"] = pd.to_numeric(p.STREET_NUM.str.extract(r"^\s*(\d+)", expand=False), errors="coerce")
    p["munis"] = p.WARD_GRID.str.strip().str[0].map(DISTRICT)
    groups = {k: g for k, g in a.dropna(subset=["num"]).groupby("street")}
    for i in p.index[~hit & p.num.notna()]:
        g = groups.get(p.at[i, "street"])
        if g is None:
            continue
        munis = p.at[i, "munis"]
        if isinstance(munis, set) and g.MUNICIPALITY_NAME.nunique() > 1:
            g = g[g.MUNICIPALITY_NAME.isin(munis)]
            if not len(g):
                continue
        n = p.at[i, "num"]
        exact = g[g.num == n]
        side = g[g.num % 2 == n % 2]
        below, above = side[side.num < n], side[side.num > n]
        lo = below.loc[below.num.idxmax()] if len(below) else None
        hi = above.loc[above.num.idxmin()] if len(above) else None
        near = [r for r in (lo, hi) if r is not None]
        if len(exact):
            r, how = exact.iloc[0], "address"
        elif near and min(abs(r.num - n) for r in near) <= NEAREST:
            r, how = min(near, key=lambda r: abs(r.num - n)), "nearest"
        elif lo is not None and hi is not None and lo.nbhd_id == hi.nbhd_id and hi.num - lo.num <= FAR:
            # Between two numbers in one neighbourhood: a retired number on a
            # redeveloped block. The DA is the nearer one's.
            r, how = min(near, key=lambda r: abs(r.num - n)), "between"
        elif (share := g.nbhd_id.value_counts(normalize=True)).iat[0] >= STREET_SHARE:
            # A street (nearly) all in one neighbourhood: number 0 or off its range.
            r = pd.Series({"DAUID": None, "nbhd_id": share.index[0]})
            how = "street"
        else:
            continue
        p.at[i, "DAUID"], p.at[i, "nbhd_id"], p.at[i, "method"] = r.DAUID, r.nbhd_id, how
    return p.drop(columns=["street", "munis"])


def aggregate(p: pd.DataFrame, by: str) -> pd.DataFrame:
    p = p[p[by].notna()]
    rows = []
    issued = p[p.issued.notna()].assign(year=p.issued.dt.year, basis="issued")
    done = p[p.source.str.startswith("cleared") & (p.STATUS == "Closed") & p.completed.notna()]
    done = done.assign(year=done.completed.dt.year, basis="completed")
    for d in (issued, done):
        d = d.assign(
            created_ground=d.created.where(d.STRUCTURE_TYPE.fillna("").str.strip().str.match(GROUND), 0),
            created_close5=d.created.where((d.completed - d.issued).dt.days <= 365.25 * CLOSE_YEARS, 0)
            if d.basis.iat[0] == "completed" else np.nan,
            permits_created=(d.created > 0).astype(int), permits_lost=(d.lost > 0).astype(int))
        rows.append(d.groupby([by, "basis", "year"])[
            ["created", "created_ground", "created_close5", "lost", "permits_created", "permits_lost"]].sum(min_count=1))
    out = pd.concat(rows).reset_index()
    out["created_other"] = out.created - out.created_ground
    out["net"] = out.created - out.lost
    cols = [by, "basis", "year", "created", "created_ground", "created_other", "created_close5",
            "lost", "net", "permits_created", "permits_lost"]
    out = out[cols].sort_values([by, "basis", "year"])
    for c in cols[3:]:
        out[c] = out[c].round(2)
    out["year"] = out.year.astype(int)
    out[by] = out[by].astype(int) if by == "nbhd_id" else out[by]
    return out


def households() -> pd.DataFrame:
    """Census households by neighbourhood (columns 2011, 2016, 2021)."""
    out = {}
    for y in ("2011", "2016", "2021"):
        c = json.loads((FIGURES / y / "common.json").read_text())
        out[int(y)] = pd.Series(c["hh"], index=c["nbhd_id"], dtype=float).groupby(level=0).sum()
    return pd.DataFrame(out)


def check_census(nb: pd.DataFrame) -> dict:
    """Net units issued over each census interval, lagged, against the change in
    households: citywide, and as a correlation across the 158 neighbourhoods.
    Censuses are in May, so interval Y0-Y1 takes permits issued in years
    Y0+lag .. Y1-1+lag."""
    hh = households()
    iss = nb[nb.basis == "issued"].pivot_table(index="nbhd_id", columns="year", values="net", aggfunc="sum", fill_value=0)
    res = {}
    print("\nnet units issued vs change in census households (city; Pearson r across neighbourhoods):")
    for y0, y1 in ((2011, 2016), (2016, 2021)):
        d = hh[y1] - hh[y0]
        for lag in (0, 1, 2, 3):
            yrs = [y for y in range(y0 + lag, y1 + lag) if y in iss.columns]
            s = iss[yrs].sum(axis=1).reindex(d.index, fill_value=0)
            r = np.corrcoef(s, d)[0, 1]
            res[f"{y0}-{y1} lag {lag}"] = {"permits": round(float(s.sum())), "households": round(float(d.sum())), "r": round(float(r), 3)}
            print(f"  {y0}-{y1}, issued {yrs[0]}-{yrs[-1]}: permits {s.sum():8,.0f}  households {d.sum():8,.0f}  r {r:.2f}")
    return res


def check_cma(nb: pd.DataFrame) -> dict:
    """City units issued per year against the Toronto CMA's new dwelling units
    in StatCan table 34-10-0292 (series.py), which the City's must not exceed."""
    f = HERE / "series" / "34-10-0292.csv"
    if not f.exists():
        print(f"\n{f} not found (series.py writes it): CMA check skipped")
        return {}
    s = pd.read_csv(f)
    s = s[(s["Type of building"] == "Total residential") & (s["Type of work"] == "New dwelling units total")
          & (s.Variables == "Number of dwelling-units created")]
    cma = s.assign(year=s.REF_DATE.str[:4].astype(int)).groupby("year").VALUE.agg(["sum", "count"])
    cma = cma[cma["count"] == 12]["sum"]
    city = nb[nb.basis == "issued"].groupby("year").created.sum()
    print("\nunits created on permits issued: City (placed) vs CMA new dwelling units (34-10-0292):")
    res = {}
    for y, v in cma.items():
        print(f"  {y}: City {city.get(y, 0):8,.0f}  CMA {v:8,.0f}  ({city.get(y, 0) / v:.0%})")
        res[int(y)] = {"city": round(float(city.get(y, 0))), "cma": round(float(v))}
    return res


def main() -> int:
    raw = load()
    one = dedupe(raw)
    a = addresses()
    p = place(one, a)

    # Checks
    p["iy"] = p.issued.dt.year
    w = p[p.created > 0]
    rate = w.pivot_table(index="iy", columns="method", values="created", aggfunc="sum", fill_value=0)
    rate = rate.div(rate.sum(axis=1), axis=0)
    print("\nshare of units created placed, by issue year and method:")
    print(rate.loc[2000:].round(3).to_string())
    placed_share = (w.created * (w.method != "unplaced")).groupby(w.iy).sum() / w.created.groupby(w.iy).sum()
    print("\nlargest unplaced permits:")
    for r in w[w.method == "unplaced"].nlargest(20, "created").itertuples():
        print(f"  {r.Index} {r.created:6,.0f} {r.STREET_NUM} {r.STREET_NAME} {r.STREET_TYPE} {r.STREET_DIRECTION} (GEO_ID {r.GEO_ID})")

    OUT.mkdir(exist_ok=True)
    nb = aggregate(p, "nbhd_id")
    da = aggregate(p, "DAUID")
    nb.to_csv(OUT / "by_nbhd.csv", index=False, lineterminator="\n")
    DA_OUT.parent.mkdir(exist_ok=True)
    da.to_csv(DA_OUT, index=False, lineterminator="\n")
    city = nb.groupby(["basis", "year"])[["created", "lost", "net"]].sum()
    print("\ncity totals of placed units by year:")
    print(city.unstack("basis").loc[2000:].round(0).to_string())
    manifest = {
        "retrieved": dt.date.today().isoformat(),
        "files": {n: (RAW / n).stat().st_size for n in FILES.values()},
        "excluded": EXCLUDE,
        "permits_with_units": int(len(p)),
        "placed_share_of_units_created_by_issue_year": {int(k): round(v, 3) for k, v in placed_share.loc[2000:].items()},
        "census_check": check_census(nb),
        "cma_check": check_cma(nb),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"\nshare of units created placed: {placed_share.loc[2000:].min():.1%} (worst issue year since 2000)")
    for f in (OUT / "by_nbhd.csv", DA_OUT):
        print(f"wrote {f} ({f.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
