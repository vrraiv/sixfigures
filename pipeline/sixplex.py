"""Homes proposed in multiplex projects, by ward and month: the Sixplex experiment's table.

    python pipeline/sixplex.py

Reads the City's building permit files (the three permits.py reads), its address
points and its ward boundaries, and writes pipeline/sixplex/:

  by_ward_month.csv  ward, month, then for each series the homes proposed and, for
                     some, the projects (see SERIES): every ward and every whole
                     month from START, with 0 where a ward had none (a true zero:
                     every ward has houses a multiplex could replace)
  wards.json         the 25 wards: number, name, arm (see below), whether a ward of
                     the rest of the city borders the sixplex wards, and an outline
  manifest.json      retrieval date, file sizes, the months covered, what was left
                     out and how much, and how the permits were placed

On 25-26 June 2025 City Council allowed up to six homes in a house-scale building
in the Toronto and East York district (wards 4, 9, 10, 11, 12, 13, 14 and 19: arm
"six") and left the rest of the city at the four allowed everywhere since 10 May
2023 (arm "four"). Ward 23 (arm "early") got six under its own by-law on 5 February
2025, so it belongs with neither.

What is counted. A multiplex project is a building permit whose structure type is
one of the City's "3+ Unit" types or "Triplex" (MULTIPLEX). Its homes are the
dwelling units it creates: net of the homes already there, so a house converted to
six shows 5. The files keep a row for each revision of a permit, each with its own
application date and unit count, so homes are dated by when they were proposed: a
permit's first row counts its units in the month of its application, and each later
revision counts the change in its units in the month of the revision. A fourplex
applied for in 2024 and revised to six homes in 2026 is 4 homes in 2024 and 2 in
2026. (permits.py's totals take a permit's latest revision; that would move those 2
homes to before the by-law.)

Series (homes; `_projects` where given counts first applications):
  plex     multiplex projects of up to CAP homes whose permit is alive (permits.py's
           DROP_STATUS: not cancelled, refused, withdrawn, abandoned or superseded)
  small    of those, the homes proposed while the project stood at four or fewer
  big      and at five or six: more than the four-home rule can produce. A house
           converted to five (4 created) can't be told from a new fourplex, so this
           undercounts
  up       revisions that took a project from four or fewer to five or six
           (`up_projects`; their homes are in `big`)
  filed    plex, with the dead permits too: older applications have had longer to be
           refused or withdrawn than recent ones
  issued   plex, only permits issued so far
  broad    plex, and new buildings of three to six homes filed as "Apartment
           Building" or "Multiple Unit Building": some sixplexes are filed that way,
           with small apartment buildings on main streets that aren't multiplexes
  suites   laneway and garden suites, and
  houses   new detached houses: neither changed with the by-law, so each is a check

Left out, and counted in the manifest: permits whose units repeat another permit's
(permits.py's companions); multiplex permits that reach more than CAP homes; rows
with no application date; permits no address places in a ward. The months kept are
whole: the last one ends before the files' latest application date.

A permit is placed in a ward by its GEO_ID's address point (the address points
carry the ward), and failing that as permits.py places one in a neighbourhood: by
its address string, the nearest number on the street, or a street all in one ward.
"""
import contextlib
import datetime as dt
import io
import json
import sys
from pathlib import Path

import pandas as pd

import permits as P

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "sixplex"
WARDS = RAW / "toronto_wards_4326.geojson"
START = "2021-01"
CAP = 6
BIG = 5  # homes created from which a project is beyond the four-home rule
SIX = ["04", "09", "10", "11", "12", "13", "14", "19"]  # Toronto and East York district
EARLY = ["23"]  # Scarborough North: its own by-law, 5 February 2025
MULTIPLEX = ("3+ Unit", "Triplex")
APARTMENT = {"Apartment Building", "Multiple Unit Building"}
NEW_BUILDING = {"New Building", "New Houses"}
SUITE = "Laneway / Rear Yard Suite"
HOUSE = "SFD - Detached"
SERIES = ["plex_homes", "plex_projects", "small_homes", "small_projects", "big_homes", "big_projects",
          "up_projects", "filed_homes", "issued_homes", "broad_homes", "suites_homes", "houses_homes"]
WIDTH, SIMPLIFY, BORDER = 600, 40, 50  # outline box (px), simplification and "borders" distance (m)


def events(rows: pd.DataFrame) -> pd.DataFrame:
    """One row per proposal: a permit's first application, then each revision that
    changed its units. `rows` has permit, rev, applied, units (one row per permit
    and revision). Returns permit, date, homes (the change), total (units after it)
    and first (whether it is the first application)."""
    r = rows.sort_values(["permit", "rev", "applied"]).copy()
    before = r.groupby("permit").units.shift()
    r["first"] = before.isna()
    r["homes"] = r.units - before.fillna(0)
    r = r[r["first"] | (r.homes != 0)]
    return r.rename(columns={"applied": "date", "units": "total"})[["permit", "date", "homes", "total", "first"]]


def whole_months(latest: pd.Timestamp, start: str = START) -> list[str]:
    """The months from `start` that end before `latest`, the files' latest application date."""
    end = pd.Period(latest, "M") - 1
    return [str(m) for m in pd.period_range(start, end, freq="M")]


def kind(structure: str, permit_type: str, work: str) -> str | None:
    """Which kind of project a permit row is (see the docstring), or None."""
    if structure.startswith(MULTIPLEX):
        return "plex"
    if structure in APARTMENT and permit_type in NEW_BUILDING and work.startswith("New Building"):
        return "apartment"
    if structure == SUITE:
        return "suite"
    if structure == HOUSE and work.startswith("New Building"):
        return "house"
    return None


def load() -> tuple[pd.DataFrame, dict]:
    """The permit rows this table counts, one per permit and revision, with what was left out."""
    with contextlib.redirect_stdout(io.StringIO()):  # permits.py prints its own checks
        raw = P.load()
        repeats = P.companions(P.dedupe(raw))
    raw = raw[raw.created > 0].copy()
    # a permit whose units repeat another's: the live permits companions() zeroed
    live_units = raw[~raw.STATUS.isin(P.DROP_STATUS)].groupby("PERMIT_NUM").created.max()
    repeated = set(repeats.index[(repeats.created == 0) & (live_units.reindex(repeats.index) > 0)])
    raw["kind"] = [kind(s, t, w) for s, t, w in zip(raw.STRUCTURE_TYPE.fillna("").str.strip(), raw.PERMIT_TYPE.fillna(""),
                                                    raw.WORK.fillna("").str.strip())]
    raw = raw[raw.kind.notna()]
    left = {"permits repeating another permit's homes": int(raw.PERMIT_NUM.isin(repeated).groupby(raw.PERMIT_NUM).first().sum())}
    raw = raw[~raw.PERMIT_NUM.isin(repeated)]
    raw["applied"] = pd.to_datetime(raw.APPLICATION_DATE.str[:10], errors="coerce")
    left["rows with no application date"] = int(raw.applied.isna().sum())
    raw = raw[raw.applied.notna()]
    raw["rank"] = raw.source.map({s: i for i, s in enumerate(P.FILES)})
    raw["dead"] = raw.STATUS.isin(P.DROP_STATUS)
    # one row per permit and revision: a cleared row beats an active one (as in permits.py)
    rows = (raw.sort_values(["PERMIT_NUM", "REVISION_NUM", "rank"]).drop_duplicates(["PERMIT_NUM", "REVISION_NUM"], keep="last")
            .rename(columns={"PERMIT_NUM": "permit", "REVISION_NUM": "rev", "created": "units"}))
    rows["issued"] = pd.to_datetime(rows.ISSUED_DATE.str[:10], errors="coerce")
    return rows, left


def place(rows: pd.DataFrame) -> pd.Series:
    """Each permit's ward ("01" to "25"), by permits.py's rules with wards for neighbourhoods."""
    a = pd.read_csv(P.ADDRESSES, dtype=str, usecols=["ADDRESS_POINT_ID", "LO_NUM", "LINEAR_NAME", "LINEAR_NAME_TYPE",
                                                     "LINEAR_NAME_DIR", "MUNICIPALITY_NAME", "WARD"])
    a = a[a.WARD.notna()]
    a["DAUID"], a["nbhd_id"] = a.WARD, a.WARD.astype(int)
    a["street"] = P.street_key(a.LINEAR_NAME, a.LINEAR_NAME_TYPE, a.LINEAR_NAME_DIR)
    a["num"] = pd.to_numeric(a.LO_NUM, errors="coerce")
    one = rows.sort_values(["permit", "rev"]).drop_duplicates("permit", keep="last").set_index("permit")
    p = P.place(one, a)
    how = p.method.value_counts()
    print("permits placed in a ward, by method:", ", ".join(f"{k} {v:,}" for k, v in how.items()))
    ward = p.nbhd_id.dropna().astype(int).map("{:02d}".format)
    return ward, {k: int(v) for k, v in how.items()}


def table(rows: pd.DataFrame, months: list[str]) -> tuple[pd.DataFrame, dict]:
    """by_ward_month.csv from the placed rows (permit, rev, applied, units, kind, dead, issued, ward)."""
    counts = {}
    out = {}
    index = pd.MultiIndex.from_product([sorted(rows.ward.unique()), months], names=["ward", "month"])

    def tally(ev: pd.DataFrame, col: str = "homes") -> pd.Series:
        ev = ev.assign(month=ev.date.dt.to_period("M").astype(str))
        return ev.groupby(["ward", "month"])[col].sum().reindex(index, fill_value=0)

    def proposals(sub: pd.DataFrame) -> pd.DataFrame:
        ev = events(sub[["permit", "rev", "applied", "units"]])
        return ev.join(sub.drop_duplicates("permit").set_index("permit")[["ward", "issued_ever"]], on="permit")

    rows = rows.assign(issued_ever=rows.groupby("permit").issued.transform("min").notna())
    plex_all = rows[rows.kind == "plex"]
    over = plex_all.groupby("permit").units.max() > CAP
    counts[f"multiplex permits reaching more than {CAP} homes"] = int(over.sum())
    plex_all = plex_all[~plex_all.permit.isin(over.index[over])]
    alive = plex_all[~plex_all.dead]
    ev = proposals(alive)
    ev["big"] = ev.total >= BIG
    out["plex_homes"], out["plex_projects"] = tally(ev), tally(ev, "first")
    out["small_homes"], out["small_projects"] = tally(ev[~ev.big]), tally(ev[~ev.big], "first")
    out["big_homes"], out["big_projects"] = tally(ev[ev.big]), tally(ev[ev.big], "first")
    was_small = ev.total - ev.homes < BIG
    up = ev[ev.big & ~ev["first"] & was_small]
    out["up_projects"] = tally(up.assign(n=1), "n")
    out["filed_homes"] = tally(proposals(plex_all))
    out["issued_homes"] = tally(ev[ev.issued_ever])
    apt = rows[(rows.kind == "apartment") & ~rows.dead]
    size = apt.groupby("permit").units.max()
    apt = apt[apt.permit.isin(size.index[size.between(3, CAP)])]
    out["broad_homes"] = out["plex_homes"] + tally(proposals(apt))
    for name, k in (("suites_homes", "suite"), ("houses_homes", "house")):
        out[name] = tally(proposals(rows[(rows.kind == k) & ~rows.dead]))
    t = pd.DataFrame(out)[SERIES].astype(int).reset_index()
    counts["multiplex permits counted"] = int(alive.permit.nunique())
    counts["revisions that changed a multiplex permit's homes"] = int((~ev["first"]).sum())
    counts["revisions that took a project to five or six homes"] = int(len(up))
    return t, counts


def wards() -> dict:
    """The wards with their arm, whether a four-home ward borders the sixplex wards, and outlines."""
    import geopandas as gpd  # only this step needs it

    g = gpd.read_file(WARDS)[["AREA_SHORT_CODE", "AREA_NAME", "geometry"]].to_crs(P.METRIC_CRS)
    g["ward"] = g.AREA_SHORT_CODE.astype(int).map("{:02d}".format)
    g = g.sort_values("ward").reset_index(drop=True)
    if len(g) != 25 or not set(SIX + EARLY) <= set(g.ward):
        sys.exit(f"{WARDS.name}: expected the 25 wards, got {len(g)}")
    g["arm"] = ["six" if w in SIX else "early" if w in EARLY else "four" for w in g.ward]
    block = g[g.arm == "six"].union_all().buffer(BORDER)
    g["borders"] = (g.arm == "four") & g.intersects(block)
    simple = g.geometry.simplify(SIMPLIFY, preserve_topology=True)
    x0, y0, x1, y1 = simple.total_bounds
    k = WIDTH / (x1 - x0)

    def ring(coords) -> str:
        pts = [(round((x - x0) * k), round((y1 - y) * k)) for x, y in coords]
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        return "M" + "L".join(f"{x} {y}" for x, y in pts[:-1]) + "Z"

    def path(geom) -> str:
        polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        return "".join(ring(p.exterior.coords) + "".join(ring(h.coords) for h in p.interiors) for p in polys)

    def label(geom) -> list[int]:
        c = geom.representative_point()
        return [round((c.x - x0) * k), round((y1 - c.y) * k)]

    return {"width": WIDTH, "height": round((y1 - y0) * k),
            "wards": [{"ward": r.ward, "name": r.AREA_NAME, "arm": r.arm, "borders": bool(r.borders),
                       "at": label(s), "path": path(s)} for r, s in zip(g.itertuples(), simple)]}


def main() -> int:
    for f in [*(RAW / n for n in P.FILES.values()), P.ADDRESSES, WARDS]:
        if not f.exists():
            sys.exit(f"{f} is missing (python pipeline/download.py --toronto {f.name})")
    rows, left = load()
    latest = rows.applied.max()
    months = whole_months(latest)
    ward, how = place(rows)
    rows["ward"] = rows.permit.map(ward)
    since = rows[rows.applied >= START]
    plex = since[(since.kind == "plex") & ~since.dead]
    left["multiplex permits that no address places in a ward"] = int(plex[plex.ward.isna()].permit.nunique())
    rows = rows[rows.ward.notna()]
    if rows.ward.nunique() != 25:
        sys.exit(f"permits in {rows.ward.nunique()} wards, not 25: the address points' wards have changed")
    t, counts = table(rows[rows.applied.dt.to_period("M").astype(str).isin(months)], months)
    w = wards()

    OUT.mkdir(exist_ok=True)
    t.to_csv(OUT / "by_ward_month.csv", index=False, lineterminator="\n")
    (OUT / "wards.json").write_text(json.dumps(w, separators=(",", ":")) + "\n")
    manifest = {
        "retrieved": dt.date.today().isoformat(),
        "files": {n: (RAW / n).stat().st_size for n in P.FILES.values()},
        "latest_application": latest.date().isoformat(),
        "months": [months[0], months[-1]],
        "left_out": left | {k: v for k, v in counts.items() if "more than" in k},
        "counted": {k: v for k, v in counts.items() if "more than" not in k},
        "placed_by": how,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    arm = {x["ward"]: x["arm"] for x in w["wards"]}
    half = t.assign(arm=t.ward.map(arm), half=t.month.str[:4] + "H" + ((t.month.str[5:].astype(int) > 6) + 1).astype(str))
    print(f"\nlatest application {latest.date()}; months {months[0]} to {months[-1]}")
    for k, v in (left | counts).items():
        print(f"  {k}: {v:,}")
    print("\nhomes proposed in multiplex projects by half-year (small / big):")
    print(half.pivot_table(index="half", columns="arm", values=["small_homes", "big_homes"], aggfunc="sum").to_string())
    print(f"\nwrote {OUT / 'by_ward_month.csv'} ({len(t):,} rows), wards.json, manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
