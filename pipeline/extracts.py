"""Toronto's rows of the Statistics Canada tables, kept in the repository: pipeline/extracts/.

    python pipeline/extracts.py     # collect them and check them (make extracts)

The census profiles are bulk files of every area in Ontario or Canada: hundreds of megabytes
each, behind a site (www12.statcan.gc.ca) that refuses scripts, two of them in a format (Beyond
20/20) that needs a patched Rust extension to read. Each script that reads one keeps only
Toronto's rows of the characteristics measures.py names, as a CSV of a few megabytes.

Those extracts are what the site's census figures are actually computed from. They are small,
they don't change (a census isn't revised; a new one adds files), and the Statistics Canada Open
Licence allows passing them on with attribution (pipeline/extracts/README.md). So they are
committed, and a checkout holds everything `make from-extracts` needs: no www12, no pyivt, no
WSL. The raw files are needed again only when measures.py asks for a characteristic an extract
doesn't hold; the script that reads it then says which file to fetch.

What is here (EXTRACTS): the 2021, 2016 and 2011 Census Profile rows, the 2011 NHS and 2006
profile rows, and the 2021 and 2016 income groups the neighbourhood medians are interpolated
from. Not here: the boundary files (the tiles and the DA-to-neighbourhood assignment need them;
they are 100 to 200 MB each and belong on the `pipeline-inputs` release) and the model inputs
that pipeline/demography_ivt.py and permits.py cache in pipeline/out/.
"""
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
DIR = HERE / "extracts"
OLD = HERE / "out"  # where the scripts cached these before they were kept in the repository
# GitHub warns about a file over 50 MB and refuses one over 100 MB.
MAX_BYTES = 50 * 1024 * 1024

# name -> (what it holds, the script that writes it, the raw file that script reads)
EXTRACTS = {
    "toronto_profile_long.csv": (
        "2021 Census Profile (98-401-X2021006): Toronto's DAs and the city", "build.py",
        "98-401-X2021006_Ontario_eng_CSV.zip"),
    "toronto_profile_2016_long.csv": (
        "2016 Census Profile (98-401-X2016044): Toronto's DAs and the city", "census2016.py",
        "98-401-X2016044_ONTARIO_eng_CSV.zip"),
    "toronto_profile_2011_long.csv": (
        "2011 Census Profile (98-316-XWE2011001): Toronto's DAs", "census2011.py",
        "98-316-XWE2011001-1501-ONT.csv"),
    "toronto_nhs_2011.csv": (
        "2011 National Household Survey Profile (a Beyond 20/20 table): Toronto's DAs and the city",
        "nhs2011.py (needs pyivt)", "NHSprofile_Can_PR_CD_CSD_DA.IVT"),
    "toronto_profile_2006.csv": (
        "2006 Census Profile (94-581-XCB2006002): Toronto's DAs and the city",
        "profile2006.py (needs pyivt)", "94-581-XCB2006002.IVT"),
    "toronto_income_groups_2021.csv": (
        "2021 Census Profile: households and people by income group, Toronto's DAs", "insights.py",
        "98-401-X2021006_Ontario_eng_CSV.zip"),
    "toronto_income_groups_2016.csv": (
        "2016 Census Profile: households and people by income group, Toronto's DAs", "insights.py",
        "98-401-X2016044_ONTARIO_eng_CSV.zip"),
}


def _rel(p: Path) -> str:
    """A path as it reads from the repository's root."""
    try:
        return p.relative_to(HERE.parent).as_posix()
    except ValueError:
        return str(p)


def path(name: str) -> Path:
    """Where an extract is kept. One still in pipeline/out/ from before is copied across."""
    assert name in EXTRACTS, name
    here, old = DIR / name, OLD / name
    if not here.exists() and old.exists():
        DIR.mkdir(exist_ok=True)
        shutil.copy2(old, here)
        print(f"copied {_rel(old)} to {_rel(here)}")
    return here


def need_raw(raw: Path, extract: Path) -> None:
    """Stop, saying what to do, when an extract has to be rebuilt and its raw file isn't here."""
    if raw.exists():
        return
    why = "doesn't hold every characteristic measures.py asks for" if extract.exists() else "is missing"
    sys.exit(f"{_rel(extract)} {why}, and {_rel(raw)} isn't here to "
             f"rebuild it from.\nFetch the raw file (python pipeline/download.py prints its address if Statistics "
             f"Canada refuses the script), or restore the extract: git checkout -- {_rel(extract)}")


def main() -> int:
    """Collect the extracts (make extracts), then load each as `make from-extracts` will."""
    DIR.mkdir(exist_ok=True)
    print(f"extracts in {_rel(DIR)}:")
    missing, heavy = [], []
    for name, (what, script, raw) in EXTRACTS.items():
        f = path(name)
        if not f.exists():
            missing.append(name)
            print(f"  MISSING {name}: written by pipeline/{script} from pipeline/raw/{raw}")
            continue
        size = f.stat().st_size
        with f.open("rb") as fh:
            rows = sum(1 for _ in fh) - 1
        print(f"  {name}: {rows:,} rows, {size / 1e6:.1f} MB")
        if size > MAX_BYTES:
            heavy.append(name)
    if heavy:
        print(f"\nOver {MAX_BYTES // 1024 // 1024} MB, too big to commit comfortably: {heavy}. Say so before committing.")
    if missing:
        print(f"\n{len(missing)} missing. Run the script named beside each, then this again.")
        return 1

    # The same loads `make from-extracts` makes, with the raw files out of the picture: each
    # stops with a message if an extract lacks something measures.py asks for.
    import build
    import census2011
    import census2016
    import insights
    print("\nloading each as the rebuild will:")
    wide21, _ = build.pivot(build.extract(), keep_counts=True)
    wide16, _ = census2016.load_table(keep_counts=True)
    wide11, _ = census2011.load_table(keep_counts=True)
    for year, wide in (("2021", wide21), ("2016", wide16), ("2011", wide11)):
        groups = insights.income_groups(year)
        absent = wide.index.difference(groups.index)
        print(f"  {year}: {len(wide):,} DAs, {wide.shape[1]} columns; income groups for {len(groups):,} DAs"
              + (f" ({len(absent)} DAs without)" if len(absent) else ""))
    if not (path("toronto_profile_2006.csv").stat().st_size > 0):
        return 1
    print("\nAll here and readable. Commit pipeline/extracts/ (git add pipeline/extracts), then anyone can run\n"
          "make from-extracts on a fresh checkout.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
