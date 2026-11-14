"""The kinds of neighbourhood: cut once from what many reruns agree on, then locked.

    python pipeline/kinds.py            # make kinds: how the locked kinds hold on today's data
    python pipeline/kinds.py --recut    # make kinds-recut: cut them again and replace the lock

The Neighbourhood Explorer sorts the 158 neighbourhoods into kinds. They used to be cut
afresh on every rebuild (Ward's clustering, eight kinds), and the neighbourhoods are a
continuum, so a new quarter of sale prices could redraw two of the eight and leave them
without names. Now they are cut from what a set of reruns agree on, named by hand, and kept
in pipeline/kinds/ until the next census is fully out:

  kinds.csv      nbhd_id, nbhd, kind (1 to K, largest first), attached: the share of the
                 reruns, on average, in which the neighbourhood is grouped with each other
                 member of its kind
  names.json     each kind's name and one-line description, written by hand; a recut
                 empties them (and lists each kind's most attached members, to name it by)
  manifest.json  when the kinds were cut and from which Explorer build, the reruns, and for
                 each kind its size and `together`: how often two of its members share a
                 group, over the reruns

affinity.py reads the lock and no longer clusters, so a data refresh changes what a kind's
neighbourhoods are like (its highest and lowest measures, its centre) but never which
neighbourhoods are in it or what it is called.

The reruns. Each is affinity.py's clustering as it was (percentile ranks, every theme but
Voting weighted equally, Ward's method, EACH_K groups) on the data with something left out:
  - one measure left out, for each measure;
  - one theme left out, for each theme;
  - one period back: each source's measures at the period before their latest (the census
    at 2016 for 2021), then every source one period back, then two.
Two neighbourhoods' agreement is the share of reruns that put them in the same group. The
kinds are average-linkage clusters of that agreement, cut at K.

Why K is 9 (14 November 2026, 72 reruns). Of the eight kinds a single run gave, three came
back with most of their members in at least 80% of reruns and two in under 15%: the reruns
kept redrawing the line between the "established" and "affluent" house neighbourhoods. Cut
from the agreement instead, nine kinds have no group under four neighbourhoods (ten splits
off a pair), and seven of the nine hold together in about 80% of reruns or more. The other two
(the fast-building apartment areas and the modest house suburbs, 52 neighbourhoods) hold in
66% and 73%: they are kept, and the page says they are looser, since leaving a third of the
city without a kind would be worse. LOOSE_UNDER marks them: it sits in the gap between
those two and the next (the family apartment suburbs and the older east-end streets, both
within half a point of 80%).

When to recut: after the 2026 Census is fully released (its last release is scheduled for
1 December 2027), with the Explorers rebuilt on it. Run --recut, read the table it prints
for K - 2 to K + 3, change K if the reasons above no longer hold, and write the names.
Without --recut this script only reports: if the locked kinds stop holding on new data
(their `together` falls well below the manifest's), that is worth knowing before the census.
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage

HERE = Path(__file__).parent
OUT = HERE / "kinds"
K = 9
EACH_K = 8  # groups in each rerun: what a single run was cut at
LOOSE_UNDER = 0.75


def reruns() -> tuple[list, list, dict, str]:
    """The neighbourhoods (ids, names) and each rerun's group for every neighbourhood."""
    import affinity as A
    cat = json.loads((A.EX / "catalogue.json").read_text())
    names, ids = [n["name"] for n in cat["nbhd"]], [n["id"] for n in cat["nbhd"]]
    theme_of, data = {}, {}
    for key, _, _, mids in A.THEMES:
        for mid in mids.split():
            theme_of[mid] = key
            data.setdefault(mid.split(".")[0], json.loads((A.EX / f"{mid.split('.')[0]}.json").read_text()))
    use = [m for m in theme_of if theme_of[m] not in A.NOT_TYPED]
    series = {m: data[m.split(".")[0]][m.split(".")[1]] for m in use}

    def groups(measures: list, back: dict | None = None) -> np.ndarray:
        back = back or {}
        X = pd.DataFrame({m: series[m][max(0, len(series[m]) - 1 - back.get(m, 0))] for m in measures}, index=names).astype(float)
        P = X.apply(A.pct_rank)
        w = pd.Series({m: 1 / sum(theme_of[x] == theme_of[m] for x in measures) for m in measures})
        return fcluster(linkage(((P.fillna(50) - 50) * np.sqrt(w)).to_numpy(), method="ward"), EACH_K, "maxclust")

    runs = {f"without {m}": groups([x for x in use if x != m]) for m in use}
    for t in sorted(set(theme_of[m] for m in use)):
        runs[f"without the theme {t}"] = groups([x for x in use if theme_of[x] != t])
    multi = [m for m in use if len(series[m]) > 1]
    for src in sorted(set(m.split(".")[0] for m in multi)):
        runs[f"{src} one period back"] = groups(use, {m: 1 for m in multi if m.startswith(src + ".")})
    runs["every source one period back"] = groups(use, {m: 1 for m in multi})
    runs["every source two periods back"] = groups(use, {m: 2 for m in multi})
    return ids, names, runs, cat["built"]


def agreement(runs: dict) -> np.ndarray:
    """For every pair of neighbourhoods, the share of reruns that group them together."""
    return np.mean([lab[:, None] == lab[None, :] for lab in runs.values()], axis=0)


def cut(co: np.ndarray, k: int, names: list) -> np.ndarray:
    """Kinds 1 to k from the agreement, largest first (ties by the first member's name)."""
    n = len(co)
    lab = fcluster(linkage(1 - co[np.triu_indices(n, 1)], method="average"), k, "maxclust")
    order = sorted(set(lab), key=lambda c: (-(lab == c).sum(), min(names[i] for i in np.where(lab == c)[0])))
    return np.array([order.index(c) + 1 for c in lab])


def hold(co: np.ndarray, kind: np.ndarray) -> tuple[dict, np.ndarray]:
    """Each kind's `together` (mean agreement between its members) and each member's `attached`."""
    together, attached = {}, np.ones(len(kind))
    for c in sorted(set(kind)):
        mem = np.where(kind == c)[0]
        inside = co[np.ix_(mem, mem)]
        together[int(c)] = float(inside[np.triu_indices(len(mem), 1)].mean()) if len(mem) > 1 else 1.0
        if len(mem) > 1:
            attached[mem] = (inside.sum(1) - 1) / (len(mem) - 1)
    return together, attached


def table(co, kind, names, label=None) -> None:
    together, attached = hold(co, kind)
    for c in sorted(set(kind)):
        mem = np.where(kind == c)[0]
        best = [names[i] for i in mem[np.argsort(-attached[mem])][:5]]
        print(f"  {c:2d}  {len(mem):3d}  together {together[int(c)]:4.0%}{'  loose' if together[int(c)] < LOOSE_UNDER else '       '}  "
              f"{(label or {}).get(int(c), '')[:34]:34}  {', '.join(best)}")


def main() -> int:
    recut = "--recut" in sys.argv[1:]
    ids, names, runs, built = reruns()
    co = agreement(runs)
    kinds_csv, names_json, manifest = OUT / "kinds.csv", OUT / "names.json", OUT / "manifest.json"
    print(f"{len(runs)} reruns on the Explorer's figures built {built}")
    if kinds_csv.exists() and not recut:
        lock = pd.read_csv(kinds_csv).set_index("nbhd_id").kind.reindex(ids)
        if lock.isna().any():
            sys.exit(f"{int(lock.isna().sum())} neighbourhoods have no kind in {kinds_csv}")
        was = json.loads(manifest.read_text())
        label = {int(k): v["name"] for k, v in json.loads(names_json.read_text()).items()}
        print(f"The kinds locked on {was['cut']}, on today's data:")
        table(co, lock.to_numpy().astype(int), names, label)
        now, _ = hold(co, lock.to_numpy().astype(int))
        slipped = [f"{label[c]} ({was['kinds'][str(c)]['together']:.0%} to {v:.0%})" for c, v in now.items() if v < was["kinds"][str(c)]["together"] - 0.15]
        print("Holding as when they were cut." if not slipped else "Holding less well than when cut: " + "; ".join(slipped))
        print(f"Nothing written. To cut them again (after {was['recut_after']}): python pipeline/kinds.py --recut")
        return 0

    for k in range(K - 2, K + 4):
        kind = cut(co, k, names)
        together, attached = hold(co, kind)
        sizes = sorted(Counter(kind).values(), reverse=True)
        print(f"{k:2d} kinds: sizes {sizes}; holding in {LOOSE_UNDER:.0%}+ of reruns: {sum(v >= LOOSE_UNDER for v in together.values())}; "
              f"neighbourhoods attached in {LOOSE_UNDER:.0%}+: {(attached >= LOOSE_UNDER).sum()}")
    kind = cut(co, K, names)
    together, attached = hold(co, kind)
    print(f"\nCut at {K}:")
    table(co, kind, names)
    OUT.mkdir(exist_ok=True)
    pd.DataFrame({"nbhd_id": ids, "nbhd": names, "kind": kind, "attached": np.round(attached, 3)}).to_csv(kinds_csv, index=False, lineterminator="\n")
    manifest.write_text(json.dumps({
        "cut": pd.Timestamp.today().date().isoformat(), "explorer_built": built, "reruns": len(runs),
        "method": f"average-linkage clusters of how often two neighbourhoods share a group over the reruns (each Ward's method, {EACH_K} groups), cut at {K}",
        "recut_after": "the 2026 Census is fully released (scheduled for 1 December 2027)",
        "kinds": {str(c): {"n": int((kind == c).sum()), "together": round(v, 3)} for c, v in together.items()},
    }, indent=2) + "\n")
    names_json.write_text(json.dumps({str(c): {"name": "", "blurb": "", "most_attached": [names[i] for i in np.where(kind == c)[0][np.argsort(-attached[kind == c])][:6]]}
                                      for c in sorted(set(kind))}, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {OUT}. Now write each kind's name and blurb in {names_json}, then python pipeline/affinity.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
