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

Demographic predictors (added after the first run, docs/forecast-spec.md): shares of
the population aged 25-34, 35-44, 65-74 and 75+, shares that immigrated in the five
years before the census and the five before that (pipeline/demography/nbhd.csv),
and the change in owner households over the five years to the origin, in ridge_demog;
ridge_demog_oracle adds the change in owners during the period (oracle).
Dwelling predictors (added after the demographic run): the shares of dwellings that
are semi-detached, row or duplex, that have three or more bedrooms, and that need
major repairs, and the share of owners with a mortgage, in ridge_dwell.
The previous change (added after the dwelling run): lag_avg, the change over the five
years to the origin in the log ratio of the average value of dwellings to the City's,
alone in reversion and with ridge's features in ridge_lag.
Heavy building (added after the previous-change run, chosen after looking):
heavy_build, 1 for the top tenth of neighbourhoods by permits issued in the five years
before the origin per 1,000 households; a fitted shift on persistence in build and on
own mean in own_mean_build, and with ridge's features in ridge_build.

Writes pipeline/out/model/value_scores.csv, value_predictions.csv and
value_demography_rho.csv.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
PIPELINE = HERE.parent
from fit import ALPHAS, KS, ROUNDS, boost_fit, choose, knn_fit, ridge_fit, self_check, spearman, tune, wmae  # noqa: E402

WEB = PIPELINE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
HOUSING = WEB / "housing.json"
PERMITS = PIPELINE / "permits" / "by_nbhd.csv"
DEMOGRAPHY = PIPELINE / "demography" / "nbhd.csv"
NBHD_2006 = PIPELINE / "census" / "nbhd_2006.csv"
NEIGHBOURHOODS = PIPELINE / "raw" / "toronto_neighbourhoods_4326.geojson"
OUT = PIPELINE / "out" / "model"

# Levels at the origin, standardised within the census; the median income on a log scale.
LEVELS = ["med_hh_at", "lim_at", "renter", "condo", "detached", "apt5", "built_new", "degree",
          "imm_recent", "moved5", "age0_14", "age65", "shelter30"]
# Their five-year change in standing (2006 has these on the same terms).
CHANGES = ["med_hh_at", "renter", "detached", "apt5", "built_new", "degree", "imm_recent"]
KNN_FEATURES = ["L", "nb_L", "med_hh_at", "condo", "built_new", "permits_before"]
FOLDS = {"forward": ("2011", "2016", "2021"), "reverse": ("2016", "2011", "2016")}
RUNGS = ["persistence", "own_mean", "trend", "ridge", "knn", "boost", "ridge_demog", "ridge_dwell", "reversion", "ridge_lag",
         "build", "ridge_build", "own_mean_build"]
# The demographic predictors (docs/forecast-spec.md, added after the first run): age
# and arrival shares, standardised within the census, and the change in owners.
AGE = {"a25_34": "25 to 34", "a35_44": "35 to 44", "a65_74": "65 to 74", "a75": "75 and over"}
ARRIVAL = {"imm_0_5": "arrived in the last 5 years", "imm_5_10": "arrived 5 to 10 years before"}
DEMOG = [*AGE, *ARRIVAL, "owners_before"]
# The dwelling predictors (added after the demographic run): (part, base) shares.
DWELL = {"attached": ("attached", "dw_tot"), "bed3": ("bed3", "bed_tot"), "repairs": ("rep_major", "rep_tot"),
         "mortgage": ("own_mort", "own_tot")}


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
    for f in (INSIGHTS, HOUSING, PERMITS, NEIGHBOURHOODS, DEMOGRAPHY, NBHD_2006):
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

    demo = pd.read_csv(DEMOGRAPHY)
    # The previous change (added after the dwelling run): log ratio of the average
    # value to the City's, each pooled over owners the same way (demography.py).
    city_avg = json.loads((DEMOGRAPHY.parent / "manifest.json").read_text())["city_avg_value"]
    A = {y: np.log(demo[demo.year == int(y)].set_index("nbhd_id").avg_value.reindex(ids).values / city_avg[y])
         for y in ("2006", "2011", "2016", "2021")}
    hh06 = pd.read_csv(NBHD_2006).set_index("nbhd_id").hh.reindex(ids).values
    # Owner households: households less the renter share (insights' tenure bases).
    owners = {y: (hh06 if y == "2006" else np.array(hh[y], float)) * (1 - arr("renter", y) / 100)
              for y in ("2006", "2011", "2016", "2021")}

    def demog(c: str) -> pd.DataFrame:
        d = demo[demo.year == int(c)].set_index("nbhd_id").reindex(ids)
        out = pd.DataFrame(index=ids)
        for k in AGE:
            out[k] = d[k] / d.age_tot
        for k in ARRIVAL:
            out[k] = d[k] / d.imm_base
        for k, (part, base) in DWELL.items():
            out[k] = d[part] / d[base]
        return (out - out.mean()) / out.std(ddof=0)

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
        # Heavy building (chosen after looking): the top tenth for permits before, at this origin.
        before = per_1000(y - 5, y - 1, c)
        d["heavy_build"] = (pd.Series(before).rank(pct=True) > 0.9).astype(float).values
        d[[*AGE, *ARRIVAL, *DWELL]] = demog(c).values
        d["owners_before"] = np.log(owners[c] / owners[prev])
        d["owners_during"] = np.log(owners[str(y + 5)] / owners[c])  # oracle
        d["lag_avg"] = A[c] - A[prev]
        d["hh"] = hh[c]
        return d.fillna(0.0)

    feats = ["L", "nb_L", *LEVELS, *[f"d_{m}" for m in CHANGES], "permits_before"]
    preds, recs, info, corr = [], [], [], []
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
        n, boost = tune(boost_fit, ROUNDS, tr[feats].values, ytr, w, grp)
        p["boost"] = te.L.values + boost(te[feats].values)
        ao, oracle = tune(ridge_fit, ALPHAS, tr[[*feats, "permits_during"]].values, ytr, w, grp)
        p["ridge_oracle"] = te.L.values + oracle(te[[*feats, "permits_during"]].values)
        fd = [*feats, *DEMOG]
        ad, demog_m = tune(ridge_fit, ALPHAS, tr[fd].values, ytr, w, grp)
        p["ridge_demog"] = te.L.values + demog_m(te[fd].values)
        ado, demog_o = tune(ridge_fit, ALPHAS, tr[[*fd, "owners_during"]].values, ytr, w, grp)
        p["ridge_demog_oracle"] = te.L.values + demog_o(te[[*fd, "owners_during"]].values)
        fw = [*fd, *DWELL]
        aw, dwell_m = tune(ridge_fit, ALPHAS, tr[fw].values, ytr, w, grp)
        p["ridge_dwell"] = te.L.values + dwell_m(te[fw].values)
        ar, rev = tune(ridge_fit, ALPHAS, tr[["lag_avg"]].values, ytr, w, grp)
        p["reversion"] = te.L.values + rev(te[["lag_avg"]].values)
        slope = (rev(np.array([[1.0]])) - rev(np.array([[0.0]])))[0]
        fl = [*feats, "lag_avg"]
        al, lag_m = tune(ridge_fit, ALPHAS, tr[fl].values, ytr, w, grp)
        p["ridge_lag"] = te.L.values + lag_m(te[fl].values)
        ab, bld = tune(ridge_fit, ALPHAS, tr[["heavy_build"]].values, ytr, w, grp)
        p["build"] = te.L.values + bld(te[["heavy_build"]].values)
        shift = (bld(np.array([[1.0]])) - bld(np.array([[0.0]])))[0]
        if fold == "forward":
            p["own_mean_build"] = p.own_mean + shift * te.heavy_build.values
        fb = [*feats, "heavy_build"]
        abr, build_m = tune(ridge_fit, ALPHAS, tr[fb].values, ytr, w, grp)
        p["ridge_build"] = te.L.values + build_m(te[fb].values)
        corr.append({"fold": fold, "period": f"{train_c}-{int(train_c) + 5}",
                     **{k: spearman(tr[k], ytr) for k in [*DEMOG, "owners_during", "age0_14", "age65", *DWELL,
                                                          "detached", "condo", "apt5", "lag_avg", "heavy_build"]}})
        info.append(f"  {fold}: fitted on {train_c}-{int(train_c) + 5}, {len(feats)} features; ridge alpha {a:.3g}, k {k}, boosting rounds {n}; with oracle permits alpha {ao:.3g}; with demography alpha {ad:.3g} ({len(fd)} features), and oracle owners {ado:.3g}; with dwellings alpha {aw:.3g} ({len(fw)} features); reversion alpha {ar:.3g}, slope {slope:+.3f}; ridge_lag alpha {al:.3g}; heavy building {int(tr.heavy_build.sum())} neighbourhoods in training, {int(te.heavy_build.sum())} in test, build alpha {ab:.3g}, shift {shift:+.3f}; ridge_build alpha {abr:.3g}")
        preds.append(p)
        base = None
        for r in [*RUNGS, "ridge_oracle", "ridge_demog_oracle"]:
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
    # Description only: each demographic share at the start of a period against the
    # change in the value ratio over it (Spearman), in each period.
    C = pd.DataFrame(corr).set_index("period").drop(columns="fold").T
    C.to_csv(OUT / "value_demography_rho.csv", float_format="%.3f")
    print("\nRank correlation with the five-year change in the value ratio (at the start of each period):")
    print(f"  {'':<34}" + "".join(f"{p:>12}" for p in C.columns))
    names = {**{k: f"aged {v}" for k, v in AGE.items()}, **ARRIVAL, "owners_before": "owners, change in the 5 years before",
             "owners_during": "owners, change during (oracle)", "age0_14": "aged 0 to 14", "age65": "aged 65 and over",
             "attached": "semi, row and duplex", "bed3": "3 or more bedrooms", "repairs": "major repairs needed",
             "mortgage": "owners with a mortgage", "detached": "single-detached", "condo": "condominium",
             "apt5": "apartments, 5+ storeys", "lag_avg": "previous change, average value",
             "heavy_build": "heavy building before"}
    for k, r in C.iterrows():
        print(f"  {names[k]:<34}" + "".join(f"{v:>12.2f}" for v in r))
    print(f"\nWrote {OUT / 'value_scores.csv'} and value_predictions.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
