"""The Getting Around page's figures: web/public/transport.json.

    python pipeline/transport_insights.py          # make transport-page

Reads what bikeshare.py and transport.py keep in pipeline/bikeshare/ and
pipeline/transport/ (both committed, so this runs on any checkout), the neighbourhoods in
insights.json and the 2021 population in the figures files, and writes, month by month:

  bike        Bike Share Toronto: months, and for each its trips, the members' and casual
              riders' trips (null where the labels can't be used, below), round trips, e-bike trips (and the trips whose bike
              model is known: `modelled`), the median trip in minutes, the stations with a
              trip, and the share of trips that started at a station with a location
  profile     trips a day by the hour they started, weekdays and weekends, members and
              casual riders, for each year
  ridehail    Uber and Lyft: months, days, trips, pooled trips, average fare, wait and
              distance, and vehicles active in a day (the last four from 2020)
  subway      delays by line and month: incidents logged, delays (a train held) and
              their minutes
  counters    bicycles a day past a fixed set of the City's counters, and the sites
  nbhd, map   the 158 neighbourhoods in insights.json's order, with SVG outlines
  pop         2021 Census population by neighbourhood
  nb          by neighbourhood: `starts` and `ends`, one row of 158 for each of `months`
              (FROM on); `stations` and `docks` in Bike Share's station list today
  stations    every station with a location and a trip in the last twelve months: name,
              neighbourhood (index), x and y on the map, docks, and its trips started and
              ended in those months
  ttc         from ttc.py (pipeline/ttc/): `feeds`, the schedule periods held (their first
              dates); for each, by neighbourhood, the weekday departures by mode, all
              departures on a Saturday and a Sunday, the stops with a weekday departure,
              and the residents within reach of frequent service and of a subway or LRT
              station (`frequent`, `rapid`); the city's departures by mode and day for each
              period; the subway delays' minutes and delays by cause group and year
              (`causes`, `cause_years`, the last year marked partial when it is); and the
              subway and LRT stations with x and y, lines, weekday departures, and their
              delays and minutes in the twelve months to the delay file's last month, with
              those minutes by cause

Members and casual riders. The files label each trip "Annual Member" or "Casual Member",
and from October 2021 the casual share climbs out of season (64% in October and November
2021 against 37% that September) until every trip of August to December 2023 is "Casual
Member": plans sold after the annual one were filed as casual. The 2024 files, in a new
layout, have 7% casual trips in January. So the split is given as published to September
2021 and from 2024, and is null between (SPLIT_UNKNOWN): the page shows those months'
trips whole. The by-hour profile of 2021 to 2023 is given for all riders together.

A neighbourhood's trips are those of the stations inside it. A station that was removed
before its location was recorded here has none (bikeshare.py), so its trips are in the
city's figures and in no neighbourhood's: `located` gives the share by year.
"""
import json
import sys
from pathlib import Path

import pandas as pd
from pyproj import Transformer

from school_insights import paths

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
COMMON = WEB / "data" / "figures" / "2021" / "common.json"
BIKE = HERE / "bikeshare"
CITY = HERE / "transport"
TTC = HERE / "ttc"
OUT = WEB / "transport.json"
FROM = "2019-01"  # neighbourhood figures start here: the network of 2017 and 2018 was a third of today's
LINES = ["YU", "BD", "SHP", "SRT", "other"]
SPLIT_UNKNOWN = ("2021-10", "2023-12")  # the months whose member and casual labels can't be used


def ints(s) -> list:
    return [None if pd.isna(v) else int(v) for v in s]


def nums(s, places: int = 2) -> list:
    return [None if pd.isna(v) else round(float(v), places) for v in s]


TTC_MODES = ["subway", "streetcar", "bus"]


def ttc_block(ids: list, index: dict, on_map) -> dict:
    sv = pd.read_csv(TTC / "service.csv", dtype={"feed": str})
    ac = pd.read_csv(TTC / "access.csv", dtype={"feed": str})
    feeds = sorted(sv.feed.unique())
    n = len(ids)

    def row(t: pd.DataFrame, col: str) -> list:
        return ints(t.groupby("nbhd_id")[col].sum().reindex(ids).fillna(0))

    nb = []
    for f in feeds:
        s = sv[sv.feed == f]
        wd = s[s.day == "weekday"]
        a = ac[ac.feed == f].set_index("nbhd_id").reindex(ids)
        nb.append({
            "weekday": {m: row(wd[wd["mode"] == m], "departures") for m in TTC_MODES},
            "saturday": row(s[s.day == "saturday"], "departures"), "sunday": row(s[s.day == "sunday"], "departures"),
            # stops are counted per mode; a stop served by two modes is rare (a few streetcar and bus stops)
            "stops": ints(wd.groupby("nbhd_id").stops.max().reindex(ids).fillna(0)),
            "frequent": nums(a.frequent / a["pop"] * 100, 1), "rapid": nums(a.rapid / a["pop"] * 100, 1),
        })
    city = [{d: {m: int(sv[(sv.feed == f) & (sv.day == d) & (sv["mode"] == m)].departures.sum()) for m in TTC_MODES}
             for d in ("weekday", "saturday", "sunday")} for f in feeds]
    reach = [{"frequent": round(float(ac[ac.feed == f].frequent.sum() / ac[ac.feed == f]["pop"].sum() * 100), 1),
              "rapid": round(float(ac[ac.feed == f].rapid.sum() / ac[ac.feed == f]["pop"].sum() * 100), 1)} for f in feeds]

    cm = pd.read_csv(TTC / "cause_month.csv")
    last = cm.month.max()
    cm["year"] = cm.month.str[:4]
    causes = cm.groupby("cause").minutes.sum().sort_values(ascending=False).index.tolist()
    causes = [c for c in causes if c != "Other"] + ["Other"]
    yrs = sorted(cm.year.unique())
    by_year = cm.groupby(["year", "cause"])[["minutes", "delays"]].sum()

    sd = pd.read_csv(TTC / "station_delays.csv")
    months12 = sorted(sd.month.unique())
    months12 = [m for m in months12 if m <= last][-12:]
    recent = sd[sd.month.isin(months12)]
    per = recent.groupby("station")[["delays", "minutes"]].sum()
    mix = recent.pivot_table(index="station", columns="cause", values="minutes", aggfunc="sum").reindex(columns=causes).fillna(0)
    stops = on_map(pd.read_csv(TTC / "stops.csv"))
    stops = stops[stops.nbhd_id.notna()]
    stations = [{"name": r.name, "nb": index[int(r.nbhd_id)], "x": r.x, "y": r.y, "lines": str(r.lines), "departures": int(r.departures),
                 "delays": int(per.delays.get(r.name, 0)), "minutes": int(per.minutes.get(r.name, 0)),
                 "by": ints(mix.loc[r.name]) if r.name in mix.index else None}
                for r in stops.itertuples(index=False)]
    if not len(stations) or sum(s["minutes"] for s in stations) == 0:
        sys.exit("no subway delays matched to a station in the last twelve months")
    held = json.loads((TTC / "manifest.json").read_text())["feeds"]
    return {
        "feeds": feeds, "days": [held[f]["days"] for f in feeds], "nb": nb, "city": city, "reach": reach,
        "causes": causes, "cause_years": yrs, "cause_partial": not last.endswith("-12"), "cause_last": last,
        "cause_minutes": [ints(by_year.minutes.unstack().reindex(index=yrs, columns=causes).fillna(0)[c]) for c in causes],
        "cause_delays": [ints(by_year.delays.unstack().reindex(index=yrs, columns=causes).fillna(0)[c]) for c in causes],
        "stations": stations, "stations_period": [months12[0], months12[-1]],
    }


def main() -> int:
    need = [BIKE / f for f in ("city_month.csv", "station_month.csv", "profile.csv", "stations.csv")]
    need += [CITY / f for f in ("ridehail_month.csv", "subway_month.csv", "counters_month.csv", "counter_sites.csv")]
    need += [TTC / f for f in ("service.csv", "access.csv", "stops.csv", "station_delays.csv", "cause_month.csv")]
    for f in [*need, INSIGHTS, COMMON]:
        if not f.exists():
            sys.exit(f"{f} is missing (make bikeshare, make transport; insights.json is committed)")
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    index = {i: k for k, i in enumerate(ids)}
    shapes, proj = paths(ids)
    c = json.loads(COMMON.read_text())
    pop = pd.DataFrame({"nbhd_id": c["nbhd_id"], "pop": c["pop21"]}).groupby("nbhd_id")["pop"].sum().reindex(ids)
    if pop.isna().any():
        sys.exit("a neighbourhood has no 2021 population")

    city = pd.read_csv(BIKE / "city_month.csv")
    sm = pd.read_csv(BIKE / "station_month.csv")
    st = pd.read_csv(BIKE / "stations.csv")
    prof = pd.read_csv(BIKE / "profile.csv")
    months = list(city.month)
    sm = sm.merge(st[["station", "nbhd_id", "lat"]], on="station", how="left")
    active = sm[sm.starts > 0].groupby("month").station.nunique().reindex(months)
    located = (sm[sm.nbhd_id.notna()].groupby("month").starts.sum() / sm.groupby("month").starts.sum()).reindex(months)
    numbered = (sm.groupby("month").starts.sum() / city.set_index("month").trips).reindex(months)

    nb_months = [m for m in months if m >= FROM]
    inside = sm[sm.nbhd_id.notna() & (sm.month >= FROM)].assign(k=lambda t: t.nbhd_id.astype(int).map(index))
    if inside.k.isna().any():
        sys.exit("a station is in a neighbourhood insights.json doesn't have")

    def by_nbhd(col: str) -> list:
        t = inside.pivot_table(index="month", columns="k", values=col, aggfunc="sum").reindex(index=nb_months, columns=range(len(ids))).fillna(0)
        return [ints(row) for row in t.values]

    now = st[st.listed == st.listed.max()]
    now = now[now.nbhd_id.notna()].assign(k=lambda t: t.nbhd_id.astype(int).map(index))
    year = months[-12:]
    recent = sm[sm.month.isin(year)].groupby("station")[["starts", "ends"]].sum()
    dots = st[st.lat.notna() & st.nbhd_id.notna() & st.station.isin(recent.index)].join(recent, on="station")
    to_map = Transformer.from_crs(4326, proj["crs"], always_xy=True)

    def on_map(t: pd.DataFrame) -> pd.DataFrame:
        x, y = to_map.transform(t.lon.values, t.lat.values)
        return t.assign(x=((x - proj["x0"]) * proj["k"]).round(1), y=((proj["y1"] - y) * proj["k"]).round(1))

    dots = on_map(dots)
    ttc = ttc_block(ids, index, on_map)

    ride = pd.read_csv(CITY / "ridehail_month.csv")
    sub = pd.read_csv(CITY / "subway_month.csv")
    sub_months = sorted(sub.month.unique())
    cnt = pd.read_csv(CITY / "counters_month.csv")
    sites = pd.read_csv(CITY / "counter_sites.csv")

    def line(code: str) -> dict:
        t = sub[sub.line == code].set_index("month")[["incidents", "delays", "minutes"]].reindex(sub_months).fillna(0)
        return {k: ints(t[k]) for k in ("incidents", "delays", "minutes")}

    years = sorted(int(v) for v in prof.year.unique())

    unknown = city.month.between(*SPLIT_UNKNOWN)
    mixed = {int(y) for y in city[unknown].month.str[:4]}  # years with a month whose split is unknown

    def hours(y: int, weekend: int) -> dict:
        t = prof[(prof.year == y) & (prof.weekend == weekend)].set_index("hour").reindex(range(24)).fillna(0)
        days = t.days.max() or 1
        if y in mixed:
            return {"all": nums((t.member + t.casual) / days, 1)}
        return {"member": nums(t.member / days, 1), "casual": nums(t.casual / days, 1)}

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "bike": {
            "months": months, "trips": ints(city.trips), "member": ints(city.member.where(~unknown)), "casual": ints(city.casual.where(~unknown)),
            "split_unknown": list(SPLIT_UNKNOWN),
            "round": ints(city["round"]), "ebike": ints(city.ebike), "modelled": ints(city.modelled), "minutes": ints(city.minutes),
            "stations": ints(active), "located": nums(located * numbered, 4),
        },
        "profile": {"years": years, "weekday": [hours(y, 0) for y in years], "weekend": [hours(y, 1) for y in years]},
        "ridehail": {"months": list(ride.month), "days": ints(ride.days), "trips": ints(ride.trips), "pooled": ints(ride.pooled),
                     "fare": nums(ride.fare), "wait": nums(ride.wait), "km": nums(ride.km), "vehicles": ints(ride.vehicles)},
        "subway": {"months": sub_months, "lines": {code: line(code) for code in LINES}},
        "counters": {"months": list(cnt.month), "daily": ints(cnt.daily), "sites": list(sites.location_name)},
        "nbhd": [{"id": i, "name": n["name"], "path": p} for i, n, p in zip(ids, insights["nbhd"], shapes)],
        "map": {"width": proj["width"], "height": proj["height"]},
        "pop": ints(pop),
        "nb": {
            "months": nb_months, "starts": by_nbhd("starts"), "ends": by_nbhd("ends"),
            "stations": ints(now.groupby("k").size().reindex(range(len(ids))).fillna(0)),
            "docks": ints(now.groupby("k").capacity.sum().reindex(range(len(ids))).fillna(0)),
            "listed": st.listed.max(),
        },
        "stations": [{"name": r.name, "nb": index[int(r.nbhd_id)], "x": r.x, "y": r.y,
                      "docks": None if pd.isna(r.capacity) else int(r.capacity), "starts": int(r.starts), "ends": int(r.ends)}
                     for r in dots.itertuples(index=False)],
        "stations_period": [year[0], year[-1]],
        "ttc": ttc,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    b = out["bike"]
    print(f"Wrote {OUT}: Bike Share {months[0]} to {months[-1]} ({b['trips'][-1]:,} trips in the last month, {b['stations'][-1]} stations); "
          f"neighbourhoods from {nb_months[0]}, {sum(1 for v in out['nb']['stations'] if v)} with a station; "
          f"ride-hail to {ride.month.iloc[-1]}, subway to {sub_months[-1]}, counters to {cnt.month.iloc[-1]}; "
          f"TTC schedule periods {', '.join(ttc['feeds'])}; {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
