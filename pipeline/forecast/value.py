"""Backtest of five-year forecasts of each neighbourhood's census median dwelling
value, relative to the City's (docs/forecast-spec.md).

    python pipeline/forecast/value.py

Reads the neighbourhood figures in web/public/insights.json, the households in
web/public/housing.json, permits by neighbourhood (pipeline/permits/by_nbhd.csv) and
the neighbourhood boundaries. The target is a neighbourhood's value as a log ratio
to the City's median; the City's own level is not forecast.

Rungs: persistence (the same ratio), own mean (the mean ratio of the censuses to
date), trend (the last five years' change in the ratio, again), ridge regression and
nearest-neighbour analogs, fitted to one transition and tested on the other:
  forward  fitted on 2011-2016, tested on 2016-2021: the backtest
  reverse  fitted on 2016-2021, tested on 2011-2016: a check that what the fit
           learns holds both ways (own mean and trend need 2006, which has no
           comparable value, so they are forward only)
Predictors are known at the origin: the census then, its change from the census
before (as standing within the City), the neighbours' ratio, and permits issued in
the five years before. A conditional run adds permits issued during the five years
being forecast (oracle: only known after the fact) and is reported apart.

Writes pipeline/out/model/value_scores.csv and value_predictions.csv.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
PIPELINE = HERE.parent
from fit import ALPHAS, KS, choose, knn_fit, ridge_fit, self_check, spearman, tune, wmae  # noqa: E402

WEB = PIPELINE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
HOUSING = WEB / "housing.json"
PERMITS = PIPELINE / "permits" / "by_nbhd.csv"
NEIGHBOURHOODS = PIPELINE / "raw" / "toronto_neighbourhoods_4326.geojson"
OUT = PIPELINE / "out" / "model"

# Levels at the origin, standardised within the census; the median income on a log scale.
LEVELS = ["med_hh_at", "lim_at", "renter", "condo", "detached", "apt5", "built_new", "degree",
          "imm_recent", "moved5", "age0_14", "age65", "shelter30"]
# Their five-year change in standing (2006 has these on the same terms).
CHANGES = ["med_hh_at", "renter", "detached", "apt5", "built_new", "degree", "imm_recent"]
KNN_FEATURES = ["L", "nb_L", "med_hh_at", "condo", "built_new", "permits_before"]
FOLDS = {"forward": ("2011", "2016", "2021"), "reverse": ("2016", "2011", "2016")}
RUNGS = ["persistence", "own_mean", "trend", "ridge", "knn"]


def neighbours(ids: list[int]) -> list[list[int]]:
    g = gpd.read_file(NEIGHBOURHOODS)
    g["nbhd_id"] = g.AREA_SHORT_CODE.astype(int)
    g = g.set_index("nbhd_id").loc[ids].to_crs(2952)
    geom = g.geometry.buffer(5)  # shared edges as digitised don't always meet exactly
    sidx = geom.sindex
    out = []
    for k, poly in enumerate(geom):
        hits = [j for j in sidx.query(poly, predicate="intersects") if j != k]
        out.append(hits)
    return out


def main() -> int:
    self_check()
    for f in (INSIGHTS, HOUSING, PERMITS, NEIGHBOURHOODS):
        if not f.exists():
            sys.exit(f"{f} is missing")
    ins = json.loads(INSIGHTS.read_text(encoding="utf-8"))
    hh = json.loads(HOUSING.read_text(encoding="utf-8"))["households"]
    ids = [n["id"] for n in ins["nbhd"]]
    M = ins["measures"]
    nb = neighbours(ids)
    if min(len(n) for n in nb) == 0:
        sys.exit("a neighbourhood has no neighbours")

    def arr(m, y):
        return np.array([np.nan if v is None else v for v in M[m]["values"][y]], float)

    def z(m, y):
        v = arr(m, y)
        v = np.log(v) if m == "med_hh_at" else v
        return (v - np.nanmean(v)) / np.nanstd(v)

    L = {y: np.log(arr("value", y) / M["value"]["city"][y]) for y in ("2011", "2016", "2021")}
    permits = pd.read_csv(PERMITS)
    permits = permits[permits.basis == "issued"].pivot_table(index="nbhd_id", columns="year", values="created", aggfunc="sum").reindex(ids).fillna(0)

    def per_1000(y0, y1, c):
        units = permits[[y for y in range(y0, y1 + 1) if y in permits.columns]].sum(axis=1).values
        return units / np.array(hh[c], float) * 1000

    def features(c: str) -> pd.DataFrame:
        y = int(c)
        prev = str(y - 5)
        d = pd.DataFrame(index=ids)
        d["L"] = L[c]
        d["nb_L"] = [np.mean(L[c][n]) for n in nb]
        for m in LEVELS:
            d[m] = z(m, c)
        for m in CHANGES:
            d[f"d_{m}"] = z(m, c) - z(m, prev)
        d["permits_before"] = np.log1p(per_1000(y - 5, y - 1, c))
        d["permits_during"] = np.log1p(per_1000(y, y + 4, c))  # oracle
        d["hh"] = hh[c]
        return d.fillna(0.0)

    feats = ["L", "nb_L", *LEVELS, *[f"d_{m}" for m in CHANGES], "permits_before"]
    preds, recs, info = [], [], []
    for fold, (train_c, test_c, _) in FOLDS.items():
        tr, te = features(train_c), features(test_c)
        ytr = L[str(int(train_c) + 5)] - L[train_c]
        yte = L[str(int(test_c) + 5)] - L[test_c]
        w, grp = tr.hh.values.astype(float), np.array(ids)
        p = pd.DataFrame({"nbhd_id": ids, "fold": fold, "L0": te.L.values, "actual": te.L.values + yte, "hh": te.hh.values})
        p["persistence"] = te.L.values
        if fold == "forward":
            p["own_mean"] = (L["2011"] + L["2016"]) / 2
            p["trend"] = 2 * L["2016"] - L["2011"]
        a, ridge = tune(ridge_fit, ALPHAS, tr[feats].values, ytr, w, grp)
        p["ridge"] = te.L.values + ridge(te[feats].values)
        k, knn = tune(knn_fit, KS, tr[KNN_FEATURES].values, ytr, w, grp)
        p["knn"] = te.L.values + knn(te[KNN_FEATURES].values)
        ao, oracle = tune(ridge_fit, ALPHAS, tr[[*feats, "permits_during"]].values, ytr, w, grp)
        p["ridge_oracle"] = te.L.values + oracle(te[[*feats, "permits_during"]].values)
        info.append(f"  {fold}: fitted on {train_c}-{int(train_c) + 5}, {len(feats)} features; ridge alpha {a:.3g}, k {k}; with oracle permits alpha {ao:.3g}")
        preds.append(p)
        base = None
        for r in [*RUNGS, "ridge_oracle"]:
            if r not in p:
                continue
            ww = p.hh.values.astype(float)
            mae = 100 * wmae(p[r].values, p.actual.values, ww)
            base = base or mae
            recs.append({"fold": fold, "rung": r, "n": len(p), "mae": mae, "skill": 1 - mae / base,
                         "rho_level": spearman(p[r], p.actual), "rho_change": spearman(p[r] - p.L0, p.actual - p.L0)})
    S = pd.DataFrame(recs)
    OUT.mkdir(parents=True, exist_ok=True)
    S.to_csv(OUT / "value_scores.csv", index=False, float_format="%.4f")
    pd.concat(preds).to_csv(OUT / "value_predictions.csv", index=False, float_format="%.4f")

    print("Mean absolute error of the log ratio to the City (x100, about %), households-weighted;")
    print("skill against persistence; rank correlation of forecast and actual levels and changes.")
    print(f"  {'fold':<9}{'rung':<14}{'n':>5}{'MAE':>7}{'skill':>8}{'rho lvl':>9}{'rho chg':>9}")
    for _, r in S.iterrows():
        chg = "" if np.isnan(r.rho_change) else f"{r.rho_change:.2f}"
        print(f"  {r.fold:<9}{r.rung:<14}{r.n:>5}{r.mae:>7.2f}{r.skill:>8.1%}{r.rho_level:>9.2f}{chg:>9}")
    print("\n".join(info))
    # The decision rule over the forward and reverse folds; the oracle run is
    # conditional and never chosen.
    mae = S.pivot(index="rung", columns="fold", values="mae")
    print(f"  Chosen by the rule: {choose({r: [mae.loc[r, 'forward'], mae.loc[r, 'reverse']] for r in RUNGS}, RUNGS)}")
    print(f"\nWrote {OUT / 'value_scores.csv'} and value_predictions.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
