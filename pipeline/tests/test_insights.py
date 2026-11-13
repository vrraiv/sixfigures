"""Neighbourhood figures from DA figures (insights.aggregate): each measure on its own
base, placeholders left out, and every DA taken together reproducing the city's value.

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import insights  # noqa: E402


def das(**cols) -> pd.DataFrame:
    n = len(next(iter(cols.values())))
    base = {"nbhd_id": [1] * n, "pop": [1000.0] * n, "hh": [100.0] * n}
    return pd.DataFrame({**base, **cols}, index=[f"3520{i:04d}" for i in range(n)])


class Transfers(unittest.TestCase):
    """A share of income is weighted by income, not by people."""

    def setUp(self):
        # equal populations; the first DA holds four fifths of the income
        self.wide = insights.income_base(das(avg_hh_tot=[200000.0, 50000.0], transfers=[5.0, 30.0]))

    def test_weighted_by_total_income(self):
        v, cov = insights.aggregate(self.wide, "2021", "transfers")
        self.assertEqual(v[1], 10.0)  # (5 x 20M + 30 x 5M) / 25M; by population it would be 17.5
        self.assertEqual(cov[1], 1.0)

    def test_a_da_without_an_average_income_is_uncovered(self):
        wide = insights.income_base(das(avg_hh_tot=[200000.0, np.nan], transfers=[5.0, 30.0]))
        v, _ = insights.aggregate(wide, "2021", "transfers")
        self.assertEqual(v[1], 5.0)

    def test_all_das_together_reproduce_the_city(self):
        self.assertIsNone(insights.check_city(self.wide, "2021", "transfers", 10.0))
        off = insights.check_city(self.wide, "2021", "transfers", 17.5)
        self.assertIn("transfers", off)


class PlaceholderZeros(unittest.TestCase):
    """A 0% printed beside a withheld median is not a value; a 0% beside a median is."""

    def setUp(self):
        self.wide = das(renters=[100.0, 20.0, 50.0], owners=[0.0, 80.0, 50.0],
                        tenant30=[40.0, 0.0, 0.0], subsidized=[10.0, 0.0, 0.0], rent=[1500.0, np.nan, 1200.0],
                        owner30=[0.0, 0.0, 25.0], own_cost=[np.nan, 1800.0, 2000.0])

    def test_tenant_share_leaves_the_placeholder_out(self):
        v, cov = insights.aggregate(self.wide, "2021", "tenant30")
        self.assertEqual(v[1], 26.7)  # (40 x 100 + 0 x 50) / 150; with the placeholder, 23.5
        self.assertAlmostEqual(cov[1], 150 / 170)

    def test_subsidized_share_keeps_real_zeros(self):
        v, _ = insights.aggregate(self.wide, "2021", "subsidized")
        self.assertEqual(v[1], 6.7)  # (10 x 100 + 0 x 50) / 150

    def test_owner_share_pairs_with_owner_costs(self):
        v, _ = insights.aggregate(self.wide, "2021", "owner30")
        self.assertEqual(v[1], 9.6)  # (0 x 80 + 25 x 50) / 130; the first DA's 0% has no owner cost

    def test_a_neighbourhood_of_placeholders_is_withheld(self):
        wide = das(renters=[100.0, 100.0], owners=[0.0, 0.0], tenant30=[0.0, 0.0], rent=[np.nan, np.nan])
        v, cov = insights.aggregate(wide, "2016", "tenant30")
        self.assertTrue(pd.isna(v[1]))
        self.assertEqual(cov[1], 0.0)

    def test_2006_shares_are_computed_from_counts(self):
        # census2006.py builds tenant30 from counts: a 0 there is a value whatever rent holds
        v, _ = insights.aggregate(self.wide, "2006", "tenant30")
        self.assertEqual(v[1], 23.5)


class CityCheck(unittest.TestCase):
    def test_dollar_figures_use_a_relative_tolerance(self):
        wide = das(avg_hh_tot=[100000.0, 120000.0])
        self.assertIsNone(insights.check_city(wide, "2021", "avg_hh_tot", 112000.0))  # 110,000: 1.8% off
        self.assertIsNotNone(insights.check_city(wide, "2021", "avg_hh_tot", 125000.0))  # 12% off

    def test_a_zero_average_shows_up(self):
        # the six 2016 DAs published at $0 pulled their neighbourhoods' averages down 3 to 5%
        wide = das(avg_hh_tot=[0.0, 120000.0])
        self.assertIsNotNone(insights.check_city(wide, "2016", "avg_hh_tot", 120000.0))


if __name__ == "__main__":
    unittest.main()
