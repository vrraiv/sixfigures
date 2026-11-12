"""The Neighbourhood Explorer's figures: web/public/neighbourhoods.json.

    python pipeline/affinity.py

How alike are two neighbourhoods? Reads the Data Explorer's files (web/public/
explorer/, from explorer_data.py), takes each measure at its latest period, and
writes what the page needs to compare any neighbourhood with every other:

  nbhd, map    the neighbourhoods (id, name, SVG outline) and map box, as in
               the Explorer's catalogue
  themes       the nine named themes in page order (key, label, the ids of their
               measures, optional: whether the page lets it be switched off by
               default it is on). Likeness is averaged within a theme, then
               across themes, so five income measures don't count five times
  measures     each measure used: id, theme, label, short, unit, period, values
               (as published, by neighbourhood) and pct (its percentile rank
               among the neighbourhoods, 0-100; ties share the middle; null
               where there is no figure)
  types        the kinds of neighbourhood: name, blurb, the measures its
               neighbourhoods are highest and lowest on, how many there are and
               the one nearest its centre (medoid)
  type, next   each neighbourhood's type and the type it is next nearest to
  typing       how the types were made, and how distinct they are (silhouette)

The method (the page computes the likeness itself, so themes can be switched):
  - every measure becomes a percentile rank across the 158 neighbourhoods, so an
    extreme figure (Bridle Path's income, downtown's crime rates) is the top of
    the scale, not off it
  - two neighbourhoods' gap on a measure is the difference of their percentiles;
    on a theme, the mean gap over its measures both have; overall, the mean of
    the theme gaps. Affinity is 100 less that gap
  - the neighbourhood itself is not left out when ranking: with 158 it changes
    the ordering of the others by under 0.2% (checked on Bridle Path, the most
    extreme), and leaving it out would make A's likeness to B differ from B's to A
Measures that restate another are left out (pedestrians within all road
injuries, the school score built from the six results, listings counted three
ways), as is canopy change, which is a trend, not a state. Checked against other
ways of measuring likeness on 2026-11-12: the first principal component alone
(25% of the variance, an affluence axis) shares 21% of top-ten lists with this,
five components 62%, every measure weighted equally 80%.

The types: Ward's hierarchical clustering of the neighbourhoods on the same
percentiles, every theme but Voting weighted equally (a missing figure at the
median), cut at K types. They are a convenient way to cut a continuum, not
sharply separate groups (silhouette about 0.1), so each neighbourhood also
carries the type it is next nearest to. A type's name is looked up by its
medoid in NAMES; if a rebuild moves a medoid, that type falls back to a
description by its highest measures until NAMES is updated.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
EX = WEB / "explorer"
OUT = WEB / "neighbourhoods.json"
K = 8

# key, label, on by default, measures (Explorer ids)
THEMES = [
    ("income", "Income", True, "census.med_hh_tot census.med_hh_at census.med_ind_tot census.med_ind_at census.avg_hh_tot "
                               "census.lim_at census.transfers"),
    ("costs", "Housing costs", True, "census.value census.own_cost census.rent census.shelter30 census.owner30 census.tenant30 "
                                     "prices.price housing.avg_rent housing.vacancy rentals.short_term"),
    ("homes", "Homes", True, "census.renter census.subsidized census.detached census.apt5 census.condo census.built_old "
                             "census.crowded housing.apt housing.social"),
    ("people", "People", True, "census.degree census.moved1 census.moved5 census.imm_recent census.age0_14 census.age65"),
    ("building", "New building", True, "census.built_new housing.created housing.net housing.dev"),
    ("safety", "Safety", True, "safety.assault safety.break_and_enter safety.auto_theft safety.robbery safety.theft_over "
                               "safety.shootings safety.homicides safety.ksi_persons"),
    ("schools", "Schools", True, "schools.g3_read schools.g3_write schools.g3_math schools.g6_read schools.g6_write schools.g6_math"),
    ("trees", "Trees and heat", True, "trees.canopy trees.trees_ha trees.large trees.shannon trees.maple trees.heat"),
    ("voting", "Voting", True, "elections.turnout elections.tory elections.chow elections.bailao"),
]
NOT_TYPED = {"voting"}  # left out of the types: a kind of place shouldn't be defined by how it votes

# A type's name and one-line description, by the neighbourhood nearest its centre.
NAMES = {
    "Eglinton East": ("Family apartment suburbs", "Lower incomes, crowded housing and many children, much of it in apartment buildings."),
    "Lawrence Park South": ("Affluent house neighbourhoods", "The highest incomes, home values and school results, and the least crime."),
    "Thistletown-Beaumond Heights": ("Settled suburban houses", "Detached houses, long-time owners and more seniors; few renters or movers."),
    "Harbourfront-CityPlace": ("New condo districts", "Recent towers, young adults and constant turnover; few children or seniors."),
    "East End-Danforth": ("Older family streets", "Pre-1960 houses, large street trees and children; few condos or recent immigrants."),
    "Clairlea-Birchmount": ("Older working suburbs", "Older houses beside industry: little tree cover, hot ground, fewer degrees, more violent crime."),
    "Newtonbrook West": ("Fast-building apartment areas", "The most construction and proposals; renters, movers and lower home prices."),
    "Trinity-Bellwoods": ("Inner-city neighbourhoods", "Dense older streets near downtown: short-term rentals, few children, few detached houses."),
}


def pct_rank(v: pd.Series) -> pd.Series:
    """Percentile rank among the known values, 0-100; ties share the middle."""
    return (v.rank(method="average") - 0.5) / v.count() * 100


def main() -> int:
    cat = json.loads((EX / "catalogue.json").read_text())
    defs = {m["id"]: m for m in cat["measures"]}
    names = [n["name"] for n in cat["nbhd"]]
    n = len(names)
    data = {}
    measures, theme_of = [], {}
    for key, _, _, ids in THEMES:
        for mid in ids.split():
            if mid not in defs:
                sys.exit(f"{mid} is not in the Explorer's catalogue (make explorer)")
            if mid in theme_of:
                sys.exit(f"{mid} is in two themes")
            src, k = mid.split(".")
            data.setdefault(src, json.loads((EX / f"{src}.json").read_text()))
            theme_of[mid] = key
            measures.append(mid)
    X = pd.DataFrame({m: data[m.split(".")[0]][m.split(".")[1]][-1] for m in measures}, index=names).astype(float)
    P = X.apply(pct_rank)
    if (X.count() < 100).any():
        sys.exit(f"too few neighbourhoods have {list(X.columns[X.count() < 100])}")

    # ---- the types
    use = [m for m in measures if theme_of[m] not in NOT_TYPED]
    w = pd.Series({m: 1 / sum(theme_of[x] == theme_of[m] for x in use) for m in use})
    V = ((P[use].fillna(50) - 50) * np.sqrt(w)).to_numpy()
    lab = fcluster(linkage(V, method="ward"), K, "maxclust")
    D = np.sqrt(((V[:, None, :] - V[None, :, :]) ** 2).sum(-1))
    order = sorted(set(lab), key=lambda c: -(lab == c).sum())  # biggest first
    centres = np.stack([V[lab == c].mean(0) for c in order])
    to_centre = np.sqrt(((V[:, None, :] - centres[None, :, :]) ** 2).sum(-1))
    type_ix = np.array([order.index(c) for c in lab])
    nxt = np.array([int(np.argsort(np.where(np.arange(len(order)) == type_ix[i], np.inf, to_centre[i]))[0]) for i in range(n)])
    sil = []
    for i in range(n):
        same = lab == lab[i]
        a = D[i, same].sum() / max(same.sum() - 1, 1)
        b = min(D[i, lab == c].mean() for c in order if c != lab[i])
        sil.append((b - a) / max(a, b))
    types = []
    for k, c in enumerate(order):
        members = np.where(lab == c)[0]
        medoid = names[members[int(np.argmin(to_centre[members, k]))]]
        med = P.iloc[members][use].median()

        def pick(s, count):  # the most extreme measures, at most two from a theme
            out, per = [], {}
            for mid in s.index:
                t = theme_of[mid]
                if per.get(t, 0) < 2:
                    out.append(mid)
                    per[t] = per.get(t, 0) + 1
                if len(out) == count:
                    break
            return out

        high, low = pick(med.sort_values(ascending=False), 5), pick(med.sort_values(), 4)
        name, blurb = NAMES.get(medoid, (None, None))
        if name is None:
            name = "Higher on " + ", ".join(defs[m]["short"].lower() for m in high[:2])
            blurb = "A rebuild moved this type's centre: name it in affinity.py's NAMES."
            print(f"  no name for the type centred on {medoid}")
        types.append({"name": name, "blurb": blurb, "medoid": medoid, "n": int(len(members)), "high": high, "low": low})
        print(f"{len(members):3d}  {name} ({medoid}): high {[defs[m]['short'] for m in high]}; low {[defs[m]['short'] for m in low]}")

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "nbhd": cat["nbhd"], "map": cat["map"],
        "themes": [{"key": k, "label": lbl, "on": on, "typed": k not in NOT_TYPED, "measures": ids.split()} for k, lbl, on, ids in THEMES],
        "measures": [{"id": m, "theme": theme_of[m], "label": defs[m]["label"], "short": defs[m]["short"], "unit": defs[m]["unit"],
                      "period": defs[m]["periods"][-1],
                      "values": [None if pd.isna(v) else v for v in X[m].tolist()],
                      "pct": [None if pd.isna(v) else round(float(v), 1) for v in P[m].tolist()]} for m in measures],
        "types": types, "type": type_ix.tolist(), "next": nxt.tolist(),
        "typing": {"k": K, "method": "Ward's hierarchical clustering on percentile ranks, themes weighted equally, Voting left out",
                   "silhouette": round(float(np.mean(sil)), 3)},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(measures)} measures in {len(THEMES)} themes; silhouette {out['typing']['silhouette']}")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
