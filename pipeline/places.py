"""Place points in 2021 DAs and the City's 158 neighbourhoods.

Shared by the point layers (crime.py, health.py, elections.py, trees.py,
rentals.py) so each places its records the same way permits.py and
city_layers.py do: a point lies in a 2021 DA by point-in-polygon, and a DA in
a neighbourhood by the 2021 figures file's assignment (common.json's nbhd_id).

DA outlines come from StatCan's 2021 boundary file (pipeline/raw/
lda_000b21a_e.zip) when it is on disk. StatCan's bot challenge often blocks
scripts from fetching it, so without it they are read from the committed
web/public/toronto_da.pmtiles at its deepest zoom (z13), whose tiles cut each
DA along tile edges; the pieces are dissolved by DAUID. At z13 a tile's 4096
units are about 1.4 m in Toronto, so only points within a metre or two of a DA
boundary can land in the neighbouring DA.

    da_polygons()        GeoDataFrame dauid, nbhd_id, geometry (EPSG:2952)
    place(df, lon, lat)  df with dauid and nbhd_id (NaN outside Toronto's DAs)
    households()         Series of 2021 private households by nbhd_id
    population()         Series of 2021 population by nbhd_id
"""
import json
from functools import lru_cache
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio

HERE = Path(__file__).parent
RAW = HERE / "raw"
WEB = HERE.parent / "web" / "public"
COMMON = WEB / "data" / "figures" / "2021" / "common.json"
BOUNDARY = RAW / "lda_000b21a_e.zip"
TILES = WEB / "toronto_da.pmtiles"
METRIC_CRS = 2952  # NAD83(CSRS) MTM zone 10, metres


@lru_cache
def common() -> pd.DataFrame:
    c = json.loads(COMMON.read_text())
    return pd.DataFrame({k: c[k] for k in ("dauid", "nbhd_id", "pop21", "hh")})


@lru_cache
def da_polygons() -> gpd.GeoDataFrame:
    """Toronto's 2021 DAs with their neighbourhood, in EPSG:2952."""
    c = common()
    if BOUNDARY.exists():
        g = gpd.read_file(f"zip://{BOUNDARY.as_posix()}!lda_000b21a_e.shp", columns=["DAUID"])
        g = g.rename(columns={"DAUID": "dauid"})
        g = g[g.dauid.isin(c.dauid)].to_crs(METRIC_CRS)
        source = "StatCan boundary file"
    else:
        layer = pyogrio.list_layers(TILES)[0][0]
        # GDAL opens a PMTiles file at its deepest zoom
        zmax = pyogrio.read_info(TILES, layer=layer)["dataset_metadata"]["ZOOM_LEVEL"]
        g = gpd.read_file(TILES, layer=layer, columns=["dauid"])
        g = g[g.dauid.isin(c.dauid)].to_crs(METRIC_CRS)
        g["geometry"] = g.buffer(0)
        g = g.dissolve("dauid").reset_index()[["dauid", "geometry"]]
        source = f"toronto_da.pmtiles z{zmax}"
    g = g.merge(c[["dauid", "nbhd_id"]], on="dauid", how="left")
    if len(g) != len(c):
        raise SystemExit(f"{len(g)} DA outlines from the {source}, expected {len(c)}")
    g.attrs["source"] = source
    return g


def place(df: pd.DataFrame, lon: str = "lon", lat: str = "lat", crs: int = 4326) -> pd.DataFrame:
    """Copy of df with dauid and nbhd_id by point-in-polygon; NaN where off the map
    or without coordinates. lon/lat name the x/y columns in `crs`."""
    out = df.copy()
    ok = out[lon].notna() & out[lat].notna()
    pts = gpd.GeoDataFrame(out.loc[ok, []], geometry=gpd.points_from_xy(out.loc[ok, lon], out.loc[ok, lat]),
                           crs=crs).to_crs(METRIC_CRS)
    j = gpd.sjoin(pts, da_polygons(), how="left", predicate="within")
    j = j[~j.index.duplicated()]  # a point exactly on a shared edge: first DA
    out["dauid"] = j.dauid.reindex(out.index)
    out["nbhd_id"] = j.nbhd_id.reindex(out.index)
    return out


def households() -> pd.Series:
    return common().groupby("nbhd_id").hh.sum()


def population() -> pd.Series:
    return common().groupby("nbhd_id").pop21.sum()
