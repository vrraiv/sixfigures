"""The locked kinds of neighbourhood (kinds.py, pipeline/kinds/): the lock is whole, every
kind is named, and the page's file carries the lock and nothing else.

    python -m unittest discover -s pipeline/tests
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE))
import kinds  # noqa: E402

LOCK = PIPELINE / "kinds"
WEB = PIPELINE.parent / "web" / "public"


class TheLock(unittest.TestCase):
    def setUp(self):
        self.lock = pd.read_csv(LOCK / "kinds.csv")
        self.names = json.loads((LOCK / "names.json").read_text(encoding="utf-8"))
        self.manifest = json.loads((LOCK / "manifest.json").read_text())

    def test_every_neighbourhood_has_one_kind(self):
        ids = [n["id"] for n in json.loads((WEB / "insights.json").read_text())["nbhd"]]
        self.assertEqual(sorted(self.lock.nbhd_id), sorted(ids))
        self.assertEqual(sorted(self.lock.kind.unique()), list(range(1, kinds.K + 1)))

    def test_every_kind_has_a_name_and_a_blurb_and_no_two_share_a_name(self):
        for k in range(1, kinds.K + 1):
            self.assertTrue(self.names[str(k)]["name"] and self.names[str(k)]["blurb"], f"kind {k}")
        self.assertEqual(len({v["name"] for v in self.names.values()}), kinds.K)

    def test_the_manifest_counts_the_kinds_members(self):
        for k, v in self.manifest["kinds"].items():
            self.assertEqual(v["n"], int((self.lock.kind == int(k)).sum()))

    def test_the_table_of_runs_with_each_kind_is_from_the_same_cut(self):
        g = pd.read_csv(LOCK / "grouped.csv")
        self.assertEqual(list(g.nbhd_id), list(self.lock.nbhd_id))
        self.assertEqual(list(g.columns[2:]), [f"with_{k}" for k in range(1, kinds.K + 1)])
        own = g[[f"with_{k}" for k in range(1, kinds.K + 1)]].to_numpy()[np.arange(len(g)), self.lock.kind - 1]
        self.assertTrue(np.allclose(own, self.lock.attached, atol=0.0005))  # with its own kind: `attached`

    def test_the_page_carries_the_lock(self):
        page = json.loads((WEB / "neighbourhoods.json").read_text())
        by_id = self.lock.set_index("nbhd_id").kind
        for n, t in zip(page["nbhd"], page["type"]):
            self.assertEqual(page["types"][t]["name"], self.names[str(by_id[n["id"]])]["name"], n["name"])


class Cutting(unittest.TestCase):
    def test_groups_that_always_agree_are_the_kinds_largest_first(self):
        a = np.array([1, 1, 1, 2, 2, 3])
        co = kinds.agreement({"x": a, "y": a})
        got = kinds.cut(co, 3, list("abcdef"))
        self.assertEqual(list(got), [1, 1, 1, 2, 2, 3])
        together, attached = kinds.hold(co, got)
        self.assertEqual(together, {1: 1.0, 2: 1.0, 3: 1.0})
        self.assertTrue((attached == 1).all())

    def test_a_member_the_runs_disagree_about_is_less_attached(self):
        runs = {"x": np.array([1, 1, 1, 2, 2]), "y": np.array([1, 1, 2, 2, 2])}
        co = kinds.agreement(runs)
        _, attached = kinds.hold(co, np.array([1, 1, 1, 2, 2]))
        self.assertEqual(attached[0], 0.75)  # with the second always, the third half the time
        self.assertEqual(attached[2], 0.5)

    def test_grouped_is_the_mean_agreement_with_each_kinds_members_itself_left_out(self):
        runs = {"x": np.array([1, 1, 1, 2, 2]), "y": np.array([1, 1, 2, 2, 2])}
        kind = np.array([1, 1, 1, 2, 2])
        co = kinds.agreement(runs)
        g = kinds.grouped(co, kind)
        _, attached = kinds.hold(co, kind)
        self.assertTrue(np.allclose(g[np.arange(5), kind - 1], attached))
        self.assertEqual(g[2, 1], 0.5)  # the third, with the two of the other kind: half the runs
        self.assertEqual(g[0, 1], 0.0)
        self.assertEqual(g[3, 0], 1 / 6)  # the fourth: with the third in one run of two, never with the others


if __name__ == "__main__":
    unittest.main()
