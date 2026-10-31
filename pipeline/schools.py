"""School test results (EQAO), by school and neighbourhood.

    python pipeline/schools.py

Reads Ontario's School Information and Student Demographics files, one per
school year from 2017-18 (download.py fetches them into pipeline/raw/schools/),
and writes pipeline/schools/:

  schools.csv     every school in the City, every school year: board, type,
                  language, level, grade range, special condition, enrolment,
                  coordinates, its 2021 DA and neighbourhood, the share of
                  students at the provincial standard in each EQAO test, and the
                  school's demographic shares. year is the spring the tests were
                  written (2018-19 = 2019); test results are blank where a file
                  repeats an earlier year's (below). Shares are percents
  by_nbhd.csv     the elementary score by neighbourhood and test year, two ways
                  (method):
                    nearest  each 2021 DA takes the nearest school reporting each
                             Grade 3 and Grade 6 result, one public and one
                             Catholic, weighted by the two boards' shares of City
                             elementary enrolment that year; neighbourhoods
                             average their DAs weighted by children aged 0-14
                             (2021). Covers all 158; the primary target
                    inside   the schools located in the neighbourhood, weighted
                             by enrolment; blank where none report a result
                  g3_read ... g6_math are the six Grade 3 and 6 results (percent
                  at the provincial standard), score their mean, score_vs_city
                  the score less the City's that year (enrolment-weighted over
                  the same schools); preliminary marks 2024, from the
                  Ministry's preliminary 2023-24 file
  manifest.json   files, retrieval dates and checks

The score uses Grades 3 and 6 only: Grade 9 math was two tests (academic and
applied) until 2019 and one since, and secondary schools draw from wide areas.
Scored schools are English-language public and Catholic elementary schools
without a special condition (alternative, adult and so on). French-language
schools, whose boards draw from much of the city, stay in schools.csv but not in
the score.

No tests were written in 2020 or 2021: the 2019-20 and 2020-21 files repeat the
2018-19 results, which this checks before dropping them. The 2023-24 file is
the Ministry's preliminary edition. Test years: 2018, 2019, 2022-2025.

The files write shares three ways: "62%" strings, integer percents and
fractions (0.62), sometimes within one column. A column's bare numbers are
fractions if any is a fraction below 1 or the column also has "%" strings, and
percents otherwise (share()).

No school attendance areas are published (the City's school "districts" are
trustee wards), so both methods place schools by their coordinates; the
Ministry's municipality and city fields name the former municipalities.
"""
import datetime as dt
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw" / "schools"
OUT = HERE / "schools"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures"
INSIGHTS = HERE.parent / "web" / "public" / "insights.json"
BOUNDARY = f"zip://{(HERE / 'raw' / 'lda_000b21a_e.zip').as_posix()}!lda_000b21a_e.shp"
METRIC_CRS = 2952

# school year -> spring of the tests in the file; None where the file repeats an
# earlier year's results
FILES = {
    "2017-18": 2018, "2018-19": 2019, "2019-20": None, "2020-21": None,
    "2021-22": 2022, "2022-23": 2023, "2023-24": 2024, "2024-25": 2025,
}
REPEATS = {"2019-20": "2018-19", "2020-21": "2018-19"}
PRELIMINARY = {"2023-24"}

# column -> header text (a header matches if it contains the text)
TEXT = {
    "board_number": "Board Number", "board": "Board Name", "school_number": "School Number",
    "name": "School Name", "type": "School Type", "special": "School Special Condition Code",
    "level": "School Level", "language": "School Language", "grades": "Grade Range",
    "enrolment": "Enrolment", "lat": "Latitude", "lon": "Longitude",
}
SHARES = {
    "g3_read": "Grade 3 Students Achieving the Provincial Standard in Reading",
    "g3_write": "Grade 3 Students Achieving the Provincial Standard in Writing",
    "g3_math": "Grade 3 Students Achieving the Provincial Standard in Mathematics",
    "g6_read": "Grade 6 Students Achieving the Provincial Standard in Reading",
    "g6_write": "Grade 6 Students Achieving the Provincial Standard in Writing",
    "g6_math": "Grade 6 Students Achieving the Provincial Standard in Mathematics",
    "g9_math": "Grade 9 Students Achieving the Provincial Standard in Mathematics",
    "g9_academic": "Grade 9 Students Achieving the Provincial Standard in Academic Mathematics",
    "g9_applied": "Grade 9 Students Achieving the Provincial Standard in Applied Mathematics",
    "osslt": "Passed the Grade 10 OSSLT on Their First Attempt",
    "low_income": "Live in Low-Income Households",
    "no_degree": "Parents Have No Degree, Diploma or Certificate",
    "not_english": "First Language Is Not English",
    "new_canada": "New to Canada from a Non-English Speaking Country",
    "special_ed": "Receiving Special Education Services",
    "gifted": "Identified as Gifted",
}
TESTS = ["g3_read", "g3_write", "g3_math", "g6_read", "g6_write", "g6_math"]
EXAMS = TESTS + ["g9_math", "g9_academic", "g9_applied", "osslt"]
TYPES = ["Public", "Catholic"]

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def read_xlsx(path: Path) -> list[list]:
    """The first sheet's rows as lists of strings (None for empty cells)."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    sheet = ET.fromstring(z.read("xl/workbook.xml")).find(f"{NS}sheets")[0]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    target = rels[sheet.get(REL)].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    rows = []
    for row in ET.fromstring(z.read(target)).iter(f"{NS}row"):
        vals = {}
        for c in row.iter(f"{NS}c"):
            v = c.find(f"{NS}v")
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(f"{NS}t"))
            else:
                val = v.text if v is not None else None
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            vals[col - 1] = val
        rows.append([vals.get(i) for i in range(max(vals) + 1)] if vals else [])
    return rows


def share(col: pd.Series) -> tuple[pd.Series, str]:
    """A share column as percents, and the scale its bare numbers were read on."""
    s = col.astype(object).where(col.notna(), "").astype(str).str.replace(" ", "")
    pct = s.str.endswith("%")
    bare = pd.to_numeric(s.where(~pct), errors="coerce").astype(float)
    out = pd.to_numeric(s.where(pct).str.rstrip("%"), errors="coerce").astype(float)
    fraction = ((bare % 1 != 0) & (bare < 1)).any() or pct.any()
    if fraction:
        # a bare number above 1 in a fraction column is a percent
        out = out.fillna(bare.where(bare > 1, bare * 100))
        scale = "fraction"
    elif bare.max() > 1:
        out = out.fillna(bare)
        scale = "percent"
    else:
        scale = "empty" if bare.isna().all() else "unresolved"
        out = out.fillna(bare * 100)
    return out.round(1), scale


def load(year: str) -> tuple[pd.DataFrame, dict]:
    rows = read_xlsx(RAW / f"sif_{year.replace('-', '_')}.xlsx")
    head = [str(h).strip() for h in rows[0]]
    body = [r + [None] * (len(head) - len(r)) for r in rows[1:] if any(r)]
    raw = pd.DataFrame(body, columns=head)
    df, scales = pd.DataFrame(index=raw.index), {}
    for k, text in {**TEXT, **SHARES}.items():
        hits = [h for h in head if text in h and not (k == "g9_math" and ("Academic" in h or "Applied" in h))]
        if len(hits) > 1:
            sys.exit(f"{year}: {k} matches {hits}")
        if not hits:
            df[k] = np.nan
            continue
        if k in SHARES:
            df[k], scales[k] = share(raw[hits[0]])
        else:
            df[k] = raw[hits[0]].astype("string").str.strip()
    bad = {k: v for k, v in scales.items() if v == "unresolved"}
    if bad:
        sys.exit(f"{year}: can't tell the scale of {bad}")
    out_of_range = {k: int((~df[k].between(0, 100) & df[k].notna()).sum()) for k in SHARES}
    if any(out_of_range.values()):
        sys.exit(f"{year}: shares outside 0-100: {out_of_range}")
    df["school_number"] = df.school_number.str.replace(r"\.0$", "", regex=True).str.zfill(6)
    for k in ("enrolment", "lat", "lon"):
        df[k] = pd.to_numeric(df[k], errors="coerce")
    df.insert(0, "school_year", year)
    return df, scales


def place(df: pd.DataFrame) -> pd.DataFrame:
    """Each row's 2021 DA and neighbourhood (point in polygon), for rows in the City."""
    pts = df.dropna(subset=["lat", "lon"])
    pts = gpd.GeoDataFrame(index=pts.index, geometry=gpd.points_from_xy(pts.lon, pts.lat), crs=4326)
    j = gpd.sjoin(pts.to_crs(METRIC_CRS), das(), predicate="within", how="inner")
    return pd.DataFrame(j[["DAUID", "nbhd_id"]])


def das() -> gpd.GeoDataFrame:
    """Toronto's 2021 DAs with their neighbourhood and children aged 0-14."""
    da = gpd.read_file(BOUNDARY, engine="pyogrio", where="DAUID LIKE '3520%'", columns=["DAUID"]).to_crs(METRIC_CRS)
    common = json.loads((FIGURES / "2021" / "common.json").read_text())
    age = json.loads((FIGURES / "2021" / "age0_14.json").read_text())["v"]
    f = pd.DataFrame({"DAUID": common["dauid"], "nbhd_id": common["nbhd_id"],
                      "children": pd.to_numeric(pd.Series(common["pop21"]), errors="coerce")
                      * pd.to_numeric(pd.Series(age), errors="coerce") / 100})
    da = da.merge(f, on="DAUID", how="left")
    if da.nbhd_id.isna().any():
        sys.exit(f"{da.nbhd_id.isna().sum()} DAs without a neighbourhood")
    return da


def scored(s: pd.DataFrame) -> pd.Series:
    """Schools in the score: English public and Catholic elementary, no special condition."""
    return (s.nbhd_id.notna() & s.year.notna() & (s.level == "Elementary") & (s.language == "English")
            & s.type.isin(TYPES) & (s.special == "Not applicable"))


def weighted(g: pd.DataFrame, cols: list[str], w: str) -> pd.Series:
    out = {}
    for c in cols:
        ok = g[c].notna() & g[w].notna()
        out[c] = np.average(g.loc[ok, c], weights=g.loc[ok, w]) if g.loc[ok, w].sum() > 0 else np.nan
    return pd.Series(out)


def inside(s: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (year, nbhd), g in s.groupby(["year", "nbhd_id"]):
        r = weighted(g, TESTS, "enrolment")
        r["schools"] = int(g[TESTS].notna().any(axis=1).sum())
        r["enrolment"] = g.enrolment.sum()
        rows.append(r.rename((year, nbhd)))
    out = pd.DataFrame(rows)
    out.index = pd.MultiIndex.from_tuples(out.index, names=["year", "nbhd_id"])
    return out


def nearest(s: pd.DataFrame, da: gpd.GeoDataFrame) -> pd.DataFrame:
    pts = da[["DAUID", "nbhd_id", "children"]].copy()
    pts = gpd.GeoDataFrame(pts, geometry=da.geometry.representative_point(), crs=METRIC_CRS)
    rows = []
    for year, g in s.groupby("year"):
        g = gpd.GeoDataFrame(g, geometry=gpd.points_from_xy(g.lon, g.lat), crs=4326).to_crs(METRIC_CRS)
        shares = g.groupby("type").enrolment.sum().reindex(TYPES) / g.enrolment.sum()
        v = pd.DataFrame(index=pts.index, columns=TESTS, dtype=float).fillna(0.0)
        used = set()
        for t in TYPES:
            for c in TESTS:
                src = g[(g["type"] == t) & g[c].notna()][[c, "school_number", "geometry"]]
                j = gpd.sjoin_nearest(pts[["geometry"]], src, how="left")
                j = j[~j.index.duplicated()]  # ties: the first
                v[c] += shares[t] * j[c]
                used |= set(j.school_number)
        v["nbhd_id"], v["children"] = pts.nbhd_id, pts.children.fillna(0)
        r = v.groupby("nbhd_id").apply(lambda x: weighted(x, TESTS, "children"), include_groups=False)
        r["schools"] = np.nan
        r["year"] = year
        rows.append(r.reset_index())
        print(f"  nearest {year}: {len(used)} schools serve the {len(pts):,} DAs")
    return pd.concat(rows).set_index(["year", "nbhd_id"])


def city(s: pd.DataFrame) -> pd.Series:
    return s.groupby("year").apply(lambda g: weighted(g, TESTS, "enrolment"), include_groups=False).mean(axis=1)


def corr(x: pd.Series, y: pd.Series) -> float:
    x, y = x.align(y, join="inner")
    ok = x.notna() & y.notna()
    return round(float(np.corrcoef(x[ok], y[ok])[0, 1]), 3)


def main() -> int:
    missing = [f"sif_{y.replace('-', '_')}.xlsx" for y in FILES if not (RAW / f"sif_{y.replace('-', '_')}.xlsx").exists()]
    if missing:
        sys.exit(f"missing {missing} in {RAW}; run pipeline/download.py")
    for p in (FIGURES / "2021" / "common.json", FIGURES / "2021" / "age0_14.json", INSIGHTS):
        if not p.exists():
            sys.exit(f"missing {p}; run make data")
    OUT.mkdir(exist_ok=True)
    checks, frames = {"scales": {}}, {}
    for y in FILES:
        frames[y], scales = load(y)
        checks["scales"][y] = scales
        print(f"{y}: {len(frames[y]):,} schools; bare numbers read as "
              f"{ {k: v for k, v in scales.items() if v != 'empty'} }")

    # The repeat files must carry the earlier year's results exactly: a check of
    # the share parsing too, since the formats differ between them
    checks["repeats"] = {}
    for y, src in REPEATS.items():
        a = frames[y].set_index("school_number")[TESTS]
        b = frames[src].set_index("school_number")[TESTS]
        a, b = a.align(b, join="inner")
        both = a.notna() & b.notna()
        diff = int(((a - b).abs() > 0.5)[both].sum().sum())
        only = int((a.notna() ^ b.notna()).sum().sum())
        checks["repeats"][y] = {"schools": len(a), "results_compared": int(both.sum().sum()),
                                "differ": diff, "present_in_one": only}
        print(f"{y} vs {src}: {checks['repeats'][y]}")
        if diff:
            sys.exit(f"{y} doesn't repeat {src}'s results; check share()")

    s = pd.concat(frames.values(), ignore_index=True)
    s["year"] = s.school_year.map(FILES).astype("Int64")
    s.loc[s.year.isna(), EXAMS] = np.nan
    s["preliminary"] = s.school_year.isin(PRELIMINARY)
    # coordinates missing in a year come from the school's nearest year with them
    s["yr"] = s.school_year.str[:4].astype(int)
    known = s.dropna(subset=["lat", "lon"])
    filled = 0
    for i in s.index[s.lat.isna() | s.lon.isna()]:
        k = known[known.school_number == s.at[i, "school_number"]]
        if len(k):
            r = k.loc[(k.yr - s.at[i, "yr"]).abs().idxmin()]
            s.loc[i, ["lat", "lon"]] = r.lat, r.lon
            filled += 1
    moved = known.groupby("school_number")[["lat", "lon"]].agg(lambda x: x.max() - x.min()).max(axis=1)
    checks["coordinates"] = {"filled_from_another_year": filled, "still_missing": int(s.lat.isna().sum()),
                             "schools_moving_over_500m": int((moved > 0.0045).sum())}
    print(f"coordinates: {checks['coordinates']}")
    # Each school year is placed at that year's coordinates: a few schools move
    # (a rebuild, a holding site)
    frames_all = s
    p = place(s)
    s = s.join(p, how="inner")
    moved = s.groupby("school_number").nbhd_id.nunique()
    checks["schools_changing_neighbourhood"] = sorted(moved.index[moved > 1])
    # the two Toronto boards' schools left out: no coordinates in any year, or
    # outside the City
    out = frames_all[frames_all.board.isin(["Toronto DSB", "Toronto CDSB"])
                     & ~frames_all.school_number.isin(s.school_number)].drop_duplicates("school_number")
    checks["toronto_boards_unplaced"] = [f"{r.school_year} {r.school_number} {r['name']} ({r.level}, {r.special})"
                                         for _, r in out.iterrows()]
    print(f"Toronto boards' schools not placed: {checks['toronto_boards_unplaced']}")
    s = s.drop(columns="yr")
    s["nbhd_id"] = s.nbhd_id.astype(int)
    print(f"in the City: {s.school_number.nunique():,} schools; by board "
          f"{s.drop_duplicates('school_number').board.value_counts().head(6).to_dict()}")

    sc = s[scored(s)].copy()
    per_year = sc.groupby("year").agg(schools=("school_number", "size"),
                                      all_six=("g3_read", lambda x: int(sc.loc[x.index, TESTS].notna().all(axis=1).sum())),
                                      any=("g3_read", lambda x: int(sc.loc[x.index, TESTS].notna().any(axis=1).sum())))
    print(f"scored schools by test year:\n{per_year.to_string()}")
    checks["scored_schools"] = json.loads(per_year.to_json(orient="index"))

    da = das()
    ins = inside(sc)
    near = nearest(sc, da)
    c = city(sc)
    out = []
    for method, df in (("nearest", near), ("inside", ins)):
        df = df.copy()
        df["score"] = df[TESTS].mean(axis=1, skipna=False)
        df["score_vs_city"] = df.score - df.index.get_level_values("year").map(c)
        df["method"] = method
        out.append(df.reset_index())
    by = pd.concat(out)
    nbhds = sorted(da.nbhd_id.unique())
    grid = pd.MultiIndex.from_product([["nearest", "inside"], sorted(sc.year.dropna().unique()), nbhds],
                                      names=["method", "year", "nbhd_id"])
    by = by.set_index(["method", "year", "nbhd_id"]).reindex(grid).reset_index()
    by["year"] = by.year.astype(int)
    by["nbhd_id"] = by.nbhd_id.astype(int)
    by["schools"] = by.schools.astype("Int64")
    by["enrolment"] = by.enrolment.round().astype("Int64")
    for k in TESTS + ["score", "score_vs_city"]:
        by[k] = by[k].round(2)
    by["preliminary"] = by.year.isin([FILES[y] for y in PRELIMINARY])
    by = by[["nbhd_id", "year", "preliminary", "method", "schools", "enrolment", *TESTS, "score", "score_vs_city"]]

    # checks against what the exploration found
    wide = {m: by[by.method == m].pivot(index="nbhd_id", columns="year", values="score") for m in ("nearest", "inside")}
    sw = sc.assign(score=sc[TESTS].mean(axis=1, skipna=False)).pivot_table(
        index="school_number", columns="year", values="score")
    years = sorted(sw.columns)
    ins_cov = by[(by.method == "inside")].groupby("year").agg(
        covered=("score", lambda x: int(x.notna().sum())),
        two_or_more=("schools", lambda x: int((x >= 2).sum())))
    insights = json.loads(INSIGHTS.read_text())
    inc = pd.Series(insights["measures"]["med_hh_tot"]["values"]["2021"],
                    index=[n["id"] for n in insights["nbhd"]], dtype=float)
    checks["stability"] = {
        "school_consecutive": {f"{a}-{b}": corr(sw[a], sw[b]) for a, b in zip(years, years[1:])},
        "school_2019_2025": corr(sw[2019], sw[2025]),
        "nbhd_2019_2025": {m: corr(w[2019], w[2025]) for m, w in wide.items()},
        "nearest_vs_inside": {int(y): corr(wide["nearest"][y], wide["inside"][y]) for y in years},
    }
    checks["inside_coverage"] = json.loads(ins_cov.to_json(orient="index"))
    checks["vs_log_median_household_income_2021"] = {
        m: {int(y): corr(w[y], np.log(inc)) for y in (2019, 2025)} for m, w in wide.items()}
    lo = sc[sc.year == 2025].assign(score=lambda x: x[TESTS].mean(axis=1, skipna=False)).dropna(
        subset=["score", "low_income"])
    checks["school_score_vs_low_income_2025_r2"] = round(corr(lo.score, lo.low_income) ** 2, 3)
    checks["city_score"] = {int(k): round(float(v), 2) for k, v in c.items()}
    print(f"inside coverage (of 158):\n{ins_cov.to_string()}")
    print(json.dumps({k: checks[k] for k in ("stability", "vs_log_median_household_income_2021",
                                            "school_score_vs_low_income_2025_r2", "city_score")}, indent=1))

    cols = ["school_year", "year", "preliminary", "board_number", "board", "school_number", "name", "type",
            "language", "level", "grades", "special", "enrolment", "lat", "lon", "DAUID", "nbhd_id",
            *EXAMS, "low_income", "no_degree", "not_english", "new_canada", "special_ed", "gifted"]
    s = s[cols].sort_values(["school_year", "school_number"])
    s["enrolment"] = s.enrolment.astype("Int64")
    s.to_csv(OUT / "schools.csv", index=False)
    by.sort_values(["method", "year", "nbhd_id"]).to_csv(OUT / "by_nbhd.csv", index=False)
    manifest = {"built": dt.date.today().isoformat(), "primary_method": "nearest",
                "files": {y: {"name": f"sif_{y.replace('-', '_')}.xlsx",
                              "bytes": (RAW / f"sif_{y.replace('-', '_')}.xlsx").stat().st_size,
                              "retrieved": dt.date.fromtimestamp(
                                  (RAW / f"sif_{y.replace('-', '_')}.xlsx").stat().st_mtime).isoformat(),
                              "test_year": FILES[y], "preliminary": y in PRELIMINARY} for y in FILES},
                "checks": checks}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
