"""TRREB sale prices by community, for the dwelling-value nowcast (docs/forecast-spec.md).

    python pipeline/trreb.py

Reads TRREB's quarterly Community Housing Market Reports for the City's three
regions (pipeline/raw/trreb_community/Toronto{East,West,Central}Q{q}{yyyy}.pdf, Q4
2011 to the latest). (The City's own May figures, from the May Market Watch reports in
pipeline/raw/trreb_mw, are read by hand into docs/forecast-spec.md.) Writes:

  pipeline/trreb/community.csv  year, q, community (TRREB's name, cleaned), district,
                                sales, dollar volume, average and median sale price
                                (all home types; none where TRREB withholds them)
  pipeline/trreb/nbhd_map.csv   each of the 158 neighbourhoods and the TRREB
                                community holding it (the City's 140 of before 2022)
  pipeline/trreb/manifest.json  checks

TRREB's Toronto communities are the City's 140 neighbourhoods of before 2022, a few
spelled differently or renamed over the years, and a few split across districts
(each part reported on its own row). The 2022 splits are the City's ("New 158
Neighbourhoods with Streets and List Table", April 2022).

Checks: sales times average price matches dollar volume on every row; a district's
communities add to its total (TRREB's own totals are off by a sale or two at times);
every community name maps; every one of the 158 neighbourhoods has a community.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

HERE = Path(__file__).parent
RAW = HERE / "raw" / "trreb_community"
OUT = HERE / "trreb"
# The text of each report's community pages (reading every report takes a while).
CACHE = HERE / "out" / "trreb_pages.json"
INSIGHTS = HERE.parent / "web" / "public" / "insights.json"

# A community row: name (perhaps with a district suffix), sales, dollar volume, then
# average and median price, each "-" where withheld (two sales or fewer).
ROW = re.compile(r"^(?P<name>[A-Za-z][^$]*?)\s+(?P<sales>\d[\d,]*)\s+\$(?P<vol>[\d,]+)\s+(?:\$(?P<avg>[\d,]+)|-)\s+(?:\$(?P<med>[\d,]+)|-)")
# The same row where the sales count ran into the name ("York Mills84",
# "St. James Tow5n6"): the name's letters, and its digits as the count.
GLUED = re.compile(r"^(?P<head>[A-Za-z][^$]*?)\s+\$(?P<vol>[\d,]+)\s+(?:\$(?P<avg>[\d,]+)|-)\s+(?:\$(?P<med>[\d,]+)|-)")
DISTRICT = re.compile(r"^Toronto [WCE]\d\d$")  # the district's own total row
SUFFIX = re.compile(r"\s+[WCE]\d{0,2}$")  # in 2018 the district number is lost

# The 2022 splits: the old neighbourhood and the new ones it became.
SPLITS = {
    "Woburn": ["Golfdale-Cedarbrae-Woburn", "Woburn North"],
    "Rouge": ["West Rouge", "Morningside Heights"],
    "Malvern": ["Malvern West", "Malvern East"],
    "L'Amoreaux": ["L'Amoreaux West", "East L'Amoreaux"],
    "Parkwoods-Donalda": ["Parkwoods-O'Connor Hills", "Fenside-Parkwoods"],
    "Willowdale East": ["Yonge-Doris", "East Willowdale", "Avondale"],
    "Downsview-Roding-CFB": ["Oakdale-Beverley Heights", "Downsview"],
    "Bendale": ["Bendale-Glen Andrew", "Bendale South"],
    "Islington-City Centre West": ["Islington", "Etobicoke City Centre"],
    "Mimico": ["Mimico-Queensway", "Humber Bay Shores"],
    "Niagara": ["West Queen West", "Fort York-Liberty Village"],
    "Waterfront Communities-The Island": ["Wellington Place", "Harbourfront-CityPlace", "St Lawrence-East Bayfront-The Islands"],
    "Church-Yonge Corridor": ["Church-Wellesley", "Downtown Yonge East"],
    "Bay Street Corridor": ["Bay-Cloverhill", "Yonge-Bay Corridor"],
    "Dovercourt-Wallace Emerson-Junction": ["Junction-Wallace Emerson", "Dovercourt Village"],
    "Mount Pleasant West": ["North Toronto", "South Eglinton-Davisville"],
}
# TRREB's names that differ from the City's (spelling, renames, older TRREB names).
RENAMES = {
    "Cabbagetown-South St. James Town": "Cabbagetown-South St.James Town",
    "North St. James Town": "North St.James Town",
    "St. Andrew-Windfields": "St.Andrew-Windfields",
    "Thistletown-Beaumonde Heights": "Thistletown-Beaumond Heights",
    "Wexford-Maryvale": "Wexford/Maryvale",
    "Yonge-St. Clair": "Yonge-St.Clair",
    "Weston-Pellam Park": "Weston-Pelham Park",
    "Humber Heights": "Humber Heights-Westmount",
    "Humberlea-Pelmo Park": "Pelmo Park-Humberlea",
    "Danforth Village-East York": "Danforth East York",
    "East York": "Old East York",
    "Crescent Town": "Taylor-Massey",
    "Leaside": "Leaside-Bennington",
    "Oakwood-Vaughan": "Oakwood Village",
    "Jamestown": "Mount Olive-Silverstone-Jamestown",
    "Emerson-Junction": "Dovercourt-Wallace Emerson-Junction",
    "Waterfront Communities": "Waterfront Communities-The Island",
    "Waterfront Communities C": "Waterfront Communities-The Island",
}


def pages(f: Path, cache: dict) -> list[str]:
    if f.name not in cache:
        with pdfplumber.open(f) as pdf:
            cache[f.name] = [t for t in ((pg.extract_text() or "") for pg in pdf.pages) if "COMMUNITY BREAKDOWN" in t.upper()]
    return cache[f.name]


def read_reports() -> pd.DataFrame:
    rows = []
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    for f in sorted(RAW.glob("Toronto*Q*.pdf")):
        m = re.fullmatch(r"Toronto(\w+?)Q(\d)(\d{4})\.pdf", f.name)
        year, q = int(m.group(3)), int(m.group(2))
        for text in pages(f, cache):
            district = re.search(r"Toronto ([WCE]\d\d)", text).group(1)
            prev = ""
            for line in text.splitlines():
                r = ROW.match(line.strip())
                if not r and (gl := GLUED.match(line.strip())) and re.search(r"[A-Za-z]\d", gl["head"]):
                    head = gl["head"]
                    r = {**gl.groupdict(), "name": re.sub(r"\d", "", head), "sales": "".join(re.findall(r"\d", head))}
                if not r:
                    s = line.strip()  # a wrapped name's start: short, no figures, not a heading
                    prev = s if len(s) < 40 and not re.search(r"\d|Community|Sales", s) else ""
                    continue
                g = r if isinstance(r, dict) else r.groupdict()
                name = g["name"].strip()
                # A long name wrapped onto two lines: its start is the line before.
                if prev and len(name.split()) == 1 and not DISTRICT.match(name):
                    name = prev + ("" if prev.endswith("-") else " ") + name
                prev = ""
                rows.append({"year": year, "q": q, "file": f.name, "district": district, "name": name,
                             "sales": int(g["sales"].replace(",", "")), "vol": float(g["vol"].replace(",", "")),
                             "avg": float(g["avg"].replace(",", "")) if g["avg"] else None,
                             "med": float(g["med"].replace(",", "")) if g["med"] else None})
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    return pd.DataFrame(rows)


def community_of(names: pd.Series, nbhd: list[str]) -> pd.Series:
    """TRREB's community name -> the City's name of before 2022. Drops a district
    suffix, completes names TRREB cut short, and applies RENAMES."""
    known = set(nbhd) | set(SPLITS) | set(RENAMES) | set(RENAMES.values())

    def one(n: str) -> str | None:
        n = SUFFIX.sub("", n).strip()
        if n not in known:
            full = [k for k in known if k.startswith(n)]
            n = full[0] if len(full) == 1 else None
        return RENAMES.get(n, n) if n else None

    return names.map(one)


def main() -> int:
    nbhd = [n["name"] for n in json.loads(INSIGHTS.read_text(encoding="utf-8"))["nbhd"]]
    d = read_reports()
    off = (d.sales * d.avg - d.vol).abs() > 0.005 * d.vol
    if off.any():
        print(d[off].head(20).to_string())
        sys.exit("sales times average doesn't match dollar volume")
    totals = d[d.name.str.match(DISTRICT.pattern)]
    d = d[~d.name.str.match(DISTRICT.pattern)].copy()
    d["community"] = community_of(d.name, nbhd)
    if d.community.isna().any():
        sys.exit(f"unmapped names: {sorted(d.name[d.community.isna()].unique())}")
    # A community's parts across districts must add to the district totals.
    s = d.groupby(["year", "q", "district"]).sales.sum()
    t = totals.assign(district=totals.name.str[-3:]).set_index(["year", "q", "district"]).sales
    gap = (s.reindex(t.index).fillna(0) - t)
    # TRREB's own district totals are off by a sale or two now and then.
    print(f"Districts whose communities don't add to the total: {int((gap != 0).sum())} of {len(gap)}, at most {int(gap.abs().max())} sales")
    if gap.abs().max() > 2:
        sys.exit("communities don't add to their district (a row was missed)")
    old = sorted(d.community.unique())
    rows = []
    for n in nbhd:
        parent = next((o for o, kids in SPLITS.items() if n in kids), n)
        rows.append({"nbhd": n, "community": parent})
    m = pd.DataFrame(rows)
    missing = sorted(set(m.community) - set(old))
    if missing:
        sys.exit(f"neighbourhoods without a community: {missing}")
    OUT.mkdir(exist_ok=True)
    d.drop(columns=["file"]).to_csv(OUT / "community.csv", index=False)
    m.to_csv(OUT / "nbhd_map.csv", index=False)
    q = d.groupby(["year", "q"]).community.nunique()
    (OUT / "manifest.json").write_text(json.dumps({
        "quarters": len(q), "first": f"{q.index[0][0]} Q{q.index[0][1]}", "last": f"{q.index[-1][0]} Q{q.index[-1][1]}",
        "communities": len(old), "communities_per_quarter": [int(q.min()), int(q.max())],
        "district_sum_mismatches": int((gap != 0).sum()),
    }, indent=2) + "\n")
    print(f"{len(d)} rows, {len(old)} communities, {len(q)} quarters ({q.min()} to {q.max()} communities a quarter)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
