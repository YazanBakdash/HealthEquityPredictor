**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Assign lat/lon points to Chicago census tracts

This repo includes a Python utility that takes point datasets from `inputs_raw/` and adds a census tract column by spatially joining the points to the tract polygons.

### Install (Python)

```bash
python -m pip install -r scripts/requirements.txt
```

### Run

Process everything in `inputs_raw/` and write results to `processed/`:

```bash
python scripts/assign_points_to_tracts.py --drop-geometry
```

Process specific files manually:

```bash
python scripts/assign_points_to_tracts.py --inputs inputs_raw/clinics.csv inputs_raw/grocery_stores.csv --out-dir processed --drop-geometry
```

Outputs will be written to `processed/` as `*_with_tracts.csv`.

### Notes

- The default tract boundary file is `public/census_tracts.json`.
- If your tract file contains a real tract id field (like `GEOID`), pass it with `--tract-id-field GEOID`.
- If your point files use different column names, pass them with `--lat-col` and `--lon-col`.
