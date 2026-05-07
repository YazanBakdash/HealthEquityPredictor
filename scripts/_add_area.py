import geopandas as gpd
import pandas as pd

SQFT_PER_SQMI = 5280 ** 2

cook = gpd.read_file('IL_tracts/cb_2025_17_tract_500k.shp')
cook = cook[cook['COUNTYFP'] == '031'].copy()
cook = cook.rename(columns={'GEOID': 'census_tract'})
cook_proj = cook.to_crs('EPSG:3435')
cook_proj['Tract_Area_SqMi'] = cook_proj.geometry.area / SQFT_PER_SQMI
area_map = cook_proj.set_index('census_tract')['Tract_Area_SqMi']

for f in ['inputs_processed/all_tract_features.csv', 'public/all_tract_features.csv']:
    df = pd.read_csv(f, dtype={'census_tract': str})
    if 'Tract_Area_SqMi' in df.columns:
        df = df.drop(columns=['Tract_Area_SqMi'])
    df['Tract_Area_SqMi'] = df['census_tract'].map(area_map).round(4)
    df.to_csv(f, index=False)
    missing = df['Tract_Area_SqMi'].isna().sum()
    mn = df['Tract_Area_SqMi'].min()
    mx = df['Tract_Area_SqMi'].max()
    avg = df['Tract_Area_SqMi'].mean()
    print(f"{f}: {len(df)} rows")
    print(f"  Area range: {mn:.4f} - {mx:.4f} sq mi")
    print(f"  Mean: {avg:.4f} sq mi")
    print(f"  Missing: {missing}")
