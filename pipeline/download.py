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
"""
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
    for name, (package, resource, magic) in TORONTO.items():
        dest = RAW / name
        if dest.exists() and dest.open("rb").read(len(magic)) == magic:
            print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   {name}")
        try:
            url = ckan_url(package, resource)
        except Exception as e:
            print(f"  could not resolve resource: {e}")
            url = f"https://open.toronto.ca/dataset/{package}/ ({resource})"
        else:
            if fetch(url, dest, magic, attempts=6):
                continue
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
    sys.exit(main())
