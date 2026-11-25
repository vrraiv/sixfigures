"""Homes proposed in multiplex projects, by ward and month: the Sixplex experiment's table.

    python pipeline/sixplex.py

Reads pipeline/multiplex/projects.csv (multiplex.py: the Housing page's list of
houseplex projects of three to six units, so that the two pages count the same
projects), the City's building permit files (for the homes each project adds, two
placebo series and the dates of first applications) and its ward boundaries, and
writes pipeline/sixplex/:

  by_ward_month.csv  ward, month, then for each series the homes proposed and, for
                     some, the projects (see SERIES): every ward and every whole
                     month from START, with 0 where a ward had none (a true zero:
                     every ward has houses a multiplex could replace)
  wards.json         the 25 wards: number, name, arm (see below), whether a ward of
                     the rest of the city borders the sixplex wards, and an outline
  manifest.json      retrieval dates, the months covered, what was counted and how
                     first applications were dated

On 25-26 June 2025 City Council allowed up to six homes in a house-scale building
in the Toronto and East York district (wards 4, 9, 10, 11, 12, 13, 14 and 19: arm
"six") and left the rest of the city at the four allowed everywhere since May 2023
(arm "four"). Ward 23 (arm "early") got six under its own by-law on 5 February
2025, so it belongs with neither. (multiplex.py's `sixplex_area` puts Ward 23 with
the eight: the Housing page describes where six are allowed, this compares.)

What is counted. A project is a row of projects.csv: an application that builds or
converts to a houseplex of three to six homes, its size read from the permit's
proposed use or description (multiplex.py has the rules), in the ward its permit
names (WARD_GRID). Its homes are the homes it adds: the dwelling units created on
its building permit, so a duplex made into a fourplex is 2, where the building's
size (projects.csv's `units`) would make it 4 and count the homes already there.
An application's permits often repeat one count (the building permit and its
companions), so the count is taken from the permit with the most. The files keep a
row for each revision of a permit, each with its own application date and unit
count, so homes are dated by when they were proposed: a permit's first row counts
its units in the month of the project's first application, and each later revision
counts the change in its units in the month of the revision. A fourplex applied for
in 2024 and revised to six homes in 2026 is 4 homes in 2024 and 2 in 2026.

Series (homes; `_projects` where given):
  plex     projects not since dropped (multiplex.py's status: cancelled, refused,
           withdrawn, abandoned); `plex_projects` counts first applications
  small    of those, the homes proposed while the project stood at four or fewer
  big      and at five or six (from the month it reached that size, `sized`): more
           than the four-home rule allows. `big_projects` counts projects of five
           or six, in that month; `up_projects` those of them first applied for
           smaller
  filed    plex, with the dropped applications too: older applications have had
           longer to be refused or withdrawn than recent ones. `filed_big_projects`
           is the Housing page's count of 5-6 unit applications
  issued   plex, only projects with a permit issued so far
  new      plex, only new buildings
  building plex, with each project's homes the building's size, not the homes it
           adds (`units_first` at its first application, the change to `units` at
           `sized`)
  suites   laneway and garden suites, and
  houses   new detached houses, both from the permit files (units created, live
           permits): neither changed with the by-law, so each is a check

A first application isn't always in the files. For some permits, mostly closed
ones, the files keep only a later revision, dated when the revision was applied
for: sometimes years after the permit. Permit numbers are given out in order
through a year ("24 142054 BLD" is the 142,054th folder of 2024), so such a
permit is dated where its number falls among the year's permits whose first
application is in the files (origins; the manifest gives how many projects that
moved, and how close the rule comes on permits whose date is known). A project's
first application is the earlier of that and projects.csv's `applied`.

The months kept are whole: to projects.csv's last whole month.
"""
import contextlib
import datetime as dt
import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import permits as P

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "sixplex"
PROJECTS = HERE / "multiplex" / "projects.csv"
PROJECTS_MANIFEST = HERE / "multiplex" / "manifest.json"
WARDS = RAW / "toronto_wards_4326.geojson"
START = "2021-01"
BIG = 5  # homes from which a project is beyond the four-home rule
SIX = ["04", "09", "10", "11", "12", "13", "14", "19"]  # Toronto and East York district
EARLY = ["23"]  # Scarborough North: its own by-law, 5 February 2025
SUITE = "Laneway / Rear Yard Suite"
HOUSE = "SFD - Detached"
SERIES = ["plex_homes", "plex_projects", "small_homes", "big_homes", "big_projects", "up_projects",
          "filed_homes", "filed_big_projects", "issued_homes", "new_homes", "building_homes", "suites_homes", "houses_homes"]
WIDTH, SIMPLIFY, BORDER = 600, 40, 50  # outline box (px), simplification and "borders" distance (m)


def events(rows: pd.DataFrame) -> pd.DataFrame:
    """One row per proposal: a permit's first application, then each revision that
    changed its units. `rows` has permit, rev, applied, units (one row per permit
    and revision) and, optionally, origin: the date of the permit's first
    application, where the first row here is a later revision. Returns permit, date,
    homes (the change), total (units after it) and first (whether it is the first
    application)."""
    r = rows.sort_values(["permit", "rev", "applied"]).copy()
    before = r.groupby("permit").units.shift()
    r["first"] = before.isna()
    r["homes"] = r.units - before.fillna(0)
    if "origin" in r:
        r["applied"] = r.applied.where(~r["first"] | r.origin.isna(), r.origin)
    r = r[r["first"] | (r.homes != 0)]
    return r.rename(columns={"applied": "date", "units": "total"})[["permit", "date", "homes", "total", "first"]]


def proposals(p: pd.DataFrame) -> pd.DataFrame:
    """projects.csv's rows as proposals: each project's first size at its first
    application, then the change to its latest size when it reached it. `p` has
    app_no, applied, sized, units_first, units. Returns events()'s columns."""
    first = pd.DataFrame({"permit": p.app_no, "rev": 0, "applied": p.applied, "units": p.units_first})
    last = pd.DataFrame({"permit": p.app_no, "rev": 1, "applied": p.sized, "units": p.units})
    return events(pd.concat([first, last[p.units.to_numpy() != p.units_first.to_numpy()]]))


def origins(rows: pd.DataFrame) -> tuple[pd.Series, dict]:
    """Each permit's first application date: its revision 00's where the files hold
    one, and otherwise where its number falls among its year's permits that do
    (never later than its earliest row). `rows` has permit, rev, applied. Returns the
    dates by permit, and how many were dated by number and how well that rule dates
    the permits whose date is known (every other one, from the rest)."""
    first = rows[rows.rev == "00"].groupby("permit").applied.min()
    earliest = rows.groupby("permit").applied.min()
    year, seq = first.index.str[:2], pd.to_numeric(first.index.str[3:9], errors="coerce")
    known = pd.DataFrame({"year": year, "seq": seq, "date": first.to_numpy().astype("datetime64[s]").astype("int64")}).dropna()
    known = known.sort_values(["year", "seq"])
    lost = earliest.index.difference(first.index)
    out, errors = {}, []
    for y, k in known.groupby("year"):
        # permits are numbered in order, but some carry a date far from their neighbours' (a folder
        # opened late, or early): the median of the 21 around each, then never running backwards
        k = k.assign(said=k.date, date=k.date.rolling(21, center=True, min_periods=1).median().cummax())
        if len(k) > 20:
            a, b = k.iloc[::2], k.iloc[1::2]
            errors.extend(abs(np.interp(b.seq, a.seq, a.date) - b.said) / 86400)
        mine = lost[lost.str[:2] == y]
        s = pd.to_numeric(mine.str[3:9], errors="coerce")
        ok = ~np.isnan(s)
        out.update(zip(mine[ok], pd.to_datetime(np.interp(s[ok], k.seq, k.date), unit="s").normalize()))
    by_number = pd.Series(out, dtype="datetime64[ns]")
    by_number = by_number.where(by_number <= earliest.reindex(by_number.index), earliest.reindex(by_number.index))
    origin = pd.concat([first, by_number])
    origin = origin.where(origin <= earliest.reindex(origin.index), earliest.reindex(origin.index))
    return origin, {"dated_by_number": int(len(by_number)),
                    "median_error_days": round(float(np.median(errors)), 1), "p90_error_days": round(float(np.quantile(errors, 0.9)), 1)}


def whole_months(last: str, start: str = START) -> list[str]:
    """The months from `start` to `last`, the last whole month."""
    return [str(m) for m in pd.period_range(start, last, freq="M")]


def kind(structure: str, work: str) -> str | None:
    """Which placebo series a permit row belongs to, or None."""
    if structure == SUITE:
        return "suite"
    if structure == HOUSE and work.startswith("New Building"):
        return "house"
    return None


def ward_of(grid: pd.Series) -> pd.Series:
    """WARD_GRID's ward, "01" to "25" ("S0423" is ward 4), or NaN."""
    w = grid.fillna("").str.strip().str[1:3]
    return w.where(w.str.fullmatch(r"\d\d") & w.between("01", "25"))


def permit_rows() -> tuple[pd.DataFrame, pd.Series, dict]:
    """The permit rows that create homes (one per permit and revision, with its application
    number, whether it is dead, its placebo kind, ward and first application date), every
    permit's first application date, and how those were found."""
    with contextlib.redirect_stdout(io.StringIO()):  # permits.py prints its own checks
        raw = P.load()
    raw["applied"] = pd.to_datetime(raw.APPLICATION_DATE.str[:10], errors="coerce")
    origin, dating = origins(raw[raw.applied.notna()].rename(columns={"PERMIT_NUM": "permit", "REVISION_NUM": "rev"}))
    raw = raw[(raw.created > 0) & raw.applied.notna()].copy()
    raw["dead"] = raw.STATUS.isin(P.DROP_STATUS)
    raw["kind"] = [kind(s, w) for s, w in zip(raw.STRUCTURE_TYPE.fillna("").str.strip(), raw.WORK.fillna("").str.strip())]
    raw["rank"] = raw.source.map({s: i for i, s in enumerate(P.FILES)})
    rows = (raw.sort_values(["PERMIT_NUM", "REVISION_NUM", "rank"]).drop_duplicates(["PERMIT_NUM", "REVISION_NUM"], keep="last")
            .rename(columns={"PERMIT_NUM": "permit", "REVISION_NUM": "rev", "created": "units"}))
    rows["app"] = rows.permit.str[:9]
    rows["origin"] = rows.permit.map(origin)
    rows["ward"] = ward_of(rows.WARD_GRID)
    return rows, origin, dating


def added(p: pd.DataFrame, rows: pd.DataFrame) -> pd.DataFrame:
    """The homes each project adds, as proposals (events()'s columns, with app_no): from the
    permit of its application that creates the most, its live rows where it has any."""
    r = rows[rows.app.isin(p.app_no)]
    live = r[~r.dead]
    r = pd.concat([live, r[~r.app.isin(live.app)]])
    lead = r.loc[r.groupby("app").units.idxmax(), "permit"]
    r = r[r.permit.isin(lead)]
    ev = events(r[["permit", "rev", "applied", "units", "origin"]])
    ev["app_no"] = ev.permit.str[:9]
    # the project's first application, where that is earlier still (another of its permits)
    start = ev.app_no.map(p.set_index("app_no").applied)
    ev["date"] = ev.date.where(~(ev["first"] & (start < ev.date)), start)
    return ev


def projects(origin: pd.Series) -> tuple[pd.DataFrame, int]:
    """projects.csv with each project's ward as "01" to "25" and its first application
    dated (see the docstring); and how many projects that moved to an earlier month."""
    p = pd.read_csv(PROJECTS, dtype={"ward": str}, parse_dates=["applied", "sized"])
    need = {"app_no", "applied", "sized", "units_first", "units", "size", "work", "status", "ward"}
    if missing := need - set(p.columns):
        sys.exit(f"{PROJECTS}: columns missing {sorted(missing)}; multiplex.py's table has changed")
    p["ward"] = p.ward.str[1:]
    if p.ward.isna().any() or not p.ward.str.fullmatch(r"\d\d").all() or p.ward.nunique() != 25:
        sys.exit(f"{PROJECTS}: a project without one of the 25 wards")
    by_app = origin.groupby(origin.index.str[:9]).min()
    first = p.app_no.map(by_app)
    earlier = first.notna() & (first.dt.to_period("M") < p.applied.dt.to_period("M"))
    p["applied"] = p.applied.where(~(first < p.applied), first)
    return p, int(earlier.sum())


def table(p: pd.DataFrame, rows: pd.DataFrame, months: list[str]) -> tuple[pd.DataFrame, dict]:
    """by_ward_month.csv from the projects and the placebo series' permit rows."""
    index = pd.MultiIndex.from_product([[f"{w:02d}" for w in range(1, 26)], months], names=["ward", "month"])

    def tally(ev: pd.DataFrame, col: str = "homes") -> pd.Series:
        ev = ev.assign(month=ev.date.dt.to_period("M").astype(str))
        return ev.groupby(["ward", "month"])[col].sum().reindex(index, fill_value=0)

    info = p.set_index("app_no")

    def homes(sub: pd.DataFrame) -> pd.DataFrame:
        ev = added(sub, rows)
        return ev.join(info[["ward", "size", "sized", "units_first"]], on="app_no")

    alive = p[p.status != "dropped"]
    ev = homes(alive)
    # a project's homes are "big" from when it stood at five or six
    big = (ev["size"] == "5-6") & ((ev.units_first >= BIG) | (ev.date >= ev.sized))
    six = lambda d: d[d["size"] == "5-6"].assign(date=lambda x: x.sized, n=1)  # noqa: E731
    out = {
        "plex_homes": tally(ev), "plex_projects": tally(ev, "first"),
        "small_homes": tally(ev[~big]), "big_homes": tally(ev[big]),
        "big_projects": tally(six(alive), "n"), "up_projects": tally(six(alive[alive.units_first < BIG]), "n"),
        "filed_homes": tally(homes(p)), "filed_big_projects": tally(six(p), "n"),
        "issued_homes": tally(homes(alive[alive.status == "issued"])),
        "new_homes": tally(homes(alive[alive.work == "new"])),
        "building_homes": tally(proposals(alive).join(info.ward, on="permit")),
    }
    for name, k in (("suites_homes", "suite"), ("houses_homes", "house")):
        sub = rows[(rows.kind == k) & rows.ward.notna() & ~rows.dead]
        out[name] = tally(events(sub[["permit", "rev", "applied", "units", "origin"]]).join(sub.drop_duplicates("permit").set_index("permit").ward, on="permit"))
    t = pd.DataFrame(out)[SERIES].astype(int).reset_index()
    seen = ev[ev.date.dt.to_period("M").astype(str).isin(months)]
    listed = alive[proposals(alive).query("first").set_index("permit").date.reindex(alive.app_no).dt.to_period("M").astype(str).isin(months).to_numpy()]
    counts = {
        "projects counted": int(seen.app_no.nunique()),
        "projects on the list with no homes created on a permit": int((~listed.app_no.isin(ev.app_no)).sum()),
        "projects whose homes changed with a revision": int((~seen["first"]).sum()),
        "projects revised from four or fewer homes to five or six": int(out["up_projects"].sum()),
    }
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
    for f in [PROJECTS, PROJECTS_MANIFEST, *(RAW / n for n in P.FILES.values()), WARDS]:
        if not f.exists():
            sys.exit(f"{f} is missing (make multiplex; python pipeline/download.py --toronto {f.name})")
    source = json.loads(PROJECTS_MANIFEST.read_text())
    months = whole_months(source["last_month"])
    rows, origin, dating = permit_rows()
    p, moved = projects(origin)
    t, counts = table(p, rows, months)
    w = wards()
    names = {x["ward"]: x["name"] for x in w["wards"]}
    theirs = {k[1:]: v for k, v in source["wards"].items()}
    if names != theirs:
        sys.exit("the wards' names differ from multiplex.py's: WARD_GRID's numbers may not be the ward file's")

    OUT.mkdir(exist_ok=True)
    t.to_csv(OUT / "by_ward_month.csv", index=False, lineterminator="\n")
    (OUT / "wards.json").write_text(json.dumps(w, separators=(",", ":")) + "\n")
    manifest = {
        "retrieved": dt.date.today().isoformat(),
        "projects_retrieved": source["retrieved"],
        "files": {n: (RAW / n).stat().st_size for n in P.FILES.values()},
        "months": [months[0], months[-1]],
        "counted": counts | {"projects dated before their first row in the files": moved},
        "first_applications": dating,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    arm = {x["ward"]: x["arm"] for x in w["wards"]}
    half = t.assign(arm=t.ward.map(arm), half=t.month.str[:4] + "H" + ((t.month.str[5:].astype(int) > 6) + 1).astype(str))
    print(f"months {months[0]} to {months[-1]} (projects.csv retrieved {source['retrieved']})")
    for k, v in manifest["counted"].items():
        print(f"  {k}: {v:,}")
    print("\nhomes proposed in multiplex projects by half-year (small / big):")
    print(half.pivot_table(index="half", columns="arm", values=["small_homes", "big_homes"], aggfunc="sum").to_string())
    print(f"\nwrote {OUT / 'by_ward_month.csv'} ({len(t):,} rows), wards.json, manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
