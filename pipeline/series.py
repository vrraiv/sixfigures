"""Statistics Canada time series for Toronto: pipeline/series/<table>.csv and
pipeline/series/manifest.json.

    python pipeline/series.py

City- and metro-wide annual and monthly series that anchor the forecasts between
censuses (docs/data-sources.md): population, income from tax records, the labour
force, building permits and prices. Read through the Web Data Service, which is
meant for scripts (unlike www12.statcan.gc.ca, it has no bot challenge).

Small tables are downloaded whole (to pipeline/raw, ignored by git) and streamed
for Toronto's rows; the building-permit table is 370 MB whole, so only the series
named below are requested. Geography is matched by its exact member name and the
match printed, never by a substring ("Toronto" alone matches several members).

Every row keeps StatCan's STATUS and SYMBOL (estimates are revised and flagged),
and the manifest records each table's title, StatCan's release time and our
retrieval date, so a later pull can be told apart from this one.
"""
import csv
import datetime
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "series"
WDS = "https://www150.statcan.gc.ca/t1/wds/rest/"
UA = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}

# table -> (exact geography member, how to fetch, what it is for)
# 11-10-0239's dollars are constant dollars of its latest year (2024 in the
# 2026-04 release), not as published: the manifest records the unit.
TABLES = {
    "17-10-0155": ("Toronto (C), Ontario", "full", "Population estimates, July 1, City of Toronto (CSD, 2021 boundaries)"),
    "11-10-0239": ("Toronto, Ontario", "full", "Income of individuals from the T1 Family File, Toronto CMA"),
    "14-10-0459": ("Toronto, Ontario", "full", "Labour force, three-month moving average, Toronto CMA"),
    "18-10-0005": ("Toronto, Ontario", "full", "Consumer price index, annual average, Toronto"),
    "34-10-0292": ("Toronto, Ontario", "series", "Building permits, Toronto CMA (City-level permits come from the City's data)"),
}
# Rows kept from whole tables: column -> allowed values (the rest is detail
# the anchors don't need, and would make the committed files large).
KEEP = {
    "11-10-0239": {"Age group": {"15 years and over"}, "Gender": {"Total - Gender"}},
    "14-10-0459": {"Statistics": {"Estimate"}},
}
# Building permits: the series requested (dimension -> member names); unadjusted, current dollars.
PERMITS = {
    "Type of building": ["Total residential", "Single total", "Multiple dwelling building total"],
    "Type of work": ["Types of work, total", "New dwelling units total"],
    "Variables": ["Value of permits", "Number of dwelling-units created", "Number of dwelling-units lost", "Number of permits"],
    "Seasonal adjustment, value type": ["Unadjusted, current"],
}


def post(method: str, body) -> dict:
    req = urllib.request.Request(WDS + method, data=json.dumps(body).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        [res] = json.load(r)
    if res.get("status") != "SUCCESS":
        raise RuntimeError(f"WDS {method}: {res.get('object', res)}")
    return res["object"]


def get(method: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(WDS + method, headers=UA), timeout=120) as r:
        return json.load(r)


def pid(table: str) -> int:
    return int(table.replace("-", ""))


def full_table(table: str, geo: str, meta: dict) -> list[dict]:
    """Toronto's rows of a whole-table CSV, streamed from its zip."""
    z = RAW / f"{pid(table)}-eng.zip"
    url = get(f"getFullTableDownloadCSV/{pid(table)}/en")["object"]
    print(f"  downloading {url}")
    urllib.request.urlretrieve(url, z)
    rows, dguids = [], set()
    with zipfile.ZipFile(z) as f, f.open(f"{pid(table)}.csv") as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        for r in reader:
            if r["GEO"] == geo and all(r[c] in ok for c, ok in KEEP.get(table, {}).items()):
                dguids.add(r.get("DGUID", ""))
                rows.append(r)
    if not rows:
        sys.exit(f"{table}: no rows for {geo!r}")
    print(f"  {geo!r}: {len(rows):,} rows, DGUID {sorted(dguids)}")
    return rows


def requested_series(table: str, geo: str, meta: dict) -> list[dict]:
    """Only the PERMITS series, by coordinate, monthly from the table's start."""
    dims = meta["dimension"]
    names = {d["dimensionPositionId"]: d["dimensionNameEn"] for d in dims}
    geo_id = next(m["memberId"] for m in dims[0]["member"] if m["memberNameEn"] == geo)
    print(f"  {geo!r}: member {geo_id}")
    choices = [[(m["memberId"], m["memberNameEn"]) for m in d["member"] if m["memberNameEn"] in PERMITS[d["dimensionNameEn"]]] for d in dims[1:]]
    for d, c in zip(dims[1:], choices):
        if len(c) != len(PERMITS[d["dimensionNameEn"]]):
            sys.exit(f"{table}: {d['dimensionNameEn']} has {[n for _, n in c]}, wanted {PERMITS[d['dimensionNameEn']]}")
    combos = [[]]
    for c in choices:
        combos = [k + [m] for k in combos for m in c]
    n_months = (datetime.date.today().year - int(meta["cubeStartDate"][:4]) + 1) * 12
    rows, missing = [], 0
    for combo in combos:
        coord = ".".join([str(geo_id)] + [str(m) for m, _ in combo] + ["0"] * (10 - 1 - len(combo)))
        try:
            data = post("getDataFromCubePidCoordAndLatestNPeriods", [{"productId": pid(table), "coordinate": coord, "latestN": n_months}])
        except RuntimeError:
            missing += 1
            continue
        for p in data["vectorDataPoint"]:
            rows.append({"REF_DATE": p["refPer"][:7], "GEO": geo,
                         **{names[k + 2]: n for k, (_, n) in enumerate(combo)},
                         "VALUE": p["value"], "STATUS": p.get("statusCode", ""), "SYMBOL": p.get("symbolCode", ""),
                         "VECTOR": f"v{data['vectorId']}"})
    print(f"  {len(combos) - missing} of {len(combos)} series exist; {len(rows):,} rows")
    return rows


def main() -> int:
    RAW.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    manifest = {"retrieved": datetime.date.today().isoformat(), "tables": {}}
    for table, (geo, how, about) in TABLES.items():
        meta = post("getCubeMetadata", [{"productId": pid(table)}])
        print(f"{table} {meta['cubeTitleEn']} (released {meta['releaseTime'][:10]})")
        rows = (full_table if how == "full" else requested_series)(table, geo, meta)
        # Drop columns that are the same on every row (except the essentials) to keep files small.
        keep = [c for c in rows[0] if c in ("REF_DATE", "GEO", "VALUE", "STATUS", "SYMBOL") or len({r[c] for r in rows}) > 1]
        path = OUT / f"{table}.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keep, extrasaction="ignore", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        units = sorted({r.get("UOM", "") for r in rows} - {""})
        manifest["tables"][table] = {"title": meta["cubeTitleEn"], "about": about, "geography": geo, "units": units,
                                     "kept": {c: sorted(v) for c, v in KEEP.get(table, {}).items()},
                                     "released": meta["releaseTime"], "rows": len(rows), "file": path.name,
                                     "url": f"https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid={pid(table)}01"}
        print(f"  wrote {path.name} ({path.stat().st_size / 1e3:.0f} kB)\n")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {OUT / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
