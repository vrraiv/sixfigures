"""Fetch the raw inputs into pipeline/raw/.

StatCan inputs: 2021 and 2016 Census Profiles (Ontario, DA level), 2021 and 2016 DA
boundary files, the 2021<->2016 DA correspondence file (land-area version) and,
optionally, the 2021 forward sortation area (FSA) boundary file.

StatCan: www12.statcan.gc.ca sits behind a
Cloudflare bot challenge that often rejects non-browser clients with HTTP 403.
We try a plain download, verify the result is a real zip, and otherwise print
the URLs to fetch manually in a browser. A challenge page is never saved.

City of Toronto Open Data (neighbourhoods, address points, intersections, wards,
building permits):
resource URLs are resolved through the CKAN package_show API at download time.
The portal intermittently returns 504 error pages, so each download is retried
with backoff and checked for the expected leading bytes before it is kept.

CMHC (starts by census subdivision, Rental Market Survey zones, zone boundaries): plain
downloads, no bot challenge; see the CMHC section below.

With no options it fetches everything not yet on disk. The options fetch one part
(pipeline/data_refresh.py and the data-refresh workflow use them):

    --toronto FILE ...  these City of Toronto files (names as in TORONTO); with
                        --fresh, again even if on disk
    --trreb             TRREB's community reports for the quarters after the last
                        one in pipeline/trreb/community.csv
    --insideairbnb      any newer Inside Airbnb scrape the site lists (added to
                        pipeline/rentals/snapshots.json), then every scrape listed there
    --cmhc              the CMHC files (make cmhc)
"""
import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

RAW = Path(__file__).parent / "raw"
UA = {"User-Agent": "Mozilla/5.0"}

STATCAN = {
    "98-401-X2021006_Ontario_eng_CSV.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/"
        "download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=006_Ontario"
    ),
    "lda_000b21a_e.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/"
        "boundary-limites/files-fichiers/lda_000b21a_e.zip"
    ),
    "98-401-X2016044_ONTARIO_eng_CSV.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2016/dp-pd/prof/details/"
        "download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=044_ONTARIO"
    ),
    "lda_000b16a_e.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/"
        "files-fichiers/2016/lda_000b16a_e.zip"
    ),
    "2021_92-156-X_DALand_ADsup.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2021/geo/aip-pia/"
        "correspondence-correspondance/files-fichiers/2021_92-156-X_DALand_ADsup.zip"
    ),
    # 2011 Census Profile, dissemination areas, all of Canada (one CSV per province;
    # the Makefile unzips the Ontario one), 2011 DA boundaries, 2016<->2011 correspondence
    "98-316-XWE2011001-1501.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/dp-pd/prof/details/"
        "download-telecharger/comprehensive/comp_download.cfm?LANG=E&CTLG=98-316-XWE2011001&FMT=CSV1501"
    ),
    "gda_000b11a_e.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/"
        "files-fichiers/gda_000b11a_e.zip"
    ),
    "2016_92-156_DALand_ADsup_csv.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/geo/ref/"
        "files-fichiers/2016/2016_92-156_DALand_ADsup_csv.zip"
    ),
    # 2006 DA boundaries (digital) and the 2011<->2006 DA correspondence, for census2006.py
    "gda_000a06a_e.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/geo/bound-limit/"
        "files-fichiers/gda_000a06a_e.zip"
    ),
    "2011_92-156_DALand_ADsup_txt.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2011/geo/ref/"
        "files-fichiers/2011_92-156_DALand_ADsup_txt.zip"
    ),
}
# The 2011 NHS Profile for DAs was never a StatCan product (StatCan did not release
# DA-level NHS data; its comprehensive files stop at census tracts). A semi-custom
# tabulation went to universities through the Data Liberation Initiative, and the
# University of Toronto's deposit on Borealis (Scholars Portal) is public: one
# Beyond 20/20 table, zipped, 102 MB. Another Borealis deposit (hdl:10864/11372,
# file 16487) holds the same table unzipped, but that copy is corrupt as deposited:
# all but the last 8.5 MB of its 395 MB are zeros, and no reader opens it.
# local name -> (URL, MD5 as Borealis records it, whether the file is a zip holding it)
BOREALIS = {
    "NHSprofile_Can_PR_CD_CSD_DA.IVT": (
        "https://borealisdata.ca/api/access/datafile/7750",  # doi:10.5683/SP3/8BFD0R
        "56fa06ade0708b35c102e6a895cb3145",
        True,  # zipped
    ),
    # 2006 Census Profile, Canada to DAs (the last mandatory long form): a bare
    # Beyond 20/20 table in the DLI's 2006 Profile Series deposit
    # (doi:10.5683/SP3/RFXZIF, file 27195), 237,696,851 B. Sampled and fully
    # checked intact (MD5 below), unlike the damaged 2011 NHS copy.
    "94-581-XCB2006002.IVT": (
        "https://borealisdata.ca/api/access/datafile/27195",
        "cba104748aa71c675022b64f2b309e51",
        False,  # the bare table
    ),
}
# Optional: only the FSA overlay (overlays.py) uses it, so a failed download is
# reported but doesn't fail the run.
STATCAN_OPTIONAL = {
    "lfsa000b21a_e.zip": (  # 2021 forward sortation area cartographic boundary file
        "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/"
        "boundary-limites/files-fichiers/lfsa000b21a_e.zip"
    ),
}

# Ontario's School Information and Student Demographics files (schools.py), one per
# school year, English edition. data.ontario.ca adds a file each year (the 2023-24
# one is preliminary); add its line here.
SCHOOLS_DIR = RAW / "schools"
ONTARIO = "https://data.ontario.ca/dataset/d85f68c5-fcb0-4b4d-aec5-3047db47dcd5/resource/"
SCHOOLS = {
    "sif_2017_18.xlsx": "3d8e7824-d033-4ca5-a5de-aa0dbec99002/download/sif_data_table_2017_2018_en.xlsx",
    "sif_2018_19.xlsx": "bbbac037-b1c9-4b32-8f67-4fed1dfcac06/download/sif_data_table_2018_2019_en.xlsx",
    "sif_2019_20.xlsx": "602a5186-67f5-4faf-94f3-7c61ffc4719a/download/sif_data_table_2019_2020_en.xlsx",
    "sif_2020_21.xlsx": "600ab128-f50f-43a4-b4d4-97c39bb270b6/download/sif_data_table_2020_2021_en.xlsx",
    "sif_2021_22.xlsx": "e0e90bd5-d662-401a-a6d2-60d69ac89d14/download/sif_data_table_2021_2022_en.xlsx",
    "sif_2022_23.xlsx": "f95fc955-b1f0-4a2e-9b7f-cfa6eda37e0b/download/sif_data_table_2022_2023_en.xlsx",
    "sif_2023_24.xlsx": "f381e1de-3aa8-4ae9-826a-20009a6f4a01/download/"
                        "new_sif_data_table_2023_24prelim_en_january2026.xlsx",
    "sif_2024_25.xlsx": "f75540ed-59eb-49ab-ac43-976d563b3a65/download/new_sif_data_2024_25_final_en_sep_2026.xlsx",
}

CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id="
# local name -> (package id, resource name, expected leading bytes)
TORONTO = {
    "toronto_neighbourhoods_4326.geojson": ("neighbourhoods", "Neighbourhoods - 4326.geojson", b"{"),
    # Housing stock and pipeline (city_layers.py), refreshed daily to quarterly
    # upstream; delete them to fetch the current files.
    "toronto_apartment_buildings.csv": (
        "apartment-building-registration", "Apartment Building Registration Data.csv", b"_id,"),
    "toronto_rental_demolition.csv": (
        "demolition-and-replacement-of-rental-housing-units", "Rental Demolition and Replacement.csv", b"_id,"),
    "toronto_affordable_pipeline_4326.csv": (
        "upcoming-and-recently-completed-affordable-housing-units",
        "Affordable Rental Housing Pipeline - 4326.csv", b"_id,"),
    "toronto_development_applications.csv": (
        "development-applications", "Development Applications.csv", b"_id,"),
    "toronto_address_points_4326.csv": (
        "address-points-municipal-toronto-one-address-repository", "Address Points - 4326.csv", b"_id,"),
    "toronto_intersections_4326.csv": (
        "intersection-file-city-of-toronto", "Centreline Intersection - 4326.csv", b"_id,"),
    "toronto_wards_4326.geojson": ("city-wards", "City Wards Data - 4326.geojson", b"{"),
    # Building permits (permits.py): 150 MB, 156 MB and 68 MB, refreshed daily
    # upstream; delete them to fetch the current files.
    "toronto_permits_cleared_2017.csv": (
        "building-permits-cleared-permits", "Cleared Building Permits since 2017.csv", b"_id,"),
    "toronto_permits_cleared_2000_2016.csv": (
        "building-permits-cleared-permits", "Cleared Permits 2000 to 2016", b'"PERMIT_NUM"'),
    "toronto_permits_active.csv": (
        "building-permits-active-permits", "building-permits-active-permits.csv", b"_id,"),
    # Crime and traffic injuries (crime.py), refreshed quarterly (police) and daily (KSI)
    # upstream; delete them to fetch the current files.
    "toronto_neighbourhood_crime_rates_4326.csv": (
        "neighbourhood-crime-rates", "neighbourhood-crime-rates - 4326.csv", b"_id,"),
    "toronto_community_safety_indicators.csv": (
        "major-crime-indicators", "Community Safety Indicators.csv", b"_id,"),
    "toronto_shootings_4326.csv": (
        "shootings-firearm-discharges", "shootings-firearm-discharges - 4326.csv", b"_id,"),
    "toronto_homicides_4326.csv": (
        "police-annual-statistical-report-homicide", "Homicides - 4326.csv", b"_id,"),
    "toronto_ksi_4326.csv": (
        "motor-vehicle-collisions-involving-killed-or-seriously-injured-persons",
        "Motor Vehicle Collisions with KSI Data - 4326.csv", b"_id,"),
    # Short-term rental registrations (rentals.py): active numbers only, refreshed daily
    "toronto_str_registrations.csv": (
        "short-term-rentals-registration", "short-term-rental-registrations-data.csv", b"_id,"),
    # Mayoral elections by voting subdivision (elections.py)
    "toronto_election_results_2022.zip": ("election-results-official", "2022-results", b"PK"),
    "toronto_byelection_mayor_2023.xlsx": (
        "elections-official-by-election-results", "2023 Office of the Mayor", b"PK"),
    "toronto_voter_statistics_2022.xlsx": ("elections-voter-statistics", "2022-voter-statistics", b"PK"),
    "toronto_byelection_mayor_2023_voter_statistics.xlsx": (
        "elections-by-election-voter-statistics", "2023-mayoral-by-election-voter-statistics", b"PK"),
    "toronto_voting_subdivisions_2022_4326.geojson": (
        "elections-subdivisions", "voting-subdivisions-2022 - 4326.geojson", b"{"),
    "toronto_voting_subdivisions_2023_4326.geojson": (
        "elections-subdivisions", "voting-subdivisions-2023 - 4326.geojson", b"{"),
    # Street trees and 2018 land cover (trees.py); 145 MB and 436 MB
    "toronto_street_trees_4326.csv": ("street-tree-data", "Street Tree Data - 4326.csv", b"_id,"),
    "toronto_tree_canopy_2018.zip": ("forest-and-land-cover", "2018 Tree Canopy Study Geodatabase", b"PK"),
    # Canopy change 2008 to 2018 (trees.py): the 2008 study's tree cover by 140-model neighbourhood,
    # and those neighbourhoods' boundaries. (The package's "2008 Tree Canopy Study" RAR is the 2018
    # land cover again, so it isn't fetched.)
    "wellbeing_toronto_environment.xlsx": ("wellbeing-toronto-environment", "wellbeing-toronto-environment", b"PK"),
    "toronto_neighbourhoods_140_4326.geojson": ("neighbourhoods", "Neighbourhoods - historical 140 - 4326.geojson", b"{"),
    # DineSafe inspections (health.py), a rolling ~3-year window refreshed daily
    "toronto_dinesafe.csv": ("dinesafe", "Dinesafe.csv", b"_id,"),
}

# Inside Airbnb Toronto listings (rentals.py), CC BY 4.0, into pipeline/raw/insideairbnb/: the
# scrapes listed on insideairbnb.com/get-the-data (quarterly, ~last 12 months). Add each new date
# here and to rentals.SNAPSHOTS.
INSIDEAIRBNB_DIR = RAW / "insideairbnb"
INSIDEAIRBNB = "https://data.insideairbnb.com/canada/on/toronto/{}/data/listings.csv.gz"
INSIDEAIRBNB_PAGE = "https://insideairbnb.com/get-the-data/"
# the scrapes rentals.py reads (`--insideairbnb` adds newer ones the page lists)
INSIDEAIRBNB_SNAPSHOTS = Path(__file__).parent / "rentals" / "snapshots.json"
# TRREB's quarterly Community Housing Market Reports (trreb.py), one PDF per region and
# quarter, into pipeline/raw/trreb_community/. trreb.ca serves them to scripts; a quarter
# not yet posted answers 404 (TRREB posts them 8 to 12 weeks after the quarter ends).
# Reports before 2023 sit under other paths: those were downloaded by hand.
TRREB_DIR = RAW / "trreb_community"
TRREB_URL = "https://trreb.ca/wp-content/files/market-stats/community-reports/{y}/Q{q}/Toronto{r}Q{q}{y}.pdf"
TRREB_REGIONS = ["Central", "East", "West"]
TRREB_DONE = Path(__file__).parent / "trreb" / "community.csv"

# Deprivation indexes by 2021 DA (health.py), plain downloads (zip or xlsx).
# ON-Marg: non-commercial use only, credit PHO and St. Michael's, no modification
# (see health.py); CIMD: Statistics Canada Open Licence, from www150 (no bot challenge).
# The City's 2018 Tree Canopy Study (trees.py reads its Table 35 as a check; optional)
STUDY_2018 = ("toronto_tree_canopy_study_2018.pdf", "https://www.toronto.ca/legdocs/mmis/2020/ie/bgrd/backgroundfile-141368.pdf")

HEALTH = {
    "index-on-marg-2021.xlsx": "https://www.publichealthontario.ca/-/media/Data-Files/index-on-marg.xlsx",
    "cimd_2021_on_csv.zip": ("https://www150.statcan.gc.ca/n1/pub/45-20-0001/2023001/csv/"
                             "on_scores_quintiles_csv-eng.zip"),
}


# CMHC (cmhc.py), into pipeline/raw/cmhc/; past editions don't change, so files on disk are kept.
#  - Starts, completions and under construction by census subdivision, monthly from
#    January 2021 (Housing Information Monthly; no earlier edition is online)
#  - Rental Market Survey summary (October) from the Housing Market Information Portal's
#    table export, the same request the `cmhc` R package makes: by survey zone in the
#    Toronto CMA (zones from 2010) and for the City as a whole (from 2006)
#  - CMHC's 2017 survey-zone boundaries, a file geodatabase hosted (public, read-only) by
#    the `cmhc` package's author: the S3 bucket below
CMHC_DIR = RAW / "cmhc"
CMHC_SCU = ("https://assets.cmhc-schl.gc.ca/sites/cmhc/professional/housing-markets-data-and-research/"
            "housing-data-tables/housing-market-data/housing-information-monthly/"
            "{y}/{month}/starts-completions-under-construction-{m:02d}-{yy:02d}-en.xlsx")
CMHC_SCU_FIRST = (2021, 1)
CMHC_SCU_GAPS = {(2021, 3)}  # not on CMHC's server under any name tried (cmhc.py fills it)
HMIP_EXPORT = "https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/ExportTable"
HMIP_RMS = {  # local name -> (form fields without the year, first year)
    "rms_zones": ({"TableId": "2.1.31.3", "GeographyId": "2270", "GeographyTypeId": "3"}, 2010),
    "rms_city": ({"TableId": "2.1.31.3", "GeographyId": "3520005", "GeographyTypeId": "4", "MetId": "2270"}, 2006),
}
CMHC_GEO_BUCKET = "https://cmhc.s3.us-west-2.amazonaws.com"
CMHC_GEO = "RMS2017_3.gdb"  # MET_2017, NBHD_2017 and ZONE_2017 layers
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]


def fetch_hmip(fields: dict, dest: Path) -> str:
    """POST an HMIP table export; 'ok', 'none' (no data for that period) or 'failed'."""
    body = urllib.parse.urlencode({**fields, "Frequency": "Annual", "exportType": "csv"}).encode()
    try:
        req = urllib.request.Request(HMIP_EXPORT, data=body, headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r:
            text = r.read()
    except Exception as e:
        print(f"  failed: {e}")
        return "failed"
    if b"No data available" in text:
        return "none"
    if b"Rental Market Statistics Summary" not in text:
        print("  unexpected content")
        return "failed"
    dest.write_bytes(text)
    return "ok"


def cmhc() -> list:
    """Fetch the CMHC files; returns [(name, url)] that failed."""
    missing = []
    today = time.localtime()
    scu = CMHC_DIR / "scu"
    scu.mkdir(parents=True, exist_ok=True)
    y, m = CMHC_SCU_FIRST
    have, got, recent = 0, 0, []
    while (y, m) < (today.tm_year, today.tm_mon):
        dest = scu / f"scu-{y}-{m:02d}.xlsx"
        if (y, m) in CMHC_SCU_GAPS:
            pass
        elif dest.exists() and zipfile.is_zipfile(dest):
            have += 1
        else:
            url = CMHC_SCU.format(y=y, month=MONTHS[m - 1], m=m, yy=y % 100)
            if fetch(url, dest, b"PK"):
                got += 1
            elif (today.tm_year * 12 + today.tm_mon) - (y * 12 + m) <= 2:
                recent.append(f"{y}-{m:02d}")  # not published yet
            else:
                missing.append((dest.name, url))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    print(f"ok      CMHC starts by CSD: {have} editions on disk, {got} fetched"
          + (f"; not published yet: {', '.join(recent)}" if recent else ""))
    rms = CMHC_DIR / "rms"
    rms.mkdir(exist_ok=True)
    for name, (fields, first) in HMIP_RMS.items():
        have, got = 0, 0
        for year in range(first, today.tm_year + 1):
            dest = rms / f"{name}_{year}.csv"
            if dest.exists():
                have += 1
                continue
            status = fetch_hmip({**fields, "ForTimePeriod.Year": str(year)}, dest)
            got += status == "ok"
            if status == "failed" or (status == "none" and year < today.tm_year - 1):
                missing.append((dest.name, f"{HMIP_EXPORT} (POST {fields}, year {year})"))
        print(f"ok      CMHC {name}: {have} years on disk, {got} fetched")
    gdb = CMHC_DIR / CMHC_GEO
    if not (gdb / "gdb").exists():
        print(f"fetch   {CMHC_GEO}")
        try:
            with urllib.request.urlopen(f"{CMHC_GEO_BUCKET}/?list-type=2&prefix={CMHC_GEO}/", timeout=60) as r:
                listing = r.read().decode()
            keys = re.findall(r"<Key>([^<]+)</Key>", listing)
            if not keys or "<IsTruncated>true" in listing:
                raise ValueError(f"unexpected bucket listing ({len(keys)} keys)")
            # Only plain file names directly under the geodatabase folder
            bad = [k for k in keys if not re.fullmatch(rf"{re.escape(CMHC_GEO)}/[A-Za-z0-9_.]+", k) or ".." in k]
            if bad:
                raise ValueError(f"unexpected keys in the bucket listing: {bad[:3]}")
            tmp = CMHC_DIR / (CMHC_GEO + ".part")
            shutil.rmtree(tmp, ignore_errors=True)
            tmp.mkdir()
            for key in keys:
                name = key.split("/", 1)[1]
                with urllib.request.urlopen(f"{CMHC_GEO_BUCKET}/{urllib.parse.quote(key)}", timeout=120) as r:
                    (tmp / name).write_bytes(r.read())
            tmp.replace(gdb)
        except Exception as e:
            print(f"  failed: {e}")
            missing.append((CMHC_GEO, f"{CMHC_GEO_BUCKET}/{CMHC_GEO}/"))
    else:
        print(f"ok      {CMHC_GEO}")
    return missing


def fetch(url: str, dest: Path, magic: bytes, attempts: int = 1) -> bool:
    """Stream url to dest only if the body starts with `magic`."""
    tmp = dest.with_name(dest.name + ".part")
    for i in range(attempts):
        if i:
            time.sleep(15 * i)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                head = r.read(len(magic))
                if head != magic:
                    print(f"  unexpected content ({r.headers.get('Content-Type')})")
                    continue
                f.write(head)
                shutil.copyfileobj(r, f, 1 << 20)
            tmp.replace(dest)
            return True
        except Exception as e:  # 403 bot challenge, 504 gateway timeout, resets
            print(f"  attempt {i + 1} failed: {e}")
        finally:
            tmp.unlink(missing_ok=True)
    return False


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_zipped(url: str, dest: Path, digest: str) -> bool:
    """Download the zip holding `dest`, check its MD5, and extract `dest` from it."""
    z = dest.with_suffix(".zip")
    if not (z.exists() and zipfile.is_zipfile(z)) and not fetch(url, z, b"PK", attempts=3):
        return False
    if md5(z) != digest:
        print(f"  {z.name} does not match the repository's MD5 ({digest}); re-download it")
        return False
    with zipfile.ZipFile(z) as f:
        f.extract(dest.name, dest.parent)
    return dest.exists()


def fetch_checked(url: str, dest: Path, digest: str) -> bool:
    """Download a bare file to `dest` and keep it only if its MD5 matches."""
    if not fetch(url, dest, b"", attempts=3):
        return False
    if md5(dest) != digest:
        print(f"  {dest.name} does not match the repository's MD5 ({digest}); removed")
        dest.unlink()
        return False
    return True


def ckan_url(package: str, resource: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(CKAN + package, headers=UA), timeout=60) as r:
        res = json.load(r)["result"]["resources"]
    return next(x["url"] for x in res if x["name"] == resource)


def toronto_file(name: str, fresh: bool = False) -> tuple[bool, str]:
    """Fetch one of the TORONTO files unless it is on disk (or fresh); (ok, url)."""
    package, resource, magic = TORONTO[name]
    dest = RAW / name
    if not fresh and dest.exists() and dest.open("rb").read(len(magic)) == magic:
        print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
        return True, ""
    print(f"fetch   {name}")
    try:
        url = ckan_url(package, resource)
    except Exception as e:
        print(f"  could not resolve resource: {e}")
        return False, f"https://open.toronto.ca/dataset/{package}/ ({resource})"
    return fetch(url, dest, magic, attempts=6), url


def toronto(names: list[str], fresh: bool) -> list:
    """Fetch the named TORONTO files; returns [(name, url)] that failed."""
    unknown = [n for n in names if n not in TORONTO]
    if unknown:
        sys.exit(f"not in download.py's TORONTO: {unknown}")
    RAW.mkdir(exist_ok=True)
    failed = []
    for name in names:
        ok, url = toronto_file(name, fresh)
        if not ok:
            failed.append((name, url))
    return failed


def last_complete_quarter(today: time.struct_time) -> tuple[int, int]:
    q = (today.tm_mon - 1) // 3  # quarters finished this year
    return (today.tm_year, q) if q else (today.tm_year - 1, 4)


def trreb() -> list[str]:
    """Fetch TRREB's three regional reports for each finished quarter after the last one in
    community.csv, stopping at the first quarter not posted yet. Returns the quarters fetched."""
    with open(TRREB_DONE, newline="") as f:
        y, q = max((int(r["year"]), int(r["q"])) for r in csv.DictReader(f))
    end = last_complete_quarter(time.localtime())
    TRREB_DIR.mkdir(parents=True, exist_ok=True)
    got = []
    while True:
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
        if (y, q) > end:
            break
        files = {r: TRREB_DIR / f"Toronto{r}Q{q}{y}.pdf" for r in TRREB_REGIONS}
        ok = all((f.exists() and f.open("rb").read(4) == b"%PDF")
                 or fetch(TRREB_URL.format(y=y, q=q, r=r), f, b"%PDF", attempts=2) for r, f in files.items())
        if not ok:  # a quarter needs all three regions
            for f in files.values():
                f.unlink(missing_ok=True)
            print(f"wait    TRREB {y} Q{q}: not posted yet (if the error above is a 404)")
            break
        print(f"ok      TRREB {y} Q{q}")
        got.append(f"{y} Q{q}")
    if not got:
        print("TRREB: no new quarter")
    return got


def insideairbnb_new() -> list[str]:
    """Add the Toronto scrapes insideairbnb.com/get-the-data lists that are newer than the
    last in snapshots.json; returns them."""
    req = urllib.request.Request(INSIDEAIRBNB_PAGE, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        page = r.read().decode("utf-8", "replace")
    listed = sorted(set(re.findall(r"data\.insideairbnb\.com/canada/on/toronto/(\d{4}-\d{2}-\d{2})/data/listings\.csv\.gz", page)))
    if not listed:
        sys.exit(f"{INSIDEAIRBNB_PAGE} lists no Toronto listings file: has the page changed?")
    s = json.loads(INSIDEAIRBNB_SNAPSHOTS.read_text())
    new = [d for d in listed if d > s["snapshots"][-1]]
    if new:
        s["snapshots"] += new
        INSIDEAIRBNB_SNAPSHOTS.write_text(json.dumps(s, indent=2) + "\n")
    print(f"Inside Airbnb: the page lists {', '.join(listed)}; " + (f"new: {', '.join(new)}" if new else "no new scrape"))
    return new


def insideairbnb() -> list:
    """Fetch every scrape in snapshots.json not yet on disk; returns [(name, url)] that failed."""
    INSIDEAIRBNB_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for date in json.loads(INSIDEAIRBNB_SNAPSHOTS.read_text())["snapshots"]:
        dest = INSIDEAIRBNB_DIR / f"toronto_listings_{date}.csv.gz"
        if dest.exists() and dest.open("rb").read(2) == b"\x1f\x8b":
            print(f"ok      insideairbnb/{dest.name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   insideairbnb/{dest.name}")
        if not fetch(INSIDEAIRBNB.format(date), dest, b"\x1f\x8b", attempts=3):
            failed.append((f"insideairbnb/{dest.name}", INSIDEAIRBNB.format(date)))
    return failed


def main() -> int:
    RAW.mkdir(exist_ok=True)
    missing, optional = [], []
    for name, url in {**STATCAN, **STATCAN_OPTIONAL}.items():
        dest = RAW / name
        if dest.exists() and zipfile.is_zipfile(dest):
            print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   {name}")
        if not fetch(url, dest, b"PK"):
            (optional if name in STATCAN_OPTIONAL else missing).append((name, url))
    for name, (url, digest, zipped) in BOREALIS.items():
        dest = RAW / name
        # Beyond 20/20 tables start with 02 00 20 00 or 04 00 20 00.
        if dest.exists() and dest.open("rb").read(4) in (b"\x02\x00\x20\x00", b"\x04\x00\x20\x00"):
            print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   {name}")
        if not (fetch_zipped if zipped else fetch_checked)(url, dest, digest):
            missing.append((name, url))
    missing += cmhc()
    missing += toronto(list(TORONTO), fresh=False)
    SCHOOLS_DIR.mkdir(exist_ok=True)
    for name, path in SCHOOLS.items():
        dest = SCHOOLS_DIR / name
        if dest.exists() and zipfile.is_zipfile(dest):
            print(f"ok      schools/{name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   schools/{name}")
        if not fetch(ONTARIO + path, dest, b"PK", attempts=3):
            missing.append((f"schools/{name}", ONTARIO + path))
    missing += insideairbnb()
    name, url = STUDY_2018
    if (RAW / name).exists():
        print(f"ok      {name} ({(RAW / name).stat().st_size:,} bytes)")
    else:
        print(f"fetch   {name}")
        if not fetch(url, RAW / name, b"%PDF", attempts=3):
            optional.append((name, url))
    for name, url in HEALTH.items():
        dest = RAW / name
        if dest.exists() and zipfile.is_zipfile(dest):
            print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   {name}")
        if not fetch(url, dest, b"PK", attempts=3):
            missing.append((name, url))
    if optional:
        print("\nOptional downloads failed (overlays.py skips the FSA overlay without them).")
        print(f"To include them, download these in a browser and save them to {RAW.resolve()}:")
        for name, url in optional:
            print(f"  {name}\n    {url}")
    if missing:
        print("\nSome downloads failed. StatCan blocks scripts with a bot challenge;")
        print("the Toronto portal sometimes times out (rerun later).")
        print(f"Download these in a browser and save them to {RAW.resolve()}:")
        for name, url in missing:
            print(f"  {name}\n    {url}")
        return 1
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fetch the raw inputs into pipeline/raw/ (all of them, or one part).")
    ap.add_argument("--toronto", nargs="+", metavar="FILE", help="only these City of Toronto files (TORONTO's names)")
    ap.add_argument("--fresh", action="store_true", help="with --toronto: fetch again even if on disk")
    ap.add_argument("--trreb", action="store_true", help="TRREB's reports for quarters after community.csv's last")
    ap.add_argument("--insideairbnb", action="store_true", help="newer Inside Airbnb scrapes, then every one listed")
    ap.add_argument("--cmhc", action="store_true", help="only the CMHC files (make cmhc)")
    a = ap.parse_args()
    if not (a.toronto or a.trreb or a.insideairbnb or a.cmhc):
        sys.exit(main())
    failed = []
    if a.toronto:
        failed += toronto(a.toronto, a.fresh)
    if a.trreb:
        trreb()  # a quarter not posted yet isn't a failure
    if a.insideairbnb:
        insideairbnb_new()
        failed += insideairbnb()
    if a.cmhc:
        failed += cmhc()
    for name, url in failed:
        print(f"failed  {name}\n    {url}")
    sys.exit(1 if failed else 0)
