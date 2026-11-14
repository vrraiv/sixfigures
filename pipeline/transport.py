"""Getting around, month by month: ride-hail trips, subway delays and bicycle counts.

    python pipeline/transport.py          # make transport

Reads the City's files in pipeline/raw/ (download.py's TORONTO names) and writes
pipeline/transport/, which is committed, so the page's figures rebuild on any checkout:

  ridehail_month.csv   month, days, trips, pooled, fare (average, weighted by the day's
                       trips), wait (minutes, likewise), km (average trip distance),
                       vehicles (active in a day, averaged over the month's days). From the
                       City's daily summary of Uber's and Lyft's trips that start or end in
                       Toronto (2018 on; fares, waits and vehicles from 2020).
  subway_month.csv     month, line, incidents, delays, minutes. Every incident the TTC logs
                       on the subway; a delay is one that held a train (Min Delay above 0),
                       and minutes are those delays' minutes. Lines: YU (1), BD (2), SRT (3,
                       closed July 2023), SHP (4); an incident logged against two lines, or
                       none, is "other".
  counters_month.csv   month, sites, daily: bicycles a day past the City's permanent
                       counters, both directions added, averaged over the month's days and
                       summed over one fixed set of sites, or a new counter would read as
                       more cycling. The set is the sites that counted, in every direction
                       they have, on at least MIN_DAYS days of every month from PANEL_FROM
                       (the counters of before 2019 were replaced in 2022 and 2023) to the
                       latest month that at least MIN_SITES of them reach: counters drop
                       out for months at a time, and the last weeks of the file are often
                       incomplete, so the series can end a month or two before the file.
  counter_sites.csv    the sites in that set, with where they are
  manifest.json        the files read and the months covered

Only whole months are kept: a file's last month is dropped unless it runs to the month's
last day.
"""
import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "transport"
PANEL_FROM = "2023-04"  # the first month the Bloor, Sherbourne and Yonge counters all cover
MIN_DAYS = 20
MIN_SITES = 4
LINES = {"YU": "YU", "YUS": "YU", "BD": "BD", "SHP": "SHP", "SRT": "SRT"}


def need(name: str) -> Path:
    f = RAW / name
    if not f.exists():
        sys.exit(f"{f} is missing: python pipeline/download.py --toronto {name}")
    return f


def whole_months(days: pd.Series) -> pd.Series:
    """True for the rows whose month is covered to its last day by `days` (datetimes)."""
    last = days.max()
    end = last + pd.offsets.MonthEnd(0)
    return days < (last.to_period("M").to_timestamp() if last.normalize() < end.normalize() else end + pd.Timedelta(days=1))


def ridehail() -> pd.DataFrame:
    d = pd.read_csv(need("toronto_ptc_summary.csv"), parse_dates=["dt"])
    d = d[whole_months(d.dt)]
    d["month"] = d.dt.dt.strftime("%Y-%m")
    t = d.reported_trips_started

    def wavg(col):  # a month's average: the days' averages weighted by their trips
        has = d[col].notna()
        return (d[col] * t).where(has).groupby(d.month).sum(min_count=1) / t.where(has).groupby(d.month).sum(min_count=1)

    g = d.groupby("month")
    out = pd.DataFrame({
        "days": g.size(), "trips": g.reported_trips_started.sum().astype(int),
        "pooled": g.trips_started_pooled.sum(min_count=1),
        "fare": wavg("fare_avg").round(2), "wait": wavg("waittime_nonwav_avg").round(2),
        "km": wavg("dist_avg").round(2), "vehicles": g.active_vehicles.mean().round(0),
    }).reset_index()
    short = out[out.days < pd.to_datetime(out.month).dt.days_in_month]
    if len(short):
        print(f"  ride-hail: days missing in {', '.join(short.month)}; the page shows trips a day, which holds")
    return out


def subway() -> pd.DataFrame:
    parts = []
    for f in sorted(RAW.glob("toronto_subway_delays_*")):
        sheets = [pd.read_csv(f)] if f.suffix == ".csv" else list(pd.read_excel(f, sheet_name=None).values())
        for t in sheets:
            t = t.rename(columns=lambda c: str(c).strip())
            if not {"Date", "Min Delay", "Line"} <= set(t.columns):
                sys.exit(f"{f.name}: a sheet without Date, Min Delay and Line ({list(t.columns)})")
            parts.append(t[["Date", "Min Delay", "Line"]])
    if not parts:
        sys.exit("no toronto_subway_delays_* file in pipeline/raw")
    d = pd.concat(parts, ignore_index=True)
    d["Date"] = pd.to_datetime(d.Date, errors="coerce")
    bad = d.Date.isna().sum()
    if bad > len(d) * 0.001:
        sys.exit(f"{bad:,} subway incidents without a date")
    d = d.dropna(subset=["Date"])
    d = d[whole_months(d.Date)]
    d["month"] = d.Date.dt.strftime("%Y-%m")
    d["line"] = d.Line.astype(str).str.upper().str.replace(" ", "").map(LINES).fillna("other")
    d["mins"] = pd.to_numeric(d["Min Delay"], errors="coerce").fillna(0)
    d["delay"] = d.mins > 0
    g = d.groupby(["month", "line"])
    out = pd.DataFrame({"incidents": g.size(), "delays": g.delay.sum().astype(int), "minutes": g.mins.sum().round().astype(int)}).reset_index()
    months = pd.period_range(out.month.min(), out.month.max(), freq="M").strftime("%Y-%m")
    gaps = sorted(set(months) - set(out.month))
    if gaps:
        sys.exit(f"subway delays: no incident in {', '.join(gaps)}; a year's file is missing")
    other = out[out.line == "other"].incidents.sum() / out.incidents.sum()
    print(f"  subway: {len(d):,} incidents, {int(d.delay.sum()):,} delays, {out.month.min()} to {out.month.max()}; {other:.1%} on no single line")
    return out


def counters() -> tuple[pd.DataFrame, pd.DataFrame]:
    d = pd.read_csv(need("toronto_bicycle_counters_daily.csv"), parse_dates=["dt"])
    loc = pd.read_csv(need("toronto_bicycle_counters_locations.csv"))
    d = d[whole_months(d.dt) & (d.dt >= PANEL_FROM)]
    d["month"] = d.dt.dt.strftime("%Y-%m")
    day = d.groupby(["location_name", "month", "dt"]).agg(v=("daily_volume", "sum"), dirs=("direction", "nunique")).reset_index()
    day = day[day.dirs == day.groupby("location_name").dirs.transform("max")]  # a day with one direction down isn't a count
    m = day.groupby(["location_name", "month"]).v.agg(["mean", "size"])
    months = sorted(d.month.unique())
    ok = m[m["size"] >= MIN_DAYS]["mean"].unstack().reindex(columns=months)
    reach = ok.notna().cumprod(axis=1).sum(axis=1)  # the months a site covers without a break from PANEL_FROM
    n = next((k for k in range(len(months), 0, -1) if (reach >= k).sum() >= MIN_SITES), 0)
    if n < 12:
        sys.exit(f"fewer than {MIN_SITES} counter sites cover a year of months from {PANEL_FROM}")
    months = months[:n]
    panel = ok[reach >= n][months]
    out = pd.DataFrame({"month": months, "sites": len(panel), "daily": panel.sum().round().astype(int).values})
    sites = (loc[loc.location_name.isin(panel.index)].groupby("location_name")
             .agg(longitude=("longitude", "first"), latitude=("latitude", "first"), since=("first_active", "min")).reset_index())
    print(f"  counters: {len(panel)} of {ok.shape[0]} sites cover every month, {months[0]} to {months[-1]}: {', '.join(panel.index)}")
    return out, sites


def main() -> int:
    OUT.mkdir(exist_ok=True)
    r, s = ridehail(), subway()
    c, sites = counters()
    for name, t in (("ridehail_month", r), ("subway_month", s), ("counters_month", c), ("counter_sites", sites)):
        t.to_csv(OUT / f"{name}.csv", index=False, lineterminator="\n")
    files = sorted([*RAW.glob("toronto_subway_delays_*"), need("toronto_ptc_summary.csv"),
                    need("toronto_bicycle_counters_daily.csv"), need("toronto_bicycle_counters_locations.csv")])
    manifest = {
        "built": pd.Timestamp.today().date().isoformat(),
        "ridehail": [r.month.iloc[0], r.month.iloc[-1]], "subway": [s.month.min(), s.month.max()],
        "counters": [c.month.iloc[0], c.month.iloc[-1]], "counter_sites": len(sites),
        "files": {f.name: f.stat().st_size for f in files},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {OUT}: ride-hail {r.month.iloc[0]} to {r.month.iloc[-1]} ({r.trips.iloc[-1]:,} trips in the last month)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
