"""TTC service from the schedule feed, and subway delays by station and cause.

    python pipeline/ttc.py          # make ttc

Reads the TTC's schedule (GTFS, pipeline/raw/toronto_ttc_gtfs.zip; the City's
ttc-routes-and-schedules package, replaced about every six weeks when the TTC's board
period changes) and the subway delay files transport.py reads, and writes pipeline/ttc/,
which is committed:

  service.csv         feed, day, nbhd_id, mode, stops, departures: for each schedule
                      period (`feed`, its first date) and a typical weekday, Saturday and
                      Sunday in it, the stops in each neighbourhood with a departure that
                      day and their departures, by mode (subway, streetcar and LRT, bus).
                      A run adds the feed on disk and keeps the periods it holds, so the
                      table grows a period at a time; the feed itself has no history.
  access.csv          feed, nbhd_id, pop, frequent, rapid: the 2021 residents of each
                      neighbourhood, and how many live within FREQUENT_M of a stop with a
                      departure at least every 10 minutes from 7 am to 7 pm on the weekday
                      (FREQUENT_PER_HOUR in every hour, at that stop, which in the TTC's feed
                      is one side of the street), and within RAPID_M of a subway or LRT
                      station. A DA counts as within reach when its centroid is.
  stops.csv           the latest feed's subway and LRT stations: name, lat, lon, line(s),
                      nbhd_id, weekday departures
  station_delays.csv  month, station, cause, delays, minutes: subway delays that held a
                      train, at a named station, by the cause group of their code
  cause_month.csv     month, cause, incidents, delays, minutes: every subway incident, by
                      cause group, at a station or between stations
  manifest.json       the feeds held, how the days were chosen, the delay rows matched to a
                      station

The days. A feed's period runs from its calendar's first date to its last. The weekday is
the period's first Wednesday whose services are those of most weekdays in the period (a
holiday runs Sunday service and is passed over); Saturday and Sunday likewise.

Delays by station. The delay files name a station in capitals, sometimes with its line
("ST GEORGE YUS STATION", "KENNEDY BD STATION"), and sometimes a stretch between two
("BLOOR TO ST GEORGE") or a whole line: those count for the city, by cause, and for no
station. Names are matched to the schedule's stations after STATION_ALIASES.

Cause groups (CAUSES) follow the codes' own prefixes (EU trains, PU track, signals and
power, TU operations, SU security), except that the miscellaneous codes (MU) and two plant
codes for stairs and escalators are sorted by what they describe: an ill or injured
customer, a person at track level, closures and construction, fire, smoke and weather,
and staff.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

from places import METRIC_CRS, common, da_polygons, place

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "ttc"
GTFS = RAW / "toronto_ttc_gtfs.zip"
FREQUENT_PER_HOUR, FREQUENT_HOURS = 6, range(7, 19)  # 7:00 to 18:59
FREQUENT_M, RAPID_M = 400, 800
MODES = {1: "subway", 0: "streetcar", 3: "bus"}  # GTFS route_type; Lines 5 and 6 are type 0
RAPID_ROUTES = {"1", "2", "4", "5", "6"}  # subway and LRT lines, by route_short_name

CAUSES = [  # (group, codes or prefixes); the first that matches
    ("Ill or injured customers", ["MUI", "MUIR", "MUIRS", "MUIS", "PUMEL", "PUMST", "MUPAA"]),
    ("A person at track level", ["MUPR1", "SUUT"]),
    ("Security and police", ["SU"]),
    ("Closures and construction", ["MUCP", "MUCU", "MUEC", "MUATC", "PUEWZ", "PUSWZ", "PUTWZ"]),
    ("Fire, smoke and weather", ["MUFS", "MUPLA", "MUPLB", "MUPLC", "MUWEA", "MUFM", "PUTIS", "PUSIS", "MUPF"]),
    ("Doors and passengers", ["MUD", "MUDD", "MUSAN", "MUODC"]),
    ("Staff and operations", ["TU", "MUNOA", "MUESA", "MUNCA", "MUCSA", "MUTD", "MUTO", "MULD", "MUWR", "MUCL", "MUIE"]),
    ("Trains", ["EU"]),
    ("Track, signals and power", ["PU"]),
]
OTHER = "Other"
# The schedule lists Bloor (Line 1) and Yonge (Line 2), and Sheppard (Lines 1 and 4), under
# their own names; they are one station each to a rider and in the delay log.
STATION_NAMES = {"Bloor": "Bloor-Yonge", "Yonge": "Bloor-Yonge", "Sheppard": "Sheppard-Yonge"}
# delay-log names (after norm) -> the schedule's station names (after norm)
STATION_ALIASES = {
    "BLOOR": "BLOOR YONGE", "YONGE": "BLOOR YONGE", "YONGE BLOOR": "BLOOR YONGE",
    "SHEPPARD": "SHEPPARD YONGE", "YONGE SHEPPARD": "SHEPPARD YONGE",
    "VMC": "VAUGHAN METROPOLITAN CENTRE", "VAUGHAN MC": "VAUGHAN METROPOLITAN CENTRE",
    "NORTH YORK CTR": "NORTH YORK CENTRE", "NORTH YORK CENTER": "NORTH YORK CENTRE",
    "DOWNSVIEW": "SHEPPARD WEST", "EGLINTON W": "CEDARVALE", "EGLINTON WEST": "CEDARVALE",
    "DUNDAS": "TMU", "ST PATRICKS": "ST PATRICK", "QUEENS PARK": "QUEEN'S PARK",
    "DOWNSVIEW PARK": "DOWNSVIEW PARK",  # before DOWNSVIEW above is tried: an exact name wins
}


def cause(code) -> str:
    c = str(code).strip().upper()
    for group, keys in CAUSES:
        if c in keys or any(len(k) == 2 and c.startswith(k) for k in keys):
            return group
    return OTHER


# ---- the schedule ---------------------------------------------------------------------------
def read(z: zipfile.ZipFile, name: str, **kw) -> pd.DataFrame:
    return pd.read_csv(z.open(name), dtype={"service_id": str, "route_id": str, "trip_id": str, "stop_id": str,
                                            "route_short_name": str, "date": str, "start_date": str, "end_date": str}, **kw)


def services_on(cal: pd.DataFrame, dates: pd.DataFrame, day: pd.Timestamp) -> frozenset:
    dow = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.day_of_week]
    ymd = day.strftime("%Y%m%d")
    on = set(cal[(cal[dow] == 1) & (cal.start_date <= ymd) & (cal.end_date >= ymd)].service_id)
    ex = dates[dates.date == ymd]
    on |= set(ex[ex.exception_type == 1].service_id)
    on -= set(ex[ex.exception_type == 2].service_id)
    return frozenset(on)


def typical_days(cal: pd.DataFrame, dates: pd.DataFrame) -> dict:
    first = pd.Timestamp(min(cal.start_date.min(), dates.date.min() if len(dates) else "99999999"))
    last = pd.Timestamp(max(cal.end_date.max(), dates.date.max() if len(dates) else "0"))
    days = pd.date_range(first, last)
    out = {}
    for kind, dows, pick in (("weekday", {0, 1, 2, 3, 4}, 2), ("saturday", {5}, 5), ("sunday", {6}, 6)):
        cands = [d for d in days if d.day_of_week in dows]
        sets = {d: services_on(cal, dates, d) for d in cands}
        common_set = pd.Series(list(sets.values())).value_counts().index[0]
        usual = [d for d in cands if sets[d] == common_set]
        out[kind] = (next((d for d in usual if d.day_of_week == pick), usual[0]), common_set)
    return out


def secs(t: pd.Series) -> pd.Series:
    p = t.str.split(":", expand=True).astype(int)
    return p[0] * 3600 + p[1] * 60 + p[2]


def schedule() -> tuple[str, pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    if not GTFS.exists():
        sys.exit(f"{GTFS} is missing: python pipeline/download.py --toronto {GTFS.name}")
    z = zipfile.ZipFile(GTFS)
    cal, dates = read(z, "calendar.txt"), read(z, "calendar_dates.txt")
    routes, trips, stops = read(z, "routes.txt"), read(z, "trips.txt"), read(z, "stops.txt")
    st = read(z, "stop_times.txt", usecols=["trip_id", "stop_id", "departure_time", "pickup_type"])
    st = st[st.pickup_type.fillna(0) != 1]  # a stop where no one may board isn't a departure
    feed = pd.Timestamp(cal.start_date.min()).date().isoformat()
    unknown = set(routes.route_type) - set(MODES)
    if unknown:
        sys.exit(f"route types {unknown} in the feed: add them to MODES")
    trips = trips.merge(routes[["route_id", "route_type", "route_short_name"]], on="route_id")
    trips["mode"] = trips.route_type.map(MODES)
    days = typical_days(cal, dates)
    stops = place(stops, "stop_lon", "stop_lat")
    off = stops.nbhd_id.isna().sum()
    print(f"  feed of {feed}: {len(stops):,} stops ({off} outside the City), {len(trips):,} trips; days "
          + ", ".join(f"{k} {d.date()}" for k, (d, _) in days.items()))
    rows, frequent, rapid_deps = [], None, None
    for kind, (day, sids) in days.items():
        t = trips[trips.service_id.isin(sids)]
        s = st.merge(t[["trip_id", "mode", "route_short_name"]], on="trip_id").merge(stops[["stop_id", "nbhd_id"]], on="stop_id")
        g = s[s.nbhd_id.notna()].groupby(["nbhd_id", "mode"]).agg(stops=("stop_id", "nunique"), departures=("trip_id", "size")).reset_index()
        rows.append(g.assign(feed=feed, day=kind))
        if kind == "weekday":
            s["hour"] = secs(s.departure_time) // 3600
            per = s[s.hour.isin(FREQUENT_HOURS)].groupby(["stop_id", "hour"]).size().unstack(fill_value=0).reindex(columns=FREQUENT_HOURS, fill_value=0)
            frequent = set(per.index[(per >= FREQUENT_PER_HOUR).all(axis=1)])
            rapid_deps = s[s.route_short_name.isin(RAPID_ROUTES)].groupby("stop_id").size()
    service = pd.concat(rows, ignore_index=True)
    service["nbhd_id"] = service.nbhd_id.astype(int)
    # stations: platforms grouped by name ("Bloor-Yonge Station - Southbound Platform")
    rp = stops[stops.stop_id.isin(rapid_deps.index)].copy()
    rp["name"] = (rp.stop_name.str.replace(r"\s*-?\s*(\w+bound |LRT |Subway )?Platform.*$", "", regex=True)
                  .str.replace(r"\s+Station$", "", regex=True).str.strip())
    rp["name"] = rp.name.replace(STATION_NAMES)
    rp["deps"] = rp.stop_id.map(rapid_deps)
    lines = (st[st.stop_id.isin(rp.stop_id)].merge(trips[["trip_id", "route_short_name"]], on="trip_id")
             .merge(rp[["stop_id", "name"]], on="stop_id").groupby("name").route_short_name.agg(lambda v: "/".join(sorted(set(v)))))
    stations = rp.groupby("name").agg(lat=("stop_lat", "mean"), lon=("stop_lon", "mean"), departures=("deps", "sum")).reset_index()
    stations["lines"] = stations.name.map(lines)
    stations = place(stations, "lon", "lat")
    return feed, service, stops[stops.stop_id.isin(frequent)], stations, {k: d.date().isoformat() for k, (d, _) in days.items()}


def access(feed: str, frequent: pd.DataFrame, stations: pd.DataFrame) -> pd.DataFrame:
    das = da_polygons().merge(common()[["dauid", "pop21"]], on="dauid")
    pts = gpd.GeoDataFrame(das[["dauid", "nbhd_id", "pop21"]], geometry=das.geometry.centroid, crs=METRIC_CRS)

    def within(points: pd.DataFrame, lon: str, lat: str, metres: int) -> pd.Series:
        g = gpd.GeoDataFrame(geometry=gpd.points_from_xy(points[lon], points[lat]), crs=4326).to_crs(METRIC_CRS)
        near = gpd.sjoin_nearest(pts, g, max_distance=metres)
        return pts.index.isin(near.index)

    pts["frequent"] = within(frequent, "stop_lon", "stop_lat", FREQUENT_M)
    pts["rapid"] = within(stations, "lon", "lat", RAPID_M)
    a = pts.groupby("nbhd_id").apply(lambda g: pd.Series({"pop": g.pop21.sum(), "frequent": g.pop21[g.frequent].sum(),
                                                          "rapid": g.pop21[g.rapid].sum()}), include_groups=False).reset_index()
    a = a.astype({"nbhd_id": int, "pop": int, "frequent": int, "rapid": int})
    tot = a[["pop", "frequent", "rapid"]].sum()
    print(f"  residents within {FREQUENT_M} m of a stop every 10 minutes all day: {tot.frequent / tot['pop']:.1%}; "
          f"within {RAPID_M} m of a subway or LRT station: {tot.rapid / tot['pop']:.1%} ({len(frequent):,} frequent stops)")
    return a.assign(feed=feed)[["feed", "nbhd_id", "pop", "frequent", "rapid"]]


# ---- delays ------------------------------------------------------------------------------------
def norm(name: str) -> str:
    """A station's name in capitals without its line, the word station or what follows it."""
    s = str(name).upper()
    line4 = bool(re.search(r"\bSHP\b|SHEPPARD LINE", s))
    s = re.sub(r"[^A-Z' ]", " ", s.replace("-", " ").replace(".", ""))
    s = re.sub(r"^(APPROACHING|APPRAOCHING|LEAVING|ENTERING|DEPARTING)\s+", "", s)
    s = re.sub(r"\b(STAT\w*|STN|STA|PLATFORM|LOWER|UPPER|CENTRE TRACK|TRACK|HOSTLER|YARD|CARHOUSE)\b.*$", "", s)
    s = re.sub(r"\b(BD|YUS|YU|SHP|SRT|LINE \d)\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return "YONGE SHEPPARD" if line4 and s == "YONGE" else s


def delays(stations: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    parts = []
    for f in sorted(RAW.glob("toronto_subway_delays_*")):
        sheets = [pd.read_csv(f)] if f.suffix == ".csv" else list(pd.read_excel(f, sheet_name=None).values())
        for t in sheets:
            t = t.rename(columns=lambda c: str(c).strip())
            parts.append(t[["Date", "Station", "Code", "Min Delay"]])
    d = pd.concat(parts, ignore_index=True)
    d["Date"] = pd.to_datetime(d.Date, errors="coerce")
    d = d.dropna(subset=["Date"])
    from transport import whole_months
    d = d[whole_months(d.Date)]
    d["month"] = d.Date.dt.strftime("%Y-%m")
    d["mins"] = pd.to_numeric(d["Min Delay"], errors="coerce").fillna(0)
    d["cause"] = d.Code.map(cause)
    d["delay"] = d.mins > 0
    by_cause = d.groupby(["month", "cause"]).agg(incidents=("mins", "size"), delays=("delay", "sum"), minutes=("mins", "sum")).reset_index()
    by_cause[["delays", "minutes"]] = by_cause[["delays", "minutes"]].round().astype(int)

    known = {norm(n): n for n in stations.name}  # norm("Bloor-Yonge") is "BLOOR YONGE"
    known.update({norm(n).replace("'", ""): n for n in stations.name})

    def match(raw: str):
        if re.search(r"\bTO\b|\bAND\b|\bBETWEEN\b|\bLINE\b", str(raw).upper()):
            return None
        k = norm(raw)
        hit = known.get(k) or known.get(k.replace("'", ""))
        if hit is None:
            k = STATION_ALIASES.get(k, k)
            hit = known.get(k) or known.get(k.replace("'", ""))
        if hit is None and k.endswith(" ST"):  # "STATION" cut to "ST" ("APPROACHING KIPLING ST")
            hit = known.get(k[:-3])
        return hit

    names = pd.Series(d.Station.astype(str).unique())
    m = dict(zip(names, names.map(match)))
    d["station"] = d.Station.astype(str).map(m)
    at = d[d.station.notna() & d.delay]
    by_station = at.groupby(["month", "station", "cause"]).agg(delays=("mins", "size"), minutes=("mins", "sum")).reset_index()
    by_station["minutes"] = by_station.minutes.round().astype(int)
    held = d[d.delay]
    info = {"incidents": int(len(d)), "delays": int(d.delay.sum()),
            "delays_at_a_named_station": round(float(held.station.notna().mean()), 4),
            "minutes_at_a_named_station": round(float(held[held.station.notna()].mins.sum() / held.mins.sum()), 4),
            "cause_other_share": round(float((d.cause == OTHER).mean()), 4)}
    top = held[held.station.isna()].Station.value_counts().head(12)
    print(f"  subway delays: {info['delays']:,} held a train; {info['delays_at_a_named_station']:.1%} at a named station "
          f"({info['minutes_at_a_named_station']:.1%} of the minutes). Most common unmatched: "
          + "; ".join(f"{k} ({v})" for k, v in top.items()))
    return by_station, by_cause, info


def main() -> int:
    OUT.mkdir(exist_ok=True)
    feed, service, frequent, stations, days = schedule()
    acc = access(feed, frequent, stations)
    by_station, by_cause, info = delays(stations)

    def keep(name: str, new: pd.DataFrame) -> pd.DataFrame:  # the feeds already held, this one replaced
        f = OUT / name
        old = pd.read_csv(f, dtype={"feed": str}) if f.exists() else pd.DataFrame(columns=new.columns)
        return pd.concat([old[old.feed != feed], new], ignore_index=True).sort_values([c for c in ("feed", "day", "nbhd_id", "mode") if c in new])

    service = keep("service.csv", service[["feed", "day", "nbhd_id", "mode", "stops", "departures"]])
    acc = keep("access.csv", acc)
    service.to_csv(OUT / "service.csv", index=False, lineterminator="\n")
    acc.to_csv(OUT / "access.csv", index=False, lineterminator="\n")
    stations[["name", "lat", "lon", "lines", "nbhd_id", "departures"]].round({"lat": 6, "lon": 6}).to_csv(OUT / "stops.csv", index=False, lineterminator="\n")
    by_station.to_csv(OUT / "station_delays.csv", index=False, lineterminator="\n")
    by_cause.to_csv(OUT / "cause_month.csv", index=False, lineterminator="\n")
    mf = OUT / "manifest.json"
    before = json.loads(mf.read_text()) if mf.exists() else {}
    feeds = {**before.get("feeds", {}), feed: {"days": days, "file_bytes": GTFS.stat().st_size}}
    mf.write_text(json.dumps({"built": pd.Timestamp.today().date().isoformat(), "feeds": dict(sorted(feeds.items())),
                              "frequent": f"{FREQUENT_PER_HOUR} departures in every hour from {FREQUENT_HOURS[0]}:00 to {FREQUENT_HOURS[-1] + 1}:00 at one stop, weekday",
                              "delays": info}, indent=2) + "\n")
    print(f"Wrote {OUT}: {len(feeds)} schedule period(s), {len(stations)} subway and LRT stations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
