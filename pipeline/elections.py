"""Toronto mayoral elections by voting subdivision, on 2021 DAs and neighbourhoods.

    python pipeline/elections.py

Reads the City of Toronto's poll-by-poll results, voter statistics and voting
subdivision boundaries for two mayoral votes (download.py fetches them) and
writes pipeline/elections/:

  by_poll.csv     one row per election and voting subdivision ("poll") as the
                  City publishes it, special polls included: election, ward,
                  sub, kind (polling: a subdivision with a boundary; ltc: the
                  ward's long-term care and retirement homes, 2023 only; mail;
                  advance), electors (Total Eligible Electors), voted (Number
                  Voted), votes (valid votes for mayor) and votes for each
                  leading candidate and the rest (votes_other); for polling
                  subdivisions, n_da (2021 DAs it is spread over) and top_da
                  (the largest share it gives one DA)
  by_da.csv       one row per election and 2021 DA (dauid, nbhd_id), every poll
                  apportioned (below): electors, voted, turnout, voted_day and
                  turnout_day (polling-place votes only, nothing allocated),
                  votes, votes_<leader>, votes_other, share_<leader> (of
                  votes), lead (the candidate with most votes). Counts are
                  apportioned, so fractional (one decimal)
  by_nbhd.csv     the same summed over the 158 neighbourhoods, plus pop21
                  (2021 population) and electors_per_pop
  manifest.json   sources and retrieval dates, row counts, the special polls'
                  share by ward, and checks
and pipeline/out/elections_pieces.csv, each poll-DA piece with its weights.

Elections (municipal; the City's portal has no federal or provincial results):
  2022    General election, 24 October 2022, Office of Mayor (John Tory). Results
          `election-results-official` "2022-results" (a zip of one workbook per
          office; Poll_By_Poll_Mayor has a sheet per ward, a column per
          subdivision, a Total column and a ward Totals row). Electors and
          votes cast: `elections-voter-statistics` "2022-voter-statistics".
          Boundaries: `elections-subdivisions` "voting-subdivisions-2022"
  2023by  By-election for Mayor, 26 June 2023 (Olivia Chow). Results
          `elections-official-by-election-results` "2023 Office of the Mayor"
          (same layout plus a Read Me sheet). Electors:
          `elections-by-election-voter-statistics`
          "2023-mayoral-by-election-voter-statistics". Boundaries
          "voting-subdivisions-2023"
The 2026 general election (26 October 2026) is not included: its official
results were posted on 29 October 2026 ("2026-results"), but neither its
subdivision boundaries nor its voter statistics were on the portal on
2026-11-11, and its subdivisions are renumbered (2022's do not fit). Add it
when `elections-subdivisions` gets a 2026 layer.

Leading candidates: those with at least LEADING of the city's votes for mayor
(2022: Tory, Penalosa, Brown; 2023: Chow, Bailão, Saunders, Furey, Matlow).
Each election has its own leader columns; the other election's are empty, and
Chloe Brown's 18,831 votes in 2023 (2.6%) are in votes_other there.

Turnout is voted / electors. electors is the voters' list at the close of
voting (Total Electors plus additions minus deletions, which the City already
credits to the home subdivision for electors added at advance polls). voted is
the voter statistics' Number Voted: in 2022 it exceeds the valid votes for
mayor by 11,234 (ballots with no mayoral vote, rejected and declined; the
composite ballot also carried councillor and trustee races); in 2023 it equals
them. The City's own "% Voted" also adds declined ballots (439 in 2022), so its
turnout differs from ours in the fourth decimal.

Special polls have no boundary: in both years subdivision 97 is mail-in
voting and 98 and 99 are the ward's two advance-vote locations; in 2023
subdivision 96 pools the ward's long-term care and retirement home polls (94
buildings, 2,606 votes). They are allocated within their ward:
  - 96 (2023): the subdivision file still has a small polygon for each of the
    94 buildings (with no result of its own); the ward's 96 votes, electors
    and voted are split over them in proportion to the polygon's VOTER_COUNT,
    and they then count as polling subdivisions
  - 97-99: each candidate's special votes in a ward are split over the ward's
    polling subdivisions in proportion to that candidate's polling-place votes
    there (so the geography of each candidate's support is kept and the ward
    totals stay exact); the ward's special `voted` in proportion to the
    subdivision's polling-place voted. A candidate with no polling-place votes
    in the ward would be split by all votes (none occurs)
Mail and advance polls are 24.2% of the 2022 votes for mayor (16.6-31.4% by
ward) and 21.8% in 2023 (15.5-26.7%), plus 0.4% at long-term care homes (per
ward in the manifest). voted_day / turnout_day are kept for analysis that
should not lean on the allocation: they are counted, not modelled, but
undercount turnout, more so where advance voting was common.

Apportionment to 2021 DAs: subdivisions and DAs don't nest (a median
subdivision touches 7 DAs, counting slivers; 624 of 2022's 1,460 put 95% or
more of their weight in one DA). Each subdivision is cut by the DA outlines
(places.da_polygons(): the committed tiles at
z13), and its votes, electors and voted are split over the pieces in
proportion to each piece's estimated 2021 population: the DA's population
(figures file pop21) times the share of the DA's address points that lie in
the piece. Address points (`address-points-municipal-toronto-one-address-
repository`, REGULAR land and structure points, not entrances) say where in a
DA people live; the census population says how many, which address points
can't (a 40-storey tower is one point, a house another). Plain area would
send the votes of a tower block to a park or a rail yard in the same DA; plain
address-point counts would send a tower's votes to the houses around it. A DA
with no address points falls back on area within it, and a subdivision whose
pieces have no population at all on area within the subdivision. The
manifest compares the result with pure area weighting.

Neighbourhoods sum their DAs (a DA belongs to one neighbourhood by the figures
file's assignment, as in permits.py and city_layers.py).

Checks (manifest.json, checks):
  - per ward, the subdivisions' votes per candidate equal the workbook's Total
    column and its ward Totals row; the city's candidate totals equal the
    City Clerk's Declarations of Results (DECLARED, transcribed from the PDFs);
    the voter statistics' subdivisions add to their ward and grand totals
  - after allocation and apportionment, the totals per ward (pieces grouped by
    their subdivision's ward) and city-wide (summing by_da.csv and by_nbhd.csv)
    equal the official ones, to rounding
  - electors against 2021 population by neighbourhood, and correlations of
    turnout and the leaders' shares with 2021 median household income
    (figures file med_hh_tot: by DA, and by neighbourhood as the
    household-weighted mean of its DAs' medians)
"""
import datetime as dt
import io
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

import places

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "elections"
DETAIL = HERE / "out"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures" / "2021"
ADDRESSES = RAW / "toronto_address_points_4326.csv"
METRIC_CRS = places.METRIC_CRS
LEADING = 0.04  # share of the city's votes for mayor that makes a leader column

ELECTIONS = {
    "2022": {
        "results": (RAW / "toronto_election_results_2022.zip", "2022_Toronto_Poll_By_Poll_Mayor.xlsx"),
        "turnout": (RAW / "toronto_voter_statistics_2022.xlsx", "2022 Voter Turnout Statistics"),
        "polls": RAW / "toronto_voting_subdivisions_2022_4326.geojson",
        "date": "2022-10-24",
    },
    "2023by": {
        "results": (RAW / "toronto_byelection_mayor_2023.xlsx", None),
        "turnout": (RAW / "toronto_byelection_mayor_2023_voter_statistics.xlsx", "2023 Voter Turnout Statisti M"),
        "polls": RAW / "toronto_voting_subdivisions_2023_4326.geojson",
        "date": "2023-06-26",
    },
}
LTC, MAIL, ADVANCE = 96, 97, (98, 99)
# where download.py fetches each file: CKAN package and resource name
CKAN = {
    "toronto_election_results_2022.zip": ("election-results-official", "2022-results"),
    "toronto_byelection_mayor_2023.xlsx": ("elections-official-by-election-results", "2023 Office of the Mayor"),
    "toronto_voter_statistics_2022.xlsx": ("elections-voter-statistics", "2022-voter-statistics"),
    "toronto_byelection_mayor_2023_voter_statistics.xlsx": (
        "elections-by-election-voter-statistics", "2023-mayoral-by-election-voter-statistics"),
    "toronto_voting_subdivisions_2022_4326.geojson": (
        "elections-subdivisions", "voting-subdivisions-2022 - 4326.geojson"),
    "toronto_voting_subdivisions_2023_4326.geojson": (
        "elections-subdivisions", "voting-subdivisions-2023 - 4326.geojson"),
    "toronto_address_points_4326.csv": (
        "address-points-municipal-toronto-one-address-repository", "Address Points - 4326.csv"),
}

# City Clerk's Declarations of Results, Office of Mayor (retrieved 2026-11-11):
#   2022 https://www.toronto.ca/wp-content/uploads/2022/10/9085-FinalDeclaration-of-Results-for-the-2022-Toronto-Municipal-Election.pdf
#   2023 https://www.toronto.ca/wp-content/uploads/2023/06/8eef-Declaration-of-Results-for-the-2023-Toronto-By-Election-for-Mayor-Final.pdf
# The leaders' votes, the number of candidates and the sum over all of them.
DECLARED = {
    "2022": {"candidates": 31, "total": 551890,
             "votes": {"Tory John": 342158, "Penalosa Gil": 98525, "Brown Chloe-Marie": 34821}},
    "2023by": {"candidates": 102, "total": 724638,
               "votes": {"Chow Olivia": 269372, "Bailão Ana": 235175, "Saunders Mark": 62167,
                         "Furey Anthony": 35899, "Matlow Josh": 35572}},
}


def slug(name: str) -> str:
    """'Bailão Ana' -> 'bailao' (the surname, ASCII)."""
    s = unicodedata.normalize("NFKD", name.split()[0]).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s.lower())


def results(src: Path, member: str | None) -> tuple[pd.DataFrame, dict]:
    """Votes by ward, subdivision and candidate, and the per-ward checks."""
    book = io.BytesIO(zipfile.ZipFile(src).read(member)) if member else src
    x = pd.ExcelFile(book)
    rows, bad = [], []
    for s in x.sheet_names:
        if not s.startswith("Ward "):
            continue
        ward = int(s.split()[1])
        df = pd.read_excel(x, sheet_name=s, header=None)
        head = df.index[df[0].astype(str).str.strip() == "Subdivision"][0]
        last = df.index[df[0].astype(str).str.contains("Totals")][0]
        subs = df.loc[head, 1:]
        total_col = subs.index[subs.astype(str).str.strip() == "Total"][0]
        subs = subs.drop(total_col).astype(int)
        body = df.loc[head + 2:last - 1].set_index(0)  # skip the "Mayor" row
        body.index = body.index.str.strip()
        votes = body[subs.index].astype(int)
        votes.columns = subs.values
        # the workbook's own totals: a Total column per candidate, a Totals row per subdivision
        if not (votes.sum(axis=1) == body[total_col].astype(int)).all():
            bad.append(f"ward {ward}: candidate totals")
        if not (votes.sum() == df.loc[last, subs.index].astype(int).values).all():
            bad.append(f"ward {ward}: subdivision totals")
        if int(df.loc[last, total_col]) != int(votes.values.sum()):
            bad.append(f"ward {ward}: ward total")
        long = votes.stack().rename("votes").reset_index()
        long.columns = ["candidate", "sub", "votes"]
        rows.append(long.assign(ward=ward))
    out = pd.concat(rows, ignore_index=True)[["ward", "sub", "candidate", "votes"]]
    if bad:
        sys.exit(f"{src.name}: workbook totals don't add up: {bad}")
    return out, {"wards": int(out.ward.nunique()), "workbook_totals_match": True}


def turnout(src: Path, sheet: str) -> tuple[pd.DataFrame, dict]:
    """Electors and voted by ward and subdivision, checked against the ward and
    grand totals in the same sheet."""
    v = pd.read_excel(src, sheet_name=sheet)
    v.columns = v.columns.str.strip()
    v = v.rename(columns={"Ward": "ward", "Sub": "sub", "Total Eligible Electors": "electors",
                          "Number Voted": "voted"})
    w = v.ward.astype(str).str.strip()
    grand = v[w == "Grand Total"].iloc[0]
    totals = v[w.str.endswith(" Total") & (w != "Grand Total")].copy()
    totals["ward"] = totals.ward.str.split().str[0].astype(int)
    v = v[pd.to_numeric(v.ward, errors="coerce").notna() & pd.to_numeric(v["sub"], errors="coerce").notna()].copy()
    v["ward"], v["sub"] = v.ward.astype(int), v["sub"].astype(int)
    v["electors"] = v.electors.fillna(0).astype(int)
    v["voted"] = v.voted.fillna(0).astype(int)
    by = v.groupby("ward")[["electors", "voted"]].sum()
    t = totals.set_index("ward")[["electors", "voted"]].astype(int)
    ok = bool((by == t.reindex(by.index)).all().all())
    city = {"electors": int(v.electors.sum()), "voted": int(v.voted.sum())}
    ok = ok and city == {"electors": int(grand.electors), "voted": int(grand.voted)}
    if not ok:
        sys.exit(f"{src.name}: subdivisions don't add to the ward or grand totals")
    return v[["ward", "sub", "electors", "voted"]], {"subdivisions_add_to_ward_and_grand_totals": True, **city,
                                                     "turnout": round(city["voted"] / city["electors"], 4)}


def polls(src: Path) -> gpd.GeoDataFrame:
    g = gpd.read_file(src)
    g["ward"] = g.AREA_LONG_CODE.str[:2].astype(int)
    g["sub"] = g.AREA_LONG_CODE.str[2:].astype(int)
    if g.duplicated(["ward", "sub"]).any():
        sys.exit(f"{src.name}: repeated subdivision codes")
    g = g.rename(columns={"VOTER_COUNT": "voter_count"})[["ward", "sub", "voter_count", "geometry"]]
    return g.to_crs(METRIC_CRS)


def address_points() -> gpd.GeoDataFrame:
    """Address points that mark a place (land or structure; not entrances, not reserved)."""
    a = pd.read_csv(ADDRESSES, usecols=["MAINT_STAGE", "ADDRESS_CLASS", "geometry"], dtype=str)
    n = len(a)
    a = a[(a.MAINT_STAGE == "REGULAR") & a.ADDRESS_CLASS.isin(["L", "S"])]
    xy = a.geometry.str.extract(r"\[\[\s*([-\d.]+),\s*([-\d.]+)")
    pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(xy[0].astype(float), xy[1].astype(float)), crs=4326)
    print(f"address points: {n:,}; regular land and structure points: {len(pts):,}")
    pts.attrs["all"] = n
    return pts.to_crs(METRIC_CRS)


def pieces(p: gpd.GeoDataFrame, da: gpd.GeoDataFrame, pts: gpd.GeoDataFrame, pop: pd.Series) -> pd.DataFrame:
    """Each subdivision-DA piece with its share of the subdivision: w (population
    by address points) and w_area (area)."""
    cut = gpd.overlay(p[["ward", "sub", "geometry"]], da[["dauid", "nbhd_id", "geometry"]],
                      how="intersection", keep_geom_type=True)
    cut["area"] = cut.area
    cut = cut[cut.area > 0].reset_index(drop=True)
    j = gpd.sjoin(pts, cut[["geometry"]], predicate="within", how="inner")
    cut["points"] = j.groupby("index_right").size().reindex(cut.index, fill_value=0)
    da_pts = cut.groupby("dauid").points.transform("sum")
    da_area = cut.groupby("dauid").area.transform("sum")
    within = np.where(da_pts > 0, cut.points / da_pts.where(da_pts > 0, 1), cut.area / da_area)
    cut["pop_est"] = cut.dauid.map(pop).fillna(0) * within
    key = ["ward", "sub"]
    tot = cut.groupby(key).pop_est.transform("sum")
    area = cut.groupby(key).area.transform("sum")
    cut["w_area"] = cut.area / area
    cut["w"] = np.where(tot > 0, cut.pop_est / tot.where(tot > 0, 1), cut.w_area)
    cut["fallback"] = np.where(tot > 0, np.where(da_pts > 0, "", "da_area"), "poll_area")
    return pd.DataFrame(cut.drop(columns="geometry"))


def build(name: str, cfg: dict, da: gpd.GeoDataFrame, pts: gpd.GeoDataFrame, pop: pd.Series):
    votes, rcheck = results(*cfg["results"])
    turn, tcheck = turnout(*cfg["turnout"])
    g = polls(cfg["polls"])
    cands = votes.groupby("candidate").votes.sum().sort_values(ascending=False)
    total = int(cands.sum())

    # the clerk's declaration
    d = DECLARED[name]
    declared = {"candidates": len(cands) == d["candidates"], "total": total == d["total"],
                "leaders": all(int(cands.get(k, -1)) == v for k, v in d["votes"].items())}
    if not all(declared.values()):
        sys.exit(f"{name}: results differ from the declaration: {declared}")

    leaders = [c for c in cands.index if cands[c] / total >= LEADING]
    cols = {c: f"votes_{slug(c)}" for c in leaders}
    wide = votes.pivot_table(index=["ward", "sub"], columns="candidate", values="votes", aggfunc="sum")
    w = pd.DataFrame(index=wide.index)
    w["votes"] = wide.sum(axis=1)
    for c, col in cols.items():
        w[col] = wide[c]
    w["votes_other"] = w.votes - w[list(cols.values())].sum(axis=1)
    w = w.join(turn.set_index(["ward", "sub"]), how="outer")
    if w.votes.isna().any() or w.electors.isna().any():
        sys.exit(f"{name}: results and voter statistics list different subdivisions")
    w = w.reset_index()
    geo = set(zip(g.ward, g["sub"]))
    has_geo = [(a, b) in geo for a, b in zip(w.ward, w["sub"])]
    w["kind"] = np.select([has_geo, w["sub"] == LTC, w["sub"] == MAIL, w["sub"].isin(ADVANCE)],
                          ["polling", "ltc", "mail", "advance"], "unknown")
    if (w.kind == "unknown").any():
        sys.exit(f"{name}: subdivisions without a boundary: {w[w.kind == 'unknown'][['ward', 'sub']].values.tolist()}")
    num = ["electors", "voted", "votes", *cols.values(), "votes_other"]
    by_poll = w[["ward", "sub", "kind", *num]].copy()

    # 96: the ward's long-term care polls, spread over the buildings' polygons
    # (the polygons without a result of their own) by VOTER_COUNT
    resulted = set(zip(w.ward, w["sub"]))
    ltc_geo = g[[(a, b) not in resulted for a, b in zip(g.ward, g["sub"])]].copy()
    alloc = w[w.kind == "polling"].copy()
    ltc_check = None
    if len(ltc_geo):
        ltc_rows = w[w.kind == "ltc"].set_index("ward")
        missing = sorted(set(ltc_rows.index) - set(ltc_geo.ward))
        if missing:
            sys.exit(f"{name}: wards with long-term care votes but no building polygons: {missing}")
        wt = ltc_geo.voter_count.fillna(ltc_geo.groupby("ward").voter_count.transform("median")).fillna(1)
        ltc_geo["f"] = wt / wt.groupby(ltc_geo.ward).transform("sum")
        spread = ltc_geo[["ward", "sub", "f"]].merge(ltc_rows[num].reset_index(), on="ward")
        spread[num] = spread[num].mul(spread.f, axis=0)
        alloc = pd.concat([alloc, spread.drop(columns="f").assign(kind="ltc")], ignore_index=True)
        ltc_check = {"buildings": int(len(ltc_geo)), "wards": int(ltc_geo.ward.nunique()),
                     "votes": int(ltc_rows.votes.sum()), "electors": int(ltc_rows.electors.sum()),
                     "voter_count_missing": int(ltc_geo.voter_count.isna().sum())}
    elif (w.kind == "ltc").any():
        sys.exit(f"{name}: long-term care votes but no building polygons")
    alloc["voted_day"] = alloc.voted
    alloc["votes_day"] = alloc.votes

    # 97-99: within the ward, each candidate's by that candidate's polling-place votes
    special = w[w.kind.isin(["mail", "advance"])].groupby("ward")[num].sum()
    cand_cols = [*cols.values(), "votes_other"]
    for col in [*cand_cols, "voted"]:
        base = alloc[col] if col != "voted" else alloc.voted_day
        share = base / base.groupby(alloc.ward).transform("sum")
        if share.isna().any():  # a candidate with no polling-place votes in a ward
            share = share.fillna(alloc.votes_day / alloc.votes_day.groupby(alloc.ward).transform("sum"))
        alloc[col] = alloc[col] + share * alloc.ward.map(special[col]).fillna(0)
    alloc["votes"] = alloc[cand_cols].sum(axis=1)

    # spread each subdivision over its DA pieces
    pc = pieces(g, da, pts, pop)
    unplaced = sorted(set(zip(alloc.ward, alloc["sub"])) - set(zip(pc.ward, pc["sub"])))
    if unplaced:
        sys.exit(f"{name}: subdivisions that miss every DA: {unplaced}")
    stats = pc.groupby(["ward", "sub"]).agg(n_da=("dauid", "nunique"), top_da=("w", "max"))
    by_poll = by_poll.merge(stats.reset_index(), on=["ward", "sub"], how="left")
    val = [*num, "voted_day", "votes_day"]
    m = pc.merge(alloc[["ward", "sub", *val]], on=["ward", "sub"])
    area = m.copy()
    m[val] = m[val].mul(m.w, axis=0)
    area[val] = area[val].mul(area.w_area, axis=0)
    by_da = m.groupby(["dauid", "nbhd_id"])[val].sum().reset_index()
    by_da_area = area.groupby(["dauid", "nbhd_id"])[val].sum().reset_index()

    # checks: every vote lands once, per ward and city-wide
    official_ward = w.groupby("ward")[num].sum()
    landed_ward = m.groupby("ward")[num].sum()
    official = {k: int(w[k].sum()) for k in num}
    landed = {k: float(by_da[k].sum()) for k in num}
    check = {
        **rcheck, "declared": {"source": "City Clerk's Declaration of Results", **declared,
                               "total": total, **{cols[c]: int(cands[c]) for c in leaders}},
        "voter_statistics": tcheck,
        "official": official,
        "official_by_ward": {int(k): {c: int(v) for c, v in r.items()} for k, r in official_ward.iterrows()},
        "apportioned_minus_official": {k: round(landed[k] - official[k], 6) for k in num},
        "apportioned_minus_official_by_ward_max_abs": round(float((landed_ward - official_ward).abs().max().max()), 6),
        "piece_shares_sum_to_one_max_error": round(float((pc.groupby(["ward", "sub"]).w.sum() - 1).abs().max()), 9),
        "subdivisions": {k: int(v) for k, v in w.kind.value_counts().items()},
        "special_share": special_shares(w),
        "pieces": {"pieces": int(len(pc)), "subdivisions_per_da_median": float(pc.groupby("dauid").size().median()),
                   "das_per_subdivision_median": float(stats.n_da.median()),
                   "subdivisions_in_one_da_95pct": int((stats.top_da >= 0.95).sum()),
                   "fallback": {k or "none": int(v) for k, v in pc.fallback.value_counts().items()},
                   "das_reached": int(by_da.dauid.nunique()), "das": int(len(da)),
                   "overlap_km2": round(float((g.area.sum() - g.union_all().area) / 1e6), 3)},
        "leaders": {cols[c]: c for c in leaders},
    }
    if ltc_check:
        check["long_term_care"] = ltc_check
    pc["election"] = name
    return by_poll.assign(election=name), by_da.assign(election=name), by_da_area, check, cols, pc


def special_shares(w: pd.DataFrame) -> dict:
    """Share of each ward's votes for mayor cast at the special polls."""
    t = w.groupby("ward").votes.sum()
    out = {}
    for label, kinds in (("mail_advance", ["mail", "advance"]), ("ltc", ["ltc"])):
        s = w[w.kind.isin(kinds)].groupby("ward").votes.sum().reindex(t.index, fill_value=0) / t
        if s.any():
            out[label] = {"city": round(float(w[w.kind.isin(kinds)].votes.sum() / t.sum()), 4),
                          "ward_min": round(float(s.min()), 4), "ward_max": round(float(s.max()), 4),
                          "by_ward": {int(k): round(float(v), 4) for k, v in s.items()}}
    return out


def finish(df: pd.DataFrame, cols: dict) -> pd.DataFrame:
    """Rates, shares and the leading candidate from summed counts."""
    df = df.copy()
    df["turnout"] = df.voted / df.electors.where(df.electors > 0)
    df["turnout_day"] = df.voted_day / df.electors.where(df.electors > 0)
    leaders = list(cols.values())
    for c in leaders:
        df[c.replace("votes_", "share_")] = df[c] / df.votes.where(df.votes > 0)
    names = {v: v.replace("votes_", "") for v in leaders}
    df["lead"] = df[leaders].idxmax(axis=1).map(names).where(df.votes > 0)
    return df


def corr(x: pd.Series, y: pd.Series) -> dict:
    ok = x.notna() & y.notna()
    x, y = x[ok], y[ok]
    return {"n": int(ok.sum()), "r": round(float(x.corr(y)), 3), "rho": round(float(x.rank().corr(y.rank())), 3)}


def main() -> int:
    files = [cfg["results"][0] for cfg in ELECTIONS.values()] + [cfg["turnout"][0] for cfg in ELECTIONS.values()] \
        + [cfg["polls"] for cfg in ELECTIONS.values()] + [ADDRESSES]
    missing = [p.name for p in files if not p.exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)
    DETAIL.mkdir(exist_ok=True)
    da = places.da_polygons()
    common = places.common().set_index("dauid")
    pop = common.pop21
    pts = address_points()
    inc = json.loads((FIGURES / "med_hh_tot.json").read_text())["v"]
    income = pd.Series(inc, index=common.index, dtype=float)
    manifest = {"built": dt.date.today().isoformat(), "da_outlines": da.attrs["source"],
                "leading_share": LEADING, "files": {
                    p.name: {"package": CKAN[p.name][0], "resource": CKAN[p.name][1], "bytes": p.stat().st_size,
                             "retrieved": dt.date.fromtimestamp(p.stat().st_mtime).isoformat()} for p in files},
                "address_points": {"all": pts.attrs["all"], "used": len(pts)},
                "not_included": {
                    "2026 general election": "official poll-by-poll results posted 2026-10-29 "
                                             "(election-results-official, 2026-results), but no 2026 subdivision "
                                             "boundaries or voter statistics on the portal as of 2026-11-11"}}
    polls_, das, nbhds, pieces_ = [], [], [], []
    checks, cols_all = {}, {}
    hh = common.hh
    for name, cfg in ELECTIONS.items():
        by_poll, by_da, by_da_area, check, cols, pc = build(name, cfg, da, pts, pop)
        cols_all.update(cols)
        pieces_.append(pc)
        polls_.append(by_poll)
        d = finish(by_da, cols)
        val = [c for c in by_da.columns if c not in ("dauid", "nbhd_id", "election")]
        nb = by_da.groupby("nbhd_id")[val].sum().reset_index()
        nb["pop21"] = nb.nbhd_id.map(places.population())
        nb["electors_per_pop"] = nb.electors / nb.pop21
        nb = finish(nb, cols).assign(election=name)
        nb_area = finish(by_da_area.groupby("nbhd_id")[val].sum().reset_index(), cols)
        da_area = finish(by_da_area, cols)
        nb_inc = (income * hh).groupby(common.nbhd_id).sum() / hh.where(income.notna()).groupby(common.nbhd_id).sum()
        di = d.dauid.map(income)
        ni = nb.nbhd_id.map(nb_inc)
        lead1 = list(cols.values())[0].replace("votes_", "share_")
        check["city_sums"] = {
            "by_da": {k: round(float(d[k].sum()), 3) for k in ("electors", "voted", "votes", *cols.values())},
            "by_nbhd": {k: round(float(nb[k].sum()), 3) for k in ("electors", "voted", "votes", *cols.values())},
        }
        check["electors_vs_pop21_by_nbhd"] = {
            **corr(nb.electors, nb.pop21), "ratio_city": round(float(nb.electors.sum() / nb.pop21.sum()), 3),
            "ratio_min": round(float(nb.electors_per_pop.min()), 3), "ratio_max": round(float(nb.electors_per_pop.max()), 3)}
        sel = d.electors >= 50  # DAs with few electors apportioned have noisy rates
        check["income"] = {
            "measure": "2021 median household total income (med_hh_tot); neighbourhoods: household-weighted "
                       "mean of their DAs' medians",
            "da_min_electors": 50,
            "turnout_by_da": corr(d.turnout[sel], di[sel]),
            "turnout_day_by_da": corr(d.turnout_day[sel], di[sel]),
            "turnout_by_nbhd": corr(nb.turnout, ni),
            **{f"{c.replace('votes_', 'share_')}_by_da": corr(d[c.replace("votes_", "share_")][sel], di[sel])
               for c in cols.values()},
            **{f"{c.replace('votes_', 'share_')}_by_nbhd": corr(nb[c.replace("votes_", "share_")], ni)
               for c in cols.values()},
        }
        ref = d.set_index("dauid")
        alt = da_area.set_index("dauid").reindex(ref.index)
        nref, nalt = nb.set_index("nbhd_id"), nb_area.set_index("nbhd_id")
        check["vs_area_weighting"] = {
            "turnout_by_da": {**corr(ref.turnout[sel.values], alt.turnout[sel.values]),
                              "median_abs_diff": round(float((ref.turnout - alt.turnout)[sel.values].abs().median()), 4)},
            "turnout_by_nbhd": {**corr(nref.turnout, nalt.turnout),
                                "max_abs_diff": round(float((nref.turnout - nalt.turnout).abs().max()), 4)},
            f"{lead1}_by_nbhd": {**corr(nref[lead1], nalt[lead1]),
                                 "max_abs_diff": round(float((nref[lead1] - nalt[lead1]).abs().max()), 4)},
        }
        das.append(d.assign(election=name))
        nbhds.append(nb)
        checks[name] = check
        print(f"{name}: {check['subdivisions']}; votes {check['official']['votes']:,}, "
              f"apportioned - official {check['apportioned_minus_official']}")
        print(f"  special polls {check['special_share']['mail_advance']['city']:.1%} of votes; "
              f"turnout {check['voter_statistics']['turnout']:.1%}; vs income {check['income']['turnout_by_da']} (DA), "
              f"{check['income']['turnout_by_nbhd']} (nbhd)")

    leader_cols = list(cols_all.values())
    share_cols = [c.replace("votes_", "share_") for c in leader_cols]
    counts = ["electors", "voted", "votes", *leader_cols, "votes_other"]
    p = pd.concat(polls_, ignore_index=True)
    p = p[["election", "ward", "sub", "kind", *counts, "n_da", "top_da"]]
    for c in counts:
        p[c] = p[c].round().astype("Int64")
    p["top_da"] = p.top_da.round(3)
    p["n_da"] = p.n_da.astype("Int64")
    p.to_csv(OUT / "by_poll.csv", index=False)

    rates = ["turnout", "turnout_day", *share_cols]
    for df, key, extra in ((pd.concat(das, ignore_index=True), ["dauid", "nbhd_id"], []),
                           (pd.concat(nbhds, ignore_index=True), ["nbhd_id"], ["pop21", "electors_per_pop"])):
        df = df[["election", *key, "electors", "voted", "voted_day", "votes", *leader_cols, "votes_other",
                 "turnout", "turnout_day", *share_cols, "lead", *extra]].copy()
        df["nbhd_id"] = df.nbhd_id.astype(int)
        for c in ["electors", "voted", "voted_day", "votes", *leader_cols, "votes_other"]:
            df[c] = df[c].round(1)
        for c in rates + (["electors_per_pop"] if extra else []):
            df[c] = df[c].round(4)
        df.to_csv(OUT / ("by_da.csv" if len(key) == 2 else "by_nbhd.csv"), index=False)
        manifest[f"rows_{'by_da' if len(key) == 2 else 'by_nbhd'}"] = int(len(df))
    manifest["rows_by_poll"] = int(len(p))
    pd.concat(pieces_, ignore_index=True)[["election", "ward", "sub", "dauid", "nbhd_id", "area", "points",
                                           "pop_est", "w", "w_area", "fallback"]].round(
        {"area": 1, "pop_est": 2, "w": 6, "w_area": 6}).to_csv(DETAIL / "elections_pieces.csv", index=False)
    manifest["checks"] = checks
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}: {f.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
