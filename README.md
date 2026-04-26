# Health Equity Predictor

Interactive choropleth map of Chicago census tracts with 10 infrastructure/equity features, designed to feed a random forest model predicting health outcomes.

## Quick Start

**Prerequisites:** Node.js, Python 3.10+

```bash
npm install
npm run dev
```

## Data Pipeline

All features are computed from raw data in `inputs_raw/` by a single script:

```bash
pip install -r scripts/requirements.txt
python scripts/build_features.py
```

This produces:

| Output | Description |
|---|---|
| `inputs_processed/all_tract_features.csv` | 791 tracts x 10 density features + area + population |
| `public/all_tract_features.csv` | Same file, served to the frontend |
| `inputs_processed/combined_all_features.csv` | Above + 17 census variables from ACS |
| `inputs_processed/chicago_tract_list.csv` | List of included tract IDs |
| `public/census_tracts.json` | GeoJSON boundaries for the frontend map |

## Tract Selection

Tracts are derived from the **2025 Census Bureau shapefile** (`IL_tracts/cb_2025_17_tract_500k.shp`), filtered to Cook County, then filtered to Chicago using CTA bus stop coverage (tracts containing CTA stops OR whose centroid falls within a 0.5-mile buffered convex hull of all CTA stops). Additional exclusions:

- 4 anomalous tracts (`17031760900`, `17031770600`, `17031770700`, `17031000000`)
- 98 western suburban tracts in the 8056-8229 range (no raw data coverage)
- `17031030702` (0.006 sq mi, extreme density outlier)
- `17031980100` (Midway Airport, population 18, extreme per-capita outlier)

Final count: **791 tracts**.

## Feature Calculations

All spatial operations use **EPSG:3435** (Illinois State Plane East, feet) for accurate distance/area measurements. Features are computed as raw counts first, then converted to densities.

### Tree Canopy (`Tree_Canopy`)

- **Unit:** Percentage of tract area covered by tree canopy
- **Source:** `inputs_raw/tree_canopy.geojson` (1,318 tract-level polygons with `PCT_Tree` and `FIPS`)
- **Method:**
  1. Direct FIPS match to census tract ID
  2. Parent-tract fallback for 2020 Census sub-tract splits (e.g., `17031010201` falls back to `17031010200`)
  3. Spatial area-weighted overlay for remaining unmatched tracts (intersection of tree canopy polygons with tract polygons, weighted by overlap area)
  4. Any remaining NaN filled with 0.0
- **Normalization:** None (already a percentage)

### Affordable Housing (`Affordable_Housing`)

- **Unit:** Subsidized/income-restricted rental units per 1,000 residents
- **Source:** `inputs_raw/Affordable_Rental_Housing_Developments_20260415.csv` (598 developments with lat/lon and `Units` count)
- **Method:** Each tract boundary is buffered by **0.5 miles**. Housing developments are spatially joined to buffered tracts. The `Units` column is summed per tract. A single development may count toward multiple tracts if it falls within overlapping buffers.
- **Normalization:** Divided by (population / 1,000), with a population floor of 500

### Parks (`Parks`)

- **Unit:** Park acreage per square mile of tract area
- **Source:** `inputs_raw/CPD_Parks_20260416.csv` (617 park polygons in WKT format)
- **Method:** Park polygons are intersected with tract boundaries buffered by **0.25 miles**. The area of each intersection polygon is computed in square feet and converted to acres. Acres are summed per tract.
- **Normalization:** Divided by tract area in square miles

### Transit Stops (`Transit_Stop`)

- **Unit:** CTA bus + Metra stops per 10,000 residents
- **Source:**
  - `inputs_raw/CTA_BusStops.zip` (9,917 Chicago stops)
  - `inputs_raw/Metra_Stations.zip` (73 Chicago stations)
- **Method:** Both datasets are filtered to `CITY = CHICAGO`. Stops are spatially joined to tract polygons (point-in-polygon, no buffer). CTA and Metra counts are summed per tract.
- **Normalization:** Divided by (population / 1,000), then multiplied by 10 to get per-10,000 rate

### Bike Miles (`Bike_Miles`)

- **Unit:** Protected bike lane + off-street trail miles per square mile
- **Sources:**
  - `inputs_raw/Bike_Routes_20260415.csv` (WKT line geometries, filtered to Protected Bike Lane, Buffered Bike Lane, and Greenway categories: 358 of 1,008 routes)
  - `inputs_raw/Off-Street_Bike_Trails.geojson` (3,381 trail segments)
- **Method:** Both datasets are combined into a single line GeoDataFrame. Lines are intersected with tract boundaries buffered by **0.25 miles**. The length of each clipped segment is measured in feet and converted to miles, then summed per tract.
- **Normalization:** Divided by tract area in square miles

### Wi-Fi Hotspots (`Wifi_Hotspots`)

- **Unit:** Public Wi-Fi hotspots per square mile
- **Source:** `inputs_raw/Connect_Chicago_Locations_-_Historical_20260416.csv` (259 locations with lat/lon)
- **Method:** Hotspot points are spatially joined to tract boundaries buffered by **0.5 miles**. Count per tract.
- **Normalization:** Divided by tract area in square miles

### School Density (`School_Density`)

- **Unit:** Public K-12 schools per 10,000 residents
- **Source:** `inputs_raw/Chicago_Public_Schools_-_School_Profile_Information_SY2425.csv` (652 schools with lat/lon)
- **Method:** School points are spatially joined to tract boundaries buffered by **0.5 miles**. Count per tract.
- **Normalization:** Divided by (population / 1,000), then multiplied by 10 to get per-10,000 rate

### Library Count (`Library_Count`)

- **Unit:** Public library branches per 10,000 residents
- **Source:** `inputs_raw/Libraries_-_Locations,_Contact_Information,_and_Usual_Hours_of_Operation_20260415.csv` (81 libraries, coordinates parsed from `LOCATION` field in `(lat, lon)` format)
- **Method:** Library points are spatially joined to tract boundaries buffered by **1.0 mile** (larger buffer because libraries are sparse and serve wide areas). Count per tract.
- **Normalization:** Divided by (population / 1,000), then multiplied by 10 to get per-10,000 rate

### Small Business (`Small_Business`)

- **Unit:** Active business licenses per 1,000 residents
- **Source:** `inputs_processed/Business_Licenses_20260415_with_tracts.csv` (1.19M rows, filtered to `LICENSE STATUS = AAI`, deduplicated by `ACCOUNT NUMBER` + `SITE NUMBER`: 237,200 unique businesses with coordinates)
- **Method:** Business points are spatially joined to tract polygons using **point-in-polygon** (no buffer). Count per tract.
- **Normalization:** Divided by (population / 1,000)

### Grocery Store (`Grocery_Store`)

- **Unit:** Grocery/retail food licenses per 1,000 residents
- **Source:** Same as Small Business, filtered to licenses matching `Retail Food Establishment` or `Produce Merchant`
- **Method:** Subset of the small business spatial join, filtered by license description. Count per tract.
- **Normalization:** Divided by (population / 1,000)

## Census Variables

The `combined_all_features.csv` file adds 17 variables from `inputs_processed/census_data_out.csv` (American Community Survey via Census Bureau):

- Education: % with <9 years education, % with high school diploma, % in white-collar occupations
- Employment: Unemployment rate
- Income/poverty: Median family income, % families below poverty, % below 150% poverty threshold, log ratio low-to-high income
- Housing: Median home value, median gross rent, median monthly mortgage, % owner-occupied, % without plumbing, % single-parent households
- Access: % without motor vehicle, % without telephone, % with >1 person per room

## Population Data

Population counts are from the **2020 Decennial Census** (`inputs_raw/DECENNIALDHC2020.P1-Data.csv`), table P1 (total population by tract).

## Frontend

React + TypeScript + D3.js choropleth map with:

- Layer switcher for all 10 features + simulated ADI
- Color scale capped at 95th percentile to prevent outlier compression
- ESRI satellite imagery toggle
- Hover tooltips and tract selection
- Policy simulation sliders (ADI mode)
