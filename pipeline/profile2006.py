"""Toronto's rows of the 2006 Census DA profile: pipeline/out/toronto_profile_2006.csv.

    python pipeline/profile2006.py

Streams pipeline/raw/94-581-XCB2006002.IVT (the 2006 Census Profile for Canada to
dissemination areas, a Beyond 20/20 table: 2,172 characteristics x 57,894
geographies; download.py fetches it from Borealis) with pyivt and keeps, for the
City of Toronto CSD (3520005) and its DAs, the characteristics measures.CHARS_2006
and measures.INCOME_GROUPS_2006 name. One row per geography: geo_code (the DAUID,
or 3520005), level, label (StatCan's geography label, with its data-quality
flags), then one column per key; a suppressed cell is empty.

This stops at extraction. Assigning 2006 DAs to the City's neighbourhoods needs
the 2006 DA boundary file and the 2006-2011 DA correspondence, which come from
www12.statcan.gc.ca (a browser download: it has a bot challenge).

pyivt needs the legacy member-field fix (see nhs2011.py); run it where that
build is installed, e.g. under WSL:
    wsl -e ~/pyivt/.venv/bin/python pipeline/profile2006.py
Only pyivt and pyarrow are imported (measures.py doesn't import pandas at run time).
"""
import csv
import re
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyivt

from measures import CHARS_2006, INCOME_GROUPS_2006

HERE = Path(__file__).parent
IVT = HERE / "raw" / "94-581-XCB2006002.IVT"
OUT = HERE / "out" / "toronto_profile_2006.csv"
TORONTO_CSD = "3520005"
EXPECTED = (1, 2172, 57894)
# A DA's label is "<DAUID> (<CSD code><4-digit DA number>)  <flags>"; the CSD's
# is "Toronto (3520005) C <flags>".
DA_LABEL = re.compile(r"^(\d{8}) \((\d{7})\d{4}\)\s+(\S+)\s*$")
CSD_LABEL = re.compile(rf"^Toronto \({TORONTO_CSD}\) C\s+(\S+)\s*$")
PUBLISHED_POP_2006 = 2_503_281  # Toronto (C), 2006 Census population count


def main() -> int:
    t = pyivt.open(IVT)
    counts = tuple(t.layout.counts)
    if counts != EXPECTED:
        sys.exit(f"{IVT.name}: dimensions {counts}, expected {EXPECTED}")
    m = t.metadata
    chars = m.dimensions[1].members.en
    geos = m.dimensions[2].members.en
    if chars is None or geos is None:
        sys.exit("pyivt returned no member labels: it needs the legacy member-field fix (see nhs2011.py)")
    wanted = {**{k: (cid, name) for k, (cid, name) in CHARS_2006.items()},
              **{f"b{cid}": (cid, None) for ids, _ in INCOME_GROUPS_2006.values() for cid in ids}}
    for key, (cid, name) in wanted.items():
        found = chars[cid - 1].strip()
        if name is not None and not found.startswith(name):
            sys.exit(f"characteristic {cid} is {found!r}, not {name!r} ({key}); check measures.CHARS_2006")
    by_id = {cid: key for key, (cid, _) in wanted.items()}

    # Geography member ID (1-based) -> (geo_code, level, label)
    keep = {}
    for i, g in enumerate(geos, 1):
        if (d := DA_LABEL.match(g or "")) and d.group(2) == TORONTO_CSD:
            keep[i] = (d.group(1), "DA", g.strip())
        elif CSD_LABEL.match(g or ""):
            keep[i] = (TORONTO_CSD, "CSD", g.strip())
    print(f"{IVT.name}: {counts[2]:,} geographies x {counts[1]:,} characteristics; "
          f"Toronto: {sum(1 for v in keep.values() if v[1] == 'DA'):,} DAs and {sum(1 for v in keep.values() if v[1] == 'CSD')} CSD row; "
          f"{len(by_id)} characteristics kept")

    slugs = t.layout.slugs  # ["values", "profile_of_diss", "geography"]
    char_col, geo_col = slugs[1], slugs[2]
    t0, cells, rows, statuses = time.time(), 0, {}, {}
    geo_ids = pa.array(list(keep), pa.int32())
    char_ids = pa.array(list(by_id), pa.int32())
    for b in t.to_batches(batch_size=1_000_000, max_memory_bytes=4 << 30):
        cells += b.num_rows
        mask = pc.and_(pc.is_in(b.column(geo_col), geo_ids), pc.is_in(b.column(char_col), char_ids))
        if not pc.any(mask).as_py():
            continue
        s = b.filter(mask)
        for g, c, v, sym, st in zip(s.column(geo_col).to_pylist(), s.column(char_col).to_pylist(),
                                    s.column("value").to_pylist(), s.column("symbol").to_pylist(),
                                    s.column("status").to_pylist()):
            code, level, label = keep[g]
            row = rows.setdefault(code, {"geo_code": code, "level": level, "label": label})
            # A status (suppressed, not applicable) leaves value null: no figure.
            row[by_id[c]] = "" if v is None else v
            if v is None:
                statuses[(by_id[c], sym or st or "")] = statuses.get((by_id[c], sym or st or ""), 0) + 1
    print(f"  streamed {cells:,} cells in {time.time() - t0:.0f} s; {len(rows):,} geographies")
    by_status = {}
    for (k, s_), n in statuses.items():
        by_status[s_] = by_status.get(s_, 0) + n
    print(f"  cells without a figure, by status: {by_status}")
    incomplete = [g for g, r in rows.items() if len(r) != 3 + len(by_id)]
    if incomplete:
        sys.exit(f"{len(incomplete)} geographies lack some characteristics, e.g. {incomplete[:3]}")

    # Checks: the CSD population against the published count, and DA sums of
    # 100% counts against the CSD row (a whole-city table should add up, up to
    # random rounding and suppressed DAs).
    csd = rows[TORONTO_CSD]
    das = [r for r in rows.values() if r["level"] == "DA"]
    print(f"  CSD population {csd['pop06']:,.0f} vs published {PUBLISHED_POP_2006:,} ({csd['pop06'] / PUBLISHED_POP_2006 - 1:+.3%})")
    for key in ("pop06", "hh", "n_struct", "n_detached", "n_apt5"):
        s = sum(r[key] for r in das if r[key] != "")
        print(f"  {key:10s} sum of DAs {s:12,.0f} vs CSD {csd[key]:12,.0f} ({s / csd[key] - 1:+.2%}); "
              f"DAs without a figure: {sum(1 for r in das if r[key] == '')}")

    OUT.parent.mkdir(exist_ok=True)
    fields = ["geo_code", "level", "label", *wanted]
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for code in sorted(rows):
            w.writerow(rows[code])
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
