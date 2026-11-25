"""multiplex.size reads a building's number of units from a permit's proposed use or
description, and multiplex.ADDS tells work that adds units from work on a building that
already has them. These rules decide which permits count as 3-4 or 5-6 unit houseplexes.

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import multiplex  # noqa: E402


class Size(unittest.TestCase):
    def test_the_ways_permits_name_a_size(self):
        for text, n in [
            ("Sixplex", 6), ("Fiveplex", 5), ("Fourplex + Garden Suite", 4), ("Tripex", None), ("Triplex", 3),
            ("6 Unit - Detached", 6), ("6-Unit Apartment", 6), ("Six Unit Dwelling", 6), ("Six-Unit Residential", 6),
            ("Multiplex - 6 Units", 6), ("Multi Unit (6 Units)", 6), ("Sfd - 5 Units", 5), ("5 Plex", 5),
            ("Multi-Plex 5-Unit", 5), ("4-plex", 4), ("houseplex with 5 dwelling units", 5),
        ]:
            with self.subTest(text=text):
                self.assertEqual(multiplex.size(text), n)

    def test_a_stated_total_beats_the_units_added(self):
        self.assertEqual(multiplex.size("ADD (1) UNIT FOR A TOTAL OF (5) UNITS IN A HOUSEPLEX"), 5)
        self.assertEqual(multiplex.size("additional dwelling unit at the rear first floor, total (5) units"), 5)
        self.assertEqual(multiplex.size("Proposal to create three additional dwelling units. The building will "
                                        "contain a total of six dwelling units."), 6)

    def test_units_added_are_not_the_size(self):
        self.assertIsNone(multiplex.size("Proposal to add 2 units in the basement"))
        self.assertIsNone(multiplex.size("Proposal for a new unit in the basement"))

    def test_before_and_after_gives_the_after(self):
        self.assertEqual(multiplex.size("convert existing 4 unit dwelling to 5 units residential building"), 5)
        self.assertEqual(multiplex.size("Converting existing twounit house to a six unit building."), 6)

    def test_numbers_that_are_not_unit_counts(self):
        self.assertIsNone(multiplex.size("interior alterations to Unit 1 of the house"))
        self.assertIsNone(multiplex.size("Construct a new 3 storey detached house"))
        self.assertIsNone(multiplex.size(None))
        self.assertIsNone(multiplex.size("  "))


class Adds(unittest.TestCase):
    def test_work_that_adds_units(self):
        for text in ["convert the detached house to a fourplex", "creation of one secondary suite",
                     "Proposal to legalize existing three unit house", "ADDING ADDITIONAL UNIT TO EXISTING 4 UNIT",
                     "basement revised to a new unit", "increase the number of dwelling units"]:
            with self.subTest(text=text):
                self.assertRegex(text, multiplex.ADDS)

    def test_work_on_a_building_that_has_its_units(self):
        for text in ["To rebuild an existing second floor balcony, new basement door to an existing sixplex.",
                     "Proposed basement walkout to existing sixplex."]:
            with self.subTest(text=text):
                self.assertNotRegex(text, multiplex.ADDS)


class Wards(unittest.TestCase):
    def test_the_25_wards_and_the_sixplex_area(self):
        self.assertEqual(len(multiplex.WARDS), 25)
        self.assertLessEqual(multiplex.SIXPLEX_WARDS, set(multiplex.WARDS))
        self.assertEqual(len(multiplex.SIXPLEX_WARDS), 9)


if __name__ == "__main__":
    unittest.main()
