"""The Sixplex experiment: dating homes by the revision that proposed them and keeping whole
months (sixplex.py), and the estimate, its permutation test and whole quarters
(sixplex_insights.py).

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sixplex  # noqa: E402
import sixplex_insights as model  # noqa: E402


def rows(*r):
    return pd.DataFrame(r, columns=["permit", "rev", "applied", "units"]).assign(applied=lambda d: pd.to_datetime(d.applied))


class Proposals(unittest.TestCase):
    def test_a_revision_counts_its_change_when_it_was_made(self):
        # a fourplex applied for in 2024, revised to six homes after the by-law
        ev = sixplex.events(rows(("24 1 BLD", "00", "2024-04-30", 4), ("24 1 BLD", "01", "2026-01-15", 6)))
        self.assertEqual(list(ev.homes), [4, 2])
        self.assertEqual(list(ev.date.dt.year), [2024, 2026])
        self.assertEqual(list(ev.total), [4, 6])
        self.assertEqual(list(ev["first"]), [True, False])

    def test_a_revision_that_leaves_the_homes_alone_is_no_proposal(self):
        ev = sixplex.events(rows(("25 2 BLD", "00", "2025-08-01", 6), ("25 2 BLD", "01", "2025-11-01", 6), ("25 2 BLD", "02", "2026-02-01", 5)))
        self.assertEqual(list(ev.homes), [6, -1])
        self.assertEqual(ev.homes.sum(), 5)

    def test_revisions_are_read_in_order_whatever_the_files_order(self):
        ev = sixplex.events(rows(("24 3 BLD", "01", "2025-09-01", 6), ("24 3 BLD", "00", "2024-03-01", 3)))
        self.assertEqual(list(ev.homes), [3, 3])

    def test_a_permit_whose_first_row_is_a_revision_is_dated_by_its_number(self):
        # a folder a day through March 2024, numbered in order; 24 000255's first application
        # isn't in the files, only a revision made in 2026
        known = [(f"24 {100 + 10 * d:06d} BLD", "00", f"2024-03-{d + 1:02d}", 1) for d in range(30)]
        origin, dating = sixplex.origins(rows(("24 000255 BLD", "01", "2026-02-01", 6), *known))
        self.assertEqual(dating["dated_by_number"], 1)
        self.assertEqual(origin["24 000255 BLD"], pd.Timestamp("2024-03-16"))  # between the 16th's folder and the 17th's
        self.assertEqual(origin["24 000200 BLD"], pd.Timestamp("2024-03-11"))  # its own date
        r = rows(("24 000255 BLD", "01", "2026-02-01", 6)).assign(origin=origin["24 000255 BLD"])
        self.assertEqual(list(sixplex.events(r).date.dt.year), [2024])

    def test_only_whole_months_are_kept(self):
        self.assertEqual(sixplex.whole_months(pd.Timestamp("2026-11-20"), "2026-08"), ["2026-08", "2026-09", "2026-10"])
        self.assertEqual(sixplex.whole_months(pd.Timestamp("2026-11-30"), "2026-10"), ["2026-10"])

    def test_what_counts_as_a_multiplex(self):
        self.assertEqual(sixplex.kind("3+ Unit - Detached", "New Houses", "New Building"), "plex")
        self.assertEqual(sixplex.kind("3+ Unit - Semi-detached", "Small Residential Projects", "Multiple Projects"), "plex")
        self.assertEqual(sixplex.kind("Apartment Building", "New Building", "New Building"), "apartment")
        self.assertIsNone(sixplex.kind("Apartment Building", "Building Additions/Alterations", "Interior Alterations"))
        self.assertEqual(sixplex.kind("Laneway / Rear Yard Suite", "New Houses", "New Laneway / Rear Yard Suite"), "suite")
        self.assertIsNone(sixplex.kind("2 Unit - Detached", "Small Residential Projects", "Second Suite (New)"))
        self.assertIsNone(sixplex.kind("SFD - Detached", "Small Residential Projects", "Addition(s)"))

    def test_the_sixplex_wards_are_the_toronto_and_east_york_district(self):
        self.assertEqual(sixplex.SIX, ["04", "09", "10", "11", "12", "13", "14", "19"])
        self.assertEqual(sixplex.EARLY, ["23"])


class Estimate(unittest.TestCase):
    pre = np.array([100.0, 50, 200, 100, 150, 50])
    treated = np.array([True, True, False, False, False, False])

    def test_no_effect_when_both_groups_grow_alike(self):
        e = model.did(self.pre, self.pre * 1.5, self.treated)
        self.assertAlmostEqual(e["ratio"], 1)
        self.assertAlmostEqual(e["extra"], 0)

    def test_the_extra_homes_are_those_beyond_the_other_wards_pace(self):
        post = self.pre * 1.5
        post[self.treated] *= 2
        e = model.did(self.pre, post, self.treated)
        self.assertAlmostEqual(e["ratio"], 2)
        self.assertAlmostEqual(e["expected"], 225)
        self.assertAlmostEqual(e["extra"], 225)

    def test_a_group_with_no_homes_has_no_ratio(self):
        self.assertIsNone(model.did(np.array([0.0, 5]), np.array([3.0, 5]), np.array([True, False]))["ratio"])
        self.assertIsNone(model.permutation(np.array([0.0, 5, 5]), np.array([3.0, 5, 5]), np.array([True, False, False])))

    def test_every_relabelling_is_tried_and_the_real_one_is_among_them(self):
        picks = model.assignments(6, 2)
        self.assertEqual(len(picks), 15)
        post = self.pre * np.array([3, 3, 1, 1.1, 0.9, 1])  # the two treated wards far ahead
        self.assertAlmostEqual(model.permutation(self.pre, post, self.treated, picks), 1 / 15)
        self.assertAlmostEqual(model.permutation(self.pre, self.pre * 1.5, self.treated, picks), 1)

    def test_the_range_holds_the_estimate(self):
        post = self.pre * np.array([1.4, 1.2, 1, 1.1, 0.9, 1])
        e = model.did(self.pre, post, self.treated)
        lo, hi = model.interval(self.pre, post, self.treated, model.assignments(6, 2), level=0.5)
        self.assertLess(lo, e["ratio"])
        self.assertGreater(hi, e["ratio"])

    def test_the_additive_estimate_is_in_homes_per_ward_and_quarter(self):
        pre, post = np.array([80.0, 80, 40, 40]), np.array([100.0, 100, 30, 30])  # 8 quarters, then 5
        e = model.additive(pre, post, np.array([True, True, False, False]), 8, 5)
        # treated 10 -> 20 a ward a quarter; the others 5 -> 6: 9 more, x 2 wards x 5 quarters
        self.assertAlmostEqual(e["extra"], 90)

    def test_neighbours_are_the_wards_most_alike_before(self):
        first, second = np.array([50.0, 48, 5, 52, 4]), np.array([60.0, 58, 20, 61, 18])
        match = model.neighbours(first, second, np.array([True, False, False, False, False]), k=2)
        self.assertEqual(sorted(match[0]), [1, 3])

    def test_only_whole_quarters_are_kept(self):
        q = model.quarters_of(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
        self.assertEqual(list(q), ["2026 Q2", "2026 Q3"])


if __name__ == "__main__":
    unittest.main()
