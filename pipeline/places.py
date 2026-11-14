"""Place points in 2021 DAs and the City's 158 neighbourhoods.

Shared by the point layers (crime.py, health.py, elections.py, trees.py,
rentals.py) so each places its records the same way permits.py and
city_layers.py do: a point lies in a 2021 DA by point-in-polygon, and a DA in
a neighbourhood by the 2021 figures file's assignment (common.json's nbhd_id).

DA outlines are read from the committed web/public/toronto_da.pmtiles at its
deepest zoom (z13), on every machine. They used to come from StatCan's 2021
boundary file where it was on disk and from the tiles where it wasn't (StatCan's
bot challenge often blocks scripts from fetching it), so the same script gave
slightly different figures on the PC and in a cloud or CI run: a trial of the
heat figures moved 865 DAs by up to 0.17 degrees between the two. The tiles are
what every checkout has, and what the committed figures were made from.

The tiles cut each DA along tile edges; the pieces are dissolved by DAUID. At
z13 a tile's 4096 units are about 1.4 m in Toronto, so only points within a
metre or two of a DA boundary can land in the neighbouring DA, and a point in a
sliver between pieces goes to the nearest DA within SNAP (2 m).

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
TILES = WEB / "toronto_da.pmtiles"
METRIC_CRS = 2952  # NAD83(CSRS) MTM zone 10, metres
SNAP = 2  # metres: a point off every DA goes to the nearest within this


@lru_cache
def common() -> pd.DataFrame:
    c = json.loads(COMMON.read_text())
    return pd.DataFrame({k: c[k] for k in ("dauid", "nbhd_id", "pop21", "hh")})


@lru_cache
def da_polygons() -> gpd.GeoDataFrame:
    """Toronto's 2021 DAs with their neighbourhood, in EPSG:2952."""
    c = common()
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
    das = da_polygons()
    j = gpd.sjoin(pts, das, how="left", predicate="within")
    j = j[~j.index.duplicated()]  # a point exactly on a shared edge: first DA
    # The tiles' pieces leave slivers between DAs (median 0.14 m): a point in
    # one goes to the nearest DA within SNAP metres
    miss = j.dauid.isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts[miss], das, how="left", max_distance=SNAP)
        near = near[~near.index.duplicated()]
        j.loc[near.index, ["dauid", "nbhd_id"]] = near[["dauid", "nbhd_id"]].to_numpy()
    out["dauid"] = j.dauid.reindex(out.index)
    out["nbhd_id"] = j.nbhd_id.reindex(out.index)
    return out


def households() -> pd.Series:
    return common().groupby("nbhd_id").hh.sum()


def population() -> pd.Series:
    return common().groupby("nbhd_id").pop21.sum()
