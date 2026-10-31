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
"""
import hashlib
import json
import shutil
import sys
import time
import urllib.error
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
}


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
    SCHOOLS_DIR.mkdir(exist_ok=True)
    for name, path in SCHOOLS.items():
        dest = SCHOOLS_DIR / name
        if dest.exists() and zipfile.is_zipfile(dest):
            print(f"ok      schools/{name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   schools/{name}")
        if not fetch(ONTARIO + path, dest, b"PK", attempts=3):
            missing.append((f"schools/{name}", ONTARIO + path))
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
