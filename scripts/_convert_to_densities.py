"""
Convert raw count/length features to densities:
- By area (per sq mi): Parks, Bike_Miles, Wifi_Hotspots
- By population (per 1,000 residents): Affordable_Housing, Transit_Stop,
  School_Density, Library_Count, Small_Business, Grocery_Store
- Keep as-is: Tree_Canopy (already a percentage)
"""
import pandas as pd

POP_FLOOR = 500

for f in ['inputs_processed/all_tract_features.csv', 'public/all_tract_features.csv']:
    df = pd.read_csv(f, dtype={'census_tract': str})

    area = df['Tract_Area_SqMi']
    pop = df['Population'].clip(lower=POP_FLOOR)
    pop_k = pop / 1000

    # Per sq mi: spatial coverage features
    df['Parks'] = (df['Parks'] / area).round(4)
    df['Bike_Miles'] = (df['Bike_Miles'] / area).round(4)
    df['Wifi_Hotspots'] = (df['Wifi_Hotspots'] / area).round(4)

    # Per 1,000 residents: service access features
    df['Affordable_Housing'] = (df['Affordable_Housing'] / pop_k).round(4)
    df['Transit_Stop'] = (df['Transit_Stop'] / pop_k).round(4)
    df['School_Density'] = (df['School_Density'] / pop_k).round(4)
    df['Library_Count'] = (df['Library_Count'] / pop_k).round(4)
    df['Small_Business'] = (df['Small_Business'] / pop_k).round(4)
    df['Grocery_Store'] = (df['Grocery_Store'] / pop_k).round(4)

    df.to_csv(f, index=False)

    print(f"\n{f} ({len(df)} rows):")
    print(f"  Pop floor applied: {POP_FLOOR} (tracts with pop < {POP_FLOOR} use {POP_FLOOR} as denominator)")
    tracts_floored = (df['Population'] < POP_FLOOR).sum()
    print(f"  Tracts with pop < {POP_FLOOR}: {tracts_floored}")
    for col in ['Tree_Canopy', 'Affordable_Housing', 'Parks', 'Transit_Stop',
                'Bike_Miles', 'Wifi_Hotspots', 'School_Density', 'Library_Count',
                'Small_Business', 'Grocery_Store']:
        mn = df[col].min()
        mx = df[col].max()
        avg = df[col].mean()
        print(f"  {col:25s}  min={mn:10.4f}  max={mx:10.4f}  mean={avg:10.4f}")
