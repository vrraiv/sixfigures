"""City housing stock and pipeline, by neighbourhood.

    python pipeline/city_layers.py

Reads four City of Toronto Open Data files (download.py fetches them) and
writes pipeline/city/:

  apartments.csv    registered apartment buildings (3+ storeys, 10+ units):
                    nbhd_id, year_built, buildings and units, by type (private,
                    social housing, TCHC). Stock at a date is the sum over
                    year_built up to it; buildings demolished before the
                    registry began (2017) are not in it
  demolitions.csv   rental units approved for demolition and their
                    replacements: nbhd_id, basis (approved: year of City Council
                    approval; permit: year the first rental demolition permit
                    was issued), year, applications, units lost and replaced
                    by rent level, and units under the demolition permits
                    (under_permit). On the permit basis all of an application's
                    units go in its first permit's year, though a phased
                    demolition's first permit may cover only some of them
  development.csv   development applications: nbhd_id, year submitted, type
                    (OZ rezoning, SA site plan, SB subdivision, CD condominium,
                    PL part lot), applications, applications with a unit count,
                    and units three ways: on every application (units); without
                    repeats (units_type_first: an application whose count
                    repeats an earlier one of its family and type is a
                    resubmission); once a family (units_project_first: its
                    largest type total, in the year and neighbourhood of its
                    earliest application with a count; this one can be summed
                    across types). A family is the
                    applications joined by PARENT_FOLDER_NUMBER, which links a
                    site plan to its rezoning, or an old application to the one
                    that superseded it. CD registers buildings already built.
                    Descriptions, links and statuses are today's: a unit count
                    is the latest revision's, which a backtest wouldn't have had
  affordable.csv    the affordable rental housing pipeline: nbhd_id, status,
                    projects and homes by kind. A snapshot: the file has no
                    dates, so it can't be used in a backtest
  manifest.json     retrieval dates, file sizes, match rates and checks
and pipeline/out/city_<layer>.csv, one row per record with its placement.

Placement:
  - development applications and the affordable pipeline carry coordinates.
    Development applications' X, Y are NAD27 MTM zone 10 (EPSG:2019): read as
    NAD83 (EPSG:2952), they sit a median 220 m from their address points; as
    NAD27, 17 m. An application has one row per address, so it is placed at its
    first point in a Toronto DA
  - apartment buildings and rental demolitions carry an address only: the first
    house number and street are matched to the address points, preferring the
    record's ward where a street name repeats, and failing an exact number, to
    the nearest number on the same side of the street within NEAREST
  - address points sit in 2021 DAs by point-in-polygon, and DAs in
    neighbourhoods by the 2021 figures file's assignment (as in permits.py)

Development applications state units only in their free-text description;
units() reads the largest "N ... units" phrase that isn't parking, storage,
retail and the like, or existing units.

The City's quarterly counts of social and affordable housing
(active-affordable-and-social-housing-units) are city-wide totals with no
geography, so there is no layer for them.
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
OUT = HERE / "city"
DETAIL = HERE / "out"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures"
PERMITS = HERE / "permits" / "by_nbhd.csv"  # permits.py's output, for a check if present
BOUNDARY = f"zip://{(RAW / 'lda_000b21a_e.zip').as_posix()}!lda_000b21a_e.shp"
ADDRESSES = RAW / "toronto_address_points_4326.csv"
METRIC_CRS = 2952
DEV_CRS = 2019

FILES = {
    "apartments": RAW / "toronto_apartment_buildings.csv",
    "demolitions": RAW / "toronto_rental_demolition.csv",
    "development": RAW / "toronto_development_applications.csv",
    "affordable": RAW / "toronto_affordable_pipeline_4326.csv",
}
NEAREST = 20  # house numbers

# spelled-out street types and directions, abbreviated only in those positions
# (the last word, or the one before a direction): "Avenue Rd", "The East Mall"
TYPES = {"STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
         "CRESCENT": "CRES", "COURT": "CRT", "PLACE": "PL", "PARKWAY": "PKWY", "SQUARE": "SQ",
         "TERRACE": "TER", "CIRCLE": "CIR", "GARDENS": "GDNS", "TRAIL": "TRL"}
DIRECTIONS = {"WEST": "W", "EAST": "E", "NORTH": "N", "SOUTH": "S"}
# a number, an optional suffix letter, an optional range, then the street up to
# the next separator
ADDRESS = re.compile(r"(\d+)(?:\s?[A-Z](?=\s))?(?:\s*-\s*\d+[A-Z]?)?\s+([A-Z][A-Z .']*?)\s*(?=,|&|\bAND\b|\(|$)")

# "N [adjectives] units": only words that describe homes may come between, so
# floor areas ("40,906 square metres with 608 units"), by-law numbers and
# parking spaces don't read as units
NUMBER = r"(\d{1,3}(?:,\d{3})+|\d+)"
HOME_WORDS = (r"new|residential|dwelling|rental|condominium|condo|townhouse|stacked|back-to-back|affordable|"
              r"purpose-built|live/work|live-work|apartment|additional|proposed|market|private|freehold|"
              r"single-detached|semi-detached|detached|semi|row|ownership|family|housing|seniors'?|student|"
              r"social|supportive|common|element|non-profit|rent-geared-to-income|rgi|total")
UNITS = re.compile(NUMBER + r"\s*((?:(?:" + HOME_WORDS + r")\s+){0,4})"
                   r"((?:stacked-)?(?:units?|dwellings?|homes|townhouses|townhomes|apartments))\b", re.I)
# "demolish the existing 30 units", "retaining 12 units"
EXISTING = re.compile(r"(?i)\b(existing|demolish\w*|replac\w*|retain\w*|currently)\b[^.;,]{0,15}$")


def addresses() -> pd.DataFrame:
    """Address points with their 2021 DA and neighbourhood."""
    a = pd.read_csv(ADDRESSES, dtype=str, usecols=["LO_NUM", "LINEAR_NAME_FULL", "WARD", "geometry"])
    xy = a.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0])
    pts = gpd.GeoDataFrame(a, geometry=gpd.points_from_xy(xy.str[0], xy.str[1]), crs=4326).to_crs(METRIC_CRS)
    j = in_toronto(pts).drop(columns="geometry")
    j["street"] = j.LINEAR_NAME_FULL.str.upper().str.split().str.join(" ")
    j["num"] = pd.to_numeric(j.LO_NUM, errors="coerce")
    j["ward"] = pd.to_numeric(j.WARD, errors="coerce")
    print(f"address points: {len(a):,}; in a Toronto DA: {len(j):,}")
    return pd.DataFrame(j.dropna(subset=["num"]))


def in_toronto(pts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Points in a Toronto 2021 DA, with its DAUID and the figures file's nbhd_id."""
    da = gpd.read_file(BOUNDARY, engine="pyogrio", where="DAUID LIKE '3520%'", columns=["DAUID"]).to_crs(METRIC_CRS)
    j = gpd.sjoin(pts.to_crs(METRIC_CRS), da, predicate="within", how="inner").drop(columns="index_right")
    common = json.loads((FIGURES / "2021" / "common.json").read_text())
    j["nbhd_id"] = j.DAUID.map(dict(zip(common["dauid"], common["nbhd_id"])))
    if j.nbhd_id.isna().any():
        sys.exit(f"{j.nbhd_id.isna().sum()} points in DAs without a neighbourhood")
    return j


def parse_address(s: str):
    """The first (number, street) in an address string whose street is named."""
    s = " ".join(str(s).upper().replace(".", "").split())
    for m in ADDRESS.finditer(s):
        w = m.group(2).split()
        if len(w) > 1 and w[-1] in DIRECTIONS:
            w[-1] = DIRECTIONS[w[-1]]
            kind = -2
        else:
            kind = -1
        if len(w) > -kind and w[kind] in TYPES:
            w[kind] = TYPES[w[kind]]
        if w:
            return int(m.group(1)), " ".join(w)
    return None, None


def match(df: pd.DataFrame, col: str, ward: str, a: pd.DataFrame) -> pd.DataFrame:
    """Each record's DAUID, nbhd_id and match method (address, nearest, unplaced)."""
    df = df.copy()
    parsed = df[col].map(parse_address)
    df["num"], df["street"] = parsed.str[0], parsed.str[1]
    df["DAUID"], df["nbhd_id"], df["method"] = None, np.nan, "unplaced"
    groups = {k: g for k, g in a.groupby("street")}
    for i in df.index[df.num.notna()]:
        g = groups.get(df.at[i, "street"])
        if g is None:
            continue
        n, w = df.at[i, "num"], df.at[i, ward]
        if g.ward.nunique() > 1 and (g.ward == w).any():
            g = g[g.ward == w]
        exact = g[g.num == n]
        side = g[g.num % 2 == n % 2]
        if len(exact):
            r, how = exact.iloc[0], "address"
        elif len(side) and (d := (side.num - n).abs()).min() <= NEAREST:
            r, how = side.loc[d.idxmin()], "nearest"
        else:
            continue
        df.at[i, "DAUID"], df.at[i, "nbhd_id"], df.at[i, "method"] = r.DAUID, r.nbhd_id, how
    return df


def units(text: str) -> float:
    """The largest count of homes a description states, or NaN."""
    best = np.nan
    for m in UNITS.finditer(str(text)):
        if EXISTING.search(text[max(0, m.start() - 60):m.start()]):
            continue
        n = int(m.group(1).replace(",", ""))
        best = n if np.isnan(best) else max(best, n)
    return best


def number(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.replace(",", "").str.strip(), errors="coerce")


def apartments(a: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    b = pd.read_csv(FILES["apartments"], low_memory=False)
    # the schema changed: older rows fill NO_OF_UNITS, newer CONFIRMED_UNITS
    b["units"] = number(b.CONFIRMED_UNITS).fillna(number(b.NO_OF_UNITS))
    b["storeys"] = number(b.CONFIRMED_STOREYS).fillna(number(b.NO_OF_STOREYS))
    b["ward"] = number(b.WARD)
    b["type"] = b.PROPERTY_TYPE.str.strip().str.upper().map(
        {"PRIVATE": "private", "SOCIAL HOUSING": "social", "TCHC": "tchc"}).fillna("other")
    b = match(b, "SITE_ADDRESS", "ward", a)
    b["year_built"] = number(b.YEAR_BUILT)
    detail = b[["RSN", "SITE_ADDRESS", "ward", "type", "units", "storeys", "year_built", "YEAR_REGISTERED",
                "DAUID", "nbhd_id", "method"]]
    p = b[b.nbhd_id.notna()].assign(buildings=1)
    for t in ("private", "social", "tchc"):
        p[f"units_{t}"] = p.units.where(p.type == t, 0)
    out = (p.groupby(["nbhd_id", p.year_built.fillna(-1).rename("year_built")])
           [["buildings", "units", "units_private", "units_social", "units_tchc"]].sum().reset_index())
    out["year_built"] = out.year_built.astype(int).astype(str).replace("-1", "")
    return out, detail


def demolitions(a: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    d = pd.read_csv(FILES["demolitions"])
    d.columns = d.columns.str.strip()
    d["ward"] = number(d["(Post 2018) Ward"])
    d = match(d, "IBMS Address", "ward", a)
    # fall back on the fuller address where the IBMS one doesn't match
    miss = d.method == "unplaced"
    if miss.any():
        d.loc[miss] = match(d[miss], "Address of Existing Rental Building", "ward", a)
    levels = {"lost": "Rental Homes for Demolition", "replaced": "Rental Homes Replaced"}
    for k, v in levels.items():
        for lvl in ("Total", "Affordable", "Mid-Range", "High-End"):
            d[f"{k}_{lvl.lower().replace('-', '_')}"] = number(d[f"{lvl} {v}"])
    d["approved"] = pd.to_datetime(d["City Council Approval Date"], errors="coerce")
    d["permit"] = pd.to_datetime(d["Date the Rental Demolition Permit was Issued"], format="%m/%d/%Y", errors="coerce")
    d["under_permit"] = number(d["Rental Homes Subject to Rental Demolition Permit(s)"])
    cols = [c for c in d.columns if c.startswith(("lost_", "replaced_"))] + ["under_permit"]
    detail = d[["RH File Number", "IBMS Address", "ward", "Type", "approved", "permit", *cols,
                "DAUID", "nbhd_id", "method"]]
    rows = []
    for basis in ("approved", "permit"):
        p = d[d.nbhd_id.notna() & d[basis].notna()].assign(basis=basis, year=lambda x: x[basis].dt.year,
                                                           applications=1)
        rows.append(p.groupby(["nbhd_id", "basis", "year"])[["applications", *cols]].sum(min_count=1))
    return pd.concat(rows).reset_index(), detail


def development() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    d = pd.read_csv(FILES["development"], low_memory=False)
    d = d.drop(columns=[c for c in d.columns if c.startswith("CONTACT_")])
    d = d.dropna(subset=["X", "Y"])
    pts = gpd.GeoDataFrame(d, geometry=gpd.points_from_xy(d.X, d.Y), crs=DEV_CRS)
    placed = pd.DataFrame(in_toronto(pts).drop(columns="geometry"))
    # one row per address: the first in a Toronto DA places the application
    placed = placed.drop_duplicates("APPLICATION#")
    apps = pd.read_csv(FILES["development"], low_memory=False,
                       usecols=["APPLICATION#", "APPLICATION_TYPE", "DATE_SUBMITTED", "DESCRIPTION",
                                "PARENT_FOLDER_NUMBER"]).drop_duplicates("APPLICATION#")
    apps = apps.merge(placed[["APPLICATION#", "DAUID", "nbhd_id"]], on="APPLICATION#", how="left")
    apps["type"] = apps.APPLICATION_TYPE.str.strip()
    apps["year"] = pd.to_datetime(apps.DATE_SUBMITTED).dt.year
    apps["units"] = apps.DESCRIPTION.map(units)
    apps["family"] = families(apps)
    # Within a family and type, a count that repeats an earlier one is a
    # resubmission; different counts are phases (a site plan per building). A
    # family's project total is its largest type total, placed at its earliest
    # application with a count.
    order = apps[apps.units.notna()].sort_values(["DATE_SUBMITTED", "APPLICATION#"])
    keep = order.index[~order.duplicated(["family", "type", "units"])]
    apps["units_type_first"] = apps.units.where(apps.index.isin(keep))
    total = apps.groupby(["family", "type"]).units_type_first.sum().groupby("family").max()
    first = order.drop_duplicates("family")
    apps["units_project_first"] = np.nan
    apps.loc[first.index, "units_project_first"] = first.family.map(total)
    detail = apps[["APPLICATION#", "type", "year", "PARENT_FOLDER_NUMBER", "family", "units", "units_type_first",
                   "units_project_first", "DAUID", "nbhd_id"]]
    p = apps[apps.nbhd_id.notna()].assign(applications=1, with_units=lambda x: x.units.notna().astype(int))
    out = (p.groupby(["nbhd_id", "year", "type"])
           [["applications", "with_units", "units", "units_type_first", "units_project_first"]].sum().reset_index())
    return out, detail, apps


def families(apps: pd.DataFrame) -> pd.Series:
    """Each application's family: those joined by parent links, either way."""
    root = {k: k for k in apps["APPLICATION#"]}

    def find(k):
        while root[k] != k:
            root[k] = root[root[k]]
            k = root[k]
        return k
    for k, parent in zip(apps["APPLICATION#"], apps.PARENT_FOLDER_NUMBER):
        if parent in root:
            root[find(k)] = find(parent)
    return apps["APPLICATION#"].map(find)


def affordable() -> tuple[pd.DataFrame, pd.DataFrame]:
    f = pd.read_csv(FILES["affordable"])
    xy = f.geometry.map(lambda g: json.loads(g)["coordinates"][0])
    pts = gpd.GeoDataFrame(f.drop(columns="geometry"), geometry=gpd.points_from_xy(xy.str[0], xy.str[1]), crs=4326)
    placed = pd.DataFrame(in_toronto(pts).drop(columns="geometry"))
    f = f.drop(columns="geometry").merge(placed[["Project ID", "DAUID", "nbhd_id"]], on="Project ID", how="left")
    kinds = {"affordable": "Affordable Homes Approved", "market_rent_controlled": "Rent-Controlled Market Units Approved",
             "rgi": "RGI Homes Approved", "supportive": "Supportive Units"}
    for k, v in kinds.items():
        f[k] = number(f[v])
    f["status"] = f.Status.str.strip()
    detail = f[["Project ID", "Anchor Address", "status", *kinds, "DAUID", "nbhd_id"]]
    p = f[f.nbhd_id.notna()].assign(projects=1)
    return p.groupby(["nbhd_id", "status"])[["projects", *kinds]].sum().reset_index(), detail


def corr(x: pd.Series, y: pd.Series) -> dict:
    x, y = x.align(y, join="outer", fill_value=0)
    return {"r": round(float(x.corr(y)), 3), "rho": round(float(x.rank().corr(y.rank())), 3)}


def census_2021() -> pd.DataFrame:
    """Households, renter and subsidized renter households by neighbourhood (2021)."""
    common = json.loads((FIGURES / "2021" / "common.json").read_text())
    df = pd.DataFrame({"nbhd_id": common["nbhd_id"], "hh": common["hh"]})
    for m in ("renter", "subsidized"):
        v = json.loads((FIGURES / "2021" / f"{m}.json").read_text())["v"]
        if len(v) != len(df):
            sys.exit(f"{m}.json has {len(v)} values for {len(df)} DAs")
        df[m] = pd.to_numeric(pd.Series(v), errors="coerce") / 100
    df["renters"] = df.hh * df.renter
    df["subsidized_hh"] = df.renters * df.subsidized
    return df.groupby("nbhd_id")[["hh", "renters", "subsidized_hh"]].sum()


def rate(detail: pd.DataFrame, weight: str | None = None) -> dict:
    w = detail[weight].fillna(0) if weight else pd.Series(1, index=detail.index)
    out = {"records": int(len(detail)), "placed": round(float(detail.nbhd_id.notna().mean()), 4)}
    if weight:
        out[f"{weight}_placed"] = round(float(w[detail.nbhd_id.notna()].sum() / w.sum()), 4)
    if "method" in detail:
        out["method"] = {k: int(v) for k, v in detail.method.value_counts().items()}
    return out


def main() -> int:
    missing = [p.name for p in FILES.values() if not p.exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)
    DETAIL.mkdir(exist_ok=True)
    a = addresses()
    census = census_2021()
    manifest = {"built": dt.date.today().isoformat(), "files": {
        k: {"name": p.name, "bytes": p.stat().st_size,
            "retrieved": dt.date.fromtimestamp(p.stat().st_mtime).isoformat()} for k, p in FILES.items()}}
    checks = {}

    apt, detail = apartments(a)
    detail.to_csv(DETAIL / "city_apartments.csv", index=False)
    yb = detail.year_built
    print(f"apartments: {rate(detail, 'units')}; year built {yb.min():.0f}-{yb.max():.0f}, "
          f"{yb.isna().sum()} missing, {(yb < 1850).sum()} before 1850")
    by = apt.groupby("nbhd_id")[["units", "units_social", "units_tchc"]].sum()
    checks["apartments"] = {
        **rate(detail, "units"), "units": int(detail.units.sum()),
        "renter_households_2021": int(census.renters.sum()),
        "units_vs_renters_2021": corr(by.units, census.renters),
        "social_tchc_units_vs_subsidized_renters_2021": corr(by.units_social + by.units_tchc, census.subsidized_hh),
        "subsidized_renters_2021": int(census.subsidized_hh.sum()),
        "social_tchc_units": int((by.units_social + by.units_tchc).sum()),
    }

    dem, detail = demolitions(a)
    detail.to_csv(DETAIL / "city_demolitions.csv", index=False)
    checks["demolitions"] = {**rate(detail, "lost_total"), "lost": int(detail.lost_total.sum()),
                             "replaced": int(detail.replaced_total.sum())}
    print(f"demolitions: {checks['demolitions']}")
    for _, r in detail[detail.nbhd_id.isna()].iterrows():
        print(f"  unplaced: {r['IBMS Address'].strip()} ({r.lost_total:.0f} units)")

    dev, detail, apps = development()
    detail.to_csv(DETAIL / "city_development.csv", index=False)
    by_type = apps.groupby("type").agg(applications=("units", "size"), with_units=("units", "count"),
                                       units=("units", "sum"), units_type_first=("units_type_first", "sum"),
                                       units_project_first=("units_project_first", "sum"))
    by_type["share_with_units"] = (by_type.with_units / by_type.applications).round(3)
    checks["development"] = {**rate(detail), "years": [int(apps.year.min()), int(apps.year.max())],
                             "by_type": json.loads(by_type.to_json(orient="index"))}
    print(f"development: {rate(detail)}\n{by_type.to_string()}")
    print("  largest unit counts:")
    for _, r in apps.nlargest(15, "units").iterrows():
        print(f"    {r.units:>7,.0f}  {r['APPLICATION#']}  {str(r.DESCRIPTION)[:110]}")
    if PERMITS.exists():
        # Units first proposed (once a project, outside condominium registration)
        # against units later issued permits, by neighbourhood
        pm = pd.read_csv(PERMITS)
        pm = pm[(pm.basis == "issued") & pm.year.between(2013, 2021)].groupby("nbhd_id").created.sum()
        pr = dev[(dev.type != "CD") & dev.year.between(2010, 2016)].groupby("nbhd_id").units_project_first.sum()
        checks["development"]["project_units_2010_16_vs_permits_created_2013_21"] = {
            **corr(pr, pm), "proposed": int(pr.sum()), "permits": int(pm.sum())}
        print(f"  vs permits: {checks['development']['project_units_2010_16_vs_permits_created_2013_21']}")

    aff, detail = affordable()
    detail.to_csv(DETAIL / "city_affordable.csv", index=False)
    checks["affordable"] = {**rate(detail), "snapshot": "no dates in the file", "homes": {k: int(detail[k].sum()) for k in
                                                     ("affordable", "market_rent_controlled", "rgi", "supportive")},
                            "supportive_equal_to_rgi": int(((detail.supportive > 0)
                                                            & (detail.supportive == detail.rgi)).sum()),
                            "with_supportive": int((detail.supportive > 0).sum())}
    print(f"affordable: {checks['affordable']}")

    for name, df in (("apartments", apt), ("demolitions", dem), ("development", dev), ("affordable", aff)):
        df["nbhd_id"] = df.nbhd_id.astype(int)
        for c in df.select_dtypes("float").columns:
            df[c] = df[c].round().astype("Int64")
        df.to_csv(OUT / f"{name}.csv", index=False)
    manifest["checks"] = checks
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(checks["apartments"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
