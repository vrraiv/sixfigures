"""The street map under the census maps: a Toronto-sized cut of the Protomaps basemap.

Protomaps publishes a daily OpenStreetMap build of the whole world as one PMTiles archive
(https://maps.protomaps.com/builds/). The archive is about 115 GB, but PMTiles can be read
with HTTP range requests, so this fetches only the tiles that cover Toronto and writes them
to web/public/basemap.pmtiles. vite.config.js unpacks that into static tile files, like the
census tiles (scripts/extract-tiles.mjs), and the map's style is built from
@protomaps/basemaps (scripts/basemap-style.mjs). Nothing is fetched from a third party when
a visitor opens the map.

    python pipeline/basemap.py                  the latest build
    python pipeline/basemap.py --build 20261112 a particular day's (builds are kept a week)

The streets change slowly and the census maps are drawn over them, so this is run rarely
(when the map should show a new building or road) and the result committed. Protomaps asks
for copies in your own storage in place of hotlinking, which is what this makes.

Zoom 0 to 14. The map magnifies the last level beyond that, which is plenty under a census
map; zoom 15 would add about 60 MB for the same area. The area is the census map's bounds
(BOUNDS in web/src/common.js) plus a margin, so the neighbouring cities show a little way
out. Data © OpenStreetMap contributors (ODbL), tiles by Protomaps.
"""
import argparse
import json
import math
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

from pmtiles.reader import Reader
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

OUT = Path("web/public/basemap.pmtiles")
BUILDS = "https://build-metadata.protomaps.dev/builds.json"
BUILD_URL = "https://build.protomaps.com/{}.pmtiles"
# web/src/common.js BOUNDS: the census map's frame, west, south, east, north
CITY = (-79.6393, 43.5792, -79.1153, 43.8555)
MARGIN = 0.04  # degrees, about 3 km
MAX_ZOOM = 14
UA = "sixfigures-basemap-extract"


def get(url, headers=None, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise


def latest_build():
    builds = json.loads(get(BUILDS))
    keys = sorted(b["key"] for b in builds if re.fullmatch(r"\d{8}\.pmtiles", b["key"]))
    return keys[-1].removesuffix(".pmtiles")


def tile_x(lon, z):
    return min(max(int((lon + 180) / 360 * 2**z), 0), 2**z - 1)


def tile_y(lat, z):
    r = math.radians(lat)
    return min(max(int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**z), 0), 2**z - 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--build", help="a day's build, YYYYMMDD (default: the latest)")
    args = ap.parse_args()
    build = args.build or latest_build()
    url = BUILD_URL.format(build)
    print(f"Protomaps build {build}", flush=True)

    @lru_cache(maxsize=4096)  # directories are read again and again; tiles are read once
    def get_bytes(offset, length):
        return get(url, {"Range": f"bytes={offset}-{offset + length - 1}"})

    reader = Reader(get_bytes)
    src = reader.header()
    if src["tile_type"] != TileType.MVT:
        sys.exit(f"{url}: expected vector tiles")
    w, s, e, n = CITY[0] - MARGIN, CITY[1] - MARGIN, CITY[2] + MARGIN, CITY[3] + MARGIN
    jobs = []
    for z in range(MAX_ZOOM + 1):
        for x in range(tile_x(w, z), tile_x(e, z) + 1):
            for y in range(tile_y(n, z), tile_y(s, z) + 1):
                jobs.append((zxy_to_tileid(z, x, y), z, x, y))
    jobs.sort()  # PMTiles wants tiles in Hilbert order, which is tile-id order
    print(f"{len(jobs)} tiles to fetch", flush=True)

    with ThreadPoolExecutor(16) as pool:
        tiles = list(pool.map(lambda j: reader.get(j[1], j[2], j[3]), jobs))

    gzip_in_source = src["tile_compression"] == Compression.GZIP
    if not gzip_in_source:
        sys.exit("expected gzip-compressed tiles")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    kept = size = 0
    with write(OUT) as out:
        for (tid, *_), data in zip(jobs, tiles):
            if data:
                out.write_tile(tid, data)
                kept += 1
                size += len(data)
        meta = reader.metadata()
        meta.update({
            "name": f"Protomaps basemap, Toronto, build {build}",
            "attribution": '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
            "description": f"Zoom 0-{MAX_ZOOM} of {w:.4f},{s:.4f},{e:.4f},{n:.4f}, cut from the build with pipeline/basemap.py",
        })
        out.finalize({
            "tile_type": TileType.MVT,
            "tile_compression": Compression.GZIP,
            "min_zoom": 0,
            "max_zoom": MAX_ZOOM,
            "min_lon_e7": int(w * 1e7),
            "min_lat_e7": int(s * 1e7),
            "max_lon_e7": int(e * 1e7),
            "max_lat_e7": int(n * 1e7),
            "center_zoom": 10,
            "center_lon_e7": int((w + e) / 2 * 1e7),
            "center_lat_e7": int((s + n) / 2 * 1e7),
        }, meta)
    print(f"{kept} tiles, {size / 1e6:.1f} MB of tiles -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
