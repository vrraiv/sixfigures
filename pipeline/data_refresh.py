"""Refresh the site's data from its scripted sources, and rebuild only what changed.

    python pipeline/data_refresh.py prices rentals                  # the quarterly run
    python pipeline/data_refresh.py prices rentals safety housing   # March: the year's too
    python pipeline/data_refresh.py housing --report report.md

The scheduled GitHub Actions workflow (.github/workflows/data-refresh.yml) runs this
and opens a pull request with what it changed; `make refresh-quarterly`,
`make refresh-safety` and `make refresh-housing` run it by hand. docs/data-catalogue.md
has the schedule.

The parts (each downloads its inputs, then rebuilds its committed outputs):

  prices   TRREB's community reports for quarters after the last in
           pipeline/trreb/community.csv (download.py --trreb, trreb.py --new)
  rentals  any newer Inside Airbnb scrape, the City's short-term rental
           registrations, address points and wards (download.py --insideairbnb;
           rentals.py)
  safety   the five police and collision files (crime.py)
  housing  building permits, the City's four housing files, CMHC and the StatCan
           series (permits.py, city_layers.py, cmhc.py, series.py). It also needs
           three Statistics Canada files that only download by hand, which the
           repository's `pipeline-inputs` release holds (download.py --inputs;
           scripts/publish-inputs.sh uploads them). Without that release the part is
           skipped, and the others still run.

A part counts as changed when its data does (each part's "data" below), not just its
manifest's retrieval dates: an unchanged part is put back as it was, so a run with
nothing new leaves no diff. For rentals that means a new scrape. The pages that read
a changed part are then rebuilt, in order (price_insights.py, housing_insights.py,
safety_insights.py, trees_insights.py), and after them the two explorers
(explorer_data.py, affinity.py).

The City's files a part reads are fetched fresh once per run ("toronto"), or only if
missing for files that never change ("toronto_once").

--report writes a Markdown summary: what is new in each part, the pages rebuilt,
anything to check before merging, and the files changed. In GitHub Actions it also
sets the step outputs `changed` (true or false) and `title`.

Schools, trees, search and the census stay manual: they need EQAO's results (which
only download by hand) or a decision per edition, or are a project (the census).
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

PARTS = {
    "prices": {
        "label": "Sale prices (TRREB)",
        "fetch": [["download.py", "--trreb"]],
        "build": [["trreb.py", "--new"]],
        "dirs": ["pipeline/trreb"],
        "data": ["pipeline/trreb/community.csv"],
        "pages": ["price_insights.py", "safety_insights.py", "trees_insights.py"],
    },
    "rentals": {
        "label": "Short-term rentals (Inside Airbnb, City registrations)",
        "toronto": ["toronto_address_points_4326.csv", "toronto_wards_4326.geojson", "toronto_str_registrations.csv"],
        "fetch": [["download.py", "--insideairbnb"]],
        "build": [["rentals.py"]],
        "dirs": ["pipeline/rentals"],
        # A new scrape. by_nbhd.csv also moves with the City's registry every day (its licence_*
        # columns match listings against it), but the pages don't use those: they wait for the
        # next scrape, so a run without one makes no pull request.
        "data": ["pipeline/rentals/snapshots.json"],
        "pages": ["safety_insights.py", "trees_insights.py"],
    },
    "safety": {
        "label": "Safety (police, KSI collisions)",
        "toronto": ["toronto_neighbourhood_crime_rates_4326.csv", "toronto_community_safety_indicators.csv",
                    "toronto_shootings_4326.csv", "toronto_homicides_4326.csv", "toronto_ksi_4326.csv"],
        "build": [["crime.py"]],
        "dirs": ["pipeline/crime"],
        "data": ["pipeline/crime/by_nbhd.csv", "pipeline/crime/rates.csv", "pipeline/crime/population.csv"],
        "pages": ["safety_insights.py", "trees_insights.py"],
    },
    "housing": {
        "label": "Housing (City permits and housing files, CMHC, StatCan series)",
        "requires": ["download.py", "--inputs"],
        "toronto": ["toronto_permits_cleared_2017.csv", "toronto_permits_active.csv",
                    "toronto_apartment_buildings.csv", "toronto_rental_demolition.csv",
                    "toronto_development_applications.csv", "toronto_affordable_pipeline_4326.csv",
                    "toronto_address_points_4326.csv"],
        "toronto_once": ["toronto_permits_cleared_2000_2016.csv"],  # closed: never changes
        "fetch": [["download.py", "--cmhc"]],
        "build": [["permits.py"], ["city_layers.py"], ["cmhc.py"], ["series.py"]],
        "dirs": ["pipeline/permits", "pipeline/city", "pipeline/cmhc", "pipeline/series"],
        "data": ["pipeline/permits/by_nbhd.csv", "pipeline/city/*.csv", "pipeline/cmhc/*.csv", "pipeline/series/*.csv"],
        "pages": ["housing_insights.py"],
    },
}
PAGE_ORDER = ["price_insights.py", "housing_insights.py", "safety_insights.py", "trees_insights.py"]
EXPLORERS = ["explorer_data.py", "affinity.py"]
# every run: the neighbourhood outlines the page scripts draw (school_insights.paths)
COMMON_ONCE = ["toronto_neighbourhoods_4326.geojson"]
SETUP = "the `pipeline-inputs` release isn't set up: see docs/data-catalogue.md, \"One-time setup\""


def run(script: list[str], check: bool = True) -> tuple[bool, str]:
    """Run a pipeline script, echoing its output; stop the refresh if it fails (unless not check)."""
    print(f"\n$ python pipeline/{' '.join(script)}", flush=True)
    p = subprocess.run([PY, str(HERE / script[0]), *script[1:]], cwd=ROOT, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(p.stdout, end="", flush=True)
    if p.returncode and check:
        sys.exit(f"pipeline/{script[0]} failed (exit {p.returncode})")
    return p.returncode == 0, p.stdout


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=check)


def changed(paths: list[str]) -> bool:
    """Whether any of these committed files (or pathspecs) differs from HEAD."""
    return git("diff", "--quiet", "HEAD", "--", *paths, check=False).returncode != 0


def at_head(path: str) -> str | None:
    p = git("show", f"HEAD:{path}", check=False)
    return p.stdout if p.returncode == 0 else None


def now(path: str) -> str | None:
    p = ROOT / path
    return p.read_text() if p.exists() else None


# ---- what is new in each part, for the report ------------------------------------------------------------
def news_prices(text: str | None) -> str:
    if not text:
        return "none"
    d = pd.read_csv(io.StringIO(text))
    y = d.year.max()
    return f"{d.year.min()} to {y} Q{d[d.year == y].q.max()}"


def news_rentals(text: str | None) -> str:
    s = json.loads(text)["snapshots"] if text else []
    return f"{len(s)} scrapes, the latest {s[-1]}" if s else "none"


def news_safety(text: str | None) -> str:
    if not text:
        return "none"
    m = json.loads(text)
    last = min(c["years_complete"][1] for c in m["categories"].values())
    got = max(f["retrieved"] for f in m["files"].values())
    return f"complete years to {last}, retrieved {got}"


def news_housing(read) -> str:
    permits, starts, rms = read("pipeline/permits/manifest.json"), read("pipeline/cmhc/starts_monthly.csv"), read("pipeline/cmhc/rms_city.csv")
    if not (permits and starts and rms):
        return "none"
    month = pd.read_csv(io.StringIO(starts)).month.iloc[-1]
    year = pd.read_csv(io.StringIO(rms)).year.max()
    return f"permits retrieved {json.loads(permits)['retrieved']}, starts to {month}, rental survey to October {year}"


NEWS = {
    "prices": lambda read: news_prices(read("pipeline/trreb/community.csv")),
    "rentals": lambda read: news_rentals(read("pipeline/rentals/snapshots.json")),
    "safety": lambda read: news_safety(read("pipeline/crime/manifest.json")),
    "housing": news_housing,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("parts", nargs="+", choices=list(PARTS), help="what to refresh")
    ap.add_argument("--report", type=Path, help="write a Markdown summary here")
    args = ap.parse_args()
    parts = list(dict.fromkeys(args.parts))
    dirs = [d for p in parts for d in PARTS[p]["dirs"]]
    if git("status", "--porcelain", "--", *dirs, "web/public").stdout.strip():
        sys.exit("pipeline/ or web/public has uncommitted changes in what this refresh writes: commit or stash them first")

    # a part whose hand-downloaded inputs aren't there is skipped; the others go on
    skipped = {}
    for name in parts:
        if "requires" in PARTS[name] and not run(PARTS[name]["requires"], check=False)[0]:
            skipped[name] = SETUP
            print(f"\n{name}: skipped ({SETUP})", flush=True)
    todo = [p for p in parts if p not in skipped]

    # the City's files, each once: those that change fetched fresh, the rest only if missing
    fresh = list(dict.fromkeys(f for p in todo for f in PARTS[p].get("toronto", [])))
    once = list(dict.fromkeys(COMMON_ONCE + [f for p in todo for f in PARTS[p].get("toronto_once", [])]))
    run(["download.py", "--toronto", *once])
    if fresh:
        run(["download.py", "--toronto", *fresh, "--fresh"])

    done = {}
    for name in todo:
        part = PARTS[name]
        for step in part.get("fetch", []) + part["build"]:
            run(step)
        done[name] = changed(part["data"])
        if not done[name]:  # nothing new: drop the retrieval-date-only changes
            git("checkout", "HEAD", "--", *part["dirs"])
            git("clean", "-fdq", "--", *part["dirs"])
        print(f"\n{name}: {'changed' if done[name] else 'nothing new'}", flush=True)

    pages = [p for p in PAGE_ORDER if any(done[n] and p in PARTS[n]["pages"] for n in done)]
    notes = []
    if pages:
        for page in pages + EXPLORERS:
            notes += [line.strip() for line in run([page])[1].splitlines() if "no name for the type" in line]

    any_change = any(done.values())
    today = dt.date.today().isoformat()
    title = f"Data refresh {today}: " + (", ".join(PARTS[n]["label"].split(" (")[0].lower() for n in done if done[n]) or "nothing new")
    if args.report:
        rows = []
        for n in parts:
            state = f"skipped: {skipped[n]}" if n in skipped else "**changed**" if done[n] else "nothing new"
            rows.append(f"| {PARTS[n]['label']} | {NEWS[n](at_head)} | {NEWS[n](now)} | {state} |")
        stat = git("diff", "--stat", "HEAD").stdout.strip()
        checks = [
            "The checks in each script's output passed (the run stops on a failed check); the workflow ran `npm test` and `npm run build`.",
            "Look over the changed pages in the preview or locally (`npm run dev`).",
        ]
        if notes:
            checks.insert(0, "**Name the neighbourhood types** whose centre moved, in `pipeline/affinity.py`'s `NAMES`, then rerun it: "
                          + "; ".join(notes))
        args.report.write_text("\n".join([
            f"Scheduled data refresh, {today} (`python pipeline/data_refresh.py {' '.join(parts)}`).",
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
    print(f"\n{title}" + (f" (skipped: {', '.join(skipped)})" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
