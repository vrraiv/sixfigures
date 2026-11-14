"""The City's tree points (tree_points.py): whose land a point is on, and its height band.

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tree_points as tp  # noqa: E402


class Owners(unittest.TestCase):
    def test_a_point_without_an_owner_is_unlisted(self):
        self.assertEqual(tp.owner_group(None), "unlisted")
        self.assertEqual(tp.owner_group(float("nan")), "unlisted")
        self.assertEqual(tp.owner_group("  "), "unlisted")

    def test_the_first_group_that_fits_wins(self):
        self.assertEqual(tp.owner_group("City of Toronto - Corridor"), "road")
        self.assertEqual(tp.owner_group("Province of Ontario - Corridor"), "road")
        self.assertEqual(tp.owner_group("City of Toronto - Parks, Forestry & Recreation"), "parks")
        # the conservation authority's land is its own group, whichever division manages it
        self.assertEqual(tp.owner_group("Toronto & Region Conservation Authority - Toronto Zoo"), "conservation")
        self.assertEqual(tp.owner_group("City of Toronto - Toronto Water"), "other_public")


class Bands(unittest.TestCase):
    def test_a_height_falls_in_the_band_that_starts_at_or_below_it(self):
        self.assertEqual(tp.band(2), "2 to 5 m")
        self.assertEqual(tp.band(14.99), "10 to 15 m")
        self.assertEqual(tp.band(15), "15 to 20 m")
        self.assertEqual(tp.band(49), "30 m or more")


if __name__ == "__main__":
    unittest.main()
