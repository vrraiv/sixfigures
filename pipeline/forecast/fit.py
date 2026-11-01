"""The forecast harness's shared pieces: the fitted rungs (ridge regression and
nearest-neighbour analogs), their tuning by cross-validation, and the scores.

Plain numpy, so the harness needs nothing beyond the pipeline's requirements. Every
fit is weighted (schools by enrolment, neighbourhoods by households) and every
tuning split keeps a unit's rows together, so no unit is in both halves.
"""
import numpy as np

ALPHAS = np.logspace(-3, 3, 25)
KS = [5, 10, 20, 40, 80]
FOLDS = 5


def logit(p):
    """A percentage on the logit scale, kept off 0 and 100."""
    p = np.clip(np.asarray(p, dtype=float) / 100, 0.005, 0.995)
    return np.log(p / (1 - p))


def expit(x):
    return 100 / (1 + np.exp(-np.asarray(x, dtype=float)))


class Scaler:
    """Standardise columns on the training rows (weighted); constant columns stay 0."""

    def __init__(self, X, w):
        w = w / w.sum()
        self.mu = w @ X
        sd = np.sqrt(w @ (X - self.mu) ** 2)
        self.sd = np.where(sd > 1e-12, sd, 1.0)

    def __call__(self, X):
        return (X - self.mu) / self.sd


def ridge_fit(X, y, w, alpha):
    """Weighted ridge on standardised columns with an unpenalised intercept. The
    penalty is alpha per unit of weight, so it means the same whatever the row count."""
    sc = Scaler(X, w)
    Z = sc(X)
    wn = w / w.sum()
    ym = wn @ y
    A = Z.T @ (Z * wn[:, None]) + alpha * np.eye(Z.shape[1])
    b = np.linalg.solve(A, Z.T @ (wn * (y - ym)))
    return lambda Xn: ym + sc(Xn) @ b


def knn_fit(X, y, w, k):
    """The weighted mean of the k training rows nearest on standardised columns."""
    sc = Scaler(X, w)
    Z = sc(X)
    k = min(k, len(y))

    def predict(Xn):
        Zn = sc(Xn)
        d = ((Zn[:, None, :] - Z[None, :, :]) ** 2).sum(axis=2)
        idx = np.argpartition(d, k - 1, axis=1)[:, :k]
        ww = w[idx]
        return (ww * y[idx]).sum(axis=1) / ww.sum(axis=1)
    return predict


def group_folds(groups, n=FOLDS, seed=0):
    """Fold numbers by group (school or neighbourhood), fixed by the seed."""
    u = np.unique(groups)
    rng = np.random.default_rng(seed)
    f = dict(zip(u, rng.permutation(len(u)) % n))
    return np.array([f[g] for g in groups])


def tune(make, grid, X, y, w, groups):
    """The grid value with the lowest weighted mean absolute error across group folds,
    and the model refitted on all the training rows with it."""
    folds = group_folds(groups)
    errs = []
    for g in grid:
        e = 0.0
        for f in range(FOLDS):
            tr, te = folds != f, folds == f
            p = make(X[tr], y[tr], w[tr], g)(X[te])
            e += (w[te] * np.abs(p - y[te])).sum()
        errs.append(e / w.sum())
    best = grid[int(np.argmin(errs))]
    return best, make(X, y, w, best)


def wmae(pred, actual, w):
    return float((w * np.abs(pred - actual)).sum() / w.sum())


def spearman(a, b):
    """Spearman's rho (average ranks for ties)."""
    def rank(x):
        o = np.argsort(x, kind="mergesort")
        r = np.empty(len(x))
        r[o] = np.arange(len(x))
        xs = x[o]
        i = 0
        while i < len(xs):
            j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[i]:
                j += 1
            r[o[i:j + 1]] = (i + j) / 2
            i = j + 1
        return r
    a, b = np.asarray(a, float), np.asarray(b, float)
    if np.std(a) == 0 or np.std(b) == 0:
        return float("nan")
    return float(np.corrcoef(rank(a), rank(b))[0, 1])


# Rungs up to ridge; the rest (analogs, later boosting) must clear the higher bar.
SIMPLE = {"persistence", "own_mean", "trend", "ridge"}


def choose(mae: dict, rungs: list) -> str:
    """The decision rule. Walk the rungs in order; a rung replaces the one chosen so far
    if its MAE is lower in every fold both have; past ridge, also only if its mean
    improvement is larger than the improvements' spread (largest less smallest) across
    those folds. mae is {rung: [MAE by fold]}, NaN where a rung has no fold."""
    chosen = rungs[0]
    for r in rungs[1:]:
        if r not in mae:
            continue
        d = [a - b for a, b in zip(mae[chosen], mae[r]) if not (np.isnan(a) or np.isnan(b))]
        if not d or min(d) <= 0:
            continue
        if r in SIMPLE or np.mean(d) > max(d) - min(d):
            chosen = r
    return chosen


def self_check():
    """Ridge with no penalty is weighted least squares; spearman matches a known case."""
    rng = np.random.default_rng(1)
    X = rng.normal(size=(200, 3))
    w = rng.uniform(0.5, 2, 200)
    y = X @ [1.0, -2.0, 0.5] + 3 + rng.normal(scale=0.1, size=200)
    A = np.c_[np.ones(200), X]
    W = np.sqrt(w)[:, None]
    ols = np.linalg.lstsq(A * W, y * W[:, 0], rcond=None)[0]
    p = ridge_fit(X, y, w, 0.0)(X)
    assert np.allclose(p, A @ ols, atol=1e-8), "ridge(0) != weighted least squares"
    assert abs(spearman([1, 2, 3, 4], [10, 20, 30, 25]) - 0.8) < 1e-12, "spearman"
    assert np.allclose(knn_fit(X, y, w, 1)(X), y), "1-nearest neighbour of a training row is itself"
    m = {"persistence": [10, 10], "ridge": [9, 9.9], "knn": [8.5, 9.0]}
    assert choose(m, ["persistence", "ridge", "knn"]) == "knn", "knn: gains 0.5, 0.9 > spread 0.4"
    m["knn"] = [8.0, 9.8]
    assert choose(m, ["persistence", "ridge", "knn"]) == "ridge", "knn: gains 1.0, 0.1 < spread 0.9"
