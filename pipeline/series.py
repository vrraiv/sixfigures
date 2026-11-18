"""Statistics Canada time series for Toronto: pipeline/series/<table>.csv and
pipeline/series/manifest.json.

    python pipeline/series.py

City- and metro-wide annual and monthly series that anchor the forecasts between
censuses (docs/data-sources.md): population, income from tax records, the labour
force, building permits and prices. Read through the Web Data Service (WDS).

Since November 2026 Statistics Canada's Cloudflare refuses scripts a table's whole
download (getFullTableDownloadCSV, and the zips it points to) but still answers the
series calls: table metadata, code sets and data by coordinate. So each table is
read series by series: Toronto's member, the members SELECT names (every member of
a dimension it doesn't name), every combination asked for in a few batched calls,
and the combinations the table doesn't publish dropped. The rows are written with
the columns of StatCan's own CSV (UOM, scalar, vector, coordinate, status, symbol,
terminated), less those the same on every row. Geography is matched by its exact
member name and the match printed, never by a substring ("Toronto" alone matches
several members).

When StatCan refuses a call (403), or is releasing a table (409), the copy already
here is kept and its manifest entry says from when, so a scheduled refresh carries
on. The block is the publisher's decision: nothing here tries to get around it.

Every row keeps StatCan's STATUS and SYMBOL (estimates are revised and flagged),
and the manifest records each table's title, StatCan's release time and our
retrieval date, so a later pull can be told apart from this one.
"""
import csv
import datetime
import itertools
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "series"
WDS = "https://www150.statcan.gc.ca/t1/wds/rest/"
UA = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}
BATCH = 100  # coordinates per data call

# table -> (exact geography member, what it is for)
# 11-10-0239's dollars are constant dollars of its latest year (2024 in the
# 2026-04 release), not as published: the manifest records the unit.
TABLES = {
    "17-10-0155": ("Toronto (C), Ontario", "Population estimates, July 1, City of Toronto (CSD, 2021 boundaries)"),
    "11-10-0239": ("Toronto, Ontario", "Income of individuals from the T1 Family File, Toronto CMA"),
    "14-10-0459": ("Toronto, Ontario", "Labour force, three-month moving average, Toronto CMA"),
    "18-10-0005": ("Toronto, Ontario", "Consumer price index, annual average, Toronto"),
    "34-10-0292": ("Toronto, Ontario", "Building permits, Toronto CMA (City-level permits come from the City's data)"),
}
# The members kept: table -> dimension -> member names. A dimension not named keeps every
# member; the rest is detail the anchors don't need, and would make the committed files large.
# Building permits: unadjusted, current dollars.
SELECT = {
    "11-10-0239": {"Age group": ["15 years and over"], "Gender": ["Total - Gender"]},
    "14-10-0459": {"Statistics": ["Estimate"]},
    "34-10-0292": {
        "Type of building": ["Total residential", "Single total", "Multiple dwelling building total"],
        "Type of work": ["Types of work, total", "New dwelling units total"],
        "Variables": ["Value of permits", "Number of dwelling-units created", "Number of dwelling-units lost", "Number of permits"],
        "Seasonal adjustment, value type": ["Unadjusted, current"],
    },
}
REFUSED = {403, 409}  # 403: Cloudflare's refusal; 409: "The product is not released yet"


def post(method: str, body) -> list:
    req = urllib.request.Request(WDS + method, data=json.dumps(body).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def get(method: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(WDS + method, headers=UA), timeout=120) as r:
        return json.load(r)


def pid(table: str) -> int:
    return int(table.replace("-", ""))


def code_sets() -> dict:
    """StatCan's codes as the text its CSVs print: unit, scalar, status, symbol."""
    o = get("getCodeSets")["object"]
    return {"uom": {c["memberUomCode"]: c["memberUomEn"] or "" for c in o["uom"]},
            "scalar": {c["scalarFactorCode"]: c["scalarFactorDescEn"] or "" for c in o["scalar"]},
            "status": {int(c["statusCode"]): c["statusRepresentationEn"] or "" for c in o["status"]},
            "symbol": {int(c["symbolCode"]): c["symbolRepresentationEn"] or "" for c in o["symbol"]}}


def periods(meta: dict) -> tuple[int, int]:
    """How many periods the table spans, and how many characters of a date name one."""
    a, b = (datetime.date.fromisoformat(meta[k]) for k in ("cubeStartDate", "cubeEndDate"))
    if meta["frequencyCode"] == 12:  # annual
        return b.year - a.year + 1, 4
    if meta["frequencyCode"] == 6:  # monthly
        return (b.year - a.year) * 12 + b.month - a.month + 1, 7
    sys.exit(f"{meta['productId']}: frequency {meta['frequencyCode']} not handled")


def table_rows(table: str, geo: str, meta: dict, codes: dict) -> list[dict]:
    """Toronto's rows of the table, series by series, in the order StatCan's CSV has them."""
    dims = sorted(meta["dimension"], key=lambda d: d["dimensionPositionId"])
    names = [d["dimensionNameEn"] for d in dims]
    want = SELECT.get(table, {})
    if set(want) - set(names[1:]):
        sys.exit(f"{table}: no dimension {sorted(set(want) - set(names[1:]))}; it has {names}")
    places = [[m for m in dims[0]["member"] if m["memberNameEn"] == geo]]
    if len(places[0]) != 1:
        sys.exit(f"{table}: {len(places[0])} geography members named {geo!r}")
    print(f"  {geo!r}: member {places[0][0]['memberId']}")
    for d in dims[1:]:
        w = want.get(d["dimensionNameEn"])
        ms = d["member"] if w is None else [m for m in d["member"] if m["memberNameEn"] in w]
        if w is not None and len(ms) != len(w):
            sys.exit(f"{table}: {d['dimensionNameEn']} has {[m['memberNameEn'] for m in ms]} of {w}")
        places.append(ms)
    combos = list(itertools.product(*places))
    n, width = periods(meta)
    uom_at = next((k for k, d in enumerate(dims) if d["hasUom"]), None)
    order = [{m["memberId"]: i for i, m in enumerate(d["member"])} for d in dims]
    rows, missing = [], 0
    for at in range(0, len(combos), BATCH):
        chunk = combos[at:at + BATCH]
        coords = [".".join([str(m["memberId"]) for m in c] + ["0"] * (10 - len(c))) for c in chunk]
        answers = post("getDataFromCubePidCoordAndLatestNPeriods",
                       [{"productId": pid(table), "coordinate": k, "latestN": n} for k in coords])
        # The answers don't come back in the order asked: match each by its coordinate.
        by = {a["object"]["coordinate"]: a for a in answers}
        if len(answers) != len(chunk) or set(by) != set(coords):
            sys.exit(f"{table}: asked for {len(chunk)} series, {len(answers)} answers for other coordinates")
        for combo, k in zip(chunk, coords):
            ans = by[k]
            # FAILED: the table doesn't publish this combination (most of a full grid)
            if ans.get("status") != "SUCCESS" or not ans["object"]["vectorDataPoint"]:
                missing += 1
                continue
            o, uom = ans["object"], combo[uom_at]["memberUomCode"] if uom_at is not None else None
            fixed = {"GEO": geo, **{names[k]: m["memberNameEn"] for k, m in enumerate(combo) if k},
                     "UOM": codes["uom"].get(uom, ""), "UOM_ID": "" if uom is None else str(uom)}
            for p in o["vectorDataPoint"]:
                v = p["value"]
                # ".." with no value pads a series to the table's whole span (years before it
                # began); StatCan's CSV leaves those out. An empty value with another status
                # ("F", too unreliable to publish) is a real row and stays.
                if v is None and p["statusCode"] == 1:
                    continue
                rows.append({"REF_DATE": p["refPer"][:width], **fixed,
                             "SCALAR_FACTOR": codes["scalar"][p["scalarFactorCode"]], "SCALAR_ID": str(p["scalarFactorCode"]),
                             "VECTOR": f"v{o['vectorId']}", "COORDINATE": ".".join(str(m["memberId"]) for m in combo),
                             "VALUE": "" if v is None else f"{v:.{p['decimals']}f}",
                             "STATUS": codes["status"][p["statusCode"]], "SYMBOL": codes["symbol"][p["symbolCode"]],
                             "TERMINATED": "t" if any(m["terminated"] for m in combo) else "",
                             "DECIMALS": str(p["decimals"]),
                             "_order": (p["refPer"], [order[k][m["memberId"]] for k, m in enumerate(combo)])})
    found = len(combos) - missing
    print(f"  {found} of {len(combos)} combinations published; {len(rows):,} rows")
    if not rows:
        sys.exit(f"{table}: no series came back for {geo!r}")
    rows.sort(key=lambda r: r.pop("_order"))
    return rows


def main() -> int:
    OUT.mkdir(exist_ok=True)
    manifest = {"retrieved": datetime.date.today().isoformat(), "tables": {}}
    before = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {"tables": {}}
    codes = None
    for table, (geo, about) in TABLES.items():
        try:
            codes = codes or code_sets()
            meta = post("getCubeMetadata", [{"productId": pid(table)}])[0]
            if meta.get("status") != "SUCCESS":
                raise RuntimeError(f"getCubeMetadata: {meta.get('object', meta)}")
            meta = meta["object"]
            print(f"{table} {meta['cubeTitleEn']} (released {meta['releaseTime'][:10]})")
            rows = table_rows(table, geo, meta, codes)
        except urllib.error.HTTPError as e:
            # Keep the copy already here (its manifest entry says from when).
            old = before["tables"].get(table)
            if e.code not in REFUSED or not old or not (OUT / old["file"]).exists():
                raise
            manifest["tables"][table] = {**old, "carried_over": old.get("carried_over", before.get("retrieved"))}
            why = "refused the request" if e.code == 403 else "is releasing it"
            print(f"{table}: StatCan {why} (HTTP {e.code}); kept the copy from "
                  f"{manifest['tables'][table]['carried_over']}\n")
            continue
        # Drop columns that are the same on every row (except the essentials) to keep files small.
        keep = [c for c in rows[0] if c in ("REF_DATE", "GEO", "VALUE", "STATUS", "SYMBOL") or len({r[c] for r in rows}) > 1]
        path = OUT / f"{table}.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keep, extrasaction="ignore", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        units = sorted({r.get("UOM", "") for r in rows} - {""})
        manifest["tables"][table] = {"title": meta["cubeTitleEn"], "about": about, "geography": geo, "units": units,
                                     "kept": {c: sorted(v) for c, v in SELECT.get(table, {}).items()},
                                     "released": meta["releaseTime"], "rows": len(rows), "file": path.name,
                                     "url": f"https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid={pid(table)}01"}
        print(f"  wrote {path.name} ({path.stat().st_size / 1e3:.0f} kB)\n")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {OUT / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
