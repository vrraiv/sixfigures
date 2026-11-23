"""Multiplexes on building permits: houseplexes of three to six units, by month,
ward and neighbourhood, to follow the City's multiplex by-laws.

    python pipeline/multiplex.py

Reads the City's cleared (since 2017) and active building permit files
(download.py: toronto_permits_cleared_2017.csv, toronto_permits_active.csv) and
its address points, and writes pipeline/multiplex/:

  projects.csv   one row per project (an application number) that builds a
                 houseplex of three to six units or converts a building into
                 one: when it applied, its size, new or conversion, its
                 status, ward and neighbourhood
  manifest.json  retrieval date, file sizes, the last whole month, what was
                 left out and the checks

The by-laws it follows (Zoning By-law 569-2013 as amended):
  474-2023  12 May 2023   duplexes, triplexes and fourplexes as of right citywide
  47-2025   5 Feb 2025    fiveplexes and sixplexes in Ward 23 Scarborough North
  654-2025  26 Jun 2025   fiveplexes and sixplexes in Toronto and East York
                          (Wards 4, 9-14 and 19) and Ward 23, replacing 47-2025;
                          in force with 648-2025, which updated the houseplex
                          rules citywide the same day
A permit's ward is the first three characters of WARD_GRID: its district's
letter (S is Toronto and East York) and the 2018 ward number. SIXPLEX_WARDS are
the wards of 654-2025's area. Its Ward 23 part (Steeles to the 401, Midland to
Neilson Road and the Rouge) is roughly the ward, so all of Ward 23 is counted in.

What counts. The permit files have no multiplex flag. A project counts when
  - it has a building permit (BUILDING: not plumbing, HVAC, drains, demolition)
    whose structure type is a house of several units (STRUCTURE), and
  - its size can be read from the permit (size() below: the proposed use, then
    the description; "sixplex", "6 unit", "Multiplex - 6 Units", "six-unit"),
    is 3 to 6 units, and
  - it builds the houseplex (WORK is a new building) or adds units to an
    existing building (units created on any of its permits, or a description
    that converts, creates, adds or legalizes units). Work on a building that
    already has its units (a balcony on a sixplex) does not count.
A project's size is its latest revision's: a fourplex revised to a fiveplex is
a fiveplex, dated by the revision that first made it one (`sized`), while
`applied` keeps the first application. Laneway and garden suites are separate
buildings and are left out; so are rows of townhouses and apartment buildings
of seven or more units. Projects with a houseplex structure type but no size
in the text are counted in the manifest (`no_size`), not in projects.csv.

Applications are kept whatever became of them; `status` groups the latest
building permit's status: issued (issued, under inspection, closed),
review (still in review) and dropped (cancelled, refused, withdrawn).

Whole months only: applications after the last whole month before the
retrieval date are left out (the manifest says how many). Applications before
2017 are not in these files.

A project is placed by its permit's GEO_ID (an address point ID), failing that
by its address string against the address points, and the point in a 2021 DA
and neighbourhood with places.py. The script stops if a file's columns change,
if a ward code is unknown, or if too few projects are placed.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

import pandas as pd

import places

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "multiplex"
FILES = {"cleared": "toronto_permits_cleared_2017.csv", "active": "toronto_permits_active.csv"}
ADDRESSES = RAW / "toronto_address_points_4326.csv"
COLUMNS = {"PERMIT_NUM", "REVISION_NUM", "PERMIT_TYPE", "STRUCTURE_TYPE", "WORK", "STREET_NUM", "STREET_NAME",
           "STREET_TYPE", "STREET_DIRECTION", "GEO_ID", "WARD_GRID", "APPLICATION_DATE", "ISSUED_DATE",
           "STATUS", "DESCRIPTION", "PROPOSED_USE", "DWELLING_UNITS_CREATED"}
FIRST = "2017-01-01"
BUILDING = {"New Building", "New Houses", "Small Residential Projects", "Building Additions/Alterations",
            "Residential Building Permit", "Multiple Use Permit"}
# Structure types of a house with several units, or a small building that can be one. "SFD -
# Detached" is here because some houseplexes are filed under it; the size rule then decides.
STRUCTURE = re.compile(r"^(2 Unit|3\+ Unit|Converted House|Multiple Unit Building|Apartment Building"
                       r"|Duplex|Triplex|Fourplex|SFD - Detached|SFD - Semi-Detached)")
SIXPLEX_WARDS = {"S04", "S09", "S10", "S11", "S12", "S13", "S14", "S19", "E23"}
# The 25 wards (2018) under WARD_GRID's district letters, and their names in the City's ward file
WARDS = {
    "W01": "Etobicoke North", "W02": "Etobicoke Centre", "W03": "Etobicoke-Lakeshore", "S04": "Parkdale-High Park",
    "W05": "York South-Weston", "N06": "York Centre", "W07": "Humber River-Black Creek", "N08": "Eglinton-Lawrence",
    "S09": "Davenport", "S10": "Spadina-Fort York", "S11": "University-Rosedale", "S12": "Toronto-St. Paul's",
    "S13": "Toronto Centre", "S14": "Toronto-Danforth", "N15": "Don Valley West", "N16": "Don Valley East",
    "N17": "Don Valley North", "N18": "Willowdale", "S19": "Beaches-East York", "E20": "Scarborough Southwest",
    "E21": "Scarborough Centre", "E22": "Scarborough-Agincourt", "E23": "Scarborough North",
    "E24": "Scarborough-Guildwood", "E25": "Scarborough-Rouge Park",
}
BYLAWS = [
    {"id": "474-2023", "date": "2023-05-12", "what": "Duplexes, triplexes and fourplexes allowed citywide"},
    {"id": "47-2025", "date": "2025-02-05", "what": "Fiveplexes and sixplexes allowed in Ward 23 Scarborough North"},
    {"id": "654-2025", "date": "2025-06-26",
     "what": "Fiveplexes and sixplexes allowed in Toronto and East York (Wards 4, 9-14, 19) and Ward 23"},
]
STATUS = {
    "issued": {"Permit Issued", "Inspection", "Closed", "Revision Issued", "Work Not Started", "Not Started",
               "Closed - Dormant", "Open", "Ready for Issuance", "Issuance Pending", "Revocation Pending",
               "Pending Cancellation", "Pending Closed", "Forward to Inspector", "Permit Issued/Close File"},
    "dropped": {"Cancelled", "Refused", "Refusal Notice", "Application Withdrawn", "Abandoned", "Superseded",
                "Revoked", "Pending Cancellation"},
}
MIN_PLACED = 0.97
USE_ONLY = re.compile(r"^(?:SFD|Apartment Building|Multiple Unit Building)")
# A proposed use that names a business: a mixed-use building, not a houseplex
MIXED = re.compile(r"(?i)\b(?:restaurant|retail|store|shop|office|commercial|mixed|clinic|business|personal service)")

NUM = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
       "twelve": 12}
PLEX = {"duplex": 2, "triplex": 3, "fourplex": 4, "quadplex": 4, "quadruplex": 4, "fiveplex": 5, "sixplex": 6}
_n = r"\(?(\d{1,3}|" + "|".join(NUM) + r")\)?"  # "6", "six", "(6)"
# "6 unit", "6-unit", "6 units", "6 dwelling units", "6 residential units", "6 unit's"
UNITS = re.compile(r"(?<![\w.$/#])" + _n + r"\s*-?\s*(?:dwelling\s+|residential\s+|rental\s+)?units?\b", re.I)
# "4-plex", "6plex", "four-plex"; "duplex" ... "sixplex"
NPLEX = re.compile(r"(?<![\w.$/#])" + _n + r"\s*-?\s*plex\b", re.I)
WPLEX = re.compile(r"\b(" + "|".join(PLEX) + r")(?:es)?\b", re.I)
# "(6 units)", "total of 6 units", "total 6", "6 units total"
TOTAL = re.compile(r"\btotal(?:\s+of)?\s+" + _n + r"\b|" + _n + r"\s+(?:dwelling\s+)?units?\s+total\b", re.I)
# a count of units added, not the building's total: "add 2 units", "2 additional units"
ADDED = re.compile(r"\b(?:add(?:ing|ition of)?|creat(?:e|ing|ion of)|legali[sz](?:e|ing)|an?\s+additional|new)\s+$", re.I)
ADDS = re.compile(r"\b(?:convert|conversion|creat|legali[sz]|additional\s+(?:dwelling\s+|residential\s+)?units?"
                  r"|add(?:ing)?\s+(?:\w+\s+){0,2}(?:dwelling\s+|residential\s+)?units?|new\s+(?:dwelling\s+)?units?"
                  r"|increas\w*\s+(?:the\s+)?(?:number\s+of\s+)?(?:dwelling\s+)?units)", re.I)


def _num(s: str) -> int:
    s = s.lower()
    return NUM[s] if s in NUM else int(s)


def size(text) -> int | None:
    """The number of dwelling units a proposed use or description gives the
    building, or None. A stated total wins; then "N units" (not a count of
    units added), "N-plex" and "sixplex"; of several, the largest, since text
    often names the units before and after ("convert a triplex to a sixplex")."""
    if not isinstance(text, str) or not text.strip():
        return None
    t = text.replace("_", " ")
    tot = [_num(a or b) for a, b in TOTAL.findall(t)]
    if tot:
        return max(tot)
    found = []
    for m in UNITS.finditer(t):
        if not ADDED.search(t[max(0, m.start() - 30):m.start()]):
            found.append(_num(m.group(1)))
    found += [_num(m.group(1)) for m in NPLEX.finditer(t)]
    found += [PLEX[m.group(1).lower()] for m in WPLEX.finditer(t)]
    found = [n for n in found if 1 <= n <= 500]
    return max(found) if found else None


def load() -> pd.DataFrame:
    frames = []
    for src, name in FILES.items():
        df = pd.read_csv(RAW / name, dtype=str, low_memory=False)
        if missing := COLUMNS - set(df.columns):
            sys.exit(f"{name}: columns missing {sorted(missing)}; the file's layout has changed")
        frames.append(df[sorted(COLUMNS)].assign(source=src))
        print(f"{name}: {len(df):,} rows")
    df = pd.concat(frames, ignore_index=True)
    for c in ("STATUS", "PERMIT_TYPE", "STRUCTURE_TYPE", "WORK", "PERMIT_NUM", "REVISION_NUM"):
        df[c] = df[c].fillna("").str.strip()
    df["applied"] = pd.to_datetime(df.APPLICATION_DATE.str[:10], errors="coerce")
    df["created"] = pd.to_numeric(df.DWELLING_UNITS_CREATED, errors="coerce").fillna(0)
    df["app_no"] = df.PERMIT_NUM.str[:9]
    df["rev"] = pd.to_numeric(df.REVISION_NUM, errors="coerce").fillna(0)
    # a row in both files: the cleared one
    df = df.sort_values("source").drop_duplicates(["PERMIT_NUM", "REVISION_NUM"], keep="first")
    return df


def projects(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """One row per application number that builds or converts to a 3-6 unit houseplex."""
    b = df[df.PERMIT_TYPE.isin(BUILDING) & df.STRUCTURE_TYPE.str.match(STRUCTURE)].copy()
    b["use_n"] = b.PROPOSED_USE.map(size)
    b["desc_n"] = b.DESCRIPTION.map(size)
    # A house filed as a single-family dwelling, or an apartment or multiple-unit building,
    # counts only if its proposed use gives the size: their descriptions often count lots,
    # townhouses or the units added inside a larger building ("convert the garage into 5 units").
    sfd = b.STRUCTURE_TYPE.str.match(USE_ONLY)
    b["n"] = b.use_n.where(sfd, b.use_n.fillna(b.desc_n))
    b["big"] = b[["use_n", "desc_n"]].max(axis=1) > 6
    b["mixed"] = b.PROPOSED_USE.fillna("").str.contains(MIXED)
    b["adds"] = (b.WORK.str.contains("New Building") | (b.created > 0)
                 | b.DESCRIPTION.fillna("").str.contains(ADDS))
    b = b.sort_values(["app_no", "rev", "applied"])
    rows, no_size = [], {}
    for app, g in b.groupby("app_no", sort=False):
        sized = g[g.n.notna()]
        if sized.empty:
            if g.STRUCTURE_TYPE.str.startswith("3+ Unit").any():
                y = g.applied.min()
                no_size[str(y.year) if pd.notna(y) else "unknown"] = no_size.get(str(y.year) if pd.notna(y) else "unknown", 0) + 1
            continue
        last = sized.iloc[-1]
        n = int(last.n)
        if not 3 <= n <= 6 or not g.adds.any() or g.big.any() or g.mixed.any():
            continue
        cls = "5-6" if n >= 5 else "3-4"
        same = sized[sized.n.map(lambda v: ("5-6" if v >= 5 else "3-4") == cls if 3 <= v <= 6 else False)]
        latest = g.iloc[-1]
        status = ("dropped" if latest.STATUS in STATUS["dropped"] else
                  "issued" if latest.STATUS in STATUS["issued"] or g.ISSUED_DATE.notna().any() else "review")
        rows.append({
            "app_no": app, "applied": g.applied.min(), "sized": same.applied.min(),
            "units_first": int(sized.iloc[0].n), "units": n, "size": cls,
            "work": "new" if g.WORK.str.contains("New Building").any() else "conversion",
            "structure": last.STRUCTURE_TYPE, "status": status, "status_latest": latest.STATUS,
            "ward": latest.WARD_GRID[:3] if isinstance(latest.WARD_GRID, str) else None,
            "GEO_ID": latest.GEO_ID, "STREET_NUM": latest.STREET_NUM, "STREET_NAME": latest.STREET_NAME,
            "STREET_TYPE": latest.STREET_TYPE, "STREET_DIRECTION": latest.STREET_DIRECTION,
        })
    p = pd.DataFrame(rows)
    return p, dict(sorted(no_size.items()))


def street_key(name, kind, direction) -> pd.Series:
    clean = lambda s: s.fillna("").astype(str).str.strip().str.upper()  # noqa: E731
    return clean(name) + "|" + clean(kind) + "|" + clean(direction)


def place(p: pd.DataFrame) -> pd.DataFrame:
    a = pd.read_csv(ADDRESSES, dtype=str, usecols=["ADDRESS_POINT_ID", "LO_NUM", "LINEAR_NAME", "LINEAR_NAME_TYPE",
                                                   "LINEAR_NAME_DIR", "geometry"])
    xy = a.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0])
    a["lon"], a["lat"] = xy.str[0].astype(float), xy.str[1].astype(float)
    by_id = a.drop_duplicates("ADDRESS_POINT_ID").set_index("ADDRESS_POINT_ID")[["lon", "lat"]]
    a["key"] = a.LO_NUM.fillna("").str.strip() + " " + street_key(a.LINEAR_NAME, a.LINEAR_NAME_TYPE, a.LINEAR_NAME_DIR)
    by_addr = a.drop_duplicates("key").set_index("key")[["lon", "lat"]]
    p = p.copy()
    gid = p.GEO_ID.fillna("").str.strip().str.replace(r"\.0$", "", regex=True)
    hit = gid.isin(by_id.index)
    p.loc[hit, ["lon", "lat"]] = by_id.loc[gid[hit]].to_numpy()
    num = p.STREET_NUM.fillna("").str.extract(r"^\s*(\d+)", expand=False).fillna("")
    key = num + " " + street_key(p.STREET_NAME, p.STREET_TYPE, p.STREET_DIRECTION)
    hit2 = ~hit & key.isin(by_addr.index)
    p.loc[hit2, ["lon", "lat"]] = by_addr.loc[key[hit2]].to_numpy()
    p["placed_by"] = "unplaced"
    p.loc[hit, "placed_by"], p.loc[hit2, "placed_by"] = "geo_id", "address"
    return places.place(p)


def main() -> int:
    today = dt.date.today()
    df = load()
    retrieved = max(dt.date.fromtimestamp((RAW / n).stat().st_mtime) for n in FILES.values())
    month_end = pd.Timestamp(retrieved.replace(day=1)) - pd.Timedelta(days=1)  # the last whole month
    p, no_size = projects(df)
    p = p[p.sized >= FIRST]
    late = p[p.sized > month_end]
    p = p[p.sized <= month_end].copy()
    if unknown := set(p.ward.dropna()) - set(WARDS):
        sys.exit(f"unknown ward codes {sorted(unknown)}: WARD_GRID has changed")
    p["sixplex_area"] = p.ward.isin(SIXPLEX_WARDS)
    p = place(p)
    placed = p.nbhd_id.notna().mean()
    print(f"\nprojects: {len(p):,} ({(p['size'] == '5-6').sum():,} of 5-6 units); placed {placed:.1%} "
          f"({p.placed_by.value_counts().to_dict()}); after {month_end.date()}: {len(late)} left out")
    if placed < MIN_PLACED:
        sys.exit(f"only {placed:.1%} of projects placed in a neighbourhood (expected {MIN_PLACED:.0%})")
    p["month"] = p.sized.dt.strftime("%Y-%m")
    t = p.assign(q=p.sized.dt.to_period("Q")).pivot_table(index="q", columns=["sixplex_area", "size"], values="app_no",
                                                         aggfunc="count", fill_value=0)
    print(t.loc["2022Q1":].to_string())

    OUT.mkdir(exist_ok=True)
    cols = ["app_no", "applied", "sized", "month", "units_first", "units", "size", "work", "structure", "status",
            "ward", "sixplex_area", "nbhd_id", "placed_by"]
    out = p[cols].copy()
    for c in ("applied", "sized"):
        out[c] = out[c].dt.strftime("%Y-%m-%d")
    out["nbhd_id"] = out.nbhd_id.astype("Int64")
    out.sort_values(["sized", "app_no"]).to_csv(OUT / "projects.csv", index=False, lineterminator="\n")
    manifest = {
        "retrieved": retrieved.isoformat(),
        "built": today.isoformat(),
        "files": {n: (RAW / n).stat().st_size for n in FILES.values()},
        "first": FIRST,
        "last_month": month_end.strftime("%Y-%m"),
        "left_out_after_last_month": int(len(late)),
        "bylaws": BYLAWS,
        "sixplex_wards": sorted(SIXPLEX_WARDS),
        "wards": WARDS,
        "projects": int(len(p)),
        "by_size": {k: int(v) for k, v in p["size"].value_counts().sort_index().items()},
        "placed_share": round(float(placed), 4),
        "placed_by": {k: int(v) for k, v in p.placed_by.value_counts().items()},
        "no_size_3plus_unit_projects_by_year": no_size,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {OUT / 'projects.csv'} ({(OUT / 'projects.csv').stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
