"""The Sixplex experiment's figures: web/public/sixplex.json.

    python pipeline/sixplex_insights.py

Reads pipeline/sixplex/ (sixplex.py: homes proposed in multiplex projects by ward and
month, the wards and the manifest) and estimates what the June 2025 by-law, which
allowed six homes in a house-scale building in eight wards and left the rest at four,
did to the homes proposed there.

The design, fixed on 24 November 2026. It was fixed after the counts of permits by
size, half-year and group of wards had been looked at, and before any estimate below
was computed.

Rebuilt the same day, after the first results were seen, on the Housing page's list of
projects (pipeline/multiplex/projects.csv) in place of this experiment's own count, so
that the two pages agree. That changed which projects count (a building of three to
six homes, sized from the permit's text; before, a permit of a "3+ Unit" type), when a
project is one of five or six (its size; before, five or six homes added) and where
its ward comes from (the permit; before, its address). The outcome (homes added), the
wards, periods, estimate, range and placebos stayed, and the checks but for two: "a
wider definition" (the new list is that definition) gave way to "new buildings only",
and "the building's homes, not the homes added" was added, because the list gives a
building's size and counting that was tried first: it counts a triplex that gains a
home as three. BEFORE_REBUILD keeps the estimate as it stood.

  outcome     homes proposed in multiplex projects (sixplex.py's `plex_homes`), by the
              date each was proposed
  wards       the eight sixplex wards ("six") against the sixteen left at four
              ("four"). Ward 23 had six from February 2025 under its own by-law and
              is in neither; one check puts it with the eight
  periods     whole quarters. Before: 2023 Q3 to 2025 Q2, the eight quarters after
              four homes were allowed everywhere (10 May 2023), so the by-law's last
              five days fall in "before". After: 2025 Q3 to the last whole quarter
  estimate    a difference in differences of ratios: the sixplex wards' homes after
              over before, divided by the same for the other wards. The comparison is
              "had the eight wards grown as the rest of the city did", which gives a
              number of homes: after - before x (the others' after / before). Ratios,
              because the two groups differ in size and the counts are small
  range       a permutation test: the estimate is recomputed with every choice of 8
              of the 24 wards called "sixplex wards" (735,471), and the p-value is
              the share at least as far from no effect as the real one. The 90% range
              is every effect size that test doesn't reject at 10%. The wards weren't
              chosen at random (they are the old city), so this measures how unusual
              the eight are among groups of wards, not chance in a trial
  checks      each a different reasonable choice, reported beside the estimate and
              never replacing it: Ward 23 in; only the four-home wards bordering the
              eight; each sixplex ward against its K most similar four-home wards
              (nearest neighbours on the level and growth of homes proposed before);
              dropped applications in; issued permits only; new buildings only;
              the building's homes, not the homes added; projects, not homes; a one-year "before"; a difference in homes per
              ward, not a ratio; and each ward left out in turn
  added later one more check, added after the first results were seen (they showed the
              other wards gaining on the eight before the by-law, quarter after
              quarter): the eight wards' share against the others is fitted with a
              straight line (in logs) over "before" and carried on. Marked `late`
  placebos    the same estimate where there should be none: laneway and garden
              suites, new detached houses, and a by-law imagined a year early

Every figure the page states is in the file: the page refreshes with the permits.
"""
import itertools
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
SRC = HERE / "sixplex"
OUT = HERE.parent / "web" / "public" / "sixplex.json"
BYLAW = {"four": "2023-05-10", "early": "2025-02-05", "six": "2025-06-26"}
PRE = ("2023 Q3", "2025 Q2")
POST_FROM = "2025 Q3"
FIXED = "2026-11-24"
REBUILT = "2026-11-24"
BEFORE_REBUILD = {"extra": -58.1, "extra_lo": -477.8, "extra_hi": 256.7, "t1": 851, "expected": 909.1}  # as first published in the pull request
K = 3  # nearest neighbours
LEVEL = 0.9
GRID = np.exp(np.linspace(np.log(0.25), np.log(8), 281))  # effect sizes tried for the range


def did(pre: np.ndarray, post: np.ndarray, treated: np.ndarray) -> dict:
    """The ratio estimate from each ward's homes before and after (see the docstring)."""
    t0, t1, c0, c1 = pre[treated].sum(), post[treated].sum(), pre[~treated].sum(), post[~treated].sum()
    if min(t0, c0, c1) <= 0:
        return {"t0": float(t0), "t1": float(t1), "c0": float(c0), "c1": float(c1), "ratio": None, "expected": None, "extra": None}
    expected = t0 * c1 / c0
    return {"t0": float(t0), "t1": float(t1), "c0": float(c0), "c1": float(c1),
            "ratio": float(t1 / expected), "expected": float(expected), "extra": float(t1 - expected)}


def assignments(n: int, k: int) -> np.ndarray:
    """Every choice of k of n wards, as rows of indices."""
    return np.array(list(itertools.combinations(range(n), k)), dtype=np.int8)


def _log_ratios(pre: np.ndarray, post: np.ndarray, picks: np.ndarray) -> np.ndarray:
    out = np.empty(len(picks))
    for i in range(0, len(picks), 250_000):  # in pieces: 2 million rows of 9 at once is a lot of memory
        idx = picks[i:i + 250_000].astype(np.intp)
        t0, t1 = pre[idx].sum(axis=1), post[idx].sum(axis=1)
        c0, c1 = pre.sum() - t0, post.sum() - t1
        with np.errstate(divide="ignore", invalid="ignore"):
            out[i:i + 250_000] = np.log(t1 / t0) - np.log(c1 / c0)
    return out


def permutation(pre: np.ndarray, post: np.ndarray, treated: np.ndarray, picks: np.ndarray | None = None) -> float | None:
    """The share of all relabellings of the wards whose estimate is at least as far from 1 as the real one."""
    picks = assignments(len(pre), int(treated.sum())) if picks is None else picks
    real = _log_ratios(pre, post, np.flatnonzero(treated)[None, :].astype(np.int8))[0]
    every = _log_ratios(pre, post, picks)
    if not np.isfinite(real) or not np.isfinite(every).all():
        return None  # a group with no homes: no ratio to compare
    return float((np.abs(every) >= abs(real) - 1e-12).mean())


def interval(pre: np.ndarray, post: np.ndarray, treated: np.ndarray, picks: np.ndarray, level: float = LEVEL) -> tuple[float, float]:
    """The effect sizes r the permutation test doesn't reject: with the sixplex wards'
    homes after divided by r, there should be nothing left to find."""
    kept = []
    for r in GRID:
        adj = post.astype(float).copy()
        adj[treated] /= r
        p = permutation(pre, adj, treated, picks)
        if p is not None and p > 1 - level:
            kept.append(r)
    return (float(min(kept)), float(max(kept))) if kept else (None, None)


def neighbours(pre1: np.ndarray, pre2: np.ndarray, treated: np.ndarray, k: int = K) -> dict:
    """Each sixplex ward's k most similar other wards: nearest on the level of homes
    proposed before (log, per quarter) and its growth from the first half of "before"
    to the second (log ratio), each standardised across the wards."""
    level, growth = np.log1p(pre1 + pre2), np.log1p(pre2) - np.log1p(pre1)
    z = np.column_stack([(v - v.mean()) / v.std() for v in (level, growth)])
    controls = np.flatnonzero(~treated)
    return {int(i): [int(c) for c in controls[np.argsort(((z[controls] - z[i]) ** 2).sum(axis=1), kind="stable")[:k]]]
            for i in np.flatnonzero(treated)}


def matched(pre: np.ndarray, post: np.ndarray, match: dict) -> dict:
    """The ratio estimate with each sixplex ward compared with its own neighbours."""
    t0 = sum(pre[i] for i in match)
    t1 = sum(post[i] for i in match)
    expected = sum(pre[i] * post[m].sum() / pre[m].sum() for i, m in match.items())
    return {"t0": float(t0), "t1": float(t1), "ratio": float(t1 / expected), "expected": float(expected), "extra": float(t1 - expected)}


def additive(pre: np.ndarray, post: np.ndarray, treated: np.ndarray, q0: int, q1: int) -> dict:
    """The usual difference in differences: homes per ward per quarter, not ratios."""
    per = lambda v, m, q: v[m].sum() / m.sum() / q  # noqa: E731
    gap = (per(post, treated, q1) - per(pre, treated, q0)) - (per(post, ~treated, q1) - per(pre, ~treated, q0))
    extra = gap * treated.sum() * q1
    t1 = post[treated].sum()
    return {"t0": float(pre[treated].sum()), "t1": float(t1), "ratio": float(t1 / (t1 - extra)) if t1 > extra else None,
            "expected": float(t1 - extra), "extra": float(extra)}


def trend(six: np.ndarray, four: np.ndarray, pre_q: list[int], post_q: list[int]) -> dict:
    """The estimate if the two groups' ratio had kept moving as it did before: a line
    through log(six / four) over the quarters before, carried through those after."""
    x, xp = np.array(pre_q), np.array(post_q)
    slope, level = np.polyfit(x, np.log(six[x] / four[x]), 1)
    expected = float((four[xp] * np.exp(level + slope * xp)).sum())
    t1 = float(six[xp].sum())
    return {"t0": float(six[x].sum()), "t1": t1, "ratio": t1 / expected, "expected": expected, "extra": t1 - expected,
            "slope": float(np.expm1(slope) * 100)}


def quarters_of(months: list[str]) -> dict:
    """Whole quarters only: {"2025 Q3": ["2025-07", "2025-08", "2025-09"], ...}."""
    q = {}
    for m in months:
        q.setdefault(f"{m[:4]} Q{(int(m[5:]) - 1) // 3 + 1}", []).append(m)
    return {k: v for k, v in q.items() if len(v) == 3}


def rounded(d: dict) -> dict:
    return {k: (None if v is None else round(v, 3) if k in ("ratio", "p", "lo", "hi") else round(v, 1)) for k, v in d.items()}


def main() -> int:
    for f in ("by_ward_month.csv", "wards.json", "manifest.json"):
        if not (SRC / f).exists():
            sys.exit(f"{SRC / f} is missing (make sixplex-data; the folder is committed)")
    t = pd.read_csv(SRC / "by_ward_month.csv", dtype={"ward": str})
    geo = json.loads((SRC / "wards.json").read_text())
    manifest = json.loads((SRC / "manifest.json").read_text())
    wards = geo["wards"]
    codes = [w["ward"] for w in wards]
    qmonths = quarters_of(sorted(t.month.unique()))
    quarters = list(qmonths)
    if PRE[0] not in quarters or POST_FROM not in quarters:
        sys.exit("the table doesn't cover the quarters before and after the by-law")
    t["quarter"] = t.month.map({m: q for q, ms in qmonths.items() for m in ms})
    t = t[t.quarter.notna()]
    series = [c for c in t.columns if c not in ("ward", "month", "quarter")]
    # cube[series] : wards x quarters
    cube = {s: t.pivot_table(index="ward", columns="quarter", values=s, aggfunc="sum").reindex(index=codes, columns=quarters).to_numpy(float)
            for s in series}
    if any(np.isnan(v).any() for v in cube.values()):
        sys.exit("a ward has no row for a quarter: by_ward_month.csv should hold every ward and month")
    qi = {q: i for i, q in enumerate(quarters)}
    pre_q = list(range(qi[PRE[0]], qi[PRE[1]] + 1))
    post_q = list(range(qi[POST_FROM], len(quarters)))
    arm = np.array([w["arm"] for w in wards])
    borders = np.array([w["borders"] for w in wards])
    study = arm != "early"  # the 24 wards of the estimate
    treated = (arm == "six")[study]

    def sums(s: str, quarters_: list[int], keep: np.ndarray = study) -> np.ndarray:
        return cube[s][keep][:, quarters_].sum(axis=1)

    picks = assignments(int(study.sum()), int(treated.sum()))

    def estimate(s: str, pre_: list[int] = pre_q, post_: list[int] = post_q, with_range: bool = False) -> dict:
        pre, post = sums(s, pre_), sums(s, post_)
        e = did(pre, post, treated) | {"p": permutation(pre, post, treated, picks)}
        if with_range:
            lo, hi = interval(pre, post, treated, picks)
            e |= {"lo": lo, "hi": hi, "extra_lo": e["t1"] - e["t1"] / lo, "extra_hi": e["t1"] - e["t1"] / hi}
        return e

    pre, post = sums("plex_homes", pre_q), sums("plex_homes", post_q)
    main_ = estimate("plex_homes", with_range=True)
    print(f"homes proposed in multiplex projects, {quarters[pre_q[0]]} to {quarters[pre_q[-1]]} and {quarters[post_q[0]]} to {quarters[post_q[-1]]}:")
    print(f"  sixplex wards {main_['t0']:.0f} -> {main_['t1']:.0f}; other wards {main_['c0']:.0f} -> {main_['c1']:.0f}")
    print(f"  expected {main_['expected']:.0f}, extra {main_['extra']:.0f} (x{main_['ratio']:.2f}); p {main_['p']:.4f}; "
          f"{LEVEL:.0%} range x{main_['lo']:.2f} to x{main_['hi']:.2f} ({main_['extra_lo']:.0f} to {main_['extra_hi']:.0f} homes)")

    # ---- checks -----------------------------------------------------------------------------------
    checks = []

    def check(key: str, e: dict, late: bool = False) -> None:
        checks.append({"key": key} | rounded(e) | ({"late": True} if late else {}))
        print(f"  {key:12s} x{e['ratio']:.2f}  extra {e['extra']:6.0f}" + (f"  p {e['p']:.4f}" if e.get("p") is not None else ""))

    print("checks:")
    # Ward 23 with the sixplex wards
    all25 = np.ones(len(wards), bool)
    t25 = arm != "four"
    p25, q25 = sums("plex_homes", pre_q, all25), sums("plex_homes", post_q, all25)
    check("ward23", did(p25, q25, t25) | {"p": permutation(p25, q25, t25)})
    # only the four-home wards that border the eight
    near = (arm == "six") | borders
    pn, qn, tn = sums("plex_homes", pre_q, near), sums("plex_homes", post_q, near), (arm == "six")[near]
    check("borders", did(pn, qn, tn) | {"p": permutation(pn, qn, tn)})
    # nearest neighbours
    half = len(pre_q) // 2
    match = neighbours(sums("plex_homes", pre_q[:half]), sums("plex_homes", pre_q[half:]), treated)
    check("matched", matched(pre, post, match))
    for key, s in (("filed", "filed_homes"), ("issued", "issued_homes"), ("new", "new_homes"), ("building", "building_homes"),
                   ("projects", "plex_projects")):
        check(key, estimate(s))
    check("oneyear", estimate("plex_homes", pre_=pre_q[half:]))
    check("additive", additive(pre, post, treated, len(pre_q), len(post_q)))
    check("trend", trend(cube["plex_homes"][arm == "six"].sum(axis=0), cube["plex_homes"][arm == "four"].sum(axis=0), pre_q, post_q), late=True)
    leave = []
    for i in range(int(study.sum())):
        keep = np.arange(int(study.sum())) != i
        leave.append({"ward": np.array(codes)[study][i]} | rounded(did(pre[keep], post[keep], treated[keep])))
    lo = min(leave, key=lambda r: r["ratio"])
    hi = max(leave, key=lambda r: r["ratio"])
    print(f"  leaving one ward out: x{lo['ratio']:.2f} (without ward {lo['ward']}) to x{hi['ratio']:.2f} (without ward {hi['ward']})")

    # ---- placebos -----------------------------------------------------------------------------------
    print("placebos:")
    placebos = []
    for key, e in (("suites", estimate("suites_homes")), ("houses", estimate("houses_homes")),
                   ("yearearly", estimate("plex_homes", pre_=pre_q[:half], post_=pre_q[half:]))):
        placebos.append({"key": key} | rounded(e))
        print(f"  {key:12s} x{e['ratio']:.2f}  p {e['p']:.4f}")
    parts = {key: rounded(estimate(s)) for key, s in (("small", "small_homes"), ("big", "big_homes"))}

    # ---- quarter by quarter: the two groups, and the sixplex wards against the path of the others ----
    def by_arm(s: str) -> dict:
        return {a: [int(v) for v in cube[s][arm == a].sum(axis=0)] for a in ("six", "four", "early")}

    arms = {s: by_arm(s) for s in ("plex_homes", "small_homes", "big_homes", "plex_projects", "big_projects", "up_projects",
                                   "filed_big_projects", "suites_homes", "houses_homes")}
    six, four = np.array(arms["plex_homes"]["six"], float), np.array(arms["plex_homes"]["four"], float)
    base = main_["t0"] / main_["c0"]
    expected_q = [round(float(v), 1) for v in four * base]
    rel = [None if four[i] == 0 or i < pre_q[0] else round(float(six[i] / four[i] / base), 3) for i in range(len(quarters))]

    out = {
        "built": pd.Timestamp.today().date().isoformat(),
        "retrieved": manifest["projects_retrieved"],
        "last_month": manifest["months"][1],
        "fixed": FIXED,
        "rebuilt": REBUILT,
        "before_rebuild": BEFORE_REBUILD,
        "bylaw": BYLAW,
        "quarters": quarters,
        "pre": [pre_q[0], pre_q[-1]],
        "post": [post_q[0], post_q[-1]],
        "level": LEVEL,
        "k": K,
        "assignments": int(len(picks)),
        "map": {"width": geo["width"], "height": geo["height"]},
        "wards": [{**w,
                   "pre": int(cube["plex_homes"][i, pre_q].sum()), "post": int(cube["plex_homes"][i, post_q].sum()),
                   "big_pre": int(cube["big_projects"][i, pre_q].sum()),
                   "big_post": int(cube["big_projects"][i, post_q].sum()),
                   "big_homes_post": int(cube["big_homes"][i, post_q].sum())} for i, w in enumerate(wards)],
        "arms": arms,
        "expected": expected_q,
        "relative": rel,
        "main": rounded(main_),
        "parts": parts,
        "checks": checks,
        "leave": leave,
        "matches": [{"ward": np.array(codes)[study][i], "like": [np.array(codes)[study][m] for m in ms]} for i, ms in match.items()],
        "placebos": placebos,
        "counted": manifest["counted"],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT}: {len(quarters)} quarters ({quarters[0]} to {quarters[-1]}); {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
