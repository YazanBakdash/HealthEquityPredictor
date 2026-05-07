"""Restore to 891 CTA-based Chicago tracts (no 8000+ cutoff)."""
import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

PROJECTED = "EPSG:3435"

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
print(f'Chicago tracts: {len(chicago_set)}')

# Filter features
feat = pd.read_csv('inputs_processed/all_tract_features.csv', dtype={'census_tract': str})
feat_chi = feat[feat['census_tract'].isin(chicago_set)]
feat_chi.to_csv('inputs_processed/all_tract_features.csv', index=False)
feat_chi.to_csv('public/all_tract_features.csv', index=False)
print(f'Features: {len(feat_chi)} rows')

# Tract list
pd.DataFrame({'census_tract': sorted(chicago_set)}).to_csv(
    'inputs_processed/chicago_tract_list.csv', index=False
)

# GeoJSON
chi_gdf = cook[cook['census_tract'].isin(chicago_set)].copy()
chi_gdf = chi_gdf.rename(columns={'census_tract': 'CENSUS_T_1'})
chi_gdf = chi_gdf.to_crs('EPSG:4326')
chi_gdf.to_file('public/census_tracts.json', driver='GeoJSON')
print(f'GeoJSON: {len(chi_gdf)} features')
