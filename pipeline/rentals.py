"""Short-term rentals: Inside Airbnb listings and the City's registrations.

    python pipeline/rentals.py

Reads the Inside Airbnb Toronto snapshots and the City of Toronto's
short-term rental registrations (download.py fetches them) and writes
pipeline/rentals/:

  by_nbhd.csv               per Inside Airbnb snapshot and neighbourhood (all
                            158 in every snapshot, zeros where none): listings,
                            by room type, short-term, active, estimated nights,
                            median prices, multi-listing hosts, the licence
                            numbers listings show, 2021 households and rates
                            per 1,000 households
  registrations_by_ward.csv the City's active registrations by ward (the
                            registry's own field) and property type, against
                            the latest snapshot's listings in the ward
  registrations_by_nbhd.csv the registrations placed by address, against the
                            latest snapshot's listings in the neighbourhood
  manifest.json             sources, licence and attribution, retrieval
                            dates, file sizes, definitions, match rates and
                            checks

Inside Airbnb (https://insideairbnb.com/get-the-data/): one listings.csv.gz
per scrape at data.insideairbnb.com/canada/on/toronto/<date>/data/. The page
lists the last four quarterly Toronto scrapes (SNAPSHOTS: 2025-12-12 to
2026-09-16 on 2026-11-11, "generally quarterly data for the last 12 months";
older data is by request). Monthly files from 2022-08-03 on, including ones
not yet listed (2026-10-07, 2026-11-01), also answer at that URL pattern, but
they are not published on the page, so they are left out. Licence: CC BY 4.0;
the credit is ATTRIBUTION.

  - Placement. Airbnb moves each listing's map point up to 150 m (450 ft)
    from its address, each listing in a building separately, so listings are
    placed in DAs with places.place() but only counted by neighbourhood: a DA
    is often narrower than 150 m. manifest.json gives the share of listings
    within 150 m of a neighbourhood boundary (those that could be in the
    neighbour), the share placed in the neighbourhood of the same name in
    Inside Airbnb's own neighbourhood_cleansed (the City's old 140), and, for
    listings that show a registration number, how often the listing and the
    registered address fall in the same neighbourhood and ward.
  - short_term: minimum_nights < 28. Chapter 547 regulates rentals of less
    than 28 consecutive days; in Toronto most listings (61% in 2026-09) ask for
    28 nights or more and need no registration.
  - active: reviewed in the last 12 months (number_of_reviews_ltm > 0), a
    stay that happened. Availability can't tell a booked night from a blocked
    one (Inside Airbnb's own caveat), and 84% of listings show some availability
    in the coming year, dormant ones included. In these files the definition is
    the same as estimated_occupancy_l365d > 0 (checked per snapshot).
  - est_nights: Inside Airbnb's estimated_occupancy_l365d, its "San
    Francisco model": reviews in the last 12 months / a 50% review rate x
    an average stay of 3 nights (or the minimum stay, if longer), capped at
    70% (255 nights). A model, not bookings.
  - median_price / median_price_entire: the listed nightly price, of all
    listings and of entire homes with one. The 2025-12-12 scrape has no
    prices; later ones lack them for listings not bookable on the scrape date.
  - multi_listing: listings whose host has 2+ listings in the scrape
    (calculated_host_listings_count); multi_hosts: distinct such hosts with a
    listing in the neighbourhood (a host can count in several, so this column
    doesn't sum to the city's).
  - licence_*: the licence field of short-term listings, which hosts fill in:
    registered (an STR-YYMM-XXXXXX number in the registry as retrieved),
    unmatched (that format, not in the registry: expired, revoked, mistyped or
    invented), exempt, blank or other text. The registry is a current list, so
    for earlier snapshots "unmatched" includes registrations that have lapsed
    since.

City registrations (CKAN short-term-rentals-registration, refreshed daily,
Open Government Licence - Toronto): every active operator registration
number with address, unit, FSA (the postal code's first three characters),
property type and ward. It has no dates other than the issue year and month in
the number (STR-YYMM-...: 2020-09 on) and no history, so it is compared with
the latest snapshot only, a few weeks older than the registry. The registry
supports wards directly; addresses are matched to the City's address points
as in city_layers.py (exact house number and street, else the nearest number on
the same side within city_layers.NEAREST), whose point gives the DA and neighbourhood.
FSAs aren't used: StatCan's FSA boundaries can't be fetched by script, so
listings can't be put in FSAs.

Comparing the two (registrations_by_*.csv): short_term / registrations and
short_term_active / registrations, and the share of short-term listings that
show a number in the registry. None of these measures unregistered
operation: a registration (one principal residence) can carry several
listings (the whole home and its rooms) and several platforms; a registered
operator may not be on Airbnb; jitter moves listings across boundaries; the
licence field is free text a host can copy. Read a ratio well above 1, or a
low registered share, as a place to look, not a count.
"""
import datetime as dt
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

import places
from city_layers import match

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "rentals"
IA_DIR = RAW / "insideairbnb"
IA_URL = "https://data.insideairbnb.com/canada/on/toronto/{date}/data/listings.csv.gz"
# the Toronto scrapes listed on insideairbnb.com/get-the-data (2026-11-11);
# add the new date when the page lists one
SNAPSHOTS = ["2025-12-12", "2026-03-19", "2026-06-15", "2026-09-16"]
ATTRIBUTION = ("Source: Inside Airbnb (insideairbnb.com), Toronto, {dates}. "
               "Creative Commons Attribution 4.0 International (CC BY 4.0).")
FILES = {
    "registrations": RAW / "toronto_str_registrations.csv",
    "wards": RAW / "toronto_wards_4326.geojson",
    "addresses": RAW / "toronto_address_points_4326.csv",
}
STR_NIGHTS = 28  # Chapter 547: less than 28 consecutive days
JITTER = 150  # metres
LICENCE = r"STR-?\s?(\d{4})-?\s?([A-Z]{6})"
COLS = ["id", "host_id", "latitude", "longitude", "neighbourhood_cleansed", "room_type", "minimum_nights",
        "number_of_reviews_ltm", "estimated_occupancy_l365d", "price", "calculated_host_listings_count",
        "availability_365", "license"]


def ia_path(date: str) -> Path:
    return IA_DIR / f"toronto_listings_{date}.csv.gz"


def listings(date: str, registry: set) -> pd.DataFrame:
    """One snapshot's listings with their DA, neighbourhood and derived flags."""
    l = pd.read_csv(ia_path(date), usecols=lambda c: c in COLS, low_memory=False)
    if not l.id.is_unique:
        sys.exit(f"{date}: repeated listing ids")
    l = places.place(l, "longitude", "latitude")
    l["entire_home"] = l.room_type.eq("Entire home/apt")
    l["private_room"] = l.room_type.eq("Private room")
    l["other_room"] = ~(l.entire_home | l.private_room)  # hotel and shared rooms
    l["short_term"] = l.minimum_nights < STR_NIGHTS
    l["active"] = l.number_of_reviews_ltm > 0
    l["short_term_active"] = l.short_term & l.active
    l["est_nights"] = l.estimated_occupancy_l365d
    l["price_num"] = pd.to_numeric(l.price.astype("string").str.replace(r"[$,]", "", regex=True), errors="coerce")
    l["multi_listing"] = l.calculated_host_listings_count > 1
    lic = l.license.astype("string").str.strip()
    num = lic.str.upper().str.extract(LICENCE)
    num = ("STR-" + num[0] + "-" + num[1]).astype("string")
    l["licence_number"] = num
    kind = pd.Series("other", index=l.index)
    kind[lic.isna()] = "blank"
    kind[lic.str.contains("exempt", case=False, na=False)] = "exempt"
    kind[num.notna()] = "unmatched"
    kind[num.isin(registry).fillna(False)] = "registered"
    l["licence"] = kind
    return l


def by_nbhd(l: pd.DataFrame, date: str) -> pd.DataFrame:
    p = l[l.nbhd_id.notna()]
    st = p[p.short_term]
    g = p.groupby("nbhd_id")
    out = g[["entire_home", "private_room", "other_room", "short_term", "active", "short_term_active",
             "multi_listing"]].sum()
    out.insert(0, "listings", g.size())
    out["est_nights"] = g.est_nights.sum()
    out["est_nights_short_term"] = st.groupby("nbhd_id").est_nights.sum()
    out["priced"] = g.price_num.count()
    out["median_price"] = g.price_num.median()
    out["median_price_entire"] = p[p.entire_home].groupby("nbhd_id").price_num.median()
    out["multi_hosts"] = p[p.multi_listing].groupby("nbhd_id").host_id.nunique()
    for k in ("registered", "unmatched", "exempt", "blank", "other"):
        out[f"licence_{k}"] = (st.licence == k).groupby(st.nbhd_id).sum()
    hh = places.households()
    out = out.reindex(hh.index)
    prices = ["median_price", "median_price_entire"]
    out[out.columns.difference(prices)] = out[out.columns.difference(prices)].fillna(0)
    out["households"] = hh
    for c in ("listings", "entire_home", "short_term", "active", "short_term_active"):
        out[f"{c}_per_1000hh"] = (out[c] / hh * 1000).round(2)
    out = out.reset_index()
    out.insert(0, "snapshot", date)
    return out


def nbhd_names() -> pd.Series:
    c = json.loads(places.COMMON.read_text())
    return pd.Series(c["nbhd"], index=c["nbhd_id"]).groupby(level=0).first()


def near_boundary(l: pd.DataFrame) -> float:
    """Share of placed listings with another neighbourhood within JITTER."""
    nb = places.da_polygons().dissolve("nbhd_id").reset_index()[["nbhd_id", "geometry"]]
    p = l[l.nbhd_id.notna()]
    pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(p.longitude, p.latitude), index=p.index,
                           crs=4326).to_crs(places.METRIC_CRS)
    j = gpd.sjoin(pts, nb, predicate="dwithin", distance=JITTER)
    return round(float((j.groupby(level=0).nbhd_id.nunique() > 1).mean()), 4)


def wards() -> gpd.GeoDataFrame:
    w = gpd.read_file(FILES["wards"])[["AREA_SHORT_CODE", "AREA_NAME", "geometry"]]
    w["ward"] = w.AREA_SHORT_CODE.astype(int)
    return w.rename(columns={"AREA_NAME": "ward_name"})[["ward", "ward_name", "geometry"]].to_crs(places.METRIC_CRS)


def in_ward(df: pd.DataFrame, lon: str, lat: str, w: gpd.GeoDataFrame) -> pd.Series:
    ok = df[lon].notna() & df[lat].notna()
    pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(df.loc[ok, lon], df.loc[ok, lat]), index=df.index[ok],
                           crs=4326).to_crs(places.METRIC_CRS)
    j = gpd.sjoin(pts, w, how="left", predicate="within")
    return j[~j.index.duplicated()].ward.reindex(df.index)


def ward_households(w: gpd.GeoDataFrame) -> pd.Series:
    """2021 households by ward: each DA in the ward holding its representative point."""
    da = places.da_polygons().merge(places.common()[["dauid", "hh"]], on="dauid")
    pts = gpd.GeoDataFrame(da[["hh"]], geometry=da.representative_point(), crs=places.METRIC_CRS)
    j = gpd.sjoin(pts, w, how="left", predicate="within")
    if j.ward.isna().any():
        sys.exit(f"{j.ward.isna().sum()} DAs outside the wards")
    return j.groupby("ward").hh.sum()


def address_points() -> pd.DataFrame:
    a = pd.read_csv(FILES["addresses"], dtype=str, usecols=["LO_NUM", "LINEAR_NAME_FULL", "WARD", "geometry"])
    xy = a.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0])
    a["lon"], a["lat"] = xy.str[0], xy.str[1]
    a = places.place(a)
    a = a[a.nbhd_id.notna()].rename(columns={"dauid": "DAUID"})
    a["street"] = a.LINEAR_NAME_FULL.str.upper().str.split().str.join(" ")
    a["num"] = pd.to_numeric(a.LO_NUM, errors="coerce")
    a["ward"] = pd.to_numeric(a.WARD, errors="coerce")
    return a.dropna(subset=["num"])


def registrations() -> pd.DataFrame:
    r = pd.read_csv(FILES["registrations"], dtype=str)
    r["number"] = r.operator_registration_number.str.strip().str.upper()
    r["ward"] = pd.to_numeric(r.ward_number, errors="coerce")
    r["kind"] = r.property_type.str.strip().map({
        "Condominium": "condo", "Apartment": "apartment", "Townhouse/ Row House": "townhouse",
        "Duplex/Triplex/Fourplex": "plex", "Single/Semi-detached House": "house",
        "Single/Semi-detached": "house", "Single-family detached": "house"}).fillna("other")
    return r


def compare(listings_by: pd.DataFrame, reg_by: pd.Series) -> pd.DataFrame:
    """Registrations against the latest snapshot's listings, by one geography."""
    out = listings_by.join(reg_by.rename("registrations"), how="outer").fillna(0)
    out["short_term_per_registration"] = (out.short_term / out.registrations).replace(np.inf, np.nan).round(3)
    out["short_term_active_per_registration"] = (out.short_term_active / out.registrations).replace(
        np.inf, np.nan).round(3)
    out["short_term_registered_share"] = (out.licence_registered / out.short_term).round(3)
    return out


def corr(x: pd.Series, y: pd.Series) -> dict:
    x, y = x.align(y, join="outer", fill_value=0)
    return {"r": round(float(x.corr(y)), 3), "rho": round(float(x.rank().corr(y.rank())), 3)}


def main() -> int:
    missing = [p.name for p in FILES.values() if not p.exists()]
    missing += [ia_path(d).name for d in SNAPSHOTS if not ia_path(d).exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)

    def info(p: Path) -> dict:
        return {"name": p.name, "bytes": p.stat().st_size,
                "retrieved": dt.date.fromtimestamp(p.stat().st_mtime).isoformat()}
    manifest = {
        "built": dt.date.today().isoformat(),
        "inside_airbnb": {
            "page": "https://insideairbnb.com/get-the-data/", "url": IA_URL,
            "licence": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
            "attribution": ATTRIBUTION.format(dates=", ".join(SNAPSHOTS)),
            "snapshots_listed_2026_11_11": SNAPSHOTS,
            "unlisted_but_downloadable_2026_11_11": "monthly from 2022-08-03; 2026-10-07 and 2026-11-01 "
                                                   "past the latest listed; none found 2015-2022-07",
            "files": {d: info(ia_path(d)) for d in SNAPSHOTS}},
        "city": {"registrations": {"package": "short-term-rentals-registration",
                                   "resource": "short-term-rental-registrations-data.csv",
                                   "licence": "Open Government Licence - Toronto", **info(FILES["registrations"])},
                 "wards": info(FILES["wards"]), "address_points": info(FILES["addresses"])},
        "definitions": {"short_term": f"minimum_nights < {STR_NIGHTS}", "active": "number_of_reviews_ltm > 0",
                        "est_nights": "estimated_occupancy_l365d (reviews-based, capped at 255)",
                        "placement": f"places.place (DA outlines: {places.da_polygons().attrs['source']}); "
                                     f"coordinates jittered up to {JITTER} m, so neighbourhoods only"},
    }
    checks = {}

    reg = registrations()
    registry = set(reg.number)
    names = nbhd_names()
    w = wards()
    frames, latest = [], None
    for date in SNAPSHOTS:
        l = listings(date, registry)
        b = by_nbhd(l, date)
        frames.append(b)
        placed = l.nbhd_id.notna()
        same_name = (l.neighbourhood_cleansed == l.nbhd_id.map(names))[l.neighbourhood_cleansed.isin(names.values)]
        c = {
            "rows": int(len(l)), "placed": int(placed.sum()), "outside_toronto_das": int((~placed).sum()),
            "outside_ids": l.loc[~placed, "id"].astype(str).tolist()[:20],
            "by_nbhd_sum_equals_placed": bool(b.listings.sum() == placed.sum()),
            "nbhds_with_listings": int((b.listings > 0).sum()),
            "within_150m_of_nbhd_boundary": near_boundary(l),
            "same_name_as_inside_airbnb_nbhd": round(float(same_name.mean()), 4),
            "short_term": int(l.short_term.sum()), "active": int(l.active.sum()),
            "short_term_active": int(l.short_term_active.sum()),
            "active_equals_occupancy_gt_0": bool((l.active == (l.est_nights > 0)).all()),
            "available_365_gt_0": int((l.availability_365 > 0).sum()),
            "est_nights": int(l.est_nights.sum()), "est_nights_max": int(l.est_nights.max()),
            "priced": round(float(l.price_num.notna().mean()), 4),
            "multi_listing": int(l.multi_listing.sum()),
            "licence_short_term": {k: int(v) for k, v in l[l.short_term].licence.value_counts().items()},
            "licence_not_short_term": {k: int(v) for k, v in l[~l.short_term].licence.value_counts().items()},
        }
        checks[date] = c
        print(f"{date}: {json.dumps({k: v for k, v in c.items() if k != 'outside_ids'})}")
        latest = (date, l)
    by = pd.concat(frames)
    by["nbhd_id"] = by.nbhd_id.astype(int)
    for col in by.columns.drop(["snapshot", "median_price", "median_price_entire"]):
        if by[col].dtype.kind == "f" and not col.endswith("_per_1000hh"):
            by[col] = by[col].round().astype("Int64")
    by.to_csv(OUT / "by_nbhd.csv", index=False)

    # Registrations against the latest snapshot
    date, l = latest
    l["ward"] = in_ward(l, "longitude", "latitude", w)
    flags = ["short_term", "short_term_active", "listings"]
    l["listings"] = True
    l["licence_registered"] = l.short_term & (l.licence == "registered")
    a = address_points()
    print(f"address points in a Toronto DA: {len(a):,}")
    reg = match(reg, "address", "ward", a)
    hh_w = ward_households(w)

    lw = l[l.ward.notna()].groupby("ward")[flags + ["licence_registered"]].sum()
    rw = compare(lw, reg.groupby("ward").size())
    rw = rw.join(reg.pivot_table(index="ward", columns="kind", values="number", aggfunc="size", fill_value=0)
                 .add_prefix("registrations_"))
    rw = rw.join(w.set_index("ward").ward_name).join(hh_w.rename("households"))
    rw["registrations_per_1000hh"] = (rw.registrations / rw.households * 1000).round(2)
    rw["short_term_per_1000hh"] = (rw.short_term / rw.households * 1000).round(2)
    rw.insert(0, "snapshot", date)
    rw.index = rw.index.astype(int)
    rw = rw.reset_index()
    first = ["snapshot", "ward", "ward_name", "households", "registrations"]
    rw = rw[first + [c for c in rw.columns if c not in first]]
    for c in rw.columns:
        if rw[c].dtype.kind == "f" and not c.endswith(("_per_registration", "_share", "_per_1000hh")):
            rw[c] = rw[c].round().astype("Int64")
    rw.to_csv(OUT / "registrations_by_ward.csv", index=False)

    ln = l[l.nbhd_id.notna()].groupby("nbhd_id")[flags + ["licence_registered"]].sum()
    rn = compare(ln, reg[reg.nbhd_id.notna()].groupby("nbhd_id").size()).reindex(places.households().index)
    rn[rn.columns.drop(rn.filter(regex="_per_registration|_share").columns)] = rn[
        rn.columns.drop(rn.filter(regex="_per_registration|_share").columns)].fillna(0)
    rn["households"] = places.households()
    rn["registrations_per_1000hh"] = (rn.registrations / rn.households * 1000).round(2)
    rn.index = rn.index.astype(int)
    rn = rn.reset_index()
    rn.insert(0, "snapshot", date)
    for c in rn.columns:
        if rn[c].dtype.kind == "f" and not c.endswith(("_per_registration", "_share", "_per_1000hh")):
            rn[c] = rn[c].round().astype("Int64")
    rn.to_csv(OUT / "registrations_by_nbhd.csv", index=False)

    # Listings that show a registered number: is the listing where the registration is?
    lic = l[l.licence == "registered"].merge(
        reg[["number", "ward", "nbhd_id"]].rename(columns={"ward": "reg_ward", "nbhd_id": "reg_nbhd"}),
        left_on="licence_number", right_on="number")
    both_n = lic.nbhd_id.notna() & lic.reg_nbhd.notna()
    per_number = l[l.licence == "registered"].groupby("licence_number").size()
    sp = l[l.short_term]
    checks["registrations"] = {
        "rows": int(len(reg)), "unique_numbers": int(reg.number.nunique()),
        "number_format_ok": round(float(reg.number.str.fullmatch(r"STR-\d{4}-[A-Z]{6}").mean()), 4),
        "issued_months": [f"20{reg.number.str[4:8].min()}", f"20{reg.number.str[4:8].max()}"],
        "wards": int(reg.ward.nunique()),
        "by_kind": {k: int(v) for k, v in reg.kind.value_counts().items()},
        "address_match": {**{k: int(v) for k, v in reg.method.value_counts().items()},
                          "placed": round(float(reg.nbhd_id.notna().mean()), 4)},
        "registrations_by_ward_sum": int(rw.registrations.sum()),
        "registrations_by_nbhd_sum": int(rn.registrations.sum()),
        "by_nbhd_sum_equals_placed": bool(rn.registrations.sum() == reg.nbhd_id.notna().sum()),
        "by_ward_sum_equals_rows": bool(rw.registrations.sum() == len(reg)),
    }
    checks["comparison"] = {
        "snapshot": date, "registry_retrieved": manifest["city"]["registrations"]["retrieved"],
        "listings_with_ward": int(l.ward.notna().sum()),
        "short_term_listings": int(sp.shape[0]), "short_term_active": int(sp.active.sum()),
        "registrations": int(len(reg)),
        "short_term_per_registration": round(sp.shape[0] / len(reg), 3),
        "short_term_active_per_registration": round(int(sp.active.sum()) / len(reg), 3),
        "short_term_registered_share": round(float((sp.licence == "registered").mean()), 4),
        "short_term_active_registered_share": round(float((sp[sp.active].licence == "registered").mean()), 4),
        "registration_numbers_on_listings": int(per_number.size),
        "registrations_shown_by_a_listing": round(per_number.size / len(reg), 4),
        "listings_per_number_shown": {"median": float(per_number.median()), "max": int(per_number.max()),
                                      "numbers_on_5_plus": int((per_number >= 5).sum())},
        "listing_and_registration_same_ward": round(float((lic.ward == lic.reg_ward).mean()), 4),
        "listing_and_registration_same_nbhd": round(float((lic.nbhd_id == lic.reg_nbhd)[both_n].mean()), 4),
        "by_ward_short_term_vs_registrations": corr(rw.set_index("ward").short_term,
                                                    rw.set_index("ward").registrations),
        "by_nbhd_short_term_vs_registrations": corr(rn.set_index("nbhd_id").short_term,
                                                    rn.set_index("nbhd_id").registrations),
    }
    print(json.dumps(checks["registrations"], indent=1))
    print(json.dumps(checks["comparison"], indent=1))
    manifest["checks"] = checks
    manifest["outputs"] = {p.name: {"rows": int(len(pd.read_csv(p))), "bytes": p.stat().st_size}
                           for p in sorted(OUT.glob("*.csv"))}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
