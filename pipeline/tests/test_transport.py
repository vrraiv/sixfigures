"""Getting around: reading Bike Share's dates and station names (bikeshare.py) and keeping
whole months only (transport.py).

    python -m unittest discover -s pipeline/tests
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bikeshare  # noqa: E402
import transport  # noqa: E402
import ttc  # noqa: E402


class Dates(unittest.TestCase):
    def test_a_quarter_file_names_its_months(self):
        self.assertEqual(bikeshare.months_of("2017 Data/Bikeshare Ridership (2017 Q2).csv", 2017), {4, 5, 6})
        self.assertEqual(bikeshare.months_of("bikeshare-ridership-2022/Bike share ridership 2022-11.csv", 2022), {11})
        self.assertEqual(bikeshare.months_of("bikeshare-ridership-2026.csv", 2026), set(range(1, 13)))

    def test_day_first_and_month_first_are_told_apart_by_the_files_months(self):
        # 2017 Q2 writes 1 April as 1/4/2017; 2018 Q2 writes it 4/1/2018
        day_first = pd.Series(["1/4/2017 0:01", "13/4/2017 9:30", "30/6/2017 23:59"])
        t, fmt = bikeshare.parse_dates(day_first, 2017, {4, 5, 6}, None, "Q2")
        self.assertEqual(fmt, "%d/%m/%Y %H:%M")
        self.assertEqual(list(t.dt.month), [4, 4, 6])
        month_first = pd.Series(["4/1/2018 0:01", "4/13/2018 9:30", "6/30/2018 23:59"])
        t, fmt = bikeshare.parse_dates(month_first, 2018, {4, 5, 6}, None, "Q2")
        self.assertEqual(fmt, "%m/%d/%Y %H:%M")
        self.assertEqual(list(t.dt.day), [1, 13, 30])

    def test_a_file_no_format_reads_stops_the_run(self):
        with self.assertRaises(SystemExit):
            bikeshare.parse_dates(pd.Series(["yesterday", "today"]), 2026, {1}, None, "x.csv")


class Names(unittest.TestCase):
    def test_streets_compare_without_dots_case_or_av(self):
        self.assertEqual(bikeshare.street(" King St. E "), "king st e")
        self.assertEqual(bikeshare.street("Dufferin St / Sylvan Av".split("/")[1]), "sylvan ave")


class WholeMonths(unittest.TestCase):
    def test_a_month_that_stops_early_is_dropped(self):
        days = pd.Series(pd.date_range("2026-06-01", "2026-08-12"))
        kept = days[transport.whole_months(days)]
        self.assertEqual(kept.max(), pd.Timestamp("2026-07-31"))

    def test_a_month_that_runs_to_its_last_day_is_kept(self):
        days = pd.Series(pd.date_range("2026-06-01", "2026-07-31"))
        self.assertTrue(transport.whole_months(days).all())


class SubwayDelays(unittest.TestCase):
    def test_a_station_name_loses_its_line_and_what_follows(self):
        self.assertEqual(ttc.norm("ST GEORGE YUS STATION"), "ST GEORGE")
        self.assertEqual(ttc.norm("KENNEDY BD STATION (APPRO"), "KENNEDY")
        self.assertEqual(ttc.norm("PIONEER VILLAGE STATIO"), "PIONEER VILLAGE")
        self.assertEqual(ttc.norm("APPROACHING KIPLING ST"), "KIPLING ST")
        self.assertEqual(ttc.norm("Bloor-Yonge"), "BLOOR YONGE")

    def test_yonge_is_bloor_yonge_unless_it_is_on_line_4(self):
        self.assertEqual(ttc.norm("YONGE SHP STATION"), "YONGE SHEPPARD")
        self.assertEqual(ttc.STATION_ALIASES[ttc.norm("YONGE BD STATION")], "BLOOR YONGE")

    def test_codes_go_to_their_group(self):
        self.assertEqual(ttc.cause("MUIS"), "Ill or injured customers")
        self.assertEqual(ttc.cause("PUMST"), "Ill or injured customers")  # a fall on the stairs, not the plant
        self.assertEqual(ttc.cause("PUSI"), "Track, signals and power")
        self.assertEqual(ttc.cause("SUUT"), "A person at track level")
        self.assertEqual(ttc.cause("SUDP"), "Security and police")
        self.assertEqual(ttc.cause("EUDO"), "Trains")
        self.assertEqual(ttc.cause("TUNOA"), "Staff and operations")
        self.assertEqual(ttc.cause("XX"), ttc.OTHER)


if __name__ == "__main__":
    unittest.main()
