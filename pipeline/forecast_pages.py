"""The Forecasts pages' figures: web/public/forecasts.json.

    python pipeline/forecast_pages.py

Reads the model outputs (`make forecast`: pipeline/out/model/, and the frozen live
forecasts in pipeline/model/), the neighbourhood names in insights.json and the
neighbourhood boundaries, and writes:

  nbhd, map   the 158 neighbourhoods in insights.json's order with SVG outlines
              (school_insights.paths)
  schools     by grade: the City's score each year; each fold's scores by rung; the
              ranges and their coverage in the holdout; the holdout's neighbourhood
              figures; the 2019-2022 table; and the live forecast by neighbourhood
  value       each rung's scores (centred and raw), the range's backtest, the City
              figures behind the nowcast, and the live 2026 table
  rungs       each rung's name, what it uses, and when it was added

Nothing here is computed afresh except the neighbourhood figures of the holdout,
which use the harness's own functions (forecast/schools.py).
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "forecast"))
from school_insights import paths  # noqa: E402

WEB = HERE.parent / "web" / "public"
INSIGHTS = WEB / "insights.json"
OUT = WEB / "forecasts.json"
MODEL = HERE / "out" / "model"
LIVE = HERE / "model"


def harness(name: str):
    """A forecast script as a module (pipeline/schools.py shares the name schools)."""
    spec = importlib.util.spec_from_file_location(f"fc_{name}", HERE / "forecast" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Each rung: its label, what it uses ("forecast": only what was known at the origin;
# "oracle": outcomes during the period, reported apart; "nowcast": sales during the
# period, so issued only after the census day), and when it was added
# (docs/forecast-spec.md). "looked": chosen after looking at both periods' results.
RUNGS = {
    "persistence": ("Persistence", "forecast", None),
    "own_mean": ("Own mean", "forecast", None),
    "trend": ("Trend", "forecast", None),
    "ridge": ("Ridge regression", "forecast", None),
    "knn": ("Analogs (nearest neighbours)", "forecast", None),
    "boost": ("Boosting", "forecast", "2026-10-31"),
    "ridge_oracle": ("Ridge, with permits issued during the period", "oracle", None),
    "ridge_demog": ("Ridge, with demography", "forecast", "2026-10-31"),
    "ridge_demog_oracle": ("Ridge, with demography and owner change during the period", "oracle", "2026-10-31"),
    "ridge_dwell": ("Ridge, with dwelling shares", "forecast", "2026-10-31"),
    "reversion": ("Reversion (the previous change alone)", "forecast", "2026-11-01"),
    "ridge_lag": ("Ridge, with the previous change", "forecast", "2026-11-01"),
    "build": ("Heavy building, a shift on persistence", "forecast", "2026-11-01 looked"),
    "ridge_build": ("Ridge, with heavy building", "forecast", "2026-11-01 looked"),
    "own_mean_build": ("Own mean, with the heavy-building shift", "forecast", "2026-11-01 looked"),
    "market_full": ("Market change, coefficient 1", "nowcast", "2026-11-01"),
    "market": ("Market change, fitted slope", "nowcast", "2026-11-01"),
    "own_mean_market": ("Own mean, plus the market change", "nowcast", "2026-11-01"),
    "ridge_market": ("Ridge, with the market change", "nowcast", "2026-11-01"),
}
CHOSEN = {"schools": "ridge", "value": "own_mean"}

# TRREB Market Watch, City of Toronto, all home types, May (read by hand into
# docs/forecast-spec.md; the medians must agree with forecast/value.py's).
TRREB_MAY = {"2011": (None, 535_807), "2016": (595_000, 782_051), "2021": (890_000, 1_116_736), "2026": (885_000, 1_108_292)}


def r(v, k=2):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), k)


def main() -> int:
    need = [INSIGHTS, *(MODEL / f for f in ("schools_scores.csv", "schools_predictions.csv", "schools_ranges.csv",
                                             "schools_covid.csv", "value_scores.csv", "value_range_backtest.csv",
                                             "value_live.csv")), LIVE / "schools_2026.csv"]
    for f in need:
        if not f.exists():
            sys.exit(f"{f} is missing (make forecast)")
    fs, fv = harness("schools"), harness("value")
    for y, (med, _) in TRREB_MAY.items():
        if med is not None and fv.TRREB_MAY.get(y, med) != med:
            sys.exit(f"TRREB's May {y} median disagrees with forecast/value.py")
    insights = json.loads(INSIGHTS.read_text(encoding="utf-8"))
    ids = [n["id"] for n in insights["nbhd"]]
    index = {i: k for k, i in enumerate(ids)}
    shapes, proj = paths(ids)

    # ---- schools ----------------------------------------------------------------------
    S = pd.read_csv(MODEL / "schools_scores.csv")
    if not (S.fold == "2024-2025").any():
        sys.exit("the schools scores have no holdout: run make forecast")
    P = pd.read_csv(MODEL / "schools_predictions.csv", dtype={"school_number": str})
    Rg = pd.read_csv(MODEL / "schools_ranges.csv").set_index("grade")
    Cv = pd.read_csv(MODEL / "schools_covid.csv")
    L = pd.read_csv(LIVE / "schools_2026.csv")
    s, _ = fs.load()
    schools = {}
    for g in fs.GRADES:
        d = s[s[g].notna() & s.enrolment.notna()]
        city = d.groupby("year").apply(lambda x: np.average(x[g], weights=x.enrolment), include_groups=False)
        rg = Rg.loc[g]
        h = P[(P.grade == g) & (P.t0 == fs.HOLDOUT[0]) & (P.t1 == fs.HOLDOUT[1])]
        hb = fs.with_range(fs.nbhd(h, "ridge"), {"one": rg.one, "more": rg.more})
        live = L[L.grade == g]
        schools[g] = {
            "city": {str(y): r(v) for y, v in city.items()},
            "scores": [{"fold": x.fold, "rung": x.rung, "n": int(x.n), "mae": r(x.mae), "skill": r(x.skill, 4),
                        "rho_change": r(x.rho_change), "nbhd_mae": r(x.nbhd_mae)} for x in S[S.grade == g].itertuples()],
            "range": {"one": r(rg.one), "more": r(rg.more), "rows_one": int(rg.rows_one), "rows_more": int(rg.rows_more),
                      "inside": r(rg.holdout_inside, 4), "inside_one": r(rg.holdout_inside_one, 4),
                      "inside_more": r(rg.holdout_inside_more, 4), "n": int(rg.holdout_n)},
            "holdout": [{"i": index[int(k)], "pred": r(x.pred), "actual": r(x.actual), "low": r(x.low), "high": r(x.high),
                         "n": int(x.n_schools)} for k, x in hb.iterrows()],
            "covid": [{k: (r(v, 4) if isinstance(v, float) else v) for k, v in x.items() if k != "grade"}
                      for x in Cv[Cv.grade == g].to_dict("records")],
            "live": {"origin": 2025, "target": 2026,
                     "nbhd": [{"i": index[int(x.nbhd_id)], "n": int(x.n_schools), "score0": r(x.score0), "pred": r(x.pred),
                               "low": r(x.low), "high": r(x.high)} for x in live.itertuples()]},
        }

    # ---- dwelling value ---------------------------------------------------------------
    V = pd.read_csv(MODEL / "value_scores.csv")
    rows = []
    for rung, d in V.groupby("rung", sort=False):
        f = d.set_index("fold")
        get = lambda fold, col: r(f.loc[fold, col]) if fold in f.index else None  # noqa: E731
        rows.append({"rung": rung, "forward": get("forward", "mae"), "reverse": get("reverse", "mae"),
                     "forward_raw": get("forward", "mae_raw"), "reverse_raw": get("reverse", "mae_raw"),
                     "skill": r(f.loc["forward", "skill"], 4), "rho_change": get("forward", "rho_change")})
    B = pd.read_csv(MODEL / "value_range_backtest.csv")
    Lv = pd.read_csv(MODEL / "value_live.csv")
    city = insights["measures"]["value"]["city"]
    value = {
        "scores": rows,
        "backtest": {"city": round(city["2016"] * TRREB_MAY["2021"][0] / TRREB_MAY["2016"][0]),
                     "inside": r(B.inside.mean(), 4), "inside_hh": r(np.average(B.inside, weights=B.hh), 4),
                     "above": int(B.above.sum()), "below": int(B.below.sum()),
                     "nbhd": [{"i": index[int(x.nbhd_id)], "actual": None if np.isnan(x.actual) else int(x.actual),
                               "own_mean": int(x.own_mean), "low": int(x.low), "high": int(x.high)} for x in B.itertuples()]},
        "city": {"census": {y: city[y] for y in ("2011", "2016", "2021")},
                 "trreb_may": {y: {"median": m, "average": a} for y, (m, a) in TRREB_MAY.items()},
                 "nowcast": round(fv.CITY_2021 * fv.TRREB_MAY["2026"] / fv.TRREB_MAY["2021"]), "spread": fv.SPREAD},
        "live": [{"i": index[int(x.nbhd_id)], "value_2021": int(x.value_2021), "persistence": int(x.persistence),
                  "own_mean": int(x.own_mean), "own_mean_market": int(x.own_mean_market), "low": int(x.low), "high": int(x.high),
                  "market": bool(x.market_figure)} for x in Lv.itertuples()],
    }

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "nbhd": [{"id": i, "name": n["name"], "path": p} for i, n, p in zip(ids, insights["nbhd"], shapes)],
        "map": {"width": proj["width"], "height": proj["height"]},
        "rungs": {k: {"label": a, "kind": b, "added": (c or "").split(" ")[0] or None, "looked": bool(c and "looked" in c)}
                  for k, (a, b, c) in RUNGS.items()},
        "chosen": CHOSEN,
        "schools": schools,
        "value": value,
    }
    missing = {x["rung"] for x in rows} - set(RUNGS)
    if missing:
        sys.exit(f"rungs without a label: {sorted(missing)}")
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}: schools {', '.join(f'{g} {len(v['live']['nbhd'])} neighbourhoods' for g, v in schools.items())}; "
          f"value {len(value['live'])} neighbourhoods, {len(rows)} rungs; {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
