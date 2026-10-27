"""Boundary overlays drawn over the income map: City neighbourhoods, City wards
and (when the StatCan file is present) forward sortation areas (FSAs).

    python pipeline/overlays.py

Writes pipeline/out/overlays/<kind>.geojson (polygons) and <kind>_label.geojson
(one label point per area, inside it), which `make overlays` turns into
web/public/overlays.pmtiles with one layer per file. The FSA file comes from
StatCan's bot-challenged site, so without it the FSA layers are left out; the
map offers only the overlays the tiles contain.
"""
from pathlib import Path

import geopandas as gpd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "out" / "overlays"
METRIC_CRS = 2952  # NAD83(CSRS) / MTM zone 10, as in build.py
FSA_ZIP = RAW / "lfsa000b21a_e.zip"


def neighbourhoods() -> gpd.GeoDataFrame:
    g = gpd.read_file(RAW / "toronto_neighbourhoods_4326.geojson")
    return g.assign(code=g.AREA_SHORT_CODE, label=g.AREA_NAME)


def wards() -> gpd.GeoDataFrame:
    g = gpd.read_file(RAW / "toronto_wards_4326.geojson")
    return g.assign(code=g.AREA_SHORT_CODE.astype(int).astype(str), label=g.AREA_NAME + " (" + g.AREA_SHORT_CODE.astype(int).astype(str) + ")")


def fsas() -> gpd.GeoDataFrame | None:
    if not FSA_ZIP.exists():
        return None
    g = gpd.read_file(f"zip://{FSA_ZIP.as_posix()}!lfsa000b21a_e.shp", engine="pyogrio")
    g = g[g.CFSAUID.str.startswith("M")]  # M = Toronto
    return g.assign(code=g.CFSAUID, label=g.CFSAUID)


def write(kind: str, g: gpd.GeoDataFrame):
    m = g[["code", "label", "geometry"]].to_crs(METRIC_CRS)
    m["area_km2"] = (m.area / 1e6).round(2)
    pts = m.copy()
    pts["geometry"] = m.representative_point()
    for name, df in ((kind, m), (f"{kind}_label", pts)):
        path = OUT / f"{name}.geojson"
        df.to_crs(4326).to_file(path, driver="GeoJSON", engine="pyogrio", layer_options={"COORDINATE_PRECISION": 6})
        print(f"wrote {path} ({len(df)} features)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.geojson"):  # a dropped FSA file must not linger in the tiles
        old.unlink()
    layers = {"nbhd": neighbourhoods(), "ward": wards(), "fsa": fsas()}
    for kind, g in layers.items():
        if g is None:
            print(f"skip  {kind}: {FSA_ZIP.name} not in {RAW} (see download.py)")
            continue
        write(kind, g)


if __name__ == "__main__":
    main()
