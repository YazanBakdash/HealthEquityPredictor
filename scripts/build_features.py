"""
Master pipeline: compute all tract-level features from raw data, filter to
Chicago, convert to densities, merge census variables, and write outputs.

Usage:
    python scripts/build_features.py

Outputs:
    inputs_processed/all_tract_features.csv   - features only (density-scaled)
    public/all_tract_features.csv             - same (for frontend)
    inputs_processed/combined_all_features.csv - features + census variables
    inputs_processed/chicago_tract_list.csv   - list of included tract IDs
    public/census_tracts.json                 - GeoJSON for frontend map
"""
from __future__ import annotations
import sys, time, re, json
from pathlib import Path

import pandas as pd
import numpy as np

try:
    import geopandas as gpd
    from shapely import wkt
    from shapely.ops import unary_union
except ImportError as e:
    sys.exit(f"Missing dependency: {e}\nInstall with: pip install geopandas shapely")

ROOT = Path(".")
RAW = ROOT / "inputs_raw"
PROC = ROOT / "inputs_processed"

IL_TRACTS_SHP = ROOT / "IL_tracts" / "cb_2025_17_tract_500k.shp"
CENSUS_DATA = PROC / "census_data_out.csv"
POPULATION_CSV = RAW / "DECENNIALDHC2020.P1-Data.csv"

FEET_PER_MILE = 5280.0
SQFT_PER_ACRE = 43560.0
SQFT_PER_SQMI = FEET_PER_MILE ** 2
PROJECTED_CRS = "EPSG:3435"

AFFORDABLE_BUFFER_FT = 0.5 * FEET_PER_MILE
PARK_BUFFER_FT = 0.25 * FEET_PER_MILE
LIBRARY_BUFFER_FT = 1.0 * FEET_PER_MILE
SCHOOL_BUFFER_FT = 0.5 * FEET_PER_MILE
WIFI_BUFFER_FT = 0.5 * FEET_PER_MILE
BIKE_BUFFER_FT = 0.25 * FEET_PER_MILE

EXCLUDED_TRACTS = {"17031760900", "17031770600", "17031770700", "17031000000"}
KEEP_TRACT_840000 = "17031840000"
SUBURBAN_RANGE = (805600, 822900)
DROP_TRACTS = {"17031030702", "17031980100"}

POP_FLOOR = 500
PER_CAPITA_COLS = [
    "Affordable_Housing", "Transit_Stop", "School_Density",
    "Library_Count", "Small_Business", "Grocery_Store",
]
PER_AREA_COLS = ["Parks", "Bike_Miles", "Wifi_Hotspots"]
RESCALE_10K_COLS = ["Transit_Stop", "School_Density", "Library_Count"]

t0 = time.time()


def elapsed():
    return f"[{time.time()-t0:.1f}s]"


def report(msg):
    print(f"{elapsed()} {msg}")


def tract_num(ct):
    return int(ct[5:]) if len(ct) == 11 else 0


# ============================================================
# STEP 1: Load tract boundaries and determine Chicago set
# ============================================================
report("=== STEP 1: Load tracts and determine Chicago boundary ===")
all_tracts = gpd.read_file(IL_TRACTS_SHP)
cook = all_tracts[all_tracts["COUNTYFP"] == "031"].copy()
cook = cook.rename(columns={"GEOID": "census_tract"})

census_df = pd.read_csv(CENSUS_DATA, dtype={"GEO_ID": str})
census_df["census_tract"] = census_df["GEO_ID"].str.replace("1400000US", "", regex=False)
master_set = set(census_df["census_tract"])

cook = cook[cook["census_tract"].isin(master_set)].copy()
cook_proj = cook.to_crs(PROJECTED_CRS)
report(f"  Cook County tracts: {len(cook)}")

# CTA-based Chicago filter
cta = gpd.read_file(f"zip://{RAW / 'CTA_BusStops.zip'}!CTA_BusStops.shp")
cta_chi = cta[cta["CITY"].astype(str).str.upper() == "CHICAGO"].to_crs(PROJECTED_CRS)
joined = gpd.sjoin(cook_proj[["census_tract", "geometry"]], cta_chi[["geometry"]],
                   how="inner", predicate="intersects")
tracts_with_cta = set(joined["census_tract"].unique())

cta_hull = unary_union(cta_chi.geometry).convex_hull.buffer(2640)
cook_proj["centroid_geom"] = cook_proj.geometry.centroid
in_hull = cook_proj["centroid_geom"].within(cta_hull)
tracts_in_hull = set(cook_proj.loc[in_hull, "census_tract"])

chicago_set = tracts_with_cta | tracts_in_hull
chicago_set.add(KEEP_TRACT_840000)
chicago_set -= EXCLUDED_TRACTS
chicago_set -= {ct for ct in chicago_set if SUBURBAN_RANGE[0] <= tract_num(ct) <= SUBURBAN_RANGE[1]}
chicago_set -= DROP_TRACTS
report(f"  Chicago tracts after filtering: {len(chicago_set)}")

cook_proj = cook_proj[cook_proj["census_tract"].isin(chicago_set)].copy()
cook_proj = cook_proj.drop(columns=["centroid_geom"], errors="ignore")
out = pd.DataFrame({"census_tract": sorted(cook_proj["census_tract"].tolist())})
report(f"  Output will have {len(out)} tracts")


# ============================================================
# STEP 2: Compute raw features
# ============================================================
report("\n=== STEP 2: Compute raw features ===")

# --- Tree_Canopy ---
report("\n--- Tree_Canopy ---")
tc_gj = gpd.read_file(RAW / "tree_canopy.geojson")
tc_gj["fips"] = tc_gj["FIPS"].astype(str)
tc_map = tc_gj.set_index("fips")["PCT_Tree"]
out["Tree_Canopy"] = out["census_tract"].map(tc_map)

missing_mask = out["Tree_Canopy"].isna()
for idx in out[missing_mask].index:
    parent = out.loc[idx, "census_tract"][:9] + "00"
    if parent in tc_map.index:
        out.loc[idx, "Tree_Canopy"] = tc_map[parent]

still_missing = out[out["Tree_Canopy"].isna()]["census_tract"].tolist()
if still_missing:
    tc_proj = tc_gj[["PCT_Tree", "AREA_TREE", "geometry"]].to_crs(PROJECTED_CRS)
    missing_tracts = cook_proj[cook_proj["census_tract"].isin(still_missing)][["census_tract", "geometry"]]
    overlap = gpd.overlay(tc_proj, missing_tracts, how="intersection", keep_geom_type=False)
    if not overlap.empty:
        overlap["overlap_area"] = overlap.geometry.area
        weighted = overlap.groupby("census_tract").apply(
            lambda g: (g["PCT_Tree"] * g["overlap_area"]).sum() / g["overlap_area"].sum()
            if g["overlap_area"].sum() > 0 else np.nan
        )
        for ct, val in weighted.items():
            if pd.notna(val):
                out.loc[out["census_tract"] == ct, "Tree_Canopy"] = val

out["Tree_Canopy"] = out["Tree_Canopy"].fillna(0.0)
report(f"  Range: {out['Tree_Canopy'].min():.1f} - {out['Tree_Canopy'].max():.1f}")

# --- Affordable_Housing ---
report("\n--- Affordable_Housing ---")
aff = pd.read_csv(RAW / "Affordable_Rental_Housing_Developments_20260415.csv", low_memory=False)
aff["Latitude"] = pd.to_numeric(aff["Latitude"], errors="coerce")
aff["Longitude"] = pd.to_numeric(aff["Longitude"], errors="coerce")
aff["Units"] = pd.to_numeric(aff["Units"], errors="coerce").fillna(0)
aff = aff.dropna(subset=["Latitude", "Longitude"])
aff_gdf = gpd.GeoDataFrame(
    aff, geometry=gpd.points_from_xy(aff["Longitude"], aff["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)
buffered = cook_proj[["census_tract", "geometry"]].copy()
buffered["geometry"] = buffered.geometry.buffer(AFFORDABLE_BUFFER_FT)
joined_aff = gpd.sjoin(buffered, aff_gdf[["Units", "geometry"]], how="left", predicate="intersects")
aff_sums = joined_aff.groupby("census_tract")["Units"].sum(min_count=1).fillna(0)
out["Affordable_Housing"] = out["census_tract"].map(aff_sums).fillna(0)
report(f"  Tracts with >0: {(out['Affordable_Housing'] > 0).sum()}")

# --- Parks ---
report("\n--- Parks ---")
parks_df = pd.read_csv(RAW / "CPD_Parks_20260416.csv", usecols=["the_geom"], low_memory=False)
parks_df = parks_df.dropna(subset=["the_geom"])
parks_df["geometry"] = parks_df["the_geom"].map(wkt.loads)
parks_gdf = gpd.GeoDataFrame(parks_df[["geometry"]], geometry="geometry", crs="EPSG:4326").to_crs(PROJECTED_CRS)
buffered_parks = cook_proj[["census_tract", "geometry"]].copy()
buffered_parks["geometry"] = buffered_parks.geometry.buffer(PARK_BUFFER_FT)
intersected = gpd.overlay(parks_gdf, buffered_parks, how="intersection", keep_geom_type=False)
park_sums = intersected.groupby("census_tract").apply(
    lambda g: g.geometry.area.sum() / SQFT_PER_ACRE
) if not intersected.empty else pd.Series(dtype=float)
out["Parks"] = out["census_tract"].map(park_sums).fillna(0)
report(f"  Tracts with >0: {(out['Parks'] > 0).sum()}")

# --- Transit_Stop ---
report("\n--- Transit_Stop ---")
cta_joined = gpd.sjoin(cook_proj[["census_tract", "geometry"]], cta_chi[["geometry"]],
                       how="left", predicate="intersects")
cta_counts = cta_joined.groupby("census_tract")["index_right"].count()

metra = gpd.read_file(f"zip://{RAW / 'Metra_Stations.zip'}!MetraStations.shp")
metra_chi = metra[metra["MUNICIPALI"].astype(str).str.strip().str.upper() == "CHICAGO"].to_crs(PROJECTED_CRS)
metra_joined = gpd.sjoin(cook_proj[["census_tract", "geometry"]], metra_chi[["geometry"]],
                         how="left", predicate="intersects")
metra_counts = metra_joined.groupby("census_tract")["index_right"].count()
out["Transit_Stop"] = (out["census_tract"].map(cta_counts).fillna(0) +
                       out["census_tract"].map(metra_counts).fillna(0))
report(f"  Tracts with >0: {(out['Transit_Stop'] > 0).sum()}")

# --- Bike_Miles ---
report("\n--- Bike_Miles ---")
bike_df = pd.read_csv(RAW / "Bike_Routes_20260415.csv", low_memory=False)
KEEP_CATEGORIES = {"Protected Bike Lane", "Buffered Bike Lane", "Greenway"}
bike_df["DISPLAYROU"] = bike_df["DISPLAYROU"].astype(str).str.strip()
bike_filtered = bike_df[bike_df["DISPLAYROU"].isin(KEEP_CATEGORIES)].copy()
bike_filtered = bike_filtered.dropna(subset=["the_geom"])
bike_filtered["geometry"] = bike_filtered["the_geom"].map(wkt.loads)
bike_gdf = gpd.GeoDataFrame(bike_filtered, geometry="geometry", crs="EPSG:4326").to_crs(PROJECTED_CRS)

trails_path = RAW / "Off-Street_Bike_Trails.geojson"
if trails_path.is_file():
    trails = gpd.read_file(trails_path).to_crs(PROJECTED_CRS)
    combined_bike = gpd.GeoDataFrame(
        pd.concat([bike_gdf[["geometry"]], trails[["geometry"]]], ignore_index=True),
        geometry="geometry", crs=PROJECTED_CRS
    )
else:
    combined_bike = bike_gdf[["geometry"]]

buffered_bike = cook_proj[["census_tract", "geometry"]].copy()
buffered_bike["geometry"] = buffered_bike.geometry.buffer(BIKE_BUFFER_FT)
bike_clipped = gpd.overlay(combined_bike, buffered_bike, how="intersection", keep_geom_type=False)
if not bike_clipped.empty:
    bike_clipped["miles"] = bike_clipped.geometry.length / FEET_PER_MILE
    bike_sums = bike_clipped.groupby("census_tract")["miles"].sum()
else:
    bike_sums = pd.Series(dtype=float)
out["Bike_Miles"] = out["census_tract"].map(bike_sums).fillna(0)
report(f"  Tracts with >0: {(out['Bike_Miles'] > 0).sum()}")

# --- Wifi_Hotspots ---
report("\n--- Wifi_Hotspots ---")
wifi = pd.read_csv(RAW / "Connect_Chicago_Locations_-_Historical_20260416.csv", low_memory=False)
wifi["Latitude"] = pd.to_numeric(wifi["Latitude"], errors="coerce")
wifi["Longitude"] = pd.to_numeric(wifi["Longitude"], errors="coerce")
wifi = wifi.dropna(subset=["Latitude", "Longitude"])
wifi_gdf = gpd.GeoDataFrame(
    wifi, geometry=gpd.points_from_xy(wifi["Longitude"], wifi["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)
buffered_wifi = cook_proj[["census_tract", "geometry"]].copy()
buffered_wifi["geometry"] = buffered_wifi.geometry.buffer(WIFI_BUFFER_FT)
wifi_joined = gpd.sjoin(buffered_wifi, wifi_gdf[["geometry"]], how="left", predicate="intersects")
wifi_counts = wifi_joined.groupby("census_tract")["index_right"].count()
out["Wifi_Hotspots"] = out["census_tract"].map(wifi_counts).fillna(0).astype(float)
report(f"  Tracts with >0: {(out['Wifi_Hotspots'] > 0).sum()}")

# --- School_Density ---
report("\n--- School_Density ---")
schools = pd.read_csv(RAW / "Chicago_Public_Schools_-_School_Profile_Information_SY2425.csv", low_memory=False)
schools["School_Latitude"] = pd.to_numeric(schools["School_Latitude"], errors="coerce")
schools["School_Longitude"] = pd.to_numeric(schools["School_Longitude"], errors="coerce")
schools = schools.dropna(subset=["School_Latitude", "School_Longitude"])
school_gdf = gpd.GeoDataFrame(
    schools, geometry=gpd.points_from_xy(schools["School_Longitude"], schools["School_Latitude"]),
    crs="EPSG:4326"
).to_crs(PROJECTED_CRS)
buffered_schools = cook_proj[["census_tract", "geometry"]].copy()
buffered_schools["geometry"] = buffered_schools.geometry.buffer(SCHOOL_BUFFER_FT)
school_joined = gpd.sjoin(buffered_schools, school_gdf[["geometry"]], how="left", predicate="intersects")
school_counts = school_joined.groupby("census_tract")["index_right"].count()
out["School_Density"] = out["census_tract"].map(school_counts).fillna(0).astype(float)
report(f"  Tracts with >0: {(out['School_Density'] > 0).sum()}")

# --- Library_Count ---
report("\n--- Library_Count ---")
libs = pd.read_csv(RAW / "Libraries_-_Locations,_Contact_Information,_and_Usual_Hours_of_Operation_20260415.csv",
                   low_memory=False)
def parse_location(loc):
    if pd.isna(loc):
        return None, None
    m = re.search(r"\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", str(loc))
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None

libs[["Latitude", "Longitude"]] = libs["LOCATION"].apply(lambda x: pd.Series(parse_location(x)))
libs = libs.dropna(subset=["Latitude", "Longitude"])
lib_gdf = gpd.GeoDataFrame(
    libs, geometry=gpd.points_from_xy(libs["Longitude"], libs["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)
buffered_libs = cook_proj[["census_tract", "geometry"]].copy()
buffered_libs["geometry"] = buffered_libs.geometry.buffer(LIBRARY_BUFFER_FT)
lib_joined = gpd.sjoin(buffered_libs, lib_gdf[["geometry"]], how="left", predicate="intersects")
lib_counts = lib_joined.groupby("census_tract")["index_right"].count()
out["Library_Count"] = out["census_tract"].map(lib_counts).fillna(0).astype(float)
report(f"  Tracts with >0: {(out['Library_Count'] > 0).sum()}")

# --- Small_Business + Grocery_Store ---
report("\n--- Small_Business + Grocery_Store ---")
biz = pd.read_csv(
    PROC / "Business_Licenses_20260415_with_tracts.csv",
    usecols=["ACCOUNT NUMBER", "SITE NUMBER", "LICENSE STATUS", "LICENSE DESCRIPTION",
             "LATITUDE", "LONGITUDE"],
    low_memory=False,
)
biz = biz[biz["LICENSE STATUS"].astype(str).str.upper() == "AAI"].copy()
acct = biz["ACCOUNT NUMBER"].astype("string").str.strip().fillna("")
site = biz["SITE NUMBER"].astype("string").str.strip().fillna("")
biz["_key"] = acct + "|" + site
biz = biz[biz["_key"].str.len() > 1].drop_duplicates(subset=["_key"], keep="last")
biz["LATITUDE"] = pd.to_numeric(biz["LATITUDE"], errors="coerce")
biz["LONGITUDE"] = pd.to_numeric(biz["LONGITUDE"], errors="coerce")
biz = biz.dropna(subset=["LATITUDE", "LONGITUDE"])
biz_gdf = gpd.GeoDataFrame(
    biz, geometry=gpd.points_from_xy(biz["LONGITUDE"], biz["LATITUDE"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)
biz_joined = gpd.sjoin(biz_gdf[["LICENSE DESCRIPTION", "geometry"]],
                       cook_proj[["census_tract", "geometry"]],
                       how="inner", predicate="within")
out["Small_Business"] = out["census_tract"].map(biz_joined["census_tract"].value_counts()).fillna(0).astype(float)
grocery_mask = biz_joined["LICENSE DESCRIPTION"].astype(str).str.contains(
    r"Retail Food Establishment|Produce Merchant", case=False, na=False, regex=True)
out["Grocery_Store"] = out["census_tract"].map(
    biz_joined.loc[grocery_mask, "census_tract"].value_counts()
).fillna(0).astype(float)
report(f"  Small_Business >0: {(out['Small_Business'] > 0).sum()}")
report(f"  Grocery_Store >0: {(out['Grocery_Store'] > 0).sum()}")


# ============================================================
# STEP 3: Add tract area and population, convert to densities
# ============================================================
report("\n=== STEP 3: Add area/population and convert to densities ===")

out["Tract_Area_SqMi"] = out["census_tract"].map(
    cook_proj.set_index("census_tract").geometry.area / SQFT_PER_SQMI
).round(4)

pop = pd.read_csv(POPULATION_CSV, skiprows=[1], dtype=str)
pop["census_tract"] = pop["GEO_ID"].str.replace("1400000US", "", regex=False)
pop["Population"] = pd.to_numeric(pop["P1_001N"], errors="coerce").fillna(0).astype(int)
out["Population"] = out["census_tract"].map(pop.set_index("census_tract")["Population"]).fillna(0).astype(int)

area = out["Tract_Area_SqMi"]
pop_k = out["Population"].clip(lower=POP_FLOOR) / 1000

for col in PER_AREA_COLS:
    out[col] = (out[col] / area).round(4)

for col in PER_CAPITA_COLS:
    out[col] = (out[col] / pop_k).round(4)

for col in RESCALE_10K_COLS:
    out[col] = (out[col] * 10).round(4)

report(f"  Density conversion complete")
for col in out.columns:
    if col in ("census_tract", "Population"):
        continue
    report(f"  {col:25s}  min={out[col].min():10.2f}  max={out[col].max():10.2f}  mean={out[col].mean():10.2f}")


# ============================================================
# STEP 4: Write outputs
# ============================================================
report("\n=== STEP 4: Write outputs ===")

out.to_csv(PROC / "all_tract_features.csv", index=False)
report(f"  Wrote inputs_processed/all_tract_features.csv ({len(out)} rows)")

(ROOT / "public").mkdir(parents=True, exist_ok=True)
out.to_csv(ROOT / "public" / "all_tract_features.csv", index=False)
report(f"  Wrote public/all_tract_features.csv")

pd.DataFrame({"census_tract": sorted(chicago_set - DROP_TRACTS)}).to_csv(
    PROC / "chicago_tract_list.csv", index=False)
report(f"  Wrote chicago_tract_list.csv")

# GeoJSON
chi_gdf = cook[cook["census_tract"].isin(chicago_set - DROP_TRACTS)].copy()
chi_gdf = chi_gdf.rename(columns={"census_tract": "CENSUS_T_1"}).to_crs("EPSG:4326")
chi_gdf.to_file(ROOT / "public" / "census_tracts.json", driver="GeoJSON")
report(f"  Wrote public/census_tracts.json ({len(chi_gdf)} features)")

# Combined with census data
census_merge = census_df.drop(columns=["GEO_ID"])
combined = out.merge(census_merge, on="census_tract", how="left")
combined.to_csv(PROC / "combined_all_features.csv", index=False)
report(f"  Wrote combined_all_features.csv ({len(combined)} rows, {len(combined.columns)} cols)")

report(f"\nDone in {time.time()-t0:.1f}s total")
