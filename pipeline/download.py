"""Fetch the two raw StatCan inputs into pipeline/raw/.

StatCan's www12 host sits behind a Cloudflare bot challenge that often
rejects non-browser clients with HTTP 403. This script tries a plain
download, verifies the result is a real zip, and otherwise prints the
URLs to fetch manually in a browser. It never saves a challenge page.
"""
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

RAW = Path(__file__).parent / "raw"

SOURCES = {
    "98-401-X2021006_Ontario_eng_CSV.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/"
        "download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=006_Ontario"
    ),
    "lda_000b21a_e.zip": (
        "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/"
        "boundary-limites/files-fichiers/lda_000b21a_e.zip"
    ),
}


def fetch(url: str, dest: Path) -> bool:
    tmp = dest.with_suffix(".part")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            if r.read(2) != b"PK":
                print(f"  not a zip (got {r.headers.get('Content-Type')})")
                return False
            f.write(b"PK")
            shutil.copyfileobj(r, f, 1 << 20)
    except Exception as e:  # HTTPError 403 from the bot challenge lands here
        print(f"  failed: {e}")
        return False
    finally:
        if tmp.exists() and not zipfile.is_zipfile(tmp):
            tmp.unlink()
    if not tmp.exists():
        return False
    tmp.replace(dest)
    return True


def main() -> int:
    RAW.mkdir(exist_ok=True)
    missing = []
    for name, url in SOURCES.items():
        dest = RAW / name
        if dest.exists() and zipfile.is_zipfile(dest):
            print(f"ok      {name} ({dest.stat().st_size:,} bytes)")
            continue
        print(f"fetch   {name}")
        if not fetch(url, dest):
            missing.append((name, url))
    if missing:
        print("\nAutomatic download failed (StatCan's bot challenge blocks scripts).")
        print(f"Download these in a browser and save them to {RAW.resolve()}:")
        for name, url in missing:
            print(f"  {name}\n    {url}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
