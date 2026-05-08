import csv, json, re

features = []
with open('Bike_Routes_20260415.csv', newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        wkt = row['the_geom']
        coords_raw = re.findall(r'-?\d+\.\d+ -?\d+\.\d+', wkt)
        lines = []
        current = []
        # Split on MULTILINESTRING structure
        for part in re.split(r'\(|\)', wkt):
            pairs = re.findall(r'(-?\d+\.\d+) (-?\d+\.\d+)', part)
            if pairs:
                lines.append([[float(lon), float(lat)] for lon, lat in pairs])
        if not lines:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": lines},
            "properties": {"street": row.get("STREET", "")}
        })

with open('bike_routes.geojson', 'w') as f:
    json.dump({"type": "FeatureCollection", "features": features}, f)

print(f"Done: {len(features)} features")