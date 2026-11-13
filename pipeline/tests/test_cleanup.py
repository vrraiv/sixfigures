"""What the profiles print in place of a suppression marker must not reach the site
as a figure: a dollar value of $0, a percentage above 100.

    python -m unittest discover -s pipeline/tests
"""
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import exports  # noqa: E402
from measures import MEASURES, MONEY, null_unpublished  # noqa: E402


class NullUnpublished(unittest.TestCase):
    def test_every_dollar_figure_of_zero_is_nulled(self):
        wide = pd.DataFrame({m: [0.0, 50000.0] for m in MONEY})
        out = null_unpublished(wide)
        for m in MONEY:
            self.assertTrue(pd.isna(out[m][0]), m)
            self.assertEqual(out[m][1], 50000.0, m)

    def test_average_income_of_zero_beside_a_median(self):
        # 2016 DA 35202629: median household income $319,488, average published as $0
        out = null_unpublished(pd.DataFrame({"med_hh_tot": [319488.0], "avg_hh_tot": [0.0]}))
        self.assertTrue(pd.isna(out.avg_hh_tot[0]))
        self.assertEqual(out.med_hh_tot[0], 319488.0)

    def test_published_percentage_above_100_is_nulled(self):
        out = null_unpublished(pd.DataFrame({"tenant30": [120.0, 100.0, 0.0]}))
        self.assertTrue(pd.isna(out.tenant30[0]))
        self.assertEqual(out.tenant30.tolist()[1:], [100.0, 0.0])

    def test_shares_computed_here_are_left_alone(self):
        # derive_shares caps its own shares at 100; only published percentages are checked
        wide = pd.DataFrame({"renter": [101.0], "tenant30": [101.0]})
        out = null_unpublished(wide, shares={"renter": ("n_renter", "n_tenure", "Renter households")})
        self.assertEqual(out.renter[0], 101.0)
        self.assertTrue(pd.isna(out.tenant30[0]))

    def test_counts_and_other_columns_pass_through(self):
        wide = pd.DataFrame({"n_renter": [0.0], "pop": [0.0], "rent": [0.0]})
        out = null_unpublished(wide)
        self.assertEqual(out.n_renter[0], 0.0)
        self.assertEqual(out["pop"][0], 0.0)
        self.assertTrue(pd.isna(out.rent[0]))


class BoundaryFlag(unittest.TestCase):
    def test_same_boundary_columns_are_one_or_zero(self):
        base = {"dauid": ["35200001", "35200002", "35200003"], "nbhd_id": [1, 1, 2], "nbhd": ["A", "A", "B"], "nbhd2": [None, None, None], "hh": [100, 100, 100]}
        cols = {}
        for m in MEASURES:
            cols.update({m: [1.0, 2.0, 3.0], f"pct_{m}": [1, 50, 100], f"v16_{m}": [1.0, None, None], f"p16_{m}": [1, None, None]})
        # rel on the 2021 table is the correspondence flag: 1 the same DA, 3 and 4 redrawn
        gdf = pd.DataFrame({**base, "pop21": [300, 300, 300], "rel": [1, 3, 4], **cols})
        g16 = pd.DataFrame({**base, "pop16": [300, 300, 300], "rel": [1, 0, 0], **{k: v for k, v in cols.items() if not k.startswith(("v16_", "p16_"))}})
        with tempfile.TemporaryDirectory() as d:
            exports.write_csvs(gdf, g16, out=Path(d))
            d21 = pd.read_csv(Path(d) / "toronto_da_income_2021.csv")
            d16 = pd.read_csv(Path(d) / "toronto_da_income_2016.csv")
        self.assertEqual(d21.same_boundary_2016.tolist(), [1, 0, 0])
        self.assertEqual(d16.same_boundary_2021.tolist(), [1, 0, 0])


if __name__ == "__main__":
    unittest.main()
