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


class MissedRows(unittest.TestCase):
    NBHD = ["Annex", "Casa Loma", "Wychwood", "Niagara", "University"]

    def frame(self, rows):
        import pandas as pd
        return pd.DataFrame(rows, columns=["year", "q", "district", "community"])

    def test_a_community_gone_since_the_quarter_before_is_reported(self):
        before = self.frame([(2026, 2, "C02", "Annex"), (2026, 2, "C02", "Casa Loma"), (2026, 2, "C02", "Wychwood"), (2026, 2, "C01", "Niagara")])
        now = self.frame([(2026, 3, "C02", "Annex"), (2026, 3, "C02", "Wychwood"), (2026, 3, "C01", "Niagara")])
        self.assertEqual(trreb.missed_rows(now, before, [], [(2026, 3)], self.NBHD), ["2026 Q3 C02: Casa Loma"])

    def test_one_listed_without_figures_was_read(self):
        before = self.frame([(2026, 2, "C02", "Annex"), (2026, 2, "C02", "Casa Loma")])
        now = self.frame([(2026, 3, "C02", "Annex")])
        self.assertEqual(trreb.missed_rows(now, before, [(2026, 3, "C02", "Casa Loma")], [(2026, 3)], self.NBHD), [])

    def test_a_whole_district_gone_is_reported_and_a_first_quarter_has_nothing_to_compare(self):
        before = self.frame([(2026, 2, "C01", "Niagara"), (2026, 2, "C01", "University")])
        now = self.frame([(2026, 3, "C02", "Annex")])
        self.assertEqual(trreb.missed_rows(now, before, [], [(2026, 3)], self.NBHD), ["2026 Q3 C01: Niagara", "2026 Q3 C01: University"])
        self.assertEqual(trreb.missed_rows(now, self.frame([]), [], [(2026, 3)], self.NBHD), [])

    def test_the_line_of_a_community_without_figures(self):
        self.assertEqual(trreb.EMPTY.match("The Islands 0 0 0")["name"], "The Islands")
        self.assertEqual(trreb.EMPTY.match("Rustic 2 12 5")["name"], "Rustic")
        self.assertEqual(trreb.EMPTY.match("Humberlea-Pelmo Park W4 1 22 9")["name"], "Humberlea-Pelmo Park W4")
        self.assertIsNone(trreb.EMPTY.match("Weston 16 52 21"))  # more than two sales always has prices
        self.assertIsNone(trreb.EMPTY.match("Community Market Report, 2026 Q3 10"))
        self.assertIsNone(trreb.EMPTY.match("Annex 88 $132,971,125 $1,511,036 $897,500 264 194 94% 47"))


if __name__ == "__main__":
    unittest.main()
