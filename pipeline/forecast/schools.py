"""Backtest of one-year forecasts of each elementary school's Grade 3 and Grade 6
results (docs/forecast-spec.md).

    python pipeline/forecast/schools.py             # the selection folds
    python pipeline/forecast/schools.py --holdout   # also 2024 to 2025, once
    python pipeline/forecast/schools.py --holdout --live   # and the 2025-2026 forecast

Reads pipeline/schools/schools.csv (the schools School Insights shows) and the
neighbourhood census figures in web/public/insights.json. A grade's score is the
mean of its reading, writing and math results. Each school's position is its score
on the logit scale less the City's (the enrolment-weighted mean over the schools
with that grade's score); every rung forecasts the position, and the City's level
carries over from the origin, so the rungs differ only in where they put each
school against the City.

Rungs: persistence (next year as this one), own mean (the school's mean position to
date), ridge regression and nearest-neighbour analogs on the features below, fitted
to the one-year transitions before the origin and tuned by cross-validation on them.

Folds:
  2018-2019  persistence and own mean only (nothing before it to fit on)
  2019-2022  three years across the COVID-19 closures: scored on its own, fitted
             models from 2018-2019, never used to choose a rung
  2022-2023, 2023-2024  the selection folds
  2024-2025  the holdout, with --holdout

Ranges (fixed 2026-11-03, before the holdout): each grade's neighbourhood figure
gets the 80th percentile of ridge's absolute neighbourhood error in the selection
folds, either side, separately for neighbourhoods with one scored school and with
more.

Live (--live): ridge fitted on every one-year transition to 2025 forecasts 2026 from
2025, written to pipeline/model/ before any 2025-26 result is read.

Writes pipeline/out/model/schools_scores.csv (each fold, grade and rung),
schools_predictions.csv, schools_ranges.csv and schools_covid.csv, and prints the scores, the rung the
decision rule picks, the range's coverage in the holdout, and the 2019-2022
shortfall by school low-income share.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
PIPELINE = HERE.parent
sys.path.insert(0, str(PIPELINE))
from school_insights import DEMOGRAPHICS, TESTS, TYPES  # noqa: E402
from fit import KS, ALPHAS, ROUNDS, boost_fit, choose, expit, knn_fit, logit, ridge_fit, self_check, spearman, tune, wmae  # noqa: E402

SCHOOLS = PIPELINE / "schools" / "schools.csv"
INSIGHTS = PIPELINE.parent / "web" / "public" / "insights.json"
OUT = PIPELINE / "out" / "model"
LIVE = PIPELINE / "model"  # committed: live forecasts, frozen before their outcomes are known

GRADES = {"g3": TESTS[:3], "g6": TESTS[3:]}
SELECTION = [(2022, 2023), (2023, 2024)]
FIRST = (2018, 2019)
COVID = (2019, 2022)
HOLDOUT = (2024, 2025)
ONE_YEAR = [FIRST, *SELECTION, HOLDOUT]
LIVE_ORIGIN = 2025
RANGE_Q = 80  # percentile of the absolute neighbourhood error: an 80% range
RUNGS = ["persistence", "own_mean", "ridge", "knn", "boost"]
# Neighbourhood census measures (levels; the income on a log scale), standardised
# within each census.
CENSUS = ["med_hh_at", "lim_at", "degree", "renter", "imm_recent", "moved5", "age0_14"]
KNN_FEATURES = ["pos", "prev", "own_mean", "low_income", "log_enrol"]


def census_for(origin: int) -> str:
    """The latest census fully released by the origin's results: a census's last
    profile release is late in the year after it, so census c is usable from c + 2."""
    return "2021" if origin >= 2023 else "2016"


def load() -> tuple[pd.DataFrame, dict]:
    s = pd.read_csv(SCHOOLS, dtype={"school_number": str})
    s = s[s.year.notna() & (s.level == "Elementary") & (s.language == "English") & s.type.isin(TYPES)
          & (s.special == "Not applicable") & s.nbhd_id.notna()].copy()
    s["year"] = s.year.astype(int)
    dup = s.duplicated(["school_number", "year"]).sum()
    if dup:
        sys.exit(f"{dup} school-years appear twice")
    for g, cols in GRADES.items():
        s[g] = s[cols].mean(axis=1, skipna=False)  # all three results, or none
    s = s[s[list(GRADES)].notna().any(axis=1)]
    ins = json.loads(INSIGHTS.read_text(encoding="utf-8"))
    ids = [n["id"] for n in ins["nbhd"]]
    census = {}
    for c in ("2016", "2021"):
        cols = {}
        for m in CENSUS:
            v = np.array([np.nan if x is None else x for x in ins["measures"][m]["values"][c]], float)
            if m == "med_hh_at":
                v = np.log(v)
            cols[m] = (v - np.nanmean(v)) / np.nanstd(v)
        census[c] = pd.DataFrame(cols, index=ids).fillna(0.0)
    return s, census


def positions(s: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Each school-year's logit position against the City, by grade, and the City's
    enrolment-weighted logit level."""
    s = s.copy()
    city = {}
    for g in GRADES:
        ok = s[g].notna() & s.enrolment.notna()
        lg = logit(s[g])
        lev = s[ok].assign(l=lg[ok]).groupby("year").apply(lambda d: np.average(d.l, weights=d.enrolment), include_groups=False)
        city[g] = lev.to_dict()
        s[f"{g}_pos"] = np.where(s[g].notna(), lg - s.year.map(lev), np.nan)
    return s, city


def rows(s: pd.DataFrame, census: dict, g: str, t0: int, t1: int | None) -> pd.DataFrame:
    """The schools with grade g's score at both t0 and t1, with their features at t0.
    With t1 None (a live forecast), every school with the score at t0."""
    years = sorted(s.year.unique())
    other = "g6" if g == "g3" else "g3"
    a = s[s.year == t0].set_index("school_number")
    keep = a.index[a[g].notna() & a.enrolment.notna()]
    if t1 is None:
        b = pd.DataFrame(np.nan, index=keep, columns=[g, f"{g}_pos"])
    else:
        b = s[s.year == t1].set_index("school_number")
        keep = keep.intersection(b.index[b[g].notna()])
    a, b = a.loc[keep], b.loc[keep]
    hist = s[(s.year < t0) & s[g].notna()].groupby("school_number")
    prev_year = max([y for y in years if y < t0], default=None)
    prev = s[(s.year == prev_year)].set_index("school_number")[f"{g}_pos"] if prev_year else pd.Series(dtype=float)
    d = pd.DataFrame(index=keep)
    d["pos"] = a[f"{g}_pos"]
    d["prev"] = prev.reindex(keep)
    n_hist = hist.size().reindex(keep).fillna(0)
    d["has_prev"] = d.prev.notna().astype(float)
    d["prev"] = d.prev.fillna(d.pos)
    own = (hist[f"{g}_pos"].sum().reindex(keep).fillna(0) + d.pos) / (n_hist + 1)
    d["own_mean"] = own
    d["n_years"] = n_hist + 1
    o = a[f"{other}_pos"]
    d["has_other"] = o.notna().astype(float)
    d["other"] = o.fillna(0.0)
    d["log_enrol"] = np.log(a.enrolment)
    d["pos_small"] = d.pos / np.sqrt(a.enrolment) * np.sqrt(350)  # reversion stronger where cohorts are small
    d["pos_sq"] = d.pos * np.abs(d.pos)
    d["catholic"] = (a.type == "Catholic").astype(float)
    yr = s[s.year == t0]
    for c in DEMOGRAPHICS:  # standardised within the year: the 2022-23 file's census vintage changes their levels
        mu, sd = yr[c].mean(), yr[c].std()
        d[c] = ((a[c] - mu) / sd).fillna(0.0)
    cz = census[census_for(t0)].reindex(a.nbhd_id.astype(int).values)
    for m in CENSUS:
        d[f"nb_{m}"] = cz[m].values
    d["target"] = b[f"{g}_pos"] - d.pos  # the change in position
    d["actual"] = b[g]
    d["score0"] = a[g]
    d["enrol"] = a.enrolment
    d["nbhd_id"] = a.nbhd_id.astype(int)
    d["low_income_raw"] = a.low_income
    d["t0"], d["t1"], d["grade"] = t0, (t0 + 1 if t1 is None else t1), g
    return d


FEATURES = ["pos", "prev", "has_prev", "own_mean", "n_years", "other", "has_other", "log_enrol", "pos_small",
            "pos_sq", "catholic", *DEMOGRAPHICS, *[f"nb_{m}" for m in CENSUS]]
HISTORY = ["prev", "has_prev", "own_mean", "n_years"]


def forecast(train: pd.DataFrame, test: pd.DataFrame, city: dict) -> tuple[pd.DataFrame, dict]:
    """Each rung's forecast score for the test rows; the tuned alpha and k."""
    g, t0 = test.grade.iloc[0], test.t0.iloc[0]
    lev = city[g][t0]
    out = test[["actual", "score0", "enrol", "nbhd_id", "t0", "t1", "grade", "target", "low_income_raw"]].copy()
    out["persistence"] = test.score0
    if test.n_years.max() > 1:  # with one year to date it is persistence
        out["own_mean"] = expit(test.own_mean + lev)
    info = {}
    if train is None or train.empty:
        return out, info
    feats = list(FEATURES)
    if train.has_prev.max() == 0:  # no history to learn its weight from
        feats = [f for f in feats if f not in HISTORY]
    knn_feats = [f for f in KNN_FEATURES if f in feats]
    X, y, w, grp = train[feats].values, train.target.values, train.enrol.values.astype(float), train.index.values
    alpha, model = tune(ridge_fit, ALPHAS, X, y, w, grp)
    out["ridge"] = expit(test.pos + model(test[feats].values) + lev)
    k, knn = tune(knn_fit, KS, train[knn_feats].values, y, w, grp)
    out["knn"] = expit(test.pos + knn(test[knn_feats].values) + lev)
    n, boost = tune(boost_fit, ROUNDS, X, y, w, grp)
    out["boost"] = expit(test.pos + boost(test[feats].values) + lev)
    info.update(alpha=float(alpha), k=int(k), rounds=int(n), features=len(feats), train_rows=len(train))
    return out, info


def nbhd(p: pd.DataFrame, rung: str) -> pd.DataFrame:
    """Each neighbourhood's figure: its schools' forecasts (and results) weighted by
    enrolment at the origin, and how many schools it has."""
    nb = p.assign(pw=p[rung] * p.enrol, aw=p.actual * p.enrol, sw=p.score0 * p.enrol, n=1).groupby("nbhd_id")[["pw", "aw", "sw", "enrol", "n"]].sum()
    return pd.DataFrame({"pred": nb.pw / nb.enrol, "actual": nb.aw / nb.enrol, "score0": nb.sw / nb.enrol,
                         "enrol": nb.enrol, "n_schools": nb.n})


def bands(P: pd.DataFrame) -> dict:
    """The range (docs/forecast-spec.md, fixed before the holdout): by grade, the 80th
    percentile of ridge's absolute neighbourhood error in the selection folds pooled,
    for neighbourhoods with one scored school and with more."""
    out = {}
    for g in GRADES:
        e = pd.concat([nbhd(p, "ridge") for (gg, t0, t1), p in P.groupby(["grade", "t0", "t1"])
                       if gg == g and (t0, t1) in SELECTION])
        err = (e.actual - e.pred).abs()
        out[g] = {k: float(np.percentile(err[sel], RANGE_Q)) for k, sel in (("one", e.n_schools == 1), ("more", e.n_schools > 1))}
        out[g]["rows"] = {"one": int((e.n_schools == 1).sum()), "more": int((e.n_schools > 1).sum())}
    return out


def with_range(nb: pd.DataFrame, b: dict) -> pd.DataFrame:
    half = np.where(nb.n_schools == 1, b["one"], b["more"])
    return nb.assign(low=np.clip(nb.pred - half, 0, 100), high=np.clip(nb.pred + half, 0, 100))


def score(p: pd.DataFrame, rung: str) -> dict:
    w = p.enrol.values.astype(float)
    pred, act = p[rung].values, p.actual.values
    nb = p.assign(pw=p[rung] * p.enrol, aw=p.actual * p.enrol).groupby("nbhd_id")[["pw", "aw", "enrol"]].sum()
    return {
        "n": len(p),
        "mae": wmae(pred, act, w),
        "rho_level": spearman(pred, act),
        "rho_change": spearman(pred - p.score0.values, act - p.score0.values),
        "nbhd_mae": wmae((nb.pw / nb.enrol).values, (nb.aw / nb.enrol).values, nb.enrol.values),
    }


def covid(p: pd.DataFrame, city: dict, s: pd.DataFrame) -> tuple[list[str], list[dict]]:
    """2019 to 2022: the City's change, and by thirds of the schools' 2019 low-income
    share, their enrolment-weighted results against the 2018-2019 ridge forecast (net of
    the City's change) and their change against the mean change; then the highest third
    less the lowest, with a bootstrap standard error."""
    lines, recs = [], []
    for g in GRADES:
        q = p[p.grade == g].copy()
        def city_score(y):
            d = s[(s.year == y) & s[g].notna() & s.enrolment.notna()]
            return np.average(d[g], weights=d.enrolment)
        y19, y22 = city_score(2019), city_score(2022)
        lev = city[g][2022]
        # forecast position (ridge) on the 2022 City level, against the actual
        q["resid"] = q.actual - expit(logit(q.ridge) - city[g][2019] + lev)
        ch = q.actual - q.score0
        q["raw"] = ch - np.average(ch, weights=q.enrol)  # against these schools' mean change
        q["tercile"] = pd.qcut(q.low_income_raw.rank(method="first"), 3, labels=["lowest third", "middle third", "highest third"])
        lines.append(f"  {g.upper()}: City {y19:.1f}% in 2019, {y22:.1f}% in 2022 ({y22 - y19:+.1f} pp); {len(q)} schools")
        q["resid"] -= np.average(q.resid, weights=q.enrol)  # the model's offset across all schools
        for t, d in q.groupby("tercile", observed=True):
            recs.append({"grade": g, "row": str(t), "share_lo": d.low_income_raw.min(), "share_hi": d.low_income_raw.max(),
                         "n": len(d), "vs_forecast": np.average(d.resid, weights=d.enrol), "change": np.average(d.raw, weights=d.enrol),
                         "city_2019": y19, "city_2022": y22})
            lines.append(f"    low income {t:<13} (2019 share {d.low_income_raw.min():.0f}-{d.low_income_raw.max():.0f}%): "
                         f"vs forecast {np.average(d.resid, weights=d.enrol):+.1f} pp; change vs mean change {np.average(d.raw, weights=d.enrol):+.1f} pp")
        hi, lo = q[q.tercile == "highest third"], q[q.tercile == "lowest third"]
        rng = np.random.default_rng(0)

        def gap(col, boot=False):
            h = hi.sample(frac=1, replace=True, random_state=rng) if boot else hi
            l_ = lo.sample(frac=1, replace=True, random_state=rng) if boot else lo
            return np.average(h[col], weights=h.enrol) - np.average(l_[col], weights=l_.enrol)
        gaps = {}
        for col, name in (("resid", "vs forecast"), ("raw", "change")):
            se = np.std([gap(col, True) for _ in range(1000)])
            gaps[col] = (gap(col), se)
            lines.append(f"    highest third less lowest, {name}: {gap(col):+.1f} pp (se {se:.1f})")
        recs.append({"grade": g, "row": "gap", "n": len(hi) + len(lo), "vs_forecast": gaps["resid"][0], "vs_forecast_se": gaps["resid"][1],
                     "change": gaps["raw"][0], "change_se": gaps["raw"][1], "city_2019": y19, "city_2022": y22})
    return lines, recs


def live(s: pd.DataFrame, census: dict, city: dict, B: dict) -> None:
    """The 2025-2026 forecast (docs/forecast-spec.md): ridge fitted on every one-year
    transition to 2025, each school's and neighbourhood's figure, and the range."""
    LIVE.mkdir(exist_ok=True)
    sch, nbs = [], []
    print()
    for g in GRADES:
        test = rows(s, census, g, LIVE_ORIGIN, None)
        train = pd.concat([rows(s, census, g, a, b) for a, b in ONE_YEAR if b <= LIVE_ORIGIN])
        p, info = forecast(train, test, city)
        sch.append(p[["grade", "t0", "t1", "nbhd_id", "enrol", "score0", "persistence", "own_mean", "ridge"]])
        nb = with_range(nbhd(p, "ridge"), B[g]).drop(columns="actual")
        nbs.append(nb.reset_index().assign(grade=g))
        print(f"  live {g.upper()} {LIVE_ORIGIN}-{LIVE_ORIGIN + 1}: {len(test)} schools, {len(nb)} neighbourhoods; trained on "
              f"{info['train_rows']} rows, ridge alpha {info['alpha']:.3g}; City {expit(city[g][LIVE_ORIGIN]):.1f}% carried over")
    N = pd.concat(nbs)[["grade", "nbhd_id", "n_schools", "enrol", "score0", "pred", "low", "high"]]
    files = {LIVE / f"schools_{LIVE_ORIGIN + 1}_schools.csv": pd.concat(sch).reset_index(names="school_number").to_csv(index=False, float_format="%.3f", lineterminator="\n"),
             LIVE / f"schools_{LIVE_ORIGIN + 1}.csv": N.to_csv(index=False, float_format="%.3f", lineterminator="\n")}
    for f, text in files.items():
        if f.exists() and f.read_text(encoding="utf-8").replace("\r\n", "\n") != text:
            sys.exit(f"{f} is a frozen forecast and this run differs from it: not overwritten")
        f.write_text(text, encoding="utf-8", newline="\n")
    print(f"  {LIVE / f'schools_{LIVE_ORIGIN + 1}.csv'} (neighbourhoods) and schools_{LIVE_ORIGIN + 1}_schools.csv: written or unchanged")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", action="store_true", help="also score 2024-2025 (once, after the rung is chosen)")
    ap.add_argument("--live", action="store_true", help="also forecast 2026 from 2025 (fits on the holdout year, so with --holdout)")
    args = ap.parse_args()
    if args.live and not args.holdout:
        sys.exit("--live fits on the holdout year: run it with --holdout")
    self_check()
    for f in (SCHOOLS, INSIGHTS):
        if not f.exists():
            sys.exit(f"{f} is missing (make schools)")
    s, census = load()
    s, city = positions(s)
    folds = [FIRST, COVID, *SELECTION] + ([HOLDOUT] if args.holdout else [])
    preds, infos = [], []
    for g in GRADES:
        for t0, t1 in folds:
            test = rows(s, census, g, t0, t1)
            past = [tr for tr in ONE_YEAR if tr[1] <= t0]
            train = pd.concat([rows(s, census, g, a, b) for a, b in past]) if past else None
            p, info = forecast(train, test, city)
            preds.append(p)
            infos.append({"grade": g, "fold": f"{t0}-{t1}", **info})
    P = pd.concat(preds)
    recs = []
    for (g, t0, t1), p in P.groupby(["grade", "t0", "t1"]):
        base = score(p, "persistence")["mae"]
        for r in RUNGS:
            if r in p and p[r].notna().all():
                sc = score(p, r)
                recs.append({"grade": g, "fold": f"{t0}-{t1}", "rung": r, **sc, "skill": 1 - sc["mae"] / base})
    S = pd.DataFrame(recs)
    OUT.mkdir(parents=True, exist_ok=True)
    S.to_csv(OUT / "schools_scores.csv", index=False, float_format="%.4f")
    P.reset_index(names="school_number").to_csv(OUT / "schools_predictions.csv", index=False, float_format="%.3f")
    B = bands(P)
    rng_rows = []
    for g in GRADES:
        r = {"grade": g, "one": B[g]["one"], "more": B[g]["more"], "rows_one": B[g]["rows"]["one"], "rows_more": B[g]["rows"]["more"]}
        if args.holdout:
            h = with_range(nbhd(P[(P.grade == g) & (P.t0 == HOLDOUT[0]) & (P.t1 == HOLDOUT[1])], "ridge"), B[g])
            inside = (h.actual >= h.low) & (h.actual <= h.high)
            r.update(holdout_n=len(h), holdout_inside=float(inside.mean()),
                     holdout_inside_one=float(inside[h.n_schools == 1].mean()), holdout_inside_more=float(inside[h.n_schools > 1].mean()))
        rng_rows.append(r)
    pd.DataFrame(rng_rows).to_csv(OUT / "schools_ranges.csv", index=False, float_format="%.4f")

    print("Mean absolute error in percentage points (enrolment-weighted); skill against persistence;")
    print("rank correlation of forecast and actual levels, and of forecast and actual changes.")
    for g in GRADES:
        print(f"\n{g.upper()}")
        print(f"  {'fold':<10}{'rung':<13}{'n':>5}{'MAE':>7}{'skill':>8}{'rho lvl':>9}{'rho chg':>9}{'nbhd MAE':>10}")
        for _, r in S[S.grade == g].iterrows():
            chg = "" if np.isnan(r.rho_change) else f"{r.rho_change:.2f}"
            print(f"  {r.fold:<10}{r.rung:<13}{r.n:>5}{r.mae:>7.2f}{r.skill:>8.1%}{r.rho_level:>9.2f}{chg:>9}{r.nbhd_mae:>10.2f}")
        for i in infos:
            if i["grade"] == g and "alpha" in i:
                print(f"  {i['fold']}: trained on {i['train_rows']} rows, {i['features']} features; ridge alpha {i['alpha']:.3g}, k {i['k']}, boosting rounds {i['rounds']}")
        sel = S[(S.grade == g) & S.fold.isin([f"{a}-{b}" for a, b in SELECTION])].pivot(index="fold", columns="rung", values="mae")
        print(f"  Chosen by the rule: {choose({r: sel[r].tolist() for r in sel}, RUNGS)}")
    print("\n2019 to 2022, across the COVID-19 closures (ridge fitted on 2018-2019):")
    lines, recs = covid(P[(P.t0 == COVID[0]) & (P.t1 == COVID[1])], city, s)
    print("\n".join(lines))
    pd.DataFrame(recs).to_csv(OUT / "schools_covid.csv", index=False, float_format="%.4f")
    print("\nRanges (80th percentile of ridge's absolute neighbourhood error, selection folds):")
    for r in rng_rows:
        line = f"  {r['grade'].upper()}: one school +/-{r['one']:.2f} ({r['rows_one']} rows), more +/-{r['more']:.2f} ({r['rows_more']} rows)"
        if "holdout_n" in r:
            line += (f"; holdout: {r['holdout_inside']:.0%} of {r['holdout_n']} neighbourhoods inside "
                     f"(one school {r['holdout_inside_one']:.0%}, more {r['holdout_inside_more']:.0%})")
        print(line)
    if args.holdout:
        print("\nThe holdout (2024-2025) is now spent: report it, don't tune on it.")
    if args.live:
        live(s, census, city, B)
    print(f"\nWrote {OUT / 'schools_scores.csv'} and schools_predictions.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
