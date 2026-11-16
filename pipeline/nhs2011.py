"""Toronto's rows of the 2011 NHS DA table: pipeline/extracts/toronto_nhs_2011.csv.

    python pipeline/nhs2011.py

Streams pipeline/raw/NHSprofile_Can_PR_CD_CSD_DA.IVT (the Beyond 20/20 table
download.py fetches; 59,408 geographies x 2,620 characteristics) with pyivt and
keeps, for the geographies in census division 3520 (the CD, the City of Toronto
CSD and its DAs), the characteristics measures.NHS_2011 names and the income
groups in measures.INCOME_GROUPS (columns b<ID>), Total sex. One
row per geography: geo_code, level, dq (StatCan's five-digit data-quality flag;
the fourth digit is 1 where the global non-response rate was 50% or more), gnr
(that rate, %), then one column per measure key; a suppressed cell (x) is empty.

Needs pyivt 0.0.11, the version checked (0.0.5 can't read the table's _Sort and
_Decimals member fields) and pyarrow: `make pyivt` installs the pinned version. The
geographies' codes, levels and quality fields come from pyivt's member table; only
the cells kept are exported. Only pyivt and pyarrow are imported, so the
pipeline's own environment isn't needed.
"""
import csv
import sys
import time
from pathlib import Path

import pyarrow.compute as pc
import pyivt

from measures import INCOME_GROUPS, NHS_2011

HERE = Path(__file__).parent
IVT = HERE / "raw" / "NHSprofile_Can_PR_CD_CSD_DA.IVT"
OUT = HERE / "extracts" / "toronto_nhs_2011.csv"  # kept in the repository (extracts.py)
TORONTO_CD = "3520"
SEX = "Total"
EXPECTED = (59408, 2620)


def main() -> int:
    t = pyivt.open(IVT)
    dims = t.metadata.dimensions
    counts = tuple(d.items for d in dims)
    if counts != EXPECTED:
        sys.exit(f"{IVT.name}: {counts} geographies x characteristics, expected {EXPECTED}")
    geo_dim, char_dim = (d.slug for d in dims)
    labels = dims[1].members.en
    # Characteristic IDs are the member ordinals; check each one's label.
    for key, (cid, name) in NHS_2011.items():
        found = labels[cid - 1].strip()
        if not found.startswith(name):
            sys.exit(f"characteristic {cid} is {found!r}, not {name!r} ({key}); check measures.NHS_2011")
    by_id = {cid: key for key, (cid, _) in NHS_2011.items()}
    # Income groups for insights.py's interpolated neighbourhood medians, as b<ID>.
    for ids, _ in INCOME_GROUPS["2011"].values():
        by_id.update({cid: f"b{cid}" for cid in ids})

    # The members' fields: each characteristic's sex, each geography's code, level and quality.
    members = t.to_member_table()
    chars = members.filter(pc.equal(members["dimension"], char_dim))
    sex = dict(zip(chars["code"].to_pylist(), chars["Sex"].to_pylist()))
    if other := sorted(cid for cid in by_id if sex[cid].strip() != SEX):
        sys.exit(f"characteristics {other[:5]} are not for sex {SEX!r}; check measures.NHS_2011")
    geo = members.filter(pc.equal(members["dimension"], geo_dim))
    geo = geo.filter(pc.starts_with(geo["native_Code"], TORONTO_CD))
    info = {c: {"geo_code": g, "level": lvl.strip(), "dq": dq, "gnr": gnr}
            for c, g, lvl, dq, gnr in zip(*(geo[f].to_pylist() for f in ("code", "native_Code", "Level_Niveau", "DQ_QD", "GNR %_TGN %")))}
    print(f"{IVT.name}: {counts[0]:,} geographies x {counts[1]:,} characteristics; keeping {len(by_id)} for CD {TORONTO_CD}")

    t0 = time.time()
    cells = t.to_arrow(select={geo_dim: list(info), char_dim: list(by_id)})
    if cells.num_rows != len(info) * len(by_id):
        sys.exit(f"pyivt returned {cells.num_rows:,} cells, not {len(info):,} geographies x {len(by_id)} characteristics")
    geos = {}
    # A missing value (a suppressed cell, x) comes back as null: no figure.
    for g, cid, v in zip(cells[geo_dim].to_pylist(), cells[char_dim].to_pylist(), cells["value"].to_pylist()):
        row = geos.setdefault(info[g]["geo_code"], dict(info[g]))
        row[by_id[cid]] = "" if v is None else v
    print(f"  read {cells.num_rows:,} cells in {time.time() - t0:.1f} s; {len(geos):,} geographies kept")
    levels = {}
    for r in geos.values():
        levels[r["level"]] = levels.get(r["level"], 0) + 1
    print(f"  by level: {levels}")

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
