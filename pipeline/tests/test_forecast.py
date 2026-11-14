"""The school forecasts' centring (forecast/schools.py): later live forecasts imply no change in
the City's level, and the two already published are left as they are.

    python -m unittest discover -s pipeline/tests
"""
import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np

PIPELINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE))
sys.path.insert(0, str(PIPELINE / "forecast"))

try:  # the forecast scripts need lightgbm; without it there is nothing to test here
    spec = importlib.util.spec_from_file_location("forecast_schools", PIPELINE / "forecast" / "schools.py")
    schools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(schools)
except ImportError as e:  # pragma: no cover
    schools, missing = None, str(e)


@unittest.skipIf(schools is None, "the forecast scripts' packages aren't installed")
class Centred(unittest.TestCase):
    def test_the_set_implies_no_change_and_keeps_its_order(self):
        rng = np.random.default_rng(3)
        score0 = rng.uniform(20, 95, 400)
        pred = np.clip(score0 + rng.normal(1.5, 6, 400), 1, 99)  # lifted by 1.5 on average
        w = rng.uniform(20, 120, 400)
        out = schools.centred(pred, score0, w)
        self.assertAlmostEqual(np.average(out, weights=w), np.average(score0, weights=w), places=6)
        self.assertTrue((np.argsort(out) == np.argsort(pred)).all())
        self.assertTrue(((out > 0) & (out < 100)).all())
        self.assertLess(np.average(out, weights=w), np.average(pred, weights=w))

    def test_forecasts_already_at_the_mean_are_left_where_they_are(self):
        score0, w = np.array([40.0, 60.0, 80.0]), np.array([1.0, 1.0, 1.0])
        pred = np.array([45.0, 60.0, 75.0])  # same mean
        np.testing.assert_allclose(schools.centred(pred, score0, w), pred, atol=1e-6)

    def test_the_published_forecasts_are_not_centred(self):
        self.assertTrue(all(o < schools.CENTRED_FROM for o in schools.LIVE_ORIGINS))


if __name__ == "__main__":
    unittest.main()
