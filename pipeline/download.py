"""Fetch the raw inputs into pipeline/raw/.

StatCan inputs: 2021 and 2016 Census Profiles (Ontario, DA level), 2021 and 2016 DA
boundary files, the 2021<->2016 DA correspondence file (land-area version) and,
optionally, the 2021 forward sortation area (FSA) boundary file.

StatCan: www12.statcan.gc.ca sits behind a
Cloudflare bot challenge that often rejects non-browser clients with HTTP 403.
We try a plain download, verify the result is a real zip, and otherwise print
the URLs to fetch manually in a browser. A challenge page is never saved.

City of Toronto Open Data (neighbourhoods, address points, intersections, wards):
resource URLs are resolved through the CKAN package_show API at download time.
The portal intermittently returns 504 error pages, so each download is retried
with backoff and checked for the expected leading bytes before it is kept.
"""
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
    "toronto_address_points_4326.csv": (
        "address-points-municipal-toronto-one-address-repository", "Address Points - 4326.csv", b"_id,"),
    "toronto_intersections_4326.csv": (
        "intersection-file-city-of-toronto", "Centreline Intersection - 4326.csv", b"_id,"),
    "toronto_wards_4326.geojson": ("city-wards", "City Wards Data - 4326.geojson", b"{"),
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
