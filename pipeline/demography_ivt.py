"""The age, immigration and (2011) dwelling counts demography.py needs from the two Beyond 20/20
tables: pipeline/out/demography_2006.csv and pipeline/out/demography_nhs2011.csv.

    wsl -e ~/pyivt/.venv/bin/python pipeline/demography_ivt.py

Streams the 2006 DA profile (94-581-XCB2006002.IVT) and the 2011 NHS DA table
(NHSprofile_Can_PR_CD_CSD_DA.IVT) as profile2006.py and nhs2011.py do, and keeps,
for Toronto's DAs and the City row, the characteristics below (each checked by its
label). Rows: geo_code, level, then one column per key; a suppressed cell is empty.
2011 also keeps dq, whose fourth digit marks a global non-response rate of 50% or
more. Needs pyivt with the legacy member-field fix (see nhs2011.py) and pyarrow.
"""
import csv
import re
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyivt

HERE = Path(__file__).parent
OUT = HERE / "out"
TORONTO_CSD = "3520005"

AGES = ["0 to 4", "5 to 9", "10 to 14", "15 to 19", "20 to 24", "25 to 29", "30 to 34", "35 to 39", "40 to 44",
        "45 to 49", "50 to 54", "55 to 59", "60 to 64", "65 to 69", "70 to 74", "75 to 79", "80 to 84"]
# 2006: ages by sex only (summed in demography.py); immigration on the 20% sample.
CHARS_2006 = {
    "age_tot": (2, "Total population by sex and age groups"),
    **{f"m{a.replace(' to ', '_')}": (4 + k, f"{a} years") for k, a in enumerate(AGES)},
    "m85": (21, "85 years and over"),
    **{f"f{a.replace(' to ', '_')}": (23 + k, f"{a} years") for k, a in enumerate(AGES)},
    "f85": (40, "85 years and over"),
    "imm_base": (474, "Total population by immigrant status and place of birth"),
    "non_imm": (475, "Non-immigrants"),
    "imm": (478, "Immigrants"),
    "npr": (511, "Non-permanent residents"),
    "imm_0_5": (553, "2001 to 2006"),
    "imm_5_10": (552, "1996 to 2000"),
}
NHS_2011 = {
    "imm_base": (16, "Total population in private households by immigrant status and period of immigration"),
    "non_imm": (17, "Non-immigrants"),
    "imm": (18, "Immigrants"),
    "imm_0_5": (25, "2006 to 2011"),
    "imm_5_10": (24, "2001 to 2005"),
    "npr": (26, "Non-permanent residents"),
    "rep_tot": (2491, "Total number of occupied private dwellings by condition of dwelling"),
    "rep_major": (2493, "Major repairs needed"),
    "bed_tot": (2508, "Total number of occupied private dwellings by number of bedrooms"),
    "bed3": (2511, "3 bedrooms"),
    "bed4": (2512, "4 or more bedrooms"),
    "own_tot": (2542, "Number of owner households in non-farm, non-reserve private dwellings"),
    "mort_pct": (2543, "% of owner households with a mortgage"),
    "avg_value": (2548, "Average value of dwellings ($)"),
}
DA_LABEL_2006 = re.compile(r"^(\d{8}) \((\d{7})\d{4}\)\s+(\S+)\s*$")
CSD_LABEL_2006 = re.compile(rf"^Toronto \({TORONTO_CSD}\) C\s+(\S+)\s*$")


def check(labels, chars):
    for key, (cid, name) in chars.items():
        found = labels[cid - 1].strip()
        if not found.startswith(name):
            sys.exit(f"characteristic {cid} is {found!r}, not {name!r} ({key})")
    return {cid: key for key, (cid, _) in chars.items()}


def write(path, rows, keys, extra=()):
    fields = ["geo_code", "level", *extra, *keys]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for code in sorted(rows):
            w.writerow(rows[code])
    print(f"  wrote {path} ({len(rows):,} rows)")


def y2006():
    t = pyivt.open(HERE / "raw" / "94-581-XCB2006002.IVT")
    m = t.metadata
    by_id = check(m.dimensions[1].members.en, CHARS_2006)
    keep = {}
    for i, g in enumerate(m.dimensions[2].members.en, 1):
        if (d := DA_LABEL_2006.match(g or "")) and d.group(2) == TORONTO_CSD:
            keep[i] = (d.group(1), "DA")
        elif CSD_LABEL_2006.match(g or ""):
            keep[i] = (TORONTO_CSD, "CSD")
    char_col, geo_col = t.layout.slugs[1], t.layout.slugs[2]
    rows, t0 = {}, time.time()
    for b in t.to_batches(batch_size=1_000_000, max_memory_bytes=4 << 30):
        mask = pc.and_(pc.is_in(b.column(geo_col), pa.array(list(keep), pa.int32())),
                       pc.is_in(b.column(char_col), pa.array(list(by_id), pa.int32())))
        if not pc.any(mask).as_py():
            continue
        s = b.filter(mask)
        for g, c, v in zip(s.column(geo_col).to_pylist(), s.column(char_col).to_pylist(), s.column("value").to_pylist()):
            code, level = keep[g]
            rows.setdefault(code, {"geo_code": code, "level": level})[by_id[c]] = "" if v is None else v
    print(f"2006: {len(rows):,} geographies in {time.time() - t0:.0f} s")
    write(OUT / "demography_2006.csv", rows, list(CHARS_2006))


def y2011():
    t = pyivt.open(HERE / "raw" / "NHSprofile_Can_PR_CD_CSD_DA.IVT")
    by_id = check(t.metadata.dimensions[1].members.en, NHS_2011)
    rows, t0 = {}, time.time()
    for b in t.to_batches(batch_size=1_000_000, max_memory_bytes=4 << 30):
        code = pc.cast(b.column("geography_code"), pa.string())
        keep = pc.and_(pc.starts_with(code, "3520"), pc.equal(pc.cast(b.column("2011_nhs_sex"), pa.string()), "Total"))
        keep = pc.and_(keep, pc.is_in(b.column("2011_nhs"), pa.array(list(by_id), pa.int32())))
        if not pc.any(keep).as_py():
            continue
        s = b.filter(keep)
        cols = [pc.cast(s.column(c), pa.string()).to_pylist() for c in ("geography_code", "geography_level_niveau", "geography_dq_qd")]
        for g, lvl, dq, cid, v, sym in zip(*cols, s.column("2011_nhs").to_pylist(), s.column("value").to_pylist(), s.column("symbol").to_pylist()):
            rows.setdefault(g, {"geo_code": g, "level": lvl.strip(), "dq": dq})[by_id[cid]] = "" if sym else v
    print(f"2011 NHS: {len(rows):,} geographies in {time.time() - t0:.0f} s")
    write(OUT / "demography_nhs2011.csv", rows, list(NHS_2011), extra=("dq",))


if __name__ == "__main__":
    y2006()
    y2011()
