"""trreb.unligature puts back the letters a report's font drew as one glyph (a NUL in the text).

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import trreb  # noqa: E402

KNOWN = {"Junction Area", "Little Portugal", "Palmerston-Little Italy", "Rustic", "Waterfront Communities-The Island", "Annex"}


class Ligatures(unittest.TestCase):
    def test_a_nul_is_read_as_the_pair_that_makes_a_known_name(self):
        self.assertEqual(trreb.unligature("Junc\x00on Area", KNOWN), "Junction Area")  # ti
        self.assertEqual(trreb.unligature("Li\x00le Portugal", KNOWN), "Little Portugal")  # tt
        self.assertEqual(trreb.unligature("Palmerston-Li\x00le Italy", KNOWN), "Palmerston-Little Italy")
        self.assertEqual(trreb.unligature("Rus\x00c", KNOWN), "Rustic")

    def test_a_name_cut_short_or_with_a_district_suffix_is_still_repaired(self):
        self.assertEqual(trreb.unligature("Waterfront Communi\x00es C1", KNOWN), "Waterfront Communities C1")

    def test_a_name_without_a_nul_or_without_a_known_reading_is_left_alone(self):
        self.assertEqual(trreb.unligature("Annex", KNOWN), "Annex")
        self.assertEqual(trreb.unligature("Nowhere\x00", KNOWN), "Nowhere\x00")


if __name__ == "__main__":
    unittest.main()
