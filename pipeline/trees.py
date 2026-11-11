"""Street trees, tree canopy and summer surface temperature, by DA and neighbourhood.

    python pipeline/trees.py

Three sources, for the "hotter and fewer trees, against income" story. Writes
pipeline/trees/:

  by_da.csv      one row per 2021 Toronto DA (3,743): dauid, nbhd_id, area_ha,
                 street trees (trees, trees_per_ha, dbh_median, large_share,
                 top_species, top_species_common, top_species_share), canopy
                 (canopy_ha, canopy_share) and land surface temperature
                 (lst_c, lst_anom, lst_scenes)
  by_nbhd.csv    the same for the 158 neighbourhoods, from the trees, canopy
                 area and pixels themselves (not averages of DA figures)
  lst_by_pass_nbhd.csv  each Landsat pass's mean surface temperature by
                        neighbourhood (pooled pixels) and its difference from
                        that pass's city mean: nbhd_id, date, lst_c, lst_anom
  species_city.csv      every street-tree species city-wide: species, common
                        name, genus, family, trees, share
  species_by_nbhd.csv   each neighbourhood's TOP_SPECIES (12) commonest species
  diversity_by_nbhd.csv by neighbourhood: trees, species_n, Shannon index, the
                        commonest species, genus and family with their shares,
                        family_mapped_share, norway_maple_share, meets_10_20_30
                        (no species over 10%, genus over 20%, family over 30%)
  manifest.json  retrieval dates, file sizes, the Landsat scenes, match rates
                 and checks

`python pipeline/trees.py --species` rewrites only the three species files (and
the manifest's diversity checks), without the canopy and Landsat steps.

Street trees (City of Toronto Open Data, `street-tree-data`, resource "Street
Tree Data - 4326.csv"; 688,335 rows, the same as the CKAN datastore's total,
retrieved 2026-11-11, refreshed upstream 2026-06-04). City-owned trees on road
allowances only: no park, ravine or private trees (some confirmed-private trees
on the road allowance are in it). Urban Forestry geocodes many trees to the
parcel address, so a point can sit inside the private lot; that moves it a few
metres, rarely into another DA. Each row is one tree (OBJECTID unique), placed
by places.place() at its point.
  - trees_per_ha: trees per hectare of the DA's whole area (land and any water
    inside the outline; places.da_polygons(), EPSG:2952)
  - DBH_TRUNK is the trunk diameter at breast height in cm. 3,307 rows have
    none, and values above DBH_MAX (300 cm; 39 rows, up to 9,380) are entry
    errors, so both are left out of dbh_median and large_share (they still
    count as trees). Toronto's biggest street trees are about 150-250 cm.
  - large_share: share of trees with a DBH of LARGE_DBH (50 cm) or more,
    about the top 13% city-wide: mature shade trees, where most canopy is
  - top_species: the most common botanical species (genus and species, with
    "x" hybrids keeping the third word: "Acer x freemanii"; cultivars fold into
    their species, so "Gleditsia triacanthos 'Skyline'" is honey locust); a
    genus-only record ("Tilia") counts as its own entry. top_species_common is
    the commonest COMMON_NAME among its trees; ties go alphabetically. Empty
    where a DA has no trees.

Canopy (Open Data `forest-and-land-cover`, resource "2018 Tree Canopy Study
Geodatabase", landcover2018_gdb.zip, 436,398,730 B; retrieved 2026-11-11). The
City's 2018 land cover, eight classes, as polygons (layer LandCover2018,
EPSG:2952, 1,812 multipolygons, dissolved by class, ward and 140-model
neighbourhood). "Top down": canopy over roads, roofs and grass counts as tree.
Class 1 (tree) covers 166.4 km2 of the 643.4 km2 mapped. canopy_ha is the area
of the tree polygons inside each DA (exact intersection, after splitting the
multipolygons into 343,873 parts); canopy_share divides by the DA's area. The
2008 study (a 617 MB RAR) is not used. The geodatabase (621 MB unzipped) is
unzipped into a temporary folder under raw/ for each run.

Land surface temperature (Landsat 8 and 9 Collection 2 Level-2, from Microsoft
Planetary Computer's STAC API, collection landsat-c2-l2; assets are read with an
anonymous SAS token from its /api/sas/v1/token endpoint, no account. USGS's own
AWS bucket, usgs-landsat, is requester-pays, so it needs signed AWS requests.)
  - Passes: every Landsat 8/9 scene over Toronto from June to August,
    2021-2025, with scene cloud cover under MAX_SCENE_CLOUD (10%): 27 scenes,
    none in summer 2021. The two rows of one overpass (path 18, rows 29 and 30)
    are mosaicked. A pass is kept if at least MIN_CLEAR (90%) of the land
    pixels in Toronto's DAs are clear in QA_PIXEL (not fill, dilated cloud,
    cirrus, cloud or cloud shadow; water is left out too): 11 of 23 passes,
    2022-06-14 to 2025-08-10, listed with their scene ids in manifest.json.
    Path 17 scenes miss the city's north-west corner, so its DAs (nbhd 1, 2)
    rest on the 4-5 path 18 passes; lst_scenes says how many.
  - USGS's surface temperature band (ST_B10) is missing over 27-29% of the
    clear DA pixels (usgs_st_share), in patches where the ASTER GED
    emissivity it relies on has no data (the emis band is fill exactly
    there, in every scene). So the temperature is computed here for every
    pixel the way USGS does it, from the product's own thermal radiance and
    atmosphere bands (TRAD = atran * (e * B(T) + (1 - e) * drad) + urad,
    inverted for T with band 10's K1, K2), but with emissivity e from NDVI
    (Sobrino's threshold method: 0.971 for NDVI < 0.2, 0.987 above 0.5,
    mixed between by the vegetation fraction, 0.991 for water). With USGS's
    emissivity the same formula reproduces ST_B10 to 0.17 C (sd 0.01, on a
    test scene). With NDVI emissivity it reads 0.58 C cooler than ST_B10
    where both exist (sd 0.89, 5.3 million pixel-passes; per pass in
    manifest.json): NDVI can't see roofs' lower emissivity, so built-up
    pixels read a little cool, which slightly understates the heat contrast.
  - Only a window around Toronto is read from each cloud-optimized GeoTIFF;
    raw/landsat/<scene id>.tif caches QA_PIXEL, USGS ST and this LST (3 bands,
    about 6 MB a scene, 131 MB in all)
  - per pass, a DA's value is the mean of its clear pixels (pixel centre
    inside the DA; a DA too small to hold a centre takes the pixels it
    touches), in deg C, if at least half its pixels are clear
  - lst_c is the median over passes of those means; lst_anom the median of
    the DA's difference from the pass's mean over all clear DA pixels, which
    takes out the weather of the day and the mix of dates (use it to compare
    places). Large cool DAs (parks, ravines) pull the city mean down, so the
    typical DA's lst_anom is about +1 C. A neighbourhood pools its DAs' pixels
  - Thermal pixels are 100 m natively (delivered on a 30 m grid), so a small
    DA's figure includes its surroundings. It is the temperature of the
    ground, roofs, roads and canopy at about noon EDT (15:57-16:03 UTC), not
    air temperature.

DAs and neighbourhoods come from places.da_polygons() (the StatCan boundary
file if on disk, otherwise the committed z13 tiles).

Results (2026-11-11 run): 688,313 of 688,335 trees placed (22 outside the DAs,
none without coordinates; 9 DAs have no street trees). Canopy: 166.35 of
166.43 km2 inside the DAs, 26.2% of their area. Across DAs, against median
household income: trees per ha r 0.34 (rho 0.37), canopy share r 0.43 (0.41),
lst_anom r -0.19 (-0.14); lst_anom against canopy share r -0.69. Street trees
per ha correlate slightly positively with lst_anom (r 0.16): street trees are
densest on the gridded, built-up older streets, so they track density more
than shade.

Checks (manifest.json): every tree row placed or accounted for (no
coordinates, or outside Toronto's DAs) and the sums of by_da and by_nbhd equal
to the trees placed; canopy area inside DAs against the class total; and the
correlation (Pearson r, Spearman rho) across DAs of trees per ha, canopy share
and LST with the 2021 median household income (web/public/data/figures/2021/
med_hh_tot.json, `v`, aligned with common.json's DAs; suppressed DAs left out),
plus LST against canopy.
"""
import datetime as dt
import json
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely

from places import common, da_polygons, place

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "trees"
FIGURES = HERE.parent / "web" / "public" / "data" / "figures" / "2021"

TREES = RAW / "toronto_street_trees_4326.csv"
CANOPY_ZIP = RAW / "toronto_tree_canopy_2018.zip"
CANOPY_GDB = "LandCover2018.gdb"  # in the zip
LANDSAT = RAW / "landsat"

DBH_MAX = 300  # cm; larger values are entry errors
LARGE_DBH = 50  # cm

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"
SUMMERS = range(2021, 2026)  # June-August of each
MAX_SCENE_CLOUD = 10  # eo:cloud_cover, %
MIN_CLEAR = 0.90  # share of Toronto's DA pixels clear in QA_PIXEL
MIN_DA_CLEAR = 0.5  # share of a DA's pixels clear for its scene mean to count
TORONTO_BBOX = [-79.64, 43.58, -79.11, 43.86]
QA_BAD = 0b11111 | (1 << 7)  # fill, dilated cloud, cirrus, cloud, shadow; water
ST_SCALE, ST_OFFSET = 0.00341802, 149.0
K_B10 = {"landsat-8": (774.8853, 1321.0789), "landsat-9": (799.0284, 1329.2405)}  # TIRS band 10 K1, K2
# NDVI emissivity (Sobrino et al. 2004, threshold method)
NDVI_SOIL, NDVI_VEG = 0.2, 0.5
EPS_SOIL, EPS_VEG, EPS_WATER = 0.971, 0.987, 0.991


# ---------------------------------------------------------------- street trees

def species(botanical: pd.Series) -> pd.Series:
    """Genus and species ("Acer platanoides"), three words for "x" hybrids."""
    w = botanical.fillna("").str.replace("'", " ").str.split()
    sp = w.map(lambda x: " ".join(x[:3] if len(x) > 2 and x[1].lower() == "x" else x[:2]))
    return sp.str.capitalize().replace("", np.nan)


def street_trees() -> pd.DataFrame:
    t = pd.read_csv(TREES, usecols=["_id", "OBJECTID", "BOTANICAL_NAME", "COMMON_NAME", "DBH_TRUNK", "geometry"])
    if not t.OBJECTID.is_unique:
        sys.exit("OBJECTID repeats: rows are not one tree each")
    xy = t.pop("geometry").map(lambda g: json.loads(g)["coordinates"][0] if isinstance(g, str) else [np.nan] * 2)
    t["lon"], t["lat"] = xy.str[0], xy.str[1]
    t["dbh"] = t.DBH_TRUNK.where(t.DBH_TRUNK.between(1, DBH_MAX))
    t["species"] = species(t.BOTANICAL_NAME)
    return place(t)


def tree_stats(t: pd.DataFrame, key: str) -> pd.DataFrame:
    p = t[t[key].notna()]
    g = p.groupby(key)
    out = pd.DataFrame({"trees": g.size(), "dbh_median": g.dbh.median(),
                        "large_share": g.dbh.apply(lambda s: (s >= LARGE_DBH).sum() / s.count() if s.count() else np.nan)})
    n = p.groupby([key, "species"]).size().rename("n").reset_index()
    n = n.sort_values([key, "n", "species"], ascending=[True, False, True]).drop_duplicates(key).set_index(key)
    out["top_species"] = n.species
    out["top_species_share"] = n.n / out.trees
    names = p.groupby(["species", "COMMON_NAME"]).size().rename("n").reset_index()
    names = names.sort_values(["species", "n", "COMMON_NAME"], ascending=[True, False, True]).drop_duplicates("species")
    out["top_species_common"] = out.top_species.map(names.set_index("species").COMMON_NAME)
    return out


# Botanical family of each genus in the file, for the 10-20-30 rule (no species over 10% of
# a street-tree population, no genus over 20%, no family over 30%; Santamour 1990).
# "Allianthus" and "Crategus" are the file's spellings of Ailanthus and Crataegus;
# "Alix" (0.01%) is left unmapped.
FAMILY = {
    "Sapindaceae": "Acer Aesculus Koelreuteria", "Fabaceae": "Gleditsia Gymnocladus Robinia Cercis Cladrastis Maackia Sophora Laburnum Caragana",
    "Fagaceae": "Quercus Fagus Castanea", "Malvaceae": "Tilia", "Pinaceae": "Picea Pinus Abies Pseudotsuga Tsuga Larix",
    "Ulmaceae": "Ulmus Zelkova", "Rosaceae": "Malus Pyrus Prunus Amelanchier Sorbus Crataegus Crategus",
    "Oleaceae": "Syringa Fraxinus", "Ginkgoaceae": "Ginkgo", "Cannabaceae": "Celtis",
    "Betulaceae": "Betula Corylus Ostrya Carpinus Alnus", "Platanaceae": "Platanus",
    "Cupressaceae": "Thuja Juniperus Chamaecyparis Metasequoia Xanthocyparis Taxodium", "Magnoliaceae": "Liriodendron Magnolia",
    "Bignoniaceae": "Catalpa", "Moraceae": "Morus", "Juglandaceae": "Juglans Carya", "Cercidiphyllaceae": "Cercidiphyllum",
    "Salicaceae": "Salix Populus", "Simaroubaceae": "Ailanthus Allianthus", "Taxaceae": "Taxus", "Rutaceae": "Phellodendron Ptelea",
    "Cornaceae": "Cornus", "Nyssaceae": "Nyssa", "Altingiaceae": "Liquidambar", "Elaeagnaceae": "Elaeagnus",
    "Anacardiaceae": "Cotinus Rhus", "Rhamnaceae": "Rhamnus Frangula", "Lauraceae": "Sassafras", "Hamamelidaceae": "Hamamelis",
    "Celastraceae": "Euonymus", "Araliaceae": "Aralia", "Viburnaceae": "Sambucus", "Annonaceae": "Asimina",
}
GENUS_FAMILY = {g: f for f, gs in FAMILY.items() for g in gs.split()}
NORWAY_MAPLE = "Acer platanoides"
TOP_SPECIES = 12  # species listed per neighbourhood in species_by_nbhd.csv


def diversity(t: pd.DataFrame) -> dict:
    """Species, genus and family make-up of the street trees, city-wide and by neighbourhood:
    writes species_city.csv, species_by_nbhd.csv and diversity_by_nbhd.csv; returns checks."""
    t = t[t.species.notna()].copy()
    t["genus"] = t.species.str.split().str[0]
    t["family"] = t.genus.map(GENUS_FAMILY)
    names = t.groupby(["species", "COMMON_NAME"]).size().rename("n").reset_index()
    common_name = names.sort_values(["species", "n", "COMMON_NAME"], ascending=[True, False, True]).drop_duplicates("species").set_index("species").COMMON_NAME

    city = t.species.value_counts().rename("trees").rename_axis("species").reset_index()
    city["common"] = city.species.map(common_name)
    city["genus"] = city.species.str.split().str[0]
    city["family"] = city.genus.map(GENUS_FAMILY)
    city["share"] = (city.trees / city.trees.sum()).round(5)
    city.to_csv(OUT / "species_city.csv", index=False, lineterminator="\n")

    p = t[t.nbhd_id.notna()].copy()
    p["nbhd_id"] = p.nbhd_id.astype(int)
    sp = p.groupby(["nbhd_id", "species"]).size().rename("trees").reset_index()
    sp = sp.sort_values(["nbhd_id", "trees", "species"], ascending=[True, False, True])
    top = sp.groupby("nbhd_id").head(TOP_SPECIES).copy()
    top["common"] = top.species.map(common_name)
    top[["nbhd_id", "species", "common", "trees"]].to_csv(OUT / "species_by_nbhd.csv", index=False, lineterminator="\n")

    def top_of(col):
        n = p.groupby(["nbhd_id", col]).size().rename("n").reset_index()
        n = n.sort_values(["nbhd_id", "n", col], ascending=[True, False, True]).drop_duplicates("nbhd_id").set_index("nbhd_id")
        return n[col], n.n

    total = p.groupby("nbhd_id").size()
    shares = sp.assign(q=sp.trees / sp.nbhd_id.map(total))
    out = pd.DataFrame({"trees": total, "species_n": sp.groupby("nbhd_id").size(),
                        "shannon": shares.groupby("nbhd_id").q.apply(lambda q: float(-(q * np.log(q)).sum())).round(3)})
    for col in ("species", "genus", "family"):
        name, n = top_of(col)
        out[f"top_{col}"] = name
        out[f"top_{col}_share"] = (n / total).round(4)
    out["family_mapped_share"] = (p.groupby("nbhd_id").family.count() / total).round(4)
    out["norway_maple_share"] = (p[p.species == NORWAY_MAPLE].groupby("nbhd_id").size().reindex(total.index, fill_value=0) / total).round(4)
    out["meets_10_20_30"] = (out.top_species_share <= 0.10) & (out.top_genus_share <= 0.20) & (out.top_family_share <= 0.30)
    out.index.name = "nbhd_id"
    out.reset_index().to_csv(OUT / "diversity_by_nbhd.csv", index=False, lineterminator="\n")

    g = t.genus.value_counts(normalize=True)
    f = t.family.value_counts(normalize=True)
    return {"species": int(t.species.nunique()), "genera": int(t.genus.nunique()), "families": int(t.family.nunique()),
            "family_unmapped": sorted(t.genus[t.family.isna()].unique().tolist()),
            "family_mapped_share": round(float(t.family.notna().mean()), 5),
            "top_species": [city.species[0], round(float(city.share[0]), 4)],
            "top_genus": [g.index[0], round(float(g.iloc[0]), 4)], "top_family": [f.index[0], round(float(f.iloc[0]), 4)],
            "nbhds_meeting_10_20_30": int(out.meets_10_20_30.sum()),
            "species_by_nbhd_rows": int(len(top)), "trees_in_nbhds": int(total.sum())}


def species_only() -> int:
    """`python pipeline/trees.py --species`: rewrite the species files and their checks only."""
    OUT.mkdir(exist_ok=True)
    t = street_trees()
    checks = diversity(t)
    m = OUT / "manifest.json"
    manifest = json.loads(m.read_text()) if m.exists() else {}
    manifest.setdefault("checks", {})["diversity"] = checks
    m.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(checks, indent=2))
    return 0


# ---------------------------------------------------------------- canopy

def canopy(da: gpd.GeoDataFrame) -> tuple[np.ndarray, dict]:
    """Tree-class area (m2) inside each DA, in da's order."""
    with tempfile.TemporaryDirectory(dir=RAW) as tmp:
        with zipfile.ZipFile(CANOPY_ZIP) as z:
            z.extractall(tmp)
        gdb = Path(tmp) / CANOPY_GDB
        lc = pyogrio.read_dataframe(gdb, read_geometry=False)
        g = pyogrio.read_dataframe(gdb, where="gridcode = 1", columns=["gridcode"])
    if g.crs.to_epsg() != 2952:
        g = g.to_crs(2952)
    geo = g.explode(index_parts=False).geometry.values
    dg = da.geometry.values
    shapely.prepare(dg)
    ia, ib = shapely.STRtree(geo).query(dg, predicate="intersects")
    inside = shapely.contains_properly(dg[ia], geo[ib])
    area = np.where(inside, shapely.area(geo[ib]), 0.0)
    cut = ~inside
    area[cut] = shapely.area(shapely.intersection(dg[ia[cut]], geo[ib[cut]], grid_size=0.01))
    m2 = np.bincount(ia, weights=area, minlength=len(da))
    classes = lc.groupby("Desc").Shape_Area.sum() / 1e6
    info = {"polygons": int(len(geo)), "class_km2": {k or "(none)": round(float(v), 2) for k, v in classes.items()},
            "tree_km2": round(float(shapely.area(geo).sum() / 1e6), 2), "tree_km2_in_das": round(float(m2.sum() / 1e6), 2),
            "city_share": round(float(m2.sum() / da.area.sum()), 4)}
    return m2, info


# ---------------------------------------------------------------- land surface temperature

def get_json(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json",
                                                          "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def scenes() -> list[dict]:
    items = []
    for y in SUMMERS:
        body = {"collections": ["landsat-c2-l2"], "bbox": TORONTO_BBOX, "datetime": f"{y}-06-01/{y}-08-31",
                "query": {"eo:cloud_cover": {"lt": MAX_SCENE_CLOUD}, "platform": {"in": ["landsat-8", "landsat-9"]}},
                "limit": 100}
        r = get_json(STAC, body)
        if any(link["rel"] == "next" for link in r.get("links", [])):
            sys.exit(f"more than 100 scenes for {y}: page the STAC search")
        items += r["features"]
    return sorted(items, key=lambda f: f["properties"]["datetime"])


def read_window(item: dict, asset: str, token: str, bounds4326) -> tuple[np.ndarray, dict]:
    """Toronto's window of one asset of a scene (bounds in lon/lat)."""
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    href = item["assets"][asset]["href"]
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="5"):
        with rasterio.open(f"/vsicurl/{href}?{token}") as src:
            b = transform_bounds(4326, src.crs, *bounds4326)
            w = from_bounds(*b, src.transform).round_offsets().round_lengths()
            a = src.read(1, window=w, boundless=True, fill_value=src.nodata or 0)
            prof = {"driver": "GTiff", "count": 1, "width": a.shape[1], "height": a.shape[0],
                    "crs": src.crs, "transform": src.window_transform(w), "compress": "deflate"}
    return a, prof


def thermal_constants(item: dict) -> tuple[float, float]:
    """Band 10's K1 and K2: fixed per sensor, as every MTL states them (some
    scenes on Planetary Computer lack mtl.json, so they aren't read from it)."""
    return K_B10[item["properties"]["platform"]]


def scene_bands(item: dict, token: str, bounds4326) -> Path:
    """Cache Toronto's window of QA_PIXEL, USGS's ST_B10 and our own LST (see
    the docstring) for one scene in raw/landsat/<id>.tif: three bands, the
    temperatures in hundredths of a degree C (int16, -32768 where missing)."""
    import rasterio
    dest = LANDSAT / f"{item['id']}.tif"
    if dest.exists():
        return dest
    LANDSAT.mkdir(exist_ok=True)
    r = {a: read_window(item, a, token, bounds4326) for a in
         ("qa_pixel", "lwir11", "trad", "urad", "drad", "atran", "red", "nir08")}
    prof = r["qa_pixel"][1]
    v = {a: x.astype("float64") for a, (x, _) in r.items()}
    qa = r["qa_pixel"][0]
    usgs = np.where(v["lwir11"] > 0, v["lwir11"] * ST_SCALE + ST_OFFSET - 273.15, np.nan)
    red, nir = v["red"] * 2.75e-5 - 0.2, v["nir08"] * 2.75e-5 - 0.2
    with np.errstate(all="ignore"):
        ndvi = (nir - red) / (nir + red)
        pv = np.clip((ndvi - NDVI_SOIL) / (NDVI_VEG - NDVI_SOIL), 0, 1) ** 2
        eps = np.where(ndvi < 0, EPS_WATER, EPS_SOIL * (1 - pv) + EPS_VEG * pv)
        # TRAD = atran * (eps * B(T) + (1 - eps) * drad) + urad
        surface = (v["trad"] - v["urad"]) * 1e-3 / (v["atran"] * 1e-4)
        bt = (surface - (1 - eps) * v["drad"] * 1e-3) / eps
        k1, k2 = thermal_constants(item)
        own = k2 / np.log(k1 / bt + 1) - 273.15
    bad = (r["trad"][0] == -9999) | (r["atran"][0] == -9999) | (r["red"][0] == 0) | (r["nir08"][0] == 0)
    own[bad | ~np.isfinite(own)] = np.nan
    out = np.stack([qa.astype("int32"), *(np.where(np.isnan(x), -32768, np.round(x * 100)) for x in (usgs, own))])
    tmp = dest.with_suffix(".part")
    with rasterio.open(tmp, "w", **{**prof, "count": 3, "dtype": "int32", "nodata": None}) as dst:
        dst.write(out.astype("int32"))
    tmp.replace(dest)
    return dest


def zone_ids(da: gpd.GeoDataFrame, crs, transform, shape) -> np.ndarray:
    """DA index + 1 for each pixel whose centre is in a DA (0 elsewhere); a DA
    holding no centre takes the pixels it touches that no other DA has."""
    from rasterio.features import rasterize
    g = da.to_crs(crs).geometry.values
    z = rasterize(zip(g, range(1, len(g) + 1)), out_shape=shape, transform=transform, fill=0, dtype="int32")
    missing = np.setdiff1d(np.arange(1, len(g) + 1), np.unique(z))
    for i in missing:
        t = rasterize([(g[i - 1], 1)], out_shape=shape, transform=transform, fill=0, all_touched=True, dtype="uint8")
        z[(t == 1) & (z == 0)] = i
    return z


def lst(da: gpd.GeoDataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Per-pass sums and counts of clear-pixel LST by DA, and the scene log."""
    import rasterio
    token = get_json(SAS)["token"]
    b = gpd.GeoSeries([da.union_all().envelope], crs=da.crs).buffer(500).to_crs(4326).total_bounds
    n = len(da)
    passes = {}
    for item in scenes():
        p = item["properties"]
        passes.setdefault((p["datetime"][:10], p["landsat:wrs_path"]), []).append(item)
    sums, counts, totals, log = {}, {}, {}, {"used": [], "rejected": []}
    zones, diffs = {}, []
    for (date, path), items in sorted(passes.items()):
        files = [scene_bands(i, token, b) for i in items]
        qa = st = own = None
        for f in files:  # rows of one pass: the first clear pixel wins
            with rasterio.open(f) as s:
                q, u, o = s.read()
                key = (s.crs.to_string(), tuple(s.transform), q.shape)
            if key not in zones:
                zones[key] = zone_ids(da, s.crs, s.transform, q.shape)
            if qa is None:
                qa, st, own, k0 = q, u, o, key
            else:
                if key != k0:
                    sys.exit(f"rows of the {date} pass are on different grids")
                take = ((qa & QA_BAD) != 0) & ((q & QA_BAD) == 0)
                qa, st, own = np.where(take, q, qa), np.where(take, u, st), np.where(take, o, own)
        z = zones[k0]
        ok = ((qa & QA_BAD) == 0) & (own > -32768)
        land = (z > 0) & ((qa & (1 << 7)) == 0)
        clear = float((ok & land).sum() / max(land.sum(), 1))
        both = ok & land & (st > -32768)
        d = (own[both] - st[both]) / 100
        entry = {"date": date, "wrs_path": path, "scenes": [i["id"] for i in items],
                 "time_utc": items[0]["properties"]["datetime"][11:16], "platform": items[0]["properties"]["platform"],
                 "cloud_cover": [i["properties"]["eo:cloud_cover"] for i in items], "clear": round(clear, 3),
                 "usgs_st_share": round(float(both.sum() / max((ok & land).sum(), 1)), 3)}
        if len(d):
            entry["own_minus_usgs_c"] = {"mean": round(float(d.mean()), 2), "sd": round(float(d.std()), 2)}
        if clear < MIN_CLEAR:
            log["rejected"].append(entry)
            print(f"  rejected {date} path {path}: clear {clear:.3f}")
            continue
        c = own.astype("float64") / 100
        m = ok & (z > 0)
        allpix = np.bincount(z[z > 0], minlength=n + 1)[1:]
        cnt = np.bincount(z[m], minlength=n + 1)[1:]
        sm = np.bincount(z[m], weights=c[m], minlength=n + 1)[1:]
        keep = cnt >= MIN_DA_CLEAR * np.maximum(allpix, 1)
        sums[date] = np.where(keep, sm, np.nan)
        counts[date] = np.where(keep, cnt, 0)
        totals[date] = float(sm.sum() / cnt.sum())
        entry["city_mean_c"] = round(totals[date], 2)
        log["used"].append(entry)
        diffs.append(d)
        print(f"  {date} path {path} ({len(items)} scene{'s' * (len(items) > 1)}): clear {clear:.3f}, "
              f"city mean {totals[date]:.1f} C, own - USGS {entry.get('own_minus_usgs_c')}")
    d = np.concatenate(diffs) if diffs else np.array([])
    log["own_minus_usgs_c"] = {"pixels": int(len(d)), "mean": round(float(d.mean()), 2), "sd": round(float(d.std()), 2),
                               "p5_p95": [round(float(x), 2) for x in np.percentile(d, [5, 95])]} if len(d) else None
    s, c = pd.DataFrame(sums, index=da.dauid), pd.DataFrame(counts, index=da.dauid)
    log["city_means"] = totals
    return s, c, log


def lst_summary(s: pd.DataFrame, c: pd.DataFrame, city: dict, key: pd.Series | None = None) -> pd.DataFrame:
    """Median over scenes of the mean LST and of its difference from the city mean,
    by DA, or by `key` (the DA's neighbourhood) pooling the DAs' pixels."""
    if key is not None:
        s, c = s.groupby(key.values).sum(min_count=1), c.groupby(key.values).sum()
        s = s.where(c > 0)
    mean = s / c.where(c > 0)
    anom = mean - pd.Series(city)
    return pd.DataFrame({"lst_c": mean.median(axis=1), "lst_anom": anom.median(axis=1), "lst_scenes": mean.notna().sum(axis=1)})


def lst_by_pass(s: pd.DataFrame, c: pd.DataFrame, city: dict, key: pd.Series) -> pd.DataFrame:
    """Each pass's mean LST by `key` (the neighbourhood, pooling its DAs' pixels) and its
    difference from that pass's city mean, long: key, date, lst_c, lst_anom."""
    s, c = s.groupby(key.values).sum(min_count=1), c.groupby(key.values).sum()
    mean = s.where(c > 0) / c.where(c > 0)
    anom = mean - pd.Series(city)
    out = pd.concat({"lst_c": mean.stack(), "lst_anom": anom.stack()}, axis=1).round(2)
    out.index.names = ["nbhd_id", "date"]
    return out.reset_index()


# ---------------------------------------------------------------- checks

def corr(x: pd.Series, y: pd.Series) -> dict:
    ok = x.notna() & y.notna()
    x, y = x[ok], y[ok]
    return {"n": int(ok.sum()), "r": round(float(x.corr(y)), 3), "rho": round(float(x.rank().corr(y.rank())), 3)}


def income() -> pd.Series:
    v = json.loads((FIGURES / "med_hh_tot.json").read_text())["v"]
    c = common()
    if len(v) != len(c):
        sys.exit(f"med_hh_tot.json has {len(v)} values for {len(c)} DAs")
    return pd.Series(pd.to_numeric(pd.Series(v), errors="coerce").values, index=c.dauid, name="med_hh_tot")


def file_info(p: Path) -> dict:
    return {"name": p.name, "bytes": p.stat().st_size,
            "retrieved": dt.date.fromtimestamp(p.stat().st_mtime).isoformat()}


def main() -> int:
    missing = [p.name for p in (TREES, CANOPY_ZIP) if not p.exists()]
    if missing:
        sys.exit(f"missing {missing}; run pipeline/download.py")
    OUT.mkdir(exist_ok=True)
    da = da_polygons()
    da_area = pd.Series(da.area.values / 1e4, index=da.dauid)
    nbhd = pd.Series(da.nbhd_id.astype(int).values, index=da.dauid)
    manifest = {"built": dt.date.today().isoformat(), "da_outlines": da.attrs.get("source"),
                "files": {"street_trees": file_info(TREES), "canopy_2018": file_info(CANOPY_ZIP)}}
    checks = {}

    print("street trees")
    t = street_trees()
    by_da = tree_stats(t, "dauid").reindex(da.dauid)
    by_nb = tree_stats(t, "nbhd_id")
    by_nb.index = by_nb.index.astype(int)
    by_nb = by_nb.reindex(sorted(nbhd.unique()))
    placed = int(t.dauid.notna().sum())
    no_xy = int((t.lon.isna() | t.lat.isna()).sum())
    checks["street_trees"] = {
        "rows": int(len(t)), "max_id": int(t._id.max()), "placed": placed, "no_coordinates": no_xy,
        "outside_das": int(len(t) - placed - no_xy), "placed_share": round(placed / len(t), 4),
        "by_da_sum": int(by_da.trees.sum()), "by_nbhd_sum": int(by_nb.trees.sum()),
        "dbh_missing": int(t.DBH_TRUNK.isna().sum()), "dbh_over_max": int((t.DBH_TRUNK > DBH_MAX).sum()),
        "dbh_median_city": float(t.dbh.median()), "large_share_city": round(float((t.dbh >= LARGE_DBH).sum() / t.dbh.count()), 4),
        "das_without_trees": int(by_da.trees.isna().sum()),
        "top_species_city": {k: int(v) for k, v in t.species.value_counts().head(10).items()},
    }
    if not (checks["street_trees"]["by_da_sum"] == checks["street_trees"]["by_nbhd_sum"] == placed):
        sys.exit(f"tree sums don't match: {checks['street_trees']}")
    print(json.dumps({k: v for k, v in checks["street_trees"].items() if k != "top_species_city"}))
    checks["diversity"] = diversity(t)

    print("canopy")
    m2, info = canopy(da)
    checks["canopy"] = info
    print(json.dumps(info))
    can_da = pd.Series(m2 / 1e4, index=da.dauid)

    print("land surface temperature")
    s, c, log = lst(da)
    manifest["landsat"] = {"source": "Microsoft Planetary Computer STAC, collection landsat-c2-l2, asset lwir11 (ST_B10)",
                           "retrieved": dt.date.fromtimestamp(min(p.stat().st_mtime for p in LANDSAT.glob("*.tif"))).isoformat(),
                           "summers": f"June-August {SUMMERS.start}-{SUMMERS.stop - 1}",
                           "max_scene_cloud": MAX_SCENE_CLOUD, "min_clear": MIN_CLEAR,
                           "own_minus_usgs_c": log["own_minus_usgs_c"],
                           "scenes_used": log["used"], "scenes_rejected": log["rejected"]}
    l_da = lst_summary(s, c, log["city_means"])
    l_nb = lst_summary(s, c, log["city_means"], nbhd)
    lst_by_pass(s, c, log["city_means"], nbhd).to_csv(OUT / "lst_by_pass_nbhd.csv", index=False, lineterminator="\n")

    out = by_da.assign(area_ha=da_area)
    out["trees"] = out.trees.fillna(0).astype(int)
    out["trees_per_ha"] = out.trees / out.area_ha
    out["canopy_ha"] = can_da
    out["canopy_share"] = can_da / out.area_ha
    out = out.join(l_da)
    out.insert(0, "nbhd_id", nbhd)

    nb = by_nb.assign(area_ha=da_area.groupby(nbhd).sum())
    nb["trees"] = nb.trees.fillna(0).astype(int)
    nb["trees_per_ha"] = nb.trees / nb.area_ha
    nb["canopy_ha"] = can_da.groupby(nbhd).sum()
    nb["canopy_share"] = nb.canopy_ha / nb.area_ha
    nb = nb.join(l_nb)

    cols = ["area_ha", "trees", "trees_per_ha", "dbh_median", "large_share", "top_species", "top_species_common",
            "top_species_share", "canopy_ha", "canopy_share", "lst_c", "lst_anom", "lst_scenes"]
    rnd = {"area_ha": 2, "trees_per_ha": 2, "dbh_median": 1, "large_share": 3, "top_species_share": 3,
           "canopy_ha": 2, "canopy_share": 3, "lst_c": 2, "lst_anom": 2}
    out = out[["nbhd_id", *cols]].round(rnd)
    nb = nb[cols].round(rnd)
    out.index.name, nb.index.name = "dauid", "nbhd_id"
    out.to_csv(OUT / "by_da.csv")
    nb.to_csv(OUT / "by_nbhd.csv")

    inc = income().reindex(out.index)
    checks["vs_median_household_income_2021_by_da"] = {
        "trees_per_ha": corr(out.trees_per_ha, inc), "canopy_share": corr(out.canopy_share, inc),
        "lst_c": corr(out.lst_c, inc), "lst_anom": corr(out.lst_anom, inc)}
    checks["lst_anom_vs_canopy_share_by_da"] = corr(out.lst_anom, out.canopy_share)
    checks["lst_anom_vs_trees_per_ha_by_da"] = corr(out.lst_anom, out.trees_per_ha)
    checks["lst"] = {"scenes_used": len(log["used"]), "scenes_rejected": len(log["rejected"]),
                     "das_with_lst": int(out.lst_c.notna().sum()),
                     "da_lst_c_range": [float(out.lst_c.min()), float(out.lst_c.max())],
                     "da_scenes_median": float(out.lst_scenes.median())}
    manifest["rows"] = {"by_da": int(len(out)), "by_nbhd": int(len(nb))}
    manifest["checks"] = checks
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k: v for k, v in checks.items() if k not in ("street_trees", "canopy")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(species_only() if "--species" in sys.argv[1:] else main())
