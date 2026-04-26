"""
Apply Chicago filter:
1. CTA-based Chicago tracts (891)
2. Add back 17031840000 (removed from old EXCLUDED list, causes visible gap)
3. Remove 805600-822900 range (western suburban spillover, mostly zeros)
4. Keep old excludes for the other 4: 17031760900, 17031770600, 17031770700, 17031000000
"""
import pandas as pd
import json
import geopandas as gpd
from shapely.ops import unary_union

PROJECTED = "EPSG:3435"

def tract_num(ct):
    return int(ct[5:]) if len(ct) == 11 else 0

# Step 1: CTA-based Chicago filter
cook = gpd.read_file('IL_tracts/cb_2025_17_tract_500k.shp')
cook = cook[cook['COUNTYFP'] == '031'].copy()
cook = cook.rename(columns={'GEOID': 'census_tract'})
cook_proj = cook.to_crs(PROJECTED)

cta = gpd.read_file('zip://inputs_raw/CTA_BusStops.zip!CTA_BusStops.shp')
cta_chi = cta[cta['CITY'].astype(str).str.upper() == 'CHICAGO'].to_crs(PROJECTED)

joined = gpd.sjoin(cook_proj[['census_tract', 'geometry']], cta_chi[['geometry']],
                   how='inner', predicate='intersects')
tracts_with_cta = set(joined['census_tract'].unique())

cta_hull = unary_union(cta_chi.geometry).convex_hull.buffer(2640)
cook_proj['centroid_geom'] = cook_proj.geometry.centroid
in_hull = cook_proj['centroid_geom'].within(cta_hull)
tracts_in_hull = set(cook_proj.loc[in_hull, 'census_tract'])

chicago_set = tracts_with_cta | tracts_in_hull
print(f"CTA Chicago tracts: {len(chicago_set)}")

# Step 2: Add 17031840000 explicitly
chicago_set.add('17031840000')
print(f"After adding 840000: {len(chicago_set)}")

# Step 3: Remove other 4 excludes
OLD_EXCLUDES = {'17031760900', '17031770600', '17031770700', '17031000000'}
chicago_set -= OLD_EXCLUDES
print(f"After removing 4 old excludes: {len(chicago_set)}")

# Step 4: Remove 805600-822900 suburban range
suburban = {ct for ct in chicago_set if 805600 <= tract_num(ct) <= 822900}
print(f"Western suburban tracts to remove (805600-822900): {len(suburban)}")
chicago_set -= suburban
print(f"Final tract count: {len(chicago_set)}")

# Step 5: Filter features
feat = pd.read_csv('inputs_processed/all_tract_features.csv', dtype={'census_tract': str})
feat = feat[feat['census_tract'].isin(chicago_set)].sort_values('census_tract').reset_index(drop=True)
feat.to_csv('inputs_processed/all_tract_features.csv', index=False)
feat.to_csv('public/all_tract_features.csv', index=False)
print(f"Features CSV: {len(feat)} rows")

# Step 6: Chicago tract list
pd.DataFrame({'census_tract': sorted(chicago_set)}).to_csv(
    'inputs_processed/chicago_tract_list.csv', index=False)

# Step 7: GeoJSON
chi_gdf = cook[cook['census_tract'].isin(chicago_set)].copy()
chi_gdf = chi_gdf.rename(columns={'census_tract': 'CENSUS_T_1'})
chi_gdf = chi_gdf.to_crs('EPSG:4326')
chi_gdf.to_file('public/census_tracts.json', driver='GeoJSON')
print(f"GeoJSON: {len(chi_gdf)} features")

# Summary of zeros
feat_cols = ['Affordable_Housing','Parks','Transit_Stop','Bike_Miles',
             'Wifi_Hotspots','School_Density','Library_Count','Small_Business','Grocery_Store']
feat['_zeros'] = (feat[feat_cols] == 0).sum(axis=1)
print(f"\nZero-count distribution (excl Tree_Canopy):")
print(feat['_zeros'].value_counts().sort_index().to_string())
high = feat[feat['_zeros'] >= 7]
print(f"\nTracts with >= 7 zeros: {len(high)}")
