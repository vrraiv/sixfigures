"""Toronto's rows of the 2011 NHS DA table: pipeline/out/toronto_nhs_2011.csv.

    python pipeline/nhs2011.py

Streams pipeline/raw/NHSprofile_Can_PR_CD_CSD_DA.IVT (the Beyond 20/20 table
download.py fetches; 59,408 geographies x 2,620 characteristics) with pyivt and
keeps, for the geographies in census division 3520 (the CD, the City of Toronto
CSD and its DAs), the characteristics measures.NHS_2011 names and the income
groups in measures.INCOME_GROUPS (columns b<ID>), Total sex. One
row per geography: geo_code, level, dq (StatCan's five-digit data-quality flag;
the fourth digit is 1 where the global non-response rate was 50% or more), gnr
(that rate, %), then one column per measure key; a suppressed cell (x) is empty.

Needs pyivt with the legacy member-field fix (the table's _Sort and _Decimals
fields; pyivt 0.0.5 on PyPI stops with "referenced member text is not a byte
vector"), and pyarrow. pyivt is a Rust extension: where no wheel fits (Windows
without a Rust toolchain), run this under WSL, e.g.
    wsl -e ~/pyivt/.venv/bin/python pipeline/nhs2011.py
Only pyivt and pyarrow are imported, so the pipeline's own environment isn't needed.
"""
import csv
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyivt

from measures import INCOME_GROUPS, NHS_2011

HERE = Path(__file__).parent
IVT = HERE / "raw" / "NHSprofile_Can_PR_CD_CSD_DA.IVT"
OUT = HERE / "out" / "toronto_nhs_2011.csv"
TORONTO_CD = "3520"
SEX = "Total"
EXPECTED = (59408, 2620)


def main() -> int:
    t = pyivt.open(IVT)
    m = t.metadata
    counts = tuple(t.layout.counts)
    if counts != EXPECTED:
        sys.exit(f"{IVT.name}: {counts} geographies x characteristics, expected {EXPECTED}")
    labels = m.dimensions[1].members.en
    if labels is None:
        sys.exit("pyivt returned no characteristic labels: it needs the legacy member-field fix (see the docstring)")
    # Characteristic IDs are the member ordinals; check each one's label.
    for key, (cid, name) in NHS_2011.items():
        found = labels[cid - 1].strip()
        if not found.startswith(name):
            sys.exit(f"characteristic {cid} is {found!r}, not {name!r} ({key}); check measures.NHS_2011")
    by_id = {cid: key for key, (cid, _) in NHS_2011.items()}
    # Income groups for insights.py's interpolated neighbourhood medians, as b<ID>.
    for ids, _ in INCOME_GROUPS["2011"].values():
        by_id.update({cid: f"b{cid}" for cid in ids})
    print(f"{IVT.name}: {counts[0]:,} geographies x {counts[1]:,} characteristics; keeping {len(by_id)} for CD {TORONTO_CD}")

    t0, rows, geos = time.time(), 0, {}
    # pyivt's conservative estimate for this table is ~1.6 GB whatever the batch size.
    for b in t.to_batches(batch_size=1_000_000, max_memory_bytes=4 << 30):
        rows += b.num_rows
        code = pc.cast(b.column("geography_code"), pa.string())
        keep = pc.and_(pc.starts_with(code, TORONTO_CD), pc.equal(pc.cast(b.column("2011_nhs_sex"), pa.string()), SEX))
        keep = pc.and_(keep, pc.is_in(b.column("2011_nhs"), pa.array(list(by_id), pa.int32())))
        if not pc.any(keep).as_py():
            continue
        sub = b.filter(keep)
        cols = {c: pc.cast(sub.column(c), pa.string()).to_pylist() for c in ("geography_code", "geography_level_niveau", "geography_dq_qd", "geography_gnr_tgn")}
        for g, lvl, dq, gnr, cid, v, sym in zip(*cols.values(), sub.column("2011_nhs").to_pylist(), sub.column("value").to_pylist(), sub.column("symbol").to_pylist()):
            row = geos.setdefault(g, {"geo_code": g, "level": lvl.strip(), "dq": dq, "gnr": gnr})
            row[by_id[cid]] = "" if sym else v
    print(f"  streamed {rows:,} cells in {time.time() - t0:.0f} s; {len(geos):,} geographies kept")
    levels = {}
    for r in geos.values():
        levels[r["level"]] = levels.get(r["level"], 0) + 1
    print(f"  by level: {levels}")
    missing = [g for g, r in geos.items() if len(r) != 4 + len(by_id)]
    if missing:
        sys.exit(f"{len(missing)} geographies lack some characteristics, e.g. {missing[:3]}")

    OUT.parent.mkdir(exist_ok=True)
    fields = ["geo_code", "level", "dq", "gnr", *by_id.values()]
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for g in sorted(geos):
            w.writerow(geos[g])
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
