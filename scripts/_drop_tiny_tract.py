import pandas as pd
import json

DROP = '17031980100'

for f in ['inputs_processed/all_tract_features.csv', 'public/all_tract_features.csv']:
    df = pd.read_csv(f, dtype={'census_tract': str})
    before = len(df)
    df = df[df['census_tract'] != DROP]
    df.to_csv(f, index=False)
    print(f"{f}: {before} -> {len(df)}")

cl = pd.read_csv('inputs_processed/chicago_tract_list.csv', dtype={'census_tract': str})
before = len(cl)
cl = cl[cl['census_tract'] != DROP]
cl.to_csv('inputs_processed/chicago_tract_list.csv', index=False)
print(f"chicago_tract_list: {before} -> {len(cl)}")

with open('public/census_tracts.json', 'r') as fh:
    gj = json.load(fh)
before = len(gj['features'])
gj['features'] = [ft for ft in gj['features']
                   if ft.get('properties', {}).get('CENSUS_T_1', '') != DROP]
with open('public/census_tracts.json', 'w') as fh:
    json.dump(gj, fh)
after = len(gj['features'])
print(f"census_tracts.json: {before} -> {after}")
