"""The Data Explorer's catalogue and data: web/public/explorer/.

    python pipeline/explorer_data.py

Gathers every neighbourhood measure the site has into one shape, so the Explorer
page can set any of them beside any other. No downloads: it reads the committed
outputs of the other scripts (insights.json, safety.json, schools.json,
prices.json, housing.json, trees.json, pipeline/elections and pipeline/rentals).

  catalogue.json   the neighbourhoods (id, name, SVG outline) and map box as in
                   insights.json, so the page needs no other file to draw them;
                   sources (key, label, note) and measures in menu order: id
                   ("source.key"), source, group, label, short, unit, periods
                   (labels), t (each period's time as a decimal year, for lining
                   up measures of different sources), kind (how the periods are
                   dated: census, year, election, scrape, or snapshot for a single
                   figure) and a note on how to read it
  <source>.json    {key: [period][neighbourhood]} in insights.json's neighbourhood
                   order, null where there is no figure; loaded when one of the
                   source's measures is first used

Units: money (dollars), pct (percent), rate (per 100,000 or per 1,000, said in
the label), score, degC (a difference in Celsius), temp (Celsius), index, cm,
count.

How each source is shaped for comparison:
  census     the 27 measures in 2006, 2011, 2016 and 2021 (insights.json). Dollars
             are restated in the latest year's (income in 2020 dollars by the
             income years' CPI; values, rents and owner costs in 2021 dollars by
             the census years'), so a trend is real change
  safety     per 100,000 residents of 2021 a year (safety.json). The five reported
             crimes by single year; shootings, homicides and road injuries as the
             average of the three years ending in the year named, since single
             years of a few events are noise
  schools    the Grade 3 and 6 score and six results of the schools inside the
             neighbourhood, by test year (schools.json)
  prices     the median sale price of the neighbourhood's TRREB community: the
             mean of the year's four quarterly medians, for years with four
             quarters (prices.json). Several neighbourhoods share a community
  housing    units on building permits (created, net) and in development
             applications per 1,000 households a year, averaged over the three
             years ending in the year named (permits are lumpy); CMHC's average
             rent and vacancy by year (its zones' figures); registered apartment
             units per 1,000 households and their social-housing share (today)
  trees      canopy, street trees, large trees, species diversity, Norway maple
             and surface heat against the city's (trees.json): single figures.
             The page's points short of 40% canopy and absolute temperature
             restate canopy and heat, so they are left out
  elections  mayoral turnout (2022 and the 2023 by-election) and the leading
             candidates' shares of the vote (pipeline/elections/by_nbhd.csv)
  rentals    Inside Airbnb listings per 1,000 households by scrape: all,
             short-term (minimum stay under 28 nights) and active
             (pipeline/rentals/by_nbhd.csv)
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
OUT = WEB / "explorer"
CATALOGUE_JS = HERE.parent / "web" / "src" / "catalogue.js"
RARE_YEARS = 3  # years averaged for rare events and lumpy flows

SOURCES = [
    ("census", "Census", "2006, 2011, 2016 and 2021 Censuses"),
    ("safety", "Safety", "Toronto Police Service and the City's collision records, per 100,000 residents of 2021"),
    ("schools", "Schools", "EQAO Grade 3 and 6 results of the schools inside the neighbourhood"),
    ("prices", "Sale prices", "TRREB community reports; several neighbourhoods share a community"),
    ("housing", "Housing", "City permits and applications, CMHC's Rental Market Survey, the apartment registry"),
    ("trees", "Trees and heat", "2018 canopy study, the City's street trees, Landsat summer surface temperature"),
    ("elections", "Elections", "City of Toronto mayoral election results, apportioned from voting subdivisions"),
    ("rentals", "Short-term rentals", "Inside Airbnb scrapes; listing points are shifted up to 150 m"),
]
CENSUS_GROUPS = {"income": "Income", "low": "Low income and transfers", "housing": "Housing",
                 "costs": "Housing costs and values", "dwellings": "Dwellings", "people": "People"}


def span(y: int) -> str:
    """The label of the RARE_YEARS years ending in y: 2023–25."""
    return f"{y - RARE_YEARS + 1}–{str(y)[2:]}"


# The census catalogue's short names are for a menu grouped by topic ("Household, total");
# the Explorer uses them inside sentences, so these stand in for the ones that need their topic.
CENSUS_SHORT = {"med_hh_tot": "Household income", "med_hh_at": "After-tax household income", "med_ind_tot": "Individual income",
                "med_ind_at": "After-tax individual income", "avg_hh_tot": "Average household income",
                "degree": "Bachelor's degree or higher", "own_cost": "Owners' monthly costs", "rent": "Monthly rent",
                "owner30": "Owners spending 30%+ on shelter", "tenant30": "Tenants spending 30%+ on shelter",
                "shelter30": "Households spending 30%+ on shelter", "detached": "Single-detached houses",
                "apt5": "Apartments of 5+ storeys", "built_new": "Homes built in the past 5 years",
                "built_old": "Homes built 1960 or before", "crowded": "Crowded housing", "age0_14": "Children 0 to 14",
                "age65": "People 65 and over", "moved1": "Moved in the past year", "moved5": "Moved in the past 5 years"}


class Book:
    """Collects measures: the catalogue rows and each source's data."""

    def __init__(self, ids):
        self.ids, self.rows, self.data = ids, [], {}

    def add(self, source, key, label, short, unit, periods, t, kind, values, group="", note="", digits=1):
        """values: one sequence of len(ids) per period."""
        if len(periods) != len(values) or len(periods) != len(t):
            sys.exit(f"{source}.{key}: {len(periods)} periods, {len(values)} columns")
        cols = []
        for v in values:
            v = list(v)
            if len(v) != len(self.ids):
                sys.exit(f"{source}.{key}: a period has {len(v)} values")
            cols.append([None if x is None or pd.isna(x) else (int(round(float(x))) if digits == 0 else round(float(x), digits))
                         for x in v])
        known = [sum(x is not None for x in c) for c in cols]
        if min(known) < 100:
            sys.exit(f"{source}.{key}: a period has only {min(known)} neighbourhoods")
        self.rows.append({"id": f"{source}.{key}", "source": source, "group": group, "label": label, "short": short,
                          "unit": unit, "periods": [str(p) for p in periods], "t": [round(float(x), 2) for x in t],
                          "kind": kind, "note": note})
        self.data.setdefault(source, {})[key] = cols


def census(b: Book, insights: dict):
    js = CATALOGUE_JS.read_text()
    cpi = {int(k): v for k, v in insights["cpi"].items()}
    inc_year = {int(k): int(v) for k, v in insights["income_years"].items()}
    for m in re.finditer(r'^\s+(\w+): \{ group: "(\w+)", unit: "(\w+)",(.*?)short: "([^"]+)", long: "([^"]+)" \},?$', js, re.M):
        key, group, unit, rest, short, long = m.groups()
        if key not in insights["measures"]:
            continue
        vals = insights["measures"][key]["values"]
        years = sorted(int(y) for y in vals)
        dated = 'dated: "census"' in rest
        cols = []
        for y in years:
            v = pd.Series(vals[str(y)], dtype=float)
            if unit == "money":  # restated in the latest year's dollars
                base = (lambda yy: yy) if dated else (lambda yy: inc_year[yy])
                v = v * cpi[base(years[-1])] / cpi[base(y)]
            cols.append(v)
        note = ""
        if unit == "money":
            note = f"In {years[-1] if dated else inc_year[years[-1]]} dollars (Toronto CPI)." + (
                "" if dated else " Incomes are for the year before each census.")
        if "cerb: true" in rest:
            note += " 2021's figure (2020 incomes) is moved by pandemic benefits."
        b.add("census", key, long, CENSUS_SHORT.get(key, short), "money" if unit == "money" else "pct", years, years, "census", cols,
              group=CENSUS_GROUPS[group], note=note.strip(), digits=0 if unit == "money" else 1)


def safety(b: Book):
    s = json.loads((WEB / "safety.json").read_text())
    pop = pd.Series(s["pop"], dtype=float)
    crimes = {"assault", "break_and_enter", "auto_theft", "robbery", "theft_over"}
    for c in s["categories"]:
        k = c["key"]
        years = sorted(int(y) for y in s["counts"][k])
        counts = {y: pd.Series(s["counts"][k][str(y)], dtype=float) for y in years}
        if k in crimes:
            use, cols = years, [counts[y] / pop * 1e5 for y in years]
            label, note = f"{c['label']} per 100,000 residents", ""
        else:
            use = years[RARE_YEARS - 1:]
            cols = [sum(counts[y - j] for j in range(RARE_YEARS)) / RARE_YEARS / pop * 1e5 for y in use]
            label = f"{c['label']} per 100,000 residents a year, {RARE_YEARS}-year average"
            note = f"Each period is the average of {RARE_YEARS} years: single years of a few events are noise."
        note = (note + " " + c.get("note", "")).strip()
        b.add("safety", k, label, c["short"], "rate", use if k in crimes else [span(y) for y in use], use, "year", cols,
              group=c["group"], note=note, digits=2)


def schools(b: Book):
    s = json.loads((WEB / "schools.json").read_text())
    years = s["years"]
    names = {"score": ("School score (Grade 3 and 6)", "School score"), "g3_read": ("Grade 3 reading, at standard", "Gr 3 reading"),
             "g3_write": ("Grade 3 writing, at standard", "Gr 3 writing"), "g3_math": ("Grade 3 math, at standard", "Gr 3 math"),
             "g6_read": ("Grade 6 reading, at standard", "Gr 6 reading"), "g6_write": ("Grade 6 writing, at standard", "Gr 6 writing"),
             "g6_math": ("Grade 6 math, at standard", "Gr 6 math")}
    prelim = f" {', '.join(map(str, s['preliminary']))} is preliminary." if s.get("preliminary") else ""
    for k, (label, short) in names.items():
        cols = [s["by_nbhd"]["inside"][k][str(y)] for y in years]
        b.add("schools", k, label, short, "score" if k == "score" else "pct", years, years, "year", cols,
              note="Schools inside the neighbourhood; some neighbourhoods have none. No tests in 2020 or 2021." + prelim)


def prices(b: Book):
    p = json.loads((WEB / "prices.json").read_text())
    q = pd.Series(p["quarters"])
    years = [int(y) for y, n in q.str[:4].value_counts().sort_index().items() if n == 4]
    comm = [n["c"] for n in p["nbhd"]]
    cols = []
    for y in years:
        ix = [k for k, x in enumerate(p["quarters"]) if x.startswith(str(y))]
        med = [pd.Series([c["med"][k] for k in ix], dtype=float).mean() for c in p["communities"]]
        cols.append([med[c] for c in comm])
    b.add("prices", "price", "Median sale price (TRREB community)", "Sale price", "money", years, years, "year", cols,
          note="The mean of the year's four quarterly medians, all home types, as published (not adjusted for inflation). "
               "Neighbourhoods in one TRREB community share its figure.", digits=0)


def housing(b: Book):
    h = json.loads((WEB / "housing.json").read_text())
    hh = {int(y): pd.Series(v, dtype=float) for y, v in h["households"].items()}
    base = lambda y: hh[2011 if y < 2014 else 2016 if y < 2019 else 2021]

    def flow(key, block, field, label, short, last):
        years = [y for y in block["years"] if y <= last]
        val = {y: pd.Series(block[field][str(y)], dtype=float) for y in years}
        use = years[RARE_YEARS - 1:]
        cols = [sum(val[y - j] for j in range(RARE_YEARS)) / RARE_YEARS / base(y) * 1000 for y in use]
        b.add("housing", key, f"{label} per 1,000 households a year, {RARE_YEARS}-year average", short, "rate", [span(y) for y in use],
              use, "year", cols, group="Building",
              note=f"Each period is the average of {RARE_YEARS} years (permits are lumpy), over households at the nearest census.",
              digits=2)

    last = h["partial"]["permits"] - 1
    flow("created", h["permits"], "created", "Units created on building permits", "Units on permits", last)
    flow("net", h["permits"], "net", "Net units on building permits", "Net units on permits", last)
    flow("dev", h["development"], "units", "Units proposed in development applications", "Units proposed", h["partial"]["development"] - 1)
    c = h["cmhc"]
    for key, label, short, unit, digits in (("avg_rent", "Average rent, purpose-built rental (CMHC zone)", "Average rent", "money", 0),
                                            ("vacancy", "Vacancy rate, purpose-built rental (CMHC zone)", "Vacancy rate", "pct", 1)):
        years = c["nbhd_years"]
        b.add("housing", key, label, short, unit, years, years, "year", [c[key][str(y)] for y in years], group="Rental market",
              note="CMHC publishes by zone: each neighbourhood carries its zones' figures. Each October; rents as published.",
              digits=digits)
    a = h["apartments"]
    units = pd.Series(a["units"], dtype=float)
    b.add("housing", "apt", "Units in registered apartment buildings per 1,000 households", "Apartment units", "rate", ["today"],
          [2026], "snapshot", [units / hh[2021] * 1000], group="Stock", note="Buildings of 3+ storeys and 10+ units in the City's registry.")
    social = (pd.Series(a["social"], dtype=float) + pd.Series(a["tchc"], dtype=float)) / units.where(units > 0) * 100
    b.add("housing", "social", "Social housing and TCHC share of registered apartment units", "Social housing share", "pct", ["today"],
          [2026], "snapshot", [social], group="Stock", note="Neighbourhoods without registered apartment buildings have no figure.")


def trees(b: Book):
    t = json.loads((WEB / "trees.json").read_text())["nbhd"]
    for key, label, short, unit, when, yr, note in (
            ("canopy", "Tree canopy, share of area", "Tree canopy", "pct", "2018", 2018, "The City's 2018 Tree Canopy Study."),
            ("trees_ha", "Street trees per hectare", "Street trees per ha", "rate", "2026", 2026, "City-owned trees on road allowances."),
            ("large", "Large street trees (trunk 50 cm or more), share", "Large street trees", "pct", "2026", 2026, ""),
            ("shannon", "Street-tree species diversity (Shannon index)", "Species diversity", "index", "2026", 2026, ""),
            ("maple", "Norway maple, share of street trees", "Norway maple", "pct", "2026", 2026, ""),
            ("heat", "Summer surface temperature against the city's", "Surface heat", "degC", "2022–25", 2024,
             "Landsat, 11 clear summer days, 2022 to 2025: the ground and roofs at midday, not the air.")):
        b.add("trees", key, label, short, unit, [when], [yr], "snapshot", [t[key]], note=note, digits=2)


def elections(b: Book):
    e = pd.read_csv(HERE / "elections" / "by_nbhd.csv")
    e["election"] = e.election.astype(str)
    runs = {k: g.set_index("nbhd_id").reindex(b.ids) for k, g in e.groupby("election")}
    k22, k23 = sorted(runs)[0], sorted(runs)[-1]
    if not (k22.startswith("2022") and k23.startswith("2023")):
        sys.exit(f"unexpected elections {sorted(runs)}")
    periods, t = ["2022", "2023 by-election"], [2022.8, 2023.5]
    note = "Voting subdivisions apportioned to neighbourhoods; mail-in and advance votes allocated within the ward."
    b.add("elections", "turnout", "Mayoral election turnout", "Turnout", "pct", periods, t, "election",
          [runs[k22].turnout * 100, runs[k23].turnout * 100], note=note)
    for key, run, per, tt, who in (("tory", k22, "2022", 2022.8, "John Tory"), ("chow", k23, "2023 by-election", 2023.5, "Olivia Chow"),
                                   ("bailao", k23, "2023 by-election", 2023.5, "Ana Bailão")):
        b.add("elections", key, f"{who}'s share of the mayoral vote", f"{who.split()[-1]} share", "pct", [per], [tt], "snapshot",
              [runs[run][f"share_{key}"] * 100], note=note)


def rentals(b: Book):
    r = pd.read_csv(HERE / "rentals" / "by_nbhd.csv")
    snaps = sorted(r.snapshot.unique())
    t = [pd.Timestamp(s).year + (pd.Timestamp(s).dayofyear - 1) / 365 for s in snaps]
    for key, col, label, short in (("short_term", "short_term_per_1000hh", "Short-term rental listings (stays under 28 nights) per 1,000 households",
                                    "Short-term listings"),
                                   ("listings", "listings_per_1000hh", "Airbnb listings per 1,000 households", "Airbnb listings"),
                                   ("active", "active_per_1000hh", "Airbnb listings reviewed in the past year, per 1,000 households",
                                    "Active listings")):
        cols = [r[r.snapshot == s].set_index("nbhd_id")[col].reindex(b.ids) for s in snaps]
        b.add("rentals", key, label, short, "rate", snaps, t, "scrape", cols, digits=2,
              note="Inside Airbnb's scrapes; the 2026-03-19 scrape is about 30% smaller than the others, so read the trend with care.")


def main() -> int:
    insights = json.loads((WEB / "insights.json").read_text())
    ids = [n["id"] for n in insights["nbhd"]]
    b = Book(ids)
    census(b, insights)
    safety(b)
    schools(b)
    prices(b)
    housing(b)
    trees(b)
    elections(b)
    rentals(b)
    OUT.mkdir(exist_ok=True)
    cat = {"built": pd.Timestamp.today().date().isoformat(),
           "nbhd": [{"id": n["id"], "name": n["name"], "path": n["path"]} for n in insights["nbhd"]], "map": insights["map"],
           "sources": [{"key": k, "label": l, "note": n} for k, l, n in SOURCES], "measures": b.rows}
    if {r["source"] for r in b.rows} != {k for k, *_ in SOURCES}:
        sys.exit("a source has no measures")
    (OUT / "catalogue.json").write_text(json.dumps(cat, separators=(",", ":")) + "\n")
    total = (OUT / "catalogue.json").stat().st_size
    for src, data in b.data.items():
        f = OUT / f"{src}.json"
        f.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        total += f.stat().st_size
        print(f"{src}: {len(data)} measures, {f.stat().st_size:,} bytes")
    print(f"{len(b.rows)} measures, {total:,} bytes in all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
