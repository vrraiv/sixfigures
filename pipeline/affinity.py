"""The Neighbourhood Explorer's figures: web/public/neighbourhoods.json.

    python pipeline/affinity.py

How alike are two neighbourhoods? Reads the Data Explorer's files (web/public/
explorer/, from explorer_data.py), takes each measure at its latest period, and
writes what the page needs to compare any neighbourhood with every other:

  nbhd, map    the neighbourhoods (id, name, SVG outline) and map box, as in
               the Explorer's catalogue
  themes       the named themes in page order (key, label, the ids of their
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
  grouped      for each neighbourhood, how often the reruns the kinds were cut from
               grouped it with the members of each kind, as whole percentages in the
               types' order (pipeline/kinds/grouped.csv). The figure for its own kind
               is how firmly it belongs: the page fades its map of kinds by it
  typing       how the types were made, and how distinct they are (silhouette)
  axes, xy     the likeness map: each neighbourhood's place on the first two
               principal components of the percentiles the types are made from,
               with each axis's share of the variance and the measures highest
               at its two ends; fit is how closely distance on the map tracks
               the gap (Pearson, over all pairs)
  km           each neighbourhood's representative point, in km east and north
               of their mean, for "at least 10 km away"
  history      the census measures that go back to HIST_FROM, by theme (a theme
               needs two or more, which leaves out New building), and each one's
               percentile ranks at every census since, as whole numbers

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
ways, Bike Share's docks beside its trips), as is canopy change, which is a trend, not a state. Checked against other
ways of measuring likeness on 2026-11-12: the first principal component alone
(25% of the variance, an affluence axis) shares 21% of top-ten lists with this,
five components 62%, every measure weighted equally 80%.

The types (the page's "kinds") are not made here: they are read from
pipeline/kinds/ (kinds.py), where they were cut once from what 72 reruns of the
clustering agree on, named by hand, and locked until the next census is fully
out. So a rebuild never moves a neighbourhood to another kind or renames one. What
this script works out afresh is what each kind is like on today's figures (the
measures its neighbourhoods are highest and lowest on, the one nearest its
centre) and, for each neighbourhood, the kind it is next nearest to: the kinds
cut a continuum (silhouette about 0.1 on the percentiles, every theme but
Voting weighted equally, a missing figure at the median). Each type carries
`together`, how often two of its members shared a group over the reruns, and
`loose` where that is under kinds.LOOSE_UNDER.

The likeness map is a picture, not the measure: two axes hold under half of the
differences between neighbourhoods, so the page's lists come from the gaps, not
from distance on it. Each axis is turned so that it runs toward more of its
ANCHOR measure, which keeps left and right the same from one rebuild to the next.
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
WEB = HERE.parent / "web" / "public"
EX = WEB / "explorer"
OUT = WEB / "neighbourhoods.json"
INSIGHTS = WEB / "insights.json"  # the neighbourhoods' representative points
KINDS = HERE / "kinds"  # the locked kinds: kinds.csv, names.json, manifest.json (kinds.py)
LOOSE_UNDER = 0.75  # as kinds.LOOSE_UNDER
HIST_FROM = "2006"
ANCHOR = ["census.med_hh_tot", "census.moved5"]  # the likeness map's axes run toward more of these

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
    ("transport", "Getting around", True, "transport.bike_trips transport.ttc_departures transport.ttc_frequent transport.ttc_rapid"),
    ("voting", "Voting", True, "elections.turnout elections.tory elections.chow elections.bailao"),
]
# Left out of the types. Voting: a kind of place shouldn't be defined by how it votes. Getting
# around: the kinds were cut and locked (kinds.py) before the theme was added, so they don't rest
# on it; take it out of this set when they are cut again, and it will count like the others.
NOT_TYPED = {"voting", "transport"}

def pct_rank(v: pd.Series) -> pd.Series:
    """Percentile rank among the known values, 0-100; ties share the middle."""
    return (v.rank(method="average") - 0.5) / v.count() * 100


def gap(P: pd.DataFrame, themes: list[list[str]]) -> np.ndarray:
    """The page's overall gap between every pair: mean rank gap within a theme, then across themes."""
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a pair with no measure of a theme in common
        per = [np.nanmean(np.stack([np.abs(P[m].to_numpy()[:, None] - P[m].to_numpy()[None, :]) for m in ms]), 0) for ms in themes]
        return np.nanmean(np.stack(per), 0)


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
    for f in ("kinds.csv", "grouped.csv", "names.json", "manifest.json"):
        if not (KINDS / f).exists():
            sys.exit(f"{KINDS / f} is missing: the kinds are committed; python pipeline/kinds.py --recut makes them anew")
    lock = pd.read_csv(KINDS / "kinds.csv").set_index("nbhd_id").kind.reindex([x["id"] for x in cat["nbhd"]])
    if lock.isna().any():
        sys.exit(f"{int(lock.isna().sum())} neighbourhoods have no kind in {KINDS / 'kinds.csv'}")
    lab = lock.to_numpy().astype(int)
    with_kind = pd.read_csv(KINDS / "grouped.csv").set_index("nbhd_id").reindex([x["id"] for x in cat["nbhd"]])
    with_cols = [f"with_{c}" for c in sorted(set(lab))]
    if list(with_kind.columns[1:]) != with_cols or with_kind[with_cols].isna().any().any():
        sys.exit(f"{KINDS / 'grouped.csv'} doesn't hold every neighbourhood against the {len(with_cols)} kinds of {KINDS / 'kinds.csv'}")
    if np.abs(with_kind[with_cols].to_numpy()[np.arange(n), lab - 1] - pd.read_csv(KINDS / "kinds.csv").set_index("nbhd_id").attached.reindex(with_kind.index).to_numpy()).max() > 0.0005:
        sys.exit(f"{KINDS / 'grouped.csv'} and {KINDS / 'kinds.csv'} disagree on how attached a neighbourhood is to its own kind: they are not from the same cut")
    kind_names = json.loads((KINDS / "names.json").read_text(encoding="utf-8"))
    cut = json.loads((KINDS / "manifest.json").read_text())
    D = np.sqrt(((V[:, None, :] - V[None, :, :]) ** 2).sum(-1))
    order = sorted(set(lab))  # kinds.py numbers them largest first
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

    def pick(s, count):  # the first measures of a sorted series, at most two from a theme
        out, per = [], {}
        for mid in s.index:
            t = theme_of[mid]
            if per.get(t, 0) < 2:
                out.append(mid)
                per[t] = per.get(t, 0) + 1
            if len(out) == count:
                break
        return out

    types = []
    for k, c in enumerate(order):
        members = np.where(lab == c)[0]
        medoid = names[members[int(np.argmin(to_centre[members, k]))]]
        med = P.iloc[members][use].median()
        high, low = pick(med.sort_values(ascending=False), 5), pick(med.sort_values(), 4)
        name, blurb = kind_names[str(c)]["name"], kind_names[str(c)]["blurb"]
        if not name or not blurb:
            sys.exit(f"kind {c} has no name or blurb in {KINDS / 'names.json'} (its members most attached: {kind_names[str(c)].get('most_attached')})")
        together = cut["kinds"][str(c)]["together"]
        types.append({"name": name, "blurb": blurb, "medoid": medoid, "n": int(len(members)), "high": high, "low": low,
                      "together": round(together, 3), "loose": together < LOOSE_UNDER})
        print(f"{len(members):3d}  {name} ({medoid}; together {together:.0%}): high {[defs[m]['short'] for m in high]}; low {[defs[m]['short'] for m in low]}")

    # ---- the likeness map: the first two principal components of what the types are made from
    U, s, Vt = np.linalg.svd(V - V.mean(0), full_matrices=False)
    share = s ** 2 / (s ** 2).sum()
    axes, xy = [], []
    for k in range(2):
        load = pd.Series(Vt[k], index=use)
        turn = 1 if load[ANCHOR[k]] > 0 else -1
        load = (load * turn).sort_values()
        xy.append(U[:, k] * s[k] * turn)
        axes.append({"share": round(float(share[k]), 3), "low": pick(load, 3), "high": pick(load[::-1], 3)})
        print(f"axis {k + 1}: {share[k]:.1%}; low end {[defs[m]['short'] for m in axes[-1]['low']]}; high end {[defs[m]['short'] for m in axes[-1]['high']]}")
    xy = np.stack(xy, 1)
    typed = [[m for m in ids.split()] for key, _, _, ids in THEMES if key not in NOT_TYPED]
    iu = np.triu_indices(n, 1)
    flat = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))
    fit = float(np.corrcoef(flat[iu], gap(P, typed)[iu])[0, 1])
    print(f"distance on the map against the gap: r = {fit:.2f}")

    # ---- where they are: km east and north of the mean representative point
    at = {x["id"]: x["at"] for x in json.loads(INSIGHTS.read_text())["nbhd"]}  # [lat, lon]
    ll = np.array([at[x["id"]] for x in cat["nbhd"]])
    km = np.c_[(ll[:, 1] - ll[:, 1].mean()) * 111.32 * np.cos(np.deg2rad(ll[:, 0].mean())), (ll[:, 0] - ll[:, 0].mean()) * 110.57]

    # ---- the census measures that go back to HIST_FROM, as percentile ranks at every census since
    hist_themes = {}
    for key, _, _, ids in THEMES:
        back = [m for m in ids.split() if defs[m]["kind"] == "census" and defs[m]["periods"][0] == HIST_FROM]
        if len(back) > 1:
            hist_themes[key] = back
    back = [m for ms in hist_themes.values() for m in ms]
    periods = defs[back[0]]["periods"]
    if any(defs[m]["periods"] != periods for m in back):
        sys.exit("the census measures back to " + HIST_FROM + " don't share their periods")
    hist_pct = {}
    for m in back:
        cols = data["census"][m.split(".")[1]]
        hist_pct[m] = [[None if pd.isna(v) else int(round(v)) for v in pct_rank(pd.Series(col, dtype=float))] for col in cols]
    print(f"history: {len(back)} measures in {len(hist_themes)} themes at {periods}")

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "nbhd": cat["nbhd"], "map": cat["map"],
        "themes": [{"key": k, "label": lbl, "on": on, "typed": k not in NOT_TYPED, "measures": ids.split()} for k, lbl, on, ids in THEMES],
        "measures": [{"id": m, "theme": theme_of[m], "label": defs[m]["label"], "short": defs[m]["short"], "unit": defs[m]["unit"],
                      "period": defs[m]["periods"][-1],
                      "values": [None if pd.isna(v) else v for v in X[m].tolist()],
                      "pct": [None if pd.isna(v) else round(float(v), 1) for v in P[m].tolist()]} for m in measures],
        "types": types, "type": type_ix.tolist(), "next": nxt.tolist(),
        "grouped": np.rint(with_kind[with_cols].to_numpy() * 100).astype(int).tolist(),
        "typing": {"k": len(order), "method": cut["method"], "cut": cut["cut"], "reruns": cut["reruns"], "recut_after": cut["recut_after"],
                   "silhouette": round(float(np.mean(sil)), 3)},
        "axes": axes, "xy": np.round(xy, 1).tolist(), "fit": round(fit, 2),
        "km": np.round(km, 1).tolist(),
        "history": {"periods": periods, "themes": hist_themes, "pct": hist_pct},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(measures)} measures in {len(THEMES)} themes; silhouette {out['typing']['silhouette']}")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
