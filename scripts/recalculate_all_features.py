"""
Recalculate all_tract_features.csv using the NEW Cook County tract boundaries
from IL_tracts/cb_2025_17_tract_500k.shp, keyed to the tract list in
inputs_processed/census_data_out.csv.

This replaces the old pipeline that used public/census_tracts.json (Chicago-only,
~878 tracts, State Plane feet) with the 2025 Census Bureau shapefile (all Cook
County, 1331 tracts, NAD83).
"""
from __future__ import annotations
import sys, time, re
from pathlib import Path

import pandas as pd
import numpy as np

try:
    import geopandas as gpd
    from shapely import wkt
    from shapely.geometry import Point
except ImportError as e:
    sys.exit(f"Missing dependency: {e}\nInstall with: pip install geopandas shapely")

ROOT = Path(".")
RAW = ROOT / "inputs_raw"
PROC = ROOT / "inputs_processed"

IL_TRACTS_SHP = ROOT / "IL_tracts" / "cb_2025_17_tract_500k.shp"
CENSUS_DATA = PROC / "census_data_out.csv"

FEET_PER_MILE = 5280.0
AFFORDABLE_BUFFER_FT = 0.5 * FEET_PER_MILE
PARK_BUFFER_FT = 0.25 * FEET_PER_MILE
LIBRARY_BUFFER_FT = 1.0 * FEET_PER_MILE
SCHOOL_BUFFER_FT = 0.5 * FEET_PER_MILE
WIFI_BUFFER_FT = 0.5 * FEET_PER_MILE
BIKE_BUFFER_FT = 0.25 * FEET_PER_MILE
SQFT_PER_ACRE = 43560.0

PROJECTED_CRS = "EPSG:3435"  # IL State Plane East (feet)

t0 = time.time()

def elapsed():
    return f"[{time.time()-t0:.1f}s]"

def report(msg):
    print(f"{elapsed()} {msg}")


# ============================================================
# 1. Load new tract boundaries
# ============================================================
report("Loading IL_tracts shapefile...")
all_tracts = gpd.read_file(IL_TRACTS_SHP)
cook = all_tracts[all_tracts["COUNTYFP"] == "031"].copy()
cook = cook.rename(columns={"GEOID": "census_tract"})
report(f"  Cook County tracts in shapefile: {len(cook)}")

# Get master tract list from census_data_out
census_df = pd.read_csv(CENSUS_DATA, dtype={"GEO_ID": str})
census_df["census_tract"] = census_df["GEO_ID"].str.replace("1400000US", "", regex=False)
master_set = set(census_df["census_tract"])
report(f"  census_data_out tracts: {len(master_set)}")

# Filter cook to only tracts in the master list
cook = cook[cook["census_tract"].isin(master_set)].copy()
report(f"  Cook tracts matching census_data_out: {len(cook)}")

# Project to State Plane IL East (feet) for buffer operations
cook_proj = cook.to_crs(PROJECTED_CRS)
report(f"  Projected to {PROJECTED_CRS}")

# Start output dataframe
out = pd.DataFrame({"census_tract": sorted(cook_proj["census_tract"].tolist())})
report(f"  Output will have {len(out)} tracts")


# ============================================================
# 2. Tree_Canopy (spatial area-weighted overlay from tree_canopy.geojson)
# ============================================================
report("\n--- Tree_Canopy ---")
tc_gj = gpd.read_file(RAW / "tree_canopy.geojson")
report(f"  tree_canopy.geojson features: {len(tc_gj)}")

# Step 1: direct FIPS match (fast path for most tracts)
tc_gj["fips"] = tc_gj["FIPS"].astype(str)
tc_map = tc_gj.set_index("fips")["PCT_Tree"]
out["Tree_Canopy"] = out["census_tract"].map(tc_map)
matched = out["Tree_Canopy"].notna().sum()
report(f"  Direct FIPS match: {matched} of {len(out)}")

# Step 2: parent-tract fallback for split tracts
missing_mask = out["Tree_Canopy"].isna()
for idx in out[missing_mask].index:
    ct = out.loc[idx, "census_tract"]
    parent = ct[:9] + "00"
    if parent in tc_map.index:
        out.loc[idx, "Tree_Canopy"] = tc_map[parent]

matched2 = out["Tree_Canopy"].notna().sum()
report(f"  After parent-tract fallback: {matched2} of {len(out)}")

# Step 3: spatial overlap for remaining gaps (handles renumbered tracts)
still_missing = out[out["Tree_Canopy"].isna()]["census_tract"].tolist()
if still_missing:
    report(f"  Running spatial overlay for {len(still_missing)} remaining tracts...")
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

    matched3 = out["Tree_Canopy"].notna().sum()
    report(f"  After spatial overlay: {matched3} of {len(out)}")

# Step 4: fill any remaining NaN with 0 (tracts with truly no canopy data)
remaining_nan = out["Tree_Canopy"].isna().sum()
if remaining_nan > 0:
    report(f"  Filling {remaining_nan} remaining NaN tracts with 0.0 (no canopy source coverage)")
    out["Tree_Canopy"] = out["Tree_Canopy"].fillna(0.0)

report(f"  Final: all {out['Tree_Canopy'].notna().sum()} tracts have values")
report(f"  Range: {out['Tree_Canopy'].min():.1f} - {out['Tree_Canopy'].max():.1f}")


# ============================================================
# 3. Affordable_Housing (point-in-buffer, sum Units)
# ============================================================
report("\n--- Affordable_Housing ---")
aff_path = RAW / "Affordable_Rental_Housing_Developments_20260415.csv"
aff = pd.read_csv(aff_path, low_memory=False)
aff["Latitude"] = pd.to_numeric(aff["Latitude"], errors="coerce")
aff["Longitude"] = pd.to_numeric(aff["Longitude"], errors="coerce")
aff["Units"] = pd.to_numeric(aff["Units"], errors="coerce").fillna(0)
aff = aff.dropna(subset=["Latitude", "Longitude"])
report(f"  Affordable housing rows with coords: {len(aff)}")

aff_gdf = gpd.GeoDataFrame(
    aff, geometry=gpd.points_from_xy(aff["Longitude"], aff["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)

buffered = cook_proj[["census_tract", "geometry"]].copy()
buffered["geometry"] = buffered.geometry.buffer(AFFORDABLE_BUFFER_FT)

joined = gpd.sjoin(buffered, aff_gdf[["Units", "geometry"]], how="left", predicate="intersects")
aff_sums = joined.groupby("census_tract")["Units"].sum(min_count=1).fillna(0)
out["Affordable_Housing"] = out["census_tract"].map(aff_sums).fillna(0)
report(f"  Tracts with >0 units: {(out['Affordable_Housing'] > 0).sum()}")
report(f"  Total units (with buffer overlap): {out['Affordable_Housing'].sum():.0f}")


# ============================================================
# 4. Parks (polygon overlap acres in tract + 0.25 mi buffer)
# ============================================================
report("\n--- Parks ---")
parks_path = RAW / "CPD_Parks_20260416.csv"
parks_df = pd.read_csv(parks_path, usecols=["the_geom"], low_memory=False)
parks_df = parks_df.dropna(subset=["the_geom"])
report(f"  Park polygons loaded: {len(parks_df)}")

parks_df["geometry"] = parks_df["the_geom"].map(wkt.loads)
parks_gdf = gpd.GeoDataFrame(parks_df[["geometry"]], geometry="geometry", crs="EPSG:4326")
parks_gdf = parks_gdf.to_crs(PROJECTED_CRS)

buffered_parks = cook_proj[["census_tract", "geometry"]].copy()
buffered_parks["geometry"] = buffered_parks.geometry.buffer(PARK_BUFFER_FT)

report("  Computing park-tract intersection (this may take a minute)...")
intersected = gpd.overlay(parks_gdf, buffered_parks, how="intersection", keep_geom_type=False)
if not intersected.empty:
    intersected["overlap_acres"] = intersected.geometry.area / SQFT_PER_ACRE
    park_sums = intersected.groupby("census_tract")["overlap_acres"].sum()
else:
    park_sums = pd.Series(dtype=float)

out["Parks"] = out["census_tract"].map(park_sums).fillna(0)
report(f"  Tracts with park overlap: {(out['Parks'] > 0).sum()}")
report(f"  Total park acres: {out['Parks'].sum():.1f}")


# ============================================================
# 5. Transit_Stop (CTA + Metra, Chicago-only, spatial join)
# ============================================================
report("\n--- Transit_Stop ---")

# CTA Bus Stops
cta = gpd.read_file(f"zip://{RAW / 'CTA_BusStops.zip'}!CTA_BusStops.shp")
cta_chi = cta[cta["CITY"].astype(str).str.upper() == "CHICAGO"].copy()
cta_chi = cta_chi.to_crs(PROJECTED_CRS)
report(f"  CTA bus stops (Chicago): {len(cta_chi)}")

cta_joined = gpd.sjoin(
    cook_proj[["census_tract", "geometry"]],
    cta_chi[["geometry"]],
    how="left", predicate="intersects"
)
cta_counts = cta_joined.groupby("census_tract")["index_right"].count()

# Metra Stations
metra = gpd.read_file(f"zip://{RAW / 'Metra_Stations.zip'}!MetraStations.shp")
metra_chi = metra[metra["MUNICIPALI"].astype(str).str.strip().str.upper() == "CHICAGO"].copy()
metra_chi = metra_chi.to_crs(PROJECTED_CRS)
report(f"  Metra stations (Chicago): {len(metra_chi)}")

metra_joined = gpd.sjoin(
    cook_proj[["census_tract", "geometry"]],
    metra_chi[["geometry"]],
    how="left", predicate="intersects"
)
metra_counts = metra_joined.groupby("census_tract")["index_right"].count()

transit = (
    out["census_tract"].map(cta_counts).fillna(0)
    + out["census_tract"].map(metra_counts).fillna(0)
)
out["Transit_Stop"] = transit.astype(float)
report(f"  Tracts with >0 transit stops: {(out['Transit_Stop'] > 0).sum()}")
report(f"  Total stops: {out['Transit_Stop'].sum():.0f}")


# ============================================================
# 6. Bike_Miles (bike routes + off-street trails in tract + 0.25 mi buffer)
# ============================================================
report("\n--- Bike_Miles ---")

# Bike routes from CSV (WKT geometry)
bike_csv = RAW / "Bike_Routes_20260415.csv"
bike_df = pd.read_csv(bike_csv, low_memory=False)
report(f"  Bike routes rows: {len(bike_df)}")

# Filter to protected/buffered/greenway categories
KEEP_CATEGORIES = {"Protected Bike Lane", "Buffered Bike Lane", "Greenway"}
bike_df["DISPLAYROU"] = bike_df["DISPLAYROU"].astype(str).str.strip()
bike_filtered = bike_df[bike_df["DISPLAYROU"].isin(KEEP_CATEGORIES)].copy()
report(f"  After filtering to {KEEP_CATEGORIES}: {len(bike_filtered)}")

bike_filtered = bike_filtered.dropna(subset=["the_geom"])
bike_filtered["geometry"] = bike_filtered["the_geom"].map(wkt.loads)
bike_gdf = gpd.GeoDataFrame(bike_filtered, geometry="geometry", crs="EPSG:4326").to_crs(PROJECTED_CRS)

# Off-street trails
trails_path = RAW / "Off-Street_Bike_Trails.geojson"
if trails_path.is_file():
    trails = gpd.read_file(trails_path)
    trails = trails.to_crs(PROJECTED_CRS)
    report(f"  Off-street trails loaded: {len(trails)}")
    # Combine
    combined_bike = pd.concat([
        bike_gdf[["geometry"]],
        trails[["geometry"]],
    ], ignore_index=True)
else:
    report("  Off-street trails file not found, using bike routes only")
    combined_bike = bike_gdf[["geometry"]]

combined_bike = gpd.GeoDataFrame(combined_bike, geometry="geometry", crs=PROJECTED_CRS)

buffered_bike = cook_proj[["census_tract", "geometry"]].copy()
buffered_bike["geometry"] = buffered_bike.geometry.buffer(BIKE_BUFFER_FT)

report("  Computing bike route intersections...")
bike_clipped = gpd.overlay(combined_bike, buffered_bike, how="intersection", keep_geom_type=False)
if not bike_clipped.empty:
    bike_clipped["miles"] = bike_clipped.geometry.length / FEET_PER_MILE
    bike_sums = bike_clipped.groupby("census_tract")["miles"].sum()
else:
    bike_sums = pd.Series(dtype=float)

out["Bike_Miles"] = out["census_tract"].map(bike_sums).fillna(0)
report(f"  Tracts with >0 bike miles: {(out['Bike_Miles'] > 0).sum()}")
report(f"  Total bike miles: {out['Bike_Miles'].sum():.1f}")


# ============================================================
# 7. Wifi_Hotspots (point-in-buffer, 0.5 mi)
# ============================================================
report("\n--- Wifi_Hotspots ---")
wifi_path = RAW / "Connect_Chicago_Locations_-_Historical_20260416.csv"
wifi = pd.read_csv(wifi_path, low_memory=False)
wifi["Latitude"] = pd.to_numeric(wifi["Latitude"], errors="coerce")
wifi["Longitude"] = pd.to_numeric(wifi["Longitude"], errors="coerce")
wifi = wifi.dropna(subset=["Latitude", "Longitude"])
report(f"  WiFi locations with coords: {len(wifi)}")

wifi_gdf = gpd.GeoDataFrame(
    wifi, geometry=gpd.points_from_xy(wifi["Longitude"], wifi["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)

buffered_wifi = cook_proj[["census_tract", "geometry"]].copy()
buffered_wifi["geometry"] = buffered_wifi.geometry.buffer(WIFI_BUFFER_FT)

wifi_joined = gpd.sjoin(buffered_wifi, wifi_gdf[["geometry"]], how="left", predicate="intersects")
wifi_counts = wifi_joined.groupby("census_tract")["index_right"].count()
out["Wifi_Hotspots"] = out["census_tract"].map(wifi_counts).fillna(0).astype(float)
report(f"  Tracts with >0 hotspots: {(out['Wifi_Hotspots'] > 0).sum()}")


# ============================================================
# 8. School_Density (point-in-buffer, 0.5 mi)
# ============================================================
report("\n--- School_Density ---")
school_path = RAW / "Chicago_Public_Schools_-_School_Profile_Information_SY2425.csv"
schools = pd.read_csv(school_path, low_memory=False)
schools["School_Latitude"] = pd.to_numeric(schools["School_Latitude"], errors="coerce")
schools["School_Longitude"] = pd.to_numeric(schools["School_Longitude"], errors="coerce")
schools = schools.dropna(subset=["School_Latitude", "School_Longitude"])
report(f"  Schools with coords: {len(schools)}")

school_gdf = gpd.GeoDataFrame(
    schools,
    geometry=gpd.points_from_xy(schools["School_Longitude"], schools["School_Latitude"]),
    crs="EPSG:4326",
).to_crs(PROJECTED_CRS)

buffered_schools = cook_proj[["census_tract", "geometry"]].copy()
buffered_schools["geometry"] = buffered_schools.geometry.buffer(SCHOOL_BUFFER_FT)

school_joined = gpd.sjoin(buffered_schools, school_gdf[["geometry"]], how="left", predicate="intersects")
school_counts = school_joined.groupby("census_tract")["index_right"].count()
out["School_Density"] = out["census_tract"].map(school_counts).fillna(0).astype(float)
report(f"  Tracts with >0 schools: {(out['School_Density'] > 0).sum()}")


# ============================================================
# 9. Library_Count (point-in-buffer, 1.0 mi)
# ============================================================
report("\n--- Library_Count ---")
lib_path = RAW / "Libraries_-_Locations,__Contact_Information,_and_Usual_Hours_of_Operation_20260415.csv"
libs = pd.read_csv(lib_path, low_memory=False)

# Parse LOCATION "(lat, lon)" format
def parse_location(loc):
    if pd.isna(loc):
        return None, None
    m = re.search(r"\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", str(loc))
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None

libs[["Latitude", "Longitude"]] = libs["LOCATION"].apply(
    lambda x: pd.Series(parse_location(x))
)
libs = libs.dropna(subset=["Latitude", "Longitude"])
report(f"  Libraries with coords: {len(libs)}")

lib_gdf = gpd.GeoDataFrame(
    libs, geometry=gpd.points_from_xy(libs["Longitude"], libs["Latitude"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)

buffered_libs = cook_proj[["census_tract", "geometry"]].copy()
buffered_libs["geometry"] = buffered_libs.geometry.buffer(LIBRARY_BUFFER_FT)

lib_joined = gpd.sjoin(buffered_libs, lib_gdf[["geometry"]], how="left", predicate="intersects")
lib_counts = lib_joined.groupby("census_tract")["index_right"].count()
out["Library_Count"] = out["census_tract"].map(lib_counts).fillna(0).astype(float)
report(f"  Tracts with >0 libraries: {(out['Library_Count'] > 0).sum()}")


# ============================================================
# 10 & 11. Small_Business + Grocery_Store (spatial join using LAT/LON)
# ============================================================
report("\n--- Small_Business + Grocery_Store ---")
biz_path = PROC / "Business_Licenses_20260415_with_tracts.csv"
report("  Loading business licenses (large file, may take a moment)...")
biz = pd.read_csv(
    biz_path,
    usecols=["ACCOUNT NUMBER", "SITE NUMBER", "LICENSE STATUS", "LICENSE DESCRIPTION",
             "LATITUDE", "LONGITUDE"],
    low_memory=False,
)
report(f"  Total rows: {len(biz):,}")

# Filter to active (AAI)
biz = biz[biz["LICENSE STATUS"].astype(str).str.upper() == "AAI"].copy()
report(f"  AAI active: {len(biz):,}")

# Deduplicate by account|site
acct = biz["ACCOUNT NUMBER"].astype("string").str.strip().fillna("")
site = biz["SITE NUMBER"].astype("string").str.strip().fillna("")
biz["_key"] = acct + "|" + site
biz = biz[biz["_key"].str.len() > 1]
biz = biz.drop_duplicates(subset=["_key"], keep="last")
report(f"  After dedup: {len(biz):,}")

biz["LATITUDE"] = pd.to_numeric(biz["LATITUDE"], errors="coerce")
biz["LONGITUDE"] = pd.to_numeric(biz["LONGITUDE"], errors="coerce")
biz = biz.dropna(subset=["LATITUDE", "LONGITUDE"])
report(f"  With coords: {len(biz):,}")

biz_gdf = gpd.GeoDataFrame(
    biz, geometry=gpd.points_from_xy(biz["LONGITUDE"], biz["LATITUDE"]), crs="EPSG:4326"
).to_crs(PROJECTED_CRS)

report("  Spatial join (point in tract)...")
biz_joined = gpd.sjoin(
    biz_gdf[["LICENSE DESCRIPTION", "geometry"]],
    cook_proj[["census_tract", "geometry"]],
    how="inner", predicate="within"
)
report(f"  Businesses matched to tracts: {len(biz_joined):,}")

small_biz = biz_joined["census_tract"].value_counts()
out["Small_Business"] = out["census_tract"].map(small_biz).fillna(0).astype(float)
report(f"  Tracts with >0 businesses: {(out['Small_Business'] > 0).sum()}")
report(f"  Total businesses: {out['Small_Business'].sum():.0f}")

# Grocery subset
grocery_mask = biz_joined["LICENSE DESCRIPTION"].astype(str).str.contains(
    r"Retail Food Establishment|Produce Merchant", case=False, na=False, regex=True
)
grocery_counts = biz_joined.loc[grocery_mask, "census_tract"].value_counts()
out["Grocery_Store"] = out["census_tract"].map(grocery_counts).fillna(0).astype(float)
report(f"  Tracts with >0 grocery: {(out['Grocery_Store'] > 0).sum()}")
report(f"  Total grocery licenses: {out['Grocery_Store'].sum():.0f}")


# ============================================================
# FINAL: Write output
# ============================================================
report("\n=== FINAL SUMMARY ===")
report(f"Output rows: {len(out)}")
report(f"Columns: {list(out.columns)}")
for col in out.columns:
    if col == "census_tract":
        continue
    vals = out[col]
    n_nonnull = vals.notna().sum()
    n_zero = (vals == 0).sum()
    mn = vals.min() if n_nonnull > 0 else float("nan")
    mx = vals.max() if n_nonnull > 0 else float("nan")
    avg = vals.mean() if n_nonnull > 0 else float("nan")
    report(f"  {col}: non-null={n_nonnull}, zero={n_zero}, min={mn:.2f}, max={mx:.2f}, mean={avg:.2f}")

out_path = PROC / "all_tract_features.csv"
try:
    out.to_csv(out_path, index=False)
    report(f"Wrote {out_path}")
except PermissionError:
    alt = PROC / "all_tract_features_new.csv"
    out.to_csv(alt, index=False)
    report(f"Could not write {out_path}; wrote {alt} instead")

pub_path = ROOT / "public" / "all_tract_features.csv"
try:
    pub_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(pub_path, index=False)
    report(f"Wrote {pub_path}")
except OSError as e:
    report(f"Could not write {pub_path}: {e}")

report(f"\nDone in {time.time()-t0:.1f}s total")
