"""Toronto schools' 2025-26 Grade 3 and Grade 6 results from EQAO's open data, for the
schools forecast (docs/forecast-spec.md, "EQAO's school file").

    python pipeline/eqao.py

Reads EQAO's Achievement Results zips (eqao.com/about-eqao/open-data, downloaded by
hand: Cloudflare blocks scripted downloads) from pipeline/raw/eqao/ or pipeline/raw/:

    Grade 3, 2024-2025, Achievement Results.zip   Grade 6, 2024-2025, ...
    Grade 3, 2025-2026, Achievement Results.zip   Grade 6, 2025-2026, ...

First the match: EQAO's 2024-25 school records must reproduce the Ministry's 2024-25
scores in pipeline/schools/schools.csv (every Toronto school the Ministry scores, and
at least 95% of school, grade and subject cells within one point). The measure is
pctOverall{R,W,M}_L34, the share of fully participating students at levels 3 and 4.

Then writes pipeline/schools/eqao_2026.csv: the 2025-26 scores of the schools with a
row in the Ministry's 2024-25 file ("N/R" and "N/D" are missing). Schools with a 2026
score but no Ministry 2024-25 row are counted and left out. EQAO data are used under
the Open Government Licence - Ontario.
"""
import io
import sys
import zipfile
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
SCHOOLS = HERE / "schools" / "schools.csv"
OUT = HERE / "schools" / "eqao_2026.csv"
SUBJECTS = {"read": "R", "write": "W", "math": "M"}
TORONTO_BOARDS = {"66052": "Toronto DSB", "67059": "Toronto CDSB"}  # EQAO BoardMident: the English boards
MATCH_SHARE = 0.95


def zip_for(grade: int, school_year: str) -> Path:
    name = f"Grade {grade}, {school_year}, Achievement Results.zip"
    for d in (RAW / "eqao", RAW):
        if (d / name).exists():
            return d / name
    sys.exit(f"{name} is missing: download it from eqao.com/about-eqao/open-data into {RAW / 'eqao'}")


def school_records(grade: int, school_year: str) -> pd.DataFrame:
    """The school records of the year's first file: each school's three scores."""
    with zipfile.ZipFile(zip_for(grade, school_year)) as z:
        name = next(n for n in z.namelist() if n.endswith(f"G{grade}_{school_year[-4:]}_1.csv"))
        d = pd.read_csv(io.BytesIO(z.read(name)), encoding="utf-8-sig", dtype=str)
    d = d[d.OrgType == "S"].copy()
    d["school_number"] = d.SchoolMident.str.zfill(6)
    if d.school_number.duplicated().any():
        sys.exit(f"{name}: a school appears twice")
    out = d.set_index("school_number")[["SchoolName", "BoardMident", "BoardName"]].rename(
        columns={"SchoolName": "eqao_name", "BoardMident": "board_mident", "BoardName": "eqao_board"})
    for s, k in SUBJECTS.items():
        out[f"g{grade}_{s}"] = pd.to_numeric(d.set_index("school_number")[f"pctOverall{k}_L34"].str.rstrip("%"), errors="coerce")
    return out


def main() -> int:
    if not SCHOOLS.exists():
        sys.exit(f"{SCHOOLS} is missing (make schools)")
    s = pd.read_csv(SCHOOLS, dtype={"school_number": str})
    m25 = s[s.year == 2025].set_index("school_number")
    if m25.index.duplicated().any():
        sys.exit("a school appears twice in the Ministry's 2024-25 rows")
    ok = True
    print("The match: EQAO 2024-25 against the Ministry's 2024-25 scores")
    for g in (3, 6):
        e = school_records(g, "2024-2025")
        cols = [f"g{g}_{t}" for t in SUBJECTS]
        sif = m25[m25[cols].notna().any(axis=1)]
        missing = sif.index.difference(e.index)
        A = sif[cols].stack(future_stack=True)
        B = e.reindex(sif.index)[cols].stack(future_stack=True)
        a, b = A[A.notna()], B[A.notna()]  # the Ministry's cells
        within = float(((b - a).abs() <= 1).mean())
        exact = float((b == a).mean())
        only_eqao = int((A.isna() & B.notna()).sum())
        tor = e[e.board_mident.isin(TORONTO_BOARDS)]
        extra = tor.index[tor[cols].notna().any(axis=1)].difference(sif.index)
        print(f"  Grade {g}: {len(sif)} Ministry schools, {len(sif) - len(missing)} in EQAO's file; {len(a)} cells, "
              f"{within:.1%} within one point, {exact:.1%} equal; {only_eqao} cells EQAO has and the Ministry doesn't")
        for k in extra:
            print(f"    in EQAO's file only: {k} {tor.loc[k, 'eqao_name']} ({tor.loc[k, 'eqao_board']})")
        if len(missing) or within < MATCH_SHARE:
            ok = False
    if not ok:
        sys.exit("EQAO's 2024-25 file doesn't reproduce the Ministry's: use the two-year fallback (docs/forecast-spec.md)")

    out = pd.DataFrame(index=pd.Index([], name="school_number"))
    print("2025-26 scores")
    for g in (3, 6):
        e = school_records(g, "2025-2026")
        cols = [f"g{g}_{t}" for t in SUBJECTS]
        scored = e[e[cols].notna().any(axis=1)]
        tor = scored[scored.board_mident.isin(TORONTO_BOARDS)]
        dropped = tor.index.difference(m25.index)
        keep = scored.index.intersection(m25.index)
        print(f"  Grade {g}: {len(keep)} schools with a 2026 score and a Ministry 2024-25 row; "
              f"{len(dropped)} Toronto board schools with a score and no 2024-25 row, left out")
        for k in dropped:
            print(f"    left out: {k} {tor.loc[k, 'eqao_name']} ({tor.loc[k, 'eqao_board']})")
        out = out.join(scored.loc[keep, cols], how="outer")
        out.loc[keep, "eqao_name"] = scored.loc[keep, "eqao_name"]
    out = out.reset_index().sort_values("school_number")
    out.insert(1, "name", out.school_number.map(m25.name))
    out = out[["school_number", "name", "eqao_name", *[f"g{g}_{t}" for g in (3, 6) for t in SUBJECTS]]]
    out.to_csv(OUT, index=False, float_format="%.0f", lineterminator="\n")
    n = {g: int(out[[f"g{g}_{t}" for t in SUBJECTS]].notna().all(axis=1).sum()) for g in (3, 6)}
    print(f"Wrote {OUT}: {len(out)} schools; all three Grade 3 scores {n[3]}, all three Grade 6 scores {n[6]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
