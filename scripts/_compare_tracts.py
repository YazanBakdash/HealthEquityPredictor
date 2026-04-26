import pandas as pd

old = pd.read_csv('all_tract_features.csv', dtype={'census_tract': str})
old_tracts = set(old['census_tract'].str.strip())

new = pd.read_csv('inputs_processed/all_tract_features.csv', dtype={'census_tract': str})
new_tracts = set(new['census_tract'].str.strip())

only_in_new = new_tracts - old_tracts
only_in_old = old_tracts - new_tracts
common = old_tracts & new_tracts

print(f"Old tract count: {len(old_tracts)}")
print(f"New tract count: {len(new_tracts)}")
print(f"Common: {len(common)}")
print(f"Only in NEW (added): {len(only_in_new)}")
print(f"Only in OLD (lost): {len(only_in_old)}")

if only_in_new:
    added = new[new['census_tract'].isin(only_in_new)].copy()
    feat_cols = ['Tree_Canopy','Affordable_Housing','Parks','Transit_Stop','Bike_Miles',
                 'Wifi_Hotspots','School_Density','Library_Count','Small_Business','Grocery_Store']
    added['zero_count'] = (added[feat_cols] == 0).sum(axis=1)
    added_sorted = added.sort_values('census_tract')
    
    print(f"\n=== Tracts ONLY in new set ({len(added)}) ===")
    print(f"Zero-count distribution:")
    print(added['zero_count'].value_counts().sort_index())
    
    print(f"\nTracts with >= 5 zeros ({(added['zero_count'] >= 5).sum()}):")
    high_zero = added[added['zero_count'] >= 5].sort_values('zero_count', ascending=False)
    for _, r in high_zero.iterrows():
        print(f"  {r['census_tract']}  zeros={int(r['zero_count'])}  "
              f"TC={r['Tree_Canopy']:.1f} AH={r['Affordable_Housing']:.0f} "
              f"P={r['Parks']:.1f} TS={r['Transit_Stop']:.0f} BM={r['Bike_Miles']:.1f} "
              f"WH={r['Wifi_Hotspots']:.0f} SD={r['School_Density']:.0f} "
              f"LC={r['Library_Count']:.0f} SB={r['Small_Business']:.0f} GS={r['Grocery_Store']:.0f}")

    print(f"\nAll added tracts with zero counts:")
    for _, r in added_sorted.iterrows():
        print(f"  {r['census_tract']}  zeros={int(r['zero_count'])}")

if only_in_old:
    print(f"\n=== Tracts LOST from old set ({len(only_in_old)}) ===")
    for t in sorted(only_in_old):
        print(f"  {t}")
