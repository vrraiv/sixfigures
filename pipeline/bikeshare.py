"""Bike Share Toronto's trips, counted by station and month.

    python pipeline/bikeshare.py          # make bikeshare
    python pipeline/bikeshare.py 2026     # only the years named, of those on disk
    python pipeline/bikeshare.py stations # no year: only place the stations again

The City publishes every trip (start and end station and time, member or casual), a year
to a zip: pipeline/raw/toronto_bikeshare_<year>.zip, 2017 on (download.py; 90 to 390 MB
each from 2019, so they are fetched only by name). This script reads the years on disk and
writes pipeline/bikeshare/, which is committed; a year whose zip isn't on disk keeps the
rows it has there, so a refresh needs only the current year's file.

  city_month.csv      month, trips, member, casual, round (ended where they started),
                      ebike and modelled (trips on an e-bike, and trips whose bike model is
                      given: the files name it from 2024), minutes (the median trip)
  station_month.csv   month, station, starts, ends, member, casual (of the starts)
  profile.csv         year, weekend (0/1), hour, member, casual: trips by the hour they
                      started, and days: the number of such days in the year's months
  stations.csv        station, name, lat, lon, capacity, nbhd_id, first, last (months with
                      a trip), listed (the date it was last in Bike Share's station list),
                      by ("list", or "intersection" for one placed by its name)
  manifest.json       the files read, the months covered, what was left out

What is counted. A trip belongs to the month it started in. Trips under a minute are left
out (a bike taken and put straight back; the 2018 files had already dropped
them). Only whole months are kept: the current year's file ends partway through its last.

Stations. The trip files give a station's number and name but not where it is. Locations
come from Bike Share's live station list (GBFS station_information), which holds the
stations in service today; a station since removed keeps the location stations.csv has for
it from an earlier run. One removed before the first run is placed by its name where that
names two streets ("King St E / Jarvis St"): at their intersection in the City's
intersection file, which is within a few dozen metres of where the dock stood. Streets are
often neighbourhood boundaries, so such a station can fall on the wrong side of one. The
Toronto Islands' docks are put away for the winter and leave the live list with them, and
a few other busy stations fit neither rule: HAND places those, to the nearest block. A
station with none of these has no location, and its trips count for the city only. The 2017
files for July to December give names without numbers: a name is matched to the number it
carries in the other files, and a trip whose name matches none is counted for the city but
for no station.

Dates. The files write dates five ways (1/4/2017 is 1 April in one quarter's file and
4 January in the next). Each file's format is the one under which its rows parse and fall
in the months the file is named for (all but 0.5% at most: a few rows are garbled, and
are left out and counted in the manifest).
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "bikeshare"
GBFS = "https://tor.publicbikesystem.net/ube/gbfs/v1/en/station_information"
NBHD = RAW / "toronto_neighbourhoods_4326.geojson"
CROSSINGS = RAW / "toronto_intersections_4326.csv"
MIN_SECONDS = 60
FORMATS = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M", "%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M:%S",
           "%d/%m/%Y %H:%M:%S", "%m/%d/%y %H:%M:%S", "%d/%m/%y %H:%M:%S", "%m/%d/%y %H:%M", "%d/%m/%y %H:%M"]
COLS = {  # the files' column names, lower-cased with spaces and underscores removed -> ours
    "tripdurationseconds": "secs", "tripduration": "secs",
    "fromstationid": "from_id", "startstationid": "from_id", "tostationid": "to_id", "endstationid": "to_id",
    "fromstationname": "from_name", "startstationname": "from_name", "tostationname": "to_name", "endstationname": "to_name",
    "tripstarttime": "start", "starttime": "start", "usertype": "user", "bikemodel": "model",
}
# Stations placed by hand (latitude, longitude, to about a block): enough to say which
# neighbourhood they are in. The Islands' stations are seasonal.
HAND = {
    8030: (43.6204, -79.3783),  # Centre Island Ferry Dock
    8028: (43.6305, -79.3570),  # Ward's Island Ferry Dock
    8070: (43.6195, -79.3740),  # Centre Island
    8027: (43.6275, -79.3900),  # Hanlan's Point Ferry Dock
    8228: (43.6157, -79.3745),  # Centre Island Beach
    8029: (43.6195, -79.3935),  # Hanlan's Point Beach
    8229: (43.6165, -79.3915),  # Hanlan's Point Beach (Entrance 5)
    8118: (43.6660, -79.3879),  # Clover Hill Park (Bay St / St Joseph St)
    7881: (43.6451, -79.3540),  # Queens Quay E / Merchants' Wharf
    8233: (43.6476, -79.3848),  # St. Andrew Subway Station
    7519: (43.6877, -79.4395),  # 406 Oakwood Ave
}
EBIKE = re.compile("EFIT|E-?BIKE|ELECTRIC", re.I)


def members(year: int):
    """(name, bytes) of every CSV in the year's zip, zips inside it opened too."""
    def walk(z: zipfile.ZipFile):
        for i in z.infolist():
            if i.is_dir() or "/~$" in "/" + i.filename:
                continue
            if i.filename.lower().endswith(".zip"):
                yield from walk(zipfile.ZipFile(io.BytesIO(z.read(i))))
            elif i.filename.lower().endswith(".csv"):
                yield i.filename, z.open(i)
    with zipfile.ZipFile(RAW / f"toronto_bikeshare_{year}.zip") as z:
        yield from walk(z)


def months_of(name: str, year: int) -> set[int]:
    """The months a file is named for: a quarter's, one month's, or the whole year's."""
    base = name.rsplit("/", 1)[-1]
    q = re.search(r"Q([1-4])", base)
    if q:
        return set(range(3 * int(q[1]) - 2, 3 * int(q[1]) + 1))
    m = re.search(rf"{year}-(\d\d)", base)
    return {int(m[1])} if m else set(range(1, 13))


def parse_dates(text: pd.Series, year: int, allowed: set[int], fmt: str | None, name: str) -> tuple[pd.Series, str]:
    for f in ([fmt] if fmt else FORMATS):
        t = pd.to_datetime(text, format=f, errors="coerce")
        # a few trips start in the last hours of the month before the file's
        inside = (t.dt.year == year) & t.dt.month.isin(allowed)
        if inside.mean() > 0.995:  # the odd row is garbled, or starts just before the file's first month
            return t, f
    sys.exit(f"{name}: no date format reads every row into {year}, months {sorted(allowed)} (first: {text.iloc[0]!r})")


class Counts:
    """One year's counts, built a chunk at a time."""

    def __init__(self):
        self.station, self.city, self.profile, self.dur = [], [], [], []
        self.names = {}  # station -> (month, name): the latest name seen
        self.unnumbered = []  # (month, from_name, to_name, member) counts for files without station numbers
        self.short = self.rows = self.unread = 0  # trips under a minute; rows; rows whose start time couldn't be read
        self.last = pd.Timestamp.min  # the latest trip start read

    def add(self, d: pd.DataFrame):
        self.rows += len(d)
        self.last = max(self.last, d.start.max()) if len(d) else self.last
        secs = pd.to_numeric(d.secs, errors="coerce")
        keep = secs >= MIN_SECONDS
        self.short += int((~keep).sum())
        d, secs = d[keep], secs[keep]
        if d.empty:
            return
        month = d.start.dt.strftime("%Y-%m")
        casual = d.user.astype(str).str.contains("casual", case=False)
        numbered = "from_id" in d
        if numbered:
            a = pd.to_numeric(d.from_id, errors="coerce").fillna(-1).astype(int)
            b = pd.to_numeric(d.to_id, errors="coerce").fillna(-1).astype(int)
            rounds = (a == b) & (a >= 0)
            s = pd.DataFrame({"month": month, "station": a, "member": ~casual, "casual": casual})
            g = s.groupby(["month", "station"]).agg(starts=("member", "size"), member=("member", "sum"), casual=("casual", "sum"))
            e = pd.DataFrame({"month": month, "station": b}).groupby(["month", "station"]).size().rename("ends")
            self.station.append(g.join(e, how="outer").fillna(0).astype(int).reset_index())
            for col_id, col_name in ((a, d.from_name), (b, d.to_name)):
                n = pd.DataFrame({"m": month, "id": col_id, "name": col_name.astype(str).str.strip()})
                n = n[(n.id >= 0) & ~n.name.isin(["NULL", "nan", ""])].drop_duplicates(["id", "name"], keep="last")
                for m, i, nm in n.itertuples(index=False):
                    if i not in self.names or self.names[i][0] <= m:
                        self.names[i] = (m, nm)
        else:
            rounds = d.from_name == d.to_name
            u = pd.DataFrame({"month": month, "from_name": d.from_name.astype(str).str.strip(),
                              "to_name": d.to_name.astype(str).str.strip(), "casual": casual})
            self.unnumbered.append(u.groupby(["month", "from_name", "to_name", "casual"]).size().rename("n").reset_index())
        has_model = "model" in d and d.model.notna().any()
        c = pd.DataFrame({"month": month, "member": ~casual, "casual": casual, "round": rounds,
                          "ebike": d.model.astype(str).str.contains(EBIKE) if has_model else False,
                          "modelled": d.model.notna() if has_model else False})
        self.city.append(c.groupby("month").agg(trips=("member", "size"), member=("member", "sum"), casual=("casual", "sum"),
                                                 round=("round", "sum"), ebike=("ebike", "sum"), modelled=("modelled", "sum")).reset_index())
        mins = np.minimum(secs // 60, 240).astype(int)
        self.dur.append(pd.DataFrame({"month": month, "mins": mins}).groupby(["month", "mins"]).size().rename("n").reset_index())
        p = pd.DataFrame({"month": month, "weekend": (d.start.dt.day_of_week >= 5).astype(int), "hour": d.start.dt.hour,
                          "member": ~casual, "casual": casual})
        self.profile.append(p.groupby(["month", "weekend", "hour"])[["member", "casual"]].sum().reset_index())


def read_year(year: int) -> Counts:
    c = Counts()
    for name, f in members(year):
        allowed, fmt = months_of(name, year), None
        with f:
            for chunk in pd.read_csv(f, dtype=str, chunksize=1_000_000, encoding="utf-8-sig", encoding_errors="replace"):
                chunk = chunk.rename(columns=lambda s: COLS.get(re.sub(r"[\s_]", "", s.lower()), s))
                lacking = {"secs", "start", "user", "from_name", "to_name"} - set(chunk.columns)
                if lacking:
                    sys.exit(f"{name}: no column for {sorted(lacking)} ({list(chunk.columns)})")
                chunk = chunk.dropna(subset=["start"])
                chunk["start"], fmt = parse_dates(chunk.start, year, allowed, fmt, name)
                c.unread += int(chunk.start.isna().sum())
                c.add(chunk[chunk.start.dt.year == year])
        print(f"  {year}: {name.rsplit('/', 1)[-1]} ({fmt})", flush=True)
    return c


def total(parts: list, keys: list) -> pd.DataFrame:
    return pd.concat(parts, ignore_index=True).groupby(keys).sum().reset_index() if parts else pd.DataFrame()


def median_minutes(dur: pd.DataFrame) -> pd.Series:
    def med(g):
        g = g.sort_values("mins")
        return int(g.mins.iloc[int(np.searchsorted(g.n.cumsum().values, g.n.sum() / 2))])
    return pd.Series({m: med(g) for m, g in dur.groupby("month")}, name="minutes")


def live_stations() -> pd.DataFrame:
    try:
        req = urllib.request.Request(GBFS, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            st = json.load(r)["data"]["stations"]
    except Exception as e:  # the committed stations.csv stands in
        print(f"  Bike Share's station list could not be read ({e}); keeping stations.csv's locations")
        return pd.DataFrame(columns=["station", "name", "lat", "lon", "capacity", "listed"])
    d = pd.DataFrame([{"station": int(s["station_id"]), "name": s["name"].strip(), "lat": round(s["lat"], 6), "lon": round(s["lon"], 6),
                       "capacity": s.get("capacity")} for s in st if str(s["station_id"]).isdigit()])
    d["listed"] = pd.Timestamp.today().date().isoformat()
    return d


def street(s: str) -> str:
    s = re.sub(r"\s+", " ", s.replace(".", "").strip().lower())
    return re.sub(r"\bav\b", "ave", s)


def by_intersection(names: pd.Series) -> pd.DataFrame:
    """lat, lon for the station names that are two streets meeting once in the City's file."""
    if not CROSSINGS.exists():
        sys.exit(f"{CROSSINGS} is missing: python pipeline/download.py --toronto {CROSSINGS.name}")
    x = pd.read_csv(CROSSINGS, usecols=["INTERSECTION_DESC", "geometry"]).dropna()
    at = {}
    for desc, geom in x.itertuples(index=False):
        streets = [street(p) for p in desc.split(" / ")]
        lon, lat = json.loads(geom)["coordinates"][0]
        for i, a in enumerate(streets):
            for b in streets[i + 1:]:
                at.setdefault(frozenset((a, b)), []).append((lat, lon))
    rows = {}
    for k, name in names.dropna().items():
        clean = re.sub(r"\(.*?\)|- ?smart|green p", "", name, flags=re.I)
        pair = frozenset(street(p) for p in clean.split("/") if p.strip())
        pts = at.get(pair, []) if len(pair) == 2 else []
        # two streets can meet twice (a crescent): placed only where the meetings are within 150 m
        if pts and max(abs(p[0] - pts[0][0]) * 111_000 + abs(p[1] - pts[0][1]) * 80_000 for p in pts) < 150:
            rows[k] = (round(pts[0][0], 6), round(pts[0][1], 6))
    return pd.DataFrame.from_dict(rows, orient="index", columns=["lat", "lon"])


def neighbourhood(st: pd.DataFrame) -> pd.Series:
    import geopandas as gpd
    if not NBHD.exists():
        sys.exit(f"{NBHD} is missing: python pipeline/download.py --toronto {NBHD.name}")
    nb = gpd.read_file(NBHD)
    nb["nbhd_id"] = nb["AREA_SHORT_CODE"].astype(int)
    has = st.lat.notna()
    pts = gpd.GeoDataFrame(st[has][["station"]], geometry=gpd.points_from_xy(st[has].lon, st[has].lat), crs=4326).to_crs(32617)
    j = gpd.sjoin_nearest(pts, nb[["nbhd_id", "geometry"]].to_crs(32617), max_distance=150, distance_col="m")
    j = j[~j.index.duplicated()]
    return j.set_index("station").nbhd_id.reindex(st.station).astype("Int64").set_axis(st.index)


def main(only: list[str]) -> int:
    years = sorted(int(f.stem[-4:]) for f in RAW.glob("toronto_bikeshare_20??.zip"))
    years = [] if only == ["stations"] else [y for y in years if not only or str(y) in only]
    if not years and only != ["stations"]:
        sys.exit("no toronto_bikeshare_<year>.zip in pipeline/raw (make bikeshare fetches them)")
    OUT.mkdir(exist_ok=True)
    old = {n: pd.read_csv(OUT / f"{n}.csv") if (OUT / f"{n}.csv").exists() else pd.DataFrame()
           for n in ("city_month", "station_month", "profile", "stations")}
    read = {y: read_year(y) for y in years}

    # station numbers for the files that give names only: the number each name carries elsewhere
    names = {}
    for c in read.values():
        for i, (m, nm) in c.names.items():
            if i not in names or names[i][0] <= m:
                names[i] = (m, nm)
    by_name = {nm: i for i, (m, nm) in sorted(names.items(), key=lambda kv: kv[1][0])}
    unmatched = 0
    for c in read.values():
        if not c.unnumbered:
            continue
        u = total(c.unnumbered, ["month", "from_name", "to_name", "casual"])
        u["a"], u["b"] = u.from_name.map(by_name), u.to_name.map(by_name)
        unmatched += int(u[u.a.isna()].n.sum())
        s = u.dropna(subset=["a"]).assign(station=lambda t: t.a.astype(int), member=lambda t: t.n.where(~t.casual, 0), cas=lambda t: t.n.where(t.casual, 0))
        g = s.groupby(["month", "station"]).agg(starts=("n", "sum"), member=("member", "sum"), casual=("cas", "sum"))
        e = u.dropna(subset=["b"]).assign(station=lambda t: t.b.astype(int)).groupby(["month", "station"]).n.sum().rename("ends")
        c.station.append(g.join(e, how="outer").fillna(0).astype(int).reset_index())

    def months_of_years(t):  # the committed rows of years not read now
        return t[~t.month.str[:4].astype(int).isin(years)] if len(t) else t

    if not read:
        if not len(old["city_month"]):
            sys.exit("nothing in pipeline/bikeshare to place stations for")
        return stations(old["city_month"], old["station_month"], old["profile"], old["stations"], {}, read, years, unmatched)
    city = pd.concat([total(c.city, ["month"]) for c in read.values()], ignore_index=True)
    dur = pd.concat([total(c.dur, ["month", "mins"]) for c in read.values()], ignore_index=True)
    city = city.merge(median_minutes(dur), left_on="month", right_index=True)
    station = pd.concat([total(c.station, ["month", "station"]) for c in read.values()], ignore_index=True)
    station = station[station.station >= 0][["month", "station", "starts", "ends", "member", "casual"]]
    profile = pd.concat([total(c.profile, ["month", "weekend", "hour"]) for c in read.values()], ignore_index=True)

    # whole months only: the latest file stops partway through its last month
    last = max(c.last for c in read.values())
    tail = last.strftime("%Y-%m")
    if last.day < last.days_in_month:
        print(f"  {tail} runs only to {last.date()}: left out")
        city, station, profile = city[city.month < tail], station[station.month < tail], profile[profile.month < tail]
    profile = profile.assign(year=profile.month.str[:4].astype(int)).groupby(["year", "weekend", "hour"])[["member", "casual"]].sum().reset_index()

    city = pd.concat([months_of_years(old["city_month"]), city], ignore_index=True).sort_values("month")
    station = pd.concat([months_of_years(old["station_month"]), station], ignore_index=True).sort_values(["month", "station"])
    if len(old["profile"]):
        profile = pd.concat([old["profile"][~old["profile"].year.isin(years)].drop(columns="days", errors="ignore"), profile], ignore_index=True)
    # the days of each kind in the months kept, so the page can show trips per day
    days = pd.DataFrame({"day": pd.concat([pd.Series(pd.date_range(f"{m}-01", periods=pd.Timestamp(f"{m}-01").days_in_month)) for m in city.month])})
    days = days.assign(year=days.day.dt.year, weekend=(days.day.dt.day_of_week >= 5).astype(int)).groupby(["year", "weekend"]).size().rename("days")
    keep_months = set(city.month)
    profile = profile.merge(days, on=["year", "weekend"]).sort_values(["year", "weekend", "hour"])
    return stations(city, station, profile, old["stations"], names, read, years, unmatched)


def stations(city, station, profile, prev, names, read, years, unmatched) -> int:
    keep_months = set(city.month)
    gaps = sorted(set(pd.period_range(city.month.min(), city.month.max(), freq="M").strftime("%Y-%m")) - keep_months)
    if gaps:
        sys.exit(f"no trips in {', '.join(gaps)}: a year's file is missing or unread")

    # stations: where they are, and the months they had trips
    live = live_stations()
    span = station.groupby("station").month.agg(first="min", last="max")
    st = pd.DataFrame({"station": sorted(set(span.index) | set(live.station))})
    st["name"] = st.station.map(live.set_index("station").name if len(live) else {}).fillna(st.station.map({i: nm for i, (m, nm) in names.items()}))
    for col in ("lat", "lon", "capacity", "listed"):
        st[col] = st.station.map(live.set_index("station")[col]) if len(live) else np.nan
        if len(prev) and col in prev:
            st[col] = st[col].fillna(st.station.map(prev.set_index("station")[col]))
    st["by"] = np.where(st.lat.notna(), "list", None)
    if len(prev):
        st["name"] = st.name.fillna(st.station.map(prev.set_index("station").name))
        if "by" in prev:
            st["by"] = st.station.map(prev.set_index("station").by).where(st.station.map(prev.set_index("station").lat).notna()).fillna(st.by)
            st.loc[st.listed == pd.Timestamp.today().date().isoformat(), "by"] = "list"
    found = by_intersection(st[st.lat.isna()].name)
    st.loc[found.index, ["lat", "lon"]] = found.values
    st.loc[found.index, "by"] = "intersection"
    hand = st.lat.isna() & st.station.isin(HAND)
    st.loc[hand, "lat"], st.loc[hand, "lon"] = st[hand].station.map(lambda i: HAND[i][0]), st[hand].station.map(lambda i: HAND[i][1])
    st.loc[hand, "by"] = "hand"
    st["nbhd_id"] = neighbourhood(st)
    st = st.join(span, on="station")
    st["capacity"] = st.capacity.astype("Int64")

    city.to_csv(OUT / "city_month.csv", index=False, lineterminator="\n")
    station.to_csv(OUT / "station_month.csv", index=False, lineterminator="\n")
    profile.to_csv(OUT / "profile.csv", index=False, lineterminator="\n")
    st[["station", "name", "lat", "lon", "capacity", "nbhd_id", "first", "last", "listed", "by"]].to_csv(OUT / "stations.csv", index=False, lineterminator="\n")

    placed = station.merge(st[["station", "nbhd_id"]], on="station")
    by_year = placed.assign(year=placed.month.str[:4]).groupby("year").apply(lambda g: g[g.nbhd_id.notna()].starts.sum() / g.starts.sum(), include_groups=False)
    numbered = station.groupby(station.month.str[:4]).starts.sum() / city.groupby(city.month.str[:4]).trips.sum()
    before = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {}
    manifest = {
        "built": pd.Timestamp.today().date().isoformat(),
        "months": [city.month.iloc[0], city.month.iloc[-1]],
        "trips": int(city.trips.sum()),
        # the counts below are of the years last read; a run on fewer years keeps the others' as they were
        "files": {**before.get("files", {}), **{f"toronto_bikeshare_{y}.zip": (RAW / f"toronto_bikeshare_{y}.zip").stat().st_size for y in years}},
        "under_a_minute_left_out": {**before.get("under_a_minute_left_out", {}), **{str(y): c.short for y, c in read.items()}},
        "rows_without_a_readable_start_time": {**before.get("rows_without_a_readable_start_time", {}), **{str(y): c.unread for y, c in read.items()}},
        "unnumbered_trips_without_a_station": unmatched if 2017 in years else before.get("unnumbered_trips_without_a_station", 0),
        "stations": {"with_trips": int(len(span)), "located": int(st[st["first"].notna()].lat.notna().sum()), "listed_now": int(len(live)),
                     "placed_by_intersection": int((st[st["first"].notna()].by == "intersection").sum())},
        "share_of_starts_at_a_numbered_station": {y: round(float(v), 4) for y, v in numbered.items()},
        "share_of_station_starts_located": {y: round(float(v), 4) for y, v in by_year.items()},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {OUT}: {city.month.iloc[0]} to {city.month.iloc[-1]}, {manifest['trips']:,} trips; "
          f"{manifest['stations']['located']} of {manifest['stations']['with_trips']} stations located")
    print("  share of station starts at a located station, by year:", ", ".join(f"{y} {v:.1%}" for y, v in by_year.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
