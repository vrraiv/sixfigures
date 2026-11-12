"""Refresh the site's data from its scripted sources, and rebuild only what changed.

    python pipeline/data_refresh.py prices rentals          # the quarterly run
    python pipeline/data_refresh.py prices rentals safety   # March: the police's year too
    python pipeline/data_refresh.py safety --report report.md

The scheduled GitHub Actions workflow (.github/workflows/data-refresh.yml) runs this
and opens a pull request with what it changed; `make refresh-quarterly` and
`make refresh-safety` run it by hand. docs/data-catalogue.md has the schedule.

The parts (each downloads its inputs, then rebuilds its committed outputs):

  prices   TRREB's community reports for quarters after the last in
           pipeline/trreb/community.csv (download.py --trreb, trreb.py --new)
  rentals  any newer Inside Airbnb scrape, the City's short-term rental
           registrations, address points and wards (download.py --insideairbnb,
           --toronto; rentals.py)
  safety   the five police and collision files (download.py --toronto; crime.py)

A part counts as changed when its data does (each part's "data" below), not just its
manifest's retrieval dates: an unchanged part is put back as it was, so a run with
nothing new leaves no diff. For rentals that means a new scrape. The pages that read a changed part are then rebuilt, in order
(price_insights.py, safety_insights.py, trees_insights.py), and after them the two
explorers (explorer_data.py, affinity.py).

--report writes a Markdown summary: what is new in each part, the pages rebuilt,
anything to check before merging, and the files changed. In GitHub Actions it also
sets the step outputs `changed` (true or false) and `title`.

Everything else in the catalogue (housing, schools, trees, the census) needs files
that can't be fetched by script (Statistics Canada's census files, EQAO's results)
or a decision, so it stays a manual run.
"""
import argparse
import datetime as dt
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
ROOT = HERE.parent
PY = sys.executable

CRIME_FILES = ["toronto_neighbourhood_crime_rates_4326.csv", "toronto_community_safety_indicators.csv",
               "toronto_shootings_4326.csv", "toronto_homicides_4326.csv", "toronto_ksi_4326.csv"]
PARTS = {
    "prices": {
        "label": "Sale prices (TRREB)",
        "fetch": [["download.py", "--trreb"]],
        "build": [["trreb.py", "--new"]],
        "dir": "pipeline/trreb",
        "data": ["pipeline/trreb/community.csv"],
        "pages": ["price_insights.py", "safety_insights.py", "trees_insights.py"],
    },
    "rentals": {
        "label": "Short-term rentals (Inside Airbnb, City registrations)",
        "fetch": [["download.py", "--toronto", "toronto_address_points_4326.csv", "toronto_wards_4326.geojson",
                   "toronto_str_registrations.csv", "--fresh"],
                  ["download.py", "--insideairbnb"]],
        "build": [["rentals.py"]],
        "dir": "pipeline/rentals",
        # A new scrape. by_nbhd.csv also moves with the City's registry every day (its licence_*
        # columns match listings against it), but the pages don't use those: they wait for the
        # next scrape, so a run without one makes no pull request.
        "data": ["pipeline/rentals/snapshots.json"],
        "pages": ["safety_insights.py", "trees_insights.py"],
    },
    "safety": {
        "label": "Safety (police, KSI collisions)",
        "fetch": [["download.py", "--toronto", *CRIME_FILES, "--fresh"]],
        "build": [["crime.py"]],
        "dir": "pipeline/crime",
        "data": ["pipeline/crime/by_nbhd.csv", "pipeline/crime/rates.csv", "pipeline/crime/population.csv"],
        "pages": ["safety_insights.py", "trees_insights.py"],
    },
}
PAGE_ORDER = ["price_insights.py", "safety_insights.py", "trees_insights.py"]
EXPLORERS = ["explorer_data.py", "affinity.py"]
# every run: the neighbourhood outlines the page scripts draw (school_insights.paths)
COMMON = [["download.py", "--toronto", "toronto_neighbourhoods_4326.geojson"]]


def run(script: list[str]) -> str:
    """Run a pipeline script, echoing and returning its output; stop the refresh if it fails."""
    print(f"\n$ python pipeline/{' '.join(script)}", flush=True)
    p = subprocess.run([PY, str(HERE / script[0]), *script[1:]], cwd=ROOT, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(p.stdout, end="", flush=True)
    if p.returncode:
        sys.exit(f"pipeline/{script[0]} failed (exit {p.returncode})")
    return p.stdout


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=check)


def changed(paths: list[str]) -> bool:
    """Whether any of these committed files differs from HEAD."""
    return git("diff", "--quiet", "HEAD", "--", *paths, check=False).returncode != 0


def at_head(path: str) -> str | None:
    p = git("show", f"HEAD:{path}", check=False)
    return p.stdout if p.returncode == 0 else None


# ---- what is new in each part, for the report ------------------------------------------------------------
def quarters(text: str | None) -> str:
    if not text:
        return "none"
    d = pd.read_csv(io.StringIO(text))
    y = d.year.max()
    return f"{d.year.min()} to {y} Q{d[d.year == y].q.max()}"


def news_prices() -> tuple[str, str]:
    return quarters(at_head("pipeline/trreb/community.csv")), quarters((ROOT / "pipeline/trreb/community.csv").read_text())


def news_rentals() -> tuple[str, str]:
    def show(text):
        s = json.loads(text)["snapshots"] if text else []
        return f"{len(s)} scrapes, the latest {s[-1]}" if s else "none"
    return show(at_head("pipeline/rentals/snapshots.json")), show((ROOT / "pipeline/rentals/snapshots.json").read_text())


def news_safety() -> tuple[str, str]:
    def show(text):
        if not text:
            return "none"
        m = json.loads(text)
        last = min(c["years_complete"][1] for c in m["categories"].values())
        got = max(f["retrieved"] for f in m["files"].values())
        return f"complete years to {last}, retrieved {got}"
    return show(at_head("pipeline/crime/manifest.json")), show((ROOT / "pipeline/crime/manifest.json").read_text())


NEWS = {"prices": news_prices, "rentals": news_rentals, "safety": news_safety}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("parts", nargs="+", choices=list(PARTS), help="what to refresh")
    ap.add_argument("--report", type=Path, help="write a Markdown summary here")
    args = ap.parse_args()
    if git("status", "--porcelain", "--", *[PARTS[p]["dir"] for p in args.parts], "web/public").stdout.strip():
        sys.exit("pipeline/ or web/public has uncommitted changes in what this refresh writes: commit or stash them first")

    for step in COMMON:
        run(step)
    done = {}
    for name in args.parts:
        part = PARTS[name]
        for step in part["fetch"] + part["build"]:
            run(step)
        done[name] = changed(part["data"])
        if not done[name]:  # nothing new: drop the retrieval-date-only changes
            git("checkout", "HEAD", "--", part["dir"])
            git("clean", "-fdq", "--", part["dir"])
        print(f"\n{name}: {'changed' if done[name] else 'nothing new'}", flush=True)

    pages = [p for p in PAGE_ORDER if any(done[n] and p in PARTS[n]["pages"] for n in done)]
    notes = []
    if pages:
        for page in pages + EXPLORERS:
            out = run([page])
            notes += [line.strip() for line in out.splitlines() if "no name for the type" in line]

    any_change = any(done.values())
    today = dt.date.today().isoformat()
    title = f"Data refresh {today}: " + (", ".join(PARTS[n]["label"].split(" (")[0].lower() for n in done if done[n]) or "nothing new")
    if args.report:
        rows = []
        for n in args.parts:
            before, after = NEWS[n]()
            rows.append(f"| {PARTS[n]['label']} | {before} | {after} | {'**changed**' if done[n] else 'nothing new'} |")
        stat = git("diff", "--stat", "HEAD").stdout.strip()
        checks = [
            "The checks in each script's output passed (the run stops on a failed check); the workflow ran `npm test` and `npm run build`.",
            "Look over the changed pages in the preview or locally (`npm run dev`).",
        ]
        if notes:
            checks.insert(0, "**Name the neighbourhood types** whose centre moved, in `pipeline/affinity.py`'s `NAMES`, then rerun it: "
                          + "; ".join(notes))
        args.report.write_text("\n".join([
            f"Scheduled data refresh, {today} (`python pipeline/data_refresh.py {' '.join(args.parts)}`).",
            "",
            "| Part | Before | Now | |",
            "|---|---|---|---|",
            *rows,
            "",
            f"**Pages rebuilt:** {', '.join(p.removesuffix('.py') for p in pages + EXPLORERS)}." if pages else "**Pages rebuilt:** none.",
            "",
            "**Before merging** (merging deploys the site):",
            *[f"- {c}" for c in checks],
            "",
            "Each part's schedule and sources: `docs/data-catalogue.md`.",
            "",
            "<details><summary>Files changed</summary>",
            "",
            "```",
            stat or "(none)",
            "```",
            "",
            "</details>",
            "",
        ]))
        print(f"\nwrote {args.report}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"changed={'true' if any_change else 'false'}\ntitle={title}\n")
    print(f"\n{title}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
