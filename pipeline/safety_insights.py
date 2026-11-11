"""The Safety Insights page's figures: web/public/safety.json.

    python pipeline/safety_insights.py

Reads what crime.py writes (pipeline/crime/by_nbhd.csv and manifest.json), the
neighbourhoods and 2021 figures in insights.json and web/public/data/figures, and
the neighbourhood figures of the other layers the page sets beside crime, and
writes:

  built, retrieved    this file's date and the crime files' retrieval date
  last                the last complete year in every crime file (2025)
  categories          the categories on the page, in menu order: key (crime.py's),
                      label, short, group, first (the first year compared: 2015
                      for shootings_all, whose firearm discharges were
                      under-recorded before), unit (what one count is) and a note
  counts              by category and year (first to last), each neighbourhood's
                      count in insights.json's order. crime.py writes non-zero
                      rows only, so a missing neighbourhood-year is 0
  pop, hh             2021 Census population and private households by
                      neighbourhood (the figures file's DAs, as permits.py sums
                      them): rates are per 100,000 residents of 2021
  other               the other neighbourhood measures the page correlates crime
                      with: key, label, short, unit, source and values (null where
                      a neighbourhood has none):
                        school   Grade 3 and 6 score of its schools (schools.json,
                                 schools inside it), mean of 2023 to 2025
                        price    median sale price of its TRREB community
                                 (prices.json), mean of 2025's four quarters
                        canopy   tree canopy share of its area, 2018 (trees.py)
                        heat     summer surface temperature against the city's,
                                 Landsat 2022-2025 (trees.py's lst_anom, degrees C)
                        turnout22, turnout23   mayoral turnout, 2022 election and
                                 2023 by-election (elections.py)
                        str      short-term rental listings (minimum stay under
                                 28 nights) per 1,000 households, Inside Airbnb's
                                 latest scrape (rentals.py)

Counts are the police's own neighbourhood assignment; records without one (NSA)
are left out, so the city figures are the sums of the 158 (crime.py's manifest
lists the records left out). Rates per resident overstate places people visit
more than live in (downtown, the entertainment district, Yorkdale): the page
says so where it shows them.
"""
import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
CRIME = HERE / "crime"
INSIGHTS = WEB / "insights.json"
COMMON = WEB / "data" / "figures" / "2021" / "common.json"
OUT = WEB / "safety.json"

# key, label, short, group, unit, note
CATEGORIES = [
    ("assault", "Assaults", "Assaults", "Crimes reported", "offences or victims reported", ""),
    ("break_and_enter", "Break and enters", "Break and enters", "Crimes reported", "offences reported", ""),
    ("auto_theft", "Auto thefts", "Auto thefts", "Crimes reported", "vehicles reported stolen", ""),
    ("robbery", "Robberies", "Robberies", "Crimes reported", "offences or victims reported", ""),
    ("theft_over", "Thefts over $5,000", "Thefts over $5,000", "Crimes reported", "offences reported", ""),
    ("shootings", "Shootings in which someone was hit", "Shootings, someone hit", "Gun violence and homicide",
     "events", ""),
    ("shootings_all", "Shootings and firearm discharges", "Shootings and discharges", "Gun violence and homicide",
     "events", "Firearm discharges were under-recorded before 2015, so this series starts in 2015."),
    ("homicides", "Homicide victims", "Homicides", "Gun violence and homicide", "victims", ""),
    ("ksi_persons", "People killed or seriously injured in collisions", "Killed or seriously injured, roads",
     "Road safety", "people", ""),
    ("ksi_persons_pedestrian", "Pedestrians killed or seriously injured", "Pedestrians KSI", "Road safety", "people", ""),
    ("ksi_persons_cyclist", "Cyclists killed or seriously injured", "Cyclists KSI", "Road safety", "people", ""),
    ("ksi_killed", "People killed in collisions", "Killed, roads", "Road safety", "people", ""),
]
FIRST = {"shootings_all": 2015}
KSI_NOTE = ("Collision records reach the City months to over a year late, so the latest year is low; "
            "the City's roads only, not the 400-series highways.")


def r1(v):
    return None if v is None or pd.isna(v) else round(float(v), 1)


def other_measures(insights: dict, ids: list[int]) -> list[dict]:
    out = []
    idx = pd.Index(ids)

    def add(key, label, short, unit, source, s: pd.Series):
        out.append({"key": key, "label": label, "short": short, "unit": unit, "source": source,
                    "values": [r1(v) for v in s.reindex(idx)]})

    s = json.loads((WEB / "schools.json").read_text())
    sc = pd.DataFrame({y: s["by_nbhd"]["inside"]["score"][str(y)] for y in (2023, 2024, 2025)}, index=ids)
    add("school", "School score (Grade 3 and 6, 2023 to 2025)", "School score", "score",
        "EQAO through schools.json: the schools inside the neighbourhood", sc.mean(axis=1))

    p = json.loads((WEB / "prices.json").read_text())
    qs = [k for k, q in enumerate(p["quarters"]) if q.startswith("2025 ")]
    if len(qs) != 4:
        sys.exit(f"prices.json has {len(qs)} quarters of 2025")
    comm = [pd.Series([c["med"][k] for k in qs], dtype=float).mean() for c in p["communities"]]
    add("price", "Median sale price, 2025 (TRREB community)", "Sale price", "money",
        "TRREB community reports through prices.json", pd.Series([comm[n["c"]] for n in p["nbhd"]],
                                                                   index=[n["id"] for n in p["nbhd"]]))

    t = pd.read_csv(HERE / "trees" / "by_nbhd.csv").set_index("nbhd_id")
    add("canopy", "Tree canopy share of area, 2018", "Tree canopy", "pct", "City 2018 Tree Canopy Study (trees.py)",
        t.canopy_share * 100)
    add("heat", "Summer surface temperature vs the city, 2022-2025", "Surface heat", "degC",
        "Landsat 8/9 (trees.py)", t.lst_anom)

    e = pd.read_csv(HERE / "elections" / "by_nbhd.csv")
    for year, key in (("2022", "turnout22"), ("2023", "turnout23")):
        sub = e[e.election.astype(str).str.startswith(year)].set_index("nbhd_id")
        if len(sub) != len(ids):
            sys.exit(f"elections by_nbhd.csv: {len(sub)} rows for {year}")
        add(key, f"Mayoral turnout, {year}{' by-election' if year == '2023' else ''}", f"Turnout {year}", "pct",
            "City of Toronto election results (elections.py)", sub.turnout * (100 if sub.turnout.max() <= 1 else 1))

    rn = pd.read_csv(HERE / "rentals" / "by_nbhd.csv")
    latest = rn.snapshot.max()
    add("str", f"Short-term rental listings per 1,000 households ({latest})", "Short-term rentals", "rate",
        "Inside Airbnb (rentals.py)", rn[rn.snapshot == latest].set_index("nbhd_id").short_term_per_1000hh)
    return out


def main() -> int:
    for f in (CRIME / "by_nbhd.csv", CRIME / "manifest.json", INSIGHTS, COMMON):
        if not f.exists():
            sys.exit(f"{f} is missing (make crime)")
    manifest = json.loads((CRIME / "manifest.json").read_text())
    insights = json.loads(INSIGHTS.read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    c = json.loads(COMMON.read_text())
    common = pd.DataFrame({k: c[k] for k in ("nbhd_id", "pop21", "hh")})
    pop = common.groupby("nbhd_id").pop21.sum().reindex(ids)
    hh = common.groupby("nbhd_id").hh.sum().reindex(ids)
    if pop.isna().any():
        sys.exit("a neighbourhood has no 2021 population")

    d = pd.read_csv(CRIME / "by_nbhd.csv")
    last = min(manifest["categories"][k]["years_complete"][1] for k, *_ in CATEGORIES)
    cats, counts = [], {}
    for key, label, short, group, unit, note in CATEGORIES:
        a, b = manifest["categories"][key]["years_complete"]
        first = max(a, FIRST.get(key, a))
        sub = d[(d.category == key) & d.year.between(first, last)]
        bad = set(sub.nbhd_id) - set(ids)
        if bad:
            sys.exit(f"{key}: neighbourhoods not in insights.json: {sorted(bad)[:5]}")
        t = sub.pivot_table(index="nbhd_id", columns="year", values="count", aggfunc="sum").reindex(
            index=ids, columns=range(first, last + 1)).fillna(0).astype(int)
        counts[key] = {str(y): t[y].tolist() for y in t.columns}
        if key.startswith("ksi"):
            note = (note + " " + KSI_NOTE).strip()
        cats.append({"key": key, "label": label, "short": short, "group": group, "first": first, "unit": unit,
                     "basis": manifest["categories"][key]["basis"], "note": note})
        print(f"{key}: {first}-{last}, {int(t.to_numpy().sum()):,} in the 158")

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "retrieved": max(f["retrieved"] for f in manifest["files"].values()),
        "last": last,
        "categories": cats,
        "counts": counts,
        "pop": pop.astype(int).tolist(),
        "hh": hh.astype(int).tolist(),
        "other": other_measures(insights, ids),
    }
    for o in out["other"]:
        n = sum(v is not None for v in o["values"])
        print(f"other {o['key']}: {n} of {len(ids)} neighbourhoods")
        if n < 100:
            sys.exit(f"{o['key']} has values for only {n} neighbourhoods")
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
