"""The extracts kept in the repository stand in for the raw Statistics Canada files
(pipeline/extracts.py): a script uses one that holds what measures.py asks for, whatever the
files' dates, and says what to fetch when it can't.

    python -m unittest discover -s pipeline/tests
"""
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build  # noqa: E402
import census2011  # noqa: E402
import census2016  # noqa: E402
import extracts  # noqa: E402


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args)


class UseTheExtract(unittest.TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.extract = self.dir / "toronto_profile_long.csv"
        self.raw = self.dir / "profile.zip"  # never created: the raw file isn't on this machine

    def write(self, targets):
        rows = [("d", "35200002", "Dissemination area", i, name, "1", "") for i, name in targets]
        pd.DataFrame(rows, columns=["DGUID", "ALT_GEO_CODE", "GEO_LEVEL", "CHARACTERISTIC_ID", "CHARACTERISTIC_NAME",
                                    "C1_COUNT_TOTAL", "SYMBOL"]).to_csv(self.extract, index=False)

    def test_a_complete_extract_is_used_without_the_raw_file(self):
        self.write(build.TARGETS)
        with mock.patch.object(build, "EXTRACT", self.extract), mock.patch.object(build, "PROFILE_ZIP", self.raw):
            long = quiet(build.extract)
        self.assertEqual(len(long), len(build.TARGETS))
        self.assertEqual(long.CHARACTERISTIC_ID.iloc[0], next(iter(build.TARGETS))[0])  # read as text, like the profile

    def test_an_extract_short_of_a_characteristic_asks_for_the_raw_file(self):
        self.write(list(build.TARGETS)[:-1])
        with mock.patch.object(build, "EXTRACT", self.extract), mock.patch.object(build, "PROFILE_ZIP", self.raw):
            with self.assertRaises(SystemExit) as stop:
                quiet(build.extract)
        self.assertIn("doesn't hold every characteristic", str(stop.exception))
        self.assertIn("profile.zip", str(stop.exception))

    def test_no_extract_and_no_raw_file_says_what_to_do(self):
        for module, raw in ((build, "PROFILE_ZIP"), (census2016, "PROFILE_ZIP"), (census2011, "PROFILE_CSV")):
            with mock.patch.object(module, "EXTRACT", self.dir / "absent.csv"), mock.patch.object(module, raw, self.raw):
                with self.assertRaises(SystemExit) as stop:
                    quiet(module.extract)
            self.assertIn("is missing", str(stop.exception), module.__name__)
            self.assertIn("git checkout", str(stop.exception), module.__name__)


class WhereTheyAreKept(unittest.TestCase):
    def test_an_extract_left_in_the_old_cache_is_copied_across(self):
        with tempfile.TemporaryDirectory() as d:
            new, old = Path(d) / "extracts", Path(d) / "out"
            old.mkdir()
            (old / "toronto_nhs_2011.csv").write_text("geo_code\n")
            with mock.patch.object(extracts, "DIR", new), mock.patch.object(extracts, "OLD", old):
                f = quiet(extracts.path, "toronto_nhs_2011.csv")
                self.assertEqual(f, new / "toronto_nhs_2011.csv")
                self.assertEqual(f.read_text(), "geo_code\n")
                self.assertFalse(quiet(extracts.path, "toronto_profile_2006.csv").exists())

    def test_the_scripts_read_and_write_the_kept_copies(self):
        kept = extracts.DIR
        self.assertEqual(build.EXTRACT.parent, kept)
        self.assertEqual(census2016.EXTRACT.parent, kept)
        self.assertEqual(census2011.EXTRACT.parent, kept)
        self.assertEqual(census2011.NHS_CSV.parent, kept)
        # nhs2011.py and profile2006.py import pyivt, so their paths are read from the source
        for script, name in (("nhs2011.py", "toronto_nhs_2011.csv"), ("profile2006.py", "toronto_profile_2006.csv")):
            self.assertIn(f'HERE / "extracts" / "{name}"', (extracts.HERE / script).read_text(), script)


class TheCommittedExtracts(unittest.TestCase):
    """Once they are committed (make extracts): every one is here and loads as the rebuild loads it."""

    def test_they_hold_what_measures_asks_for(self):
        if not any((extracts.DIR / name).exists() for name in extracts.EXTRACTS):
            self.skipTest("pipeline/extracts/ holds no extract yet: run make extracts where they are and commit them")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = extracts.main()
        self.assertEqual(code, 0, out.getvalue()[-2000:])


if __name__ == "__main__":
    unittest.main()
