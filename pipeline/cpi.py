"""Fetch the annual-average CPI used to restate 2016 Census dollar figures in
2021 Census terms: 2015 incomes in 2020 dollars, 2016 dwelling values and
shelter costs in 2021 dollars.

Source: Statistics Canada table 18-10-0005-01, Consumer Price Index, annual
average, not seasonally adjusted (2002=100), read through the Web Data Service
(https://www.statcan.gc.ca/en/developers/wds/user-guide), which is meant for
scripts (unlike www12.statcan.gc.ca, it has no bot challenge).

    python pipeline/cpi.py                    # Toronto, Ontario (default)
    python pipeline/cpi.py --geo "Canada"

Writes pipeline/cpi.json (committed). distributions.py reads it, so rerun
`make breaks` (or the full build) afterwards to apply it to breaks.json.
"""
import argparse
import datetime
import json
import sys
import urllib.request
from pathlib import Path

WDS = "https://www150.statcan.gc.ca/t1/wds/rest/"
PID = 18100005  # table 18-10-0005-01
TABLE = "18-10-0005-01"
PRODUCT = "All-items"
YEARS = ("2015", "2016", "2020", "2021")  # income years 2015 -> 2020; census years 2016 -> 2021
OUT = Path(__file__).parent / "cpi.json"


def post(method: str, body) -> dict:
    req = urllib.request.Request(WDS + method, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        [res] = json.load(r)
    if res.get("status") != "SUCCESS":
        sys.exit(f"WDS {method} failed: {res}")
    return res["object"]


def member(dims: list, dim_name: str, name: str) -> tuple[int, int]:
    """(dimension position, member id) for a member named `name`."""
    dim = next((d for d in dims if d["dimensionNameEn"] == dim_name), None)
    if dim is None:
        sys.exit(f"no {dim_name!r} dimension; have {[d['dimensionNameEn'] for d in dims]}")
    ids = [m["memberId"] for m in dim["member"] if m["memberNameEn"] == name]
    if len(ids) != 1:
        close = [m["memberNameEn"] for m in dim["member"] if name.split(",")[0].lower() in m["memberNameEn"].lower()]
        sys.exit(f"expected one {dim_name} member named {name!r}, found {len(ids)}; similar: {close[:10]}")
    return dim["dimensionPositionId"], ids[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--geo", default="Toronto, Ontario", help="Geography member name in table 18-10-0005-01")
    args = ap.parse_args()

    meta = post("getCubeMetadata", [{"productId": PID}])
    dims = meta["dimension"]
    coord = ["0"] * 10  # WDS coordinates are always ten member ids
    for dim_name, name in (("Geography", args.geo), ("Products and product groups", PRODUCT)):
        pos, mid = member(dims, dim_name, name)
        coord[pos - 1] = str(mid)
    data = post("getDataFromCubePidCoordAndLatestNPeriods",
                [{"productId": PID, "coordinate": ".".join(coord), "latestN": 40}])
    values = {p["refPer"][:4]: p["value"] for p in data["vectorDataPoint"]}
    missing = [y for y in YEARS if values.get(y) is None]
    if missing:
        sys.exit(f"no values for {missing} in {sorted(values)}")

    cpi = {
        "series": f"Consumer Price Index, {PRODUCT.lower()}, {args.geo}, annual average (2002=100)",
        "table": TABLE,
        "geography": args.geo,
        "vector": f"v{data['vectorId']}",
        "retrieved": datetime.date.today().isoformat(),
        **{y: values[y] for y in YEARS},
    }
    OUT.write_text(json.dumps(cpi, indent=2) + "\n")
    for a, b in (("2015", "2020"), ("2016", "2021")):
        print(f"{args.geo} {a} {values[a]} -> {b} {values[b]} (x{values[b] / values[a]:.4f})")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
