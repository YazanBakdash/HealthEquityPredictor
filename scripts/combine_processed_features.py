from __future__ import annotations

from pathlib import Path

import pandas as pd

try:
    import geopandas as gpd
except Exception as e:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: geopandas.\n"
        "Install with: python -m pip install -r scripts/requirements.txt\n"
        f"Original error: {e}"
    )


ROOT = Path(".")
PROCESSED = ROOT / "inputs_processed"
TRACTS_PATH = ROOT / "public" / "census_tracts.json"
HEALTH_ATLAS_CANOPY_CSV = PROCESSED / "tract_tree_canopy_health_atlas.csv"
OUT_PATH = PROCESSED / "all_tract_features.csv"
PUBLIC_TREE_CANOPY_CSV = ROOT / "public" / "tract_tree_canopy.csv"
PUBLIC_ALL_FEATURES_CSV = ROOT / "public" / "all_tract_features.csv"


def _normalize_tract_series(series: pd.Series) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    s = s.dropna().astype("Int64").astype(str)
    return s


def _count_by_tract(path: Path, tract_col: str) -> pd.Series:
    df = pd.read_csv(path, usecols=[tract_col], low_memory=False)
    tracts = _normalize_tract_series(df[tract_col])
    return tracts.value_counts()


def _sum_by_tract(path: Path, tract_col: str, value_col: str) -> pd.Series:
    df = pd.read_csv(path, usecols=[tract_col, value_col], low_memory=False)
    df = df.copy()
    df[tract_col] = _normalize_tract_series(df[tract_col])
    df = df[df[tract_col].notna()]
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0.0)
    return df.groupby(tract_col)[value_col].sum()


def main() -> None:
    if not HEALTH_ATLAS_CANOPY_CSV.is_file():
        raise SystemExit(
            f"Missing {HEALTH_ATLAS_CANOPY_CSV}. Run:\n"
            f"  python scripts/health_atlas_canopy_to_tract_csv.py\n"
            f"then re-run this script."
        )

    tracts = gpd.read_file(TRACTS_PATH)[["CENSUS_T_1"]].copy()
    tracts["census_tract"] = _normalize_tract_series(tracts["CENSUS_T_1"])
    out = pd.DataFrame({"census_tract": tracts["census_tract"].values})

    atlas = pd.read_csv(HEALTH_ATLAS_CANOPY_CSV, low_memory=False)
    atlas["census_tract"] = _normalize_tract_series(atlas["census_tract"])
    atlas["Tree_Canopy"] = pd.to_numeric(atlas["Tree_Canopy"], errors="coerce")
    canopy_map = atlas.drop_duplicates("census_tract", keep="last").set_index("census_tract")[
        "Tree_Canopy"
    ]
    out["Tree_Canopy"] = out["census_tract"].map(canopy_map)

    # Housing & Urban Environment
    affordable = _sum_by_tract(
        PROCESSED / "Affordable_Rental_Housing_Developments_20260415_with_tracts.csv",
        "CENSUS_TRACT",
        "Units",
    )
    out["Affordable_Housing"] = out["census_tract"].map(affordable).fillna(0.0)

    if out["Tree_Canopy"].isna().any():
        missing = out.loc[out["Tree_Canopy"].isna(), "census_tract"].tolist()
        raise SystemExit(
            f"Health Atlas canopy CSV is missing {len(missing)} tract(s). Example: {missing[:5]}"
        )

    map_csv = pd.DataFrame({"census_tract": out["census_tract"], "Tree_Canopy": out["Tree_Canopy"]})
    try:
        PUBLIC_TREE_CANOPY_CSV.parent.mkdir(parents=True, exist_ok=True)
        map_csv.to_csv(PUBLIC_TREE_CANOPY_CSV, index=False)
    except OSError as e:
        print(f"Note: could not copy tree canopy CSV to {PUBLIC_TREE_CANOPY_CSV}: {e}")

    parks = _sum_by_tract(PROCESSED / "CPD_Parks_with_tracts.csv", "census_tract", "ACRES")
    out["Parks"] = out["census_tract"].map(parks).fillna(0.0)

    # Mobility & Infrastructure
    cta_counts = _count_by_tract(PROCESSED / "CTA_BusStops_with_tracts.csv", "CENSUS_TRACT")
    metra_counts = _count_by_tract(PROCESSED / "Metra_Stations_with_tracts.csv", "CENSUS_TRACT")
    out["Transit_Stop"] = (
        out["census_tract"].map(cta_counts).fillna(0).astype(float)
        + out["census_tract"].map(metra_counts).fillna(0).astype(float)
    )

    bike = pd.read_csv(PROCESSED / "tract_bike_lane_miles.csv", low_memory=False)
    bike["census_tract"] = _normalize_tract_series(bike["census_tract"])
    bike_map = bike.set_index("census_tract")["bike_lane_miles"]
    out["Bike_Miles"] = out["census_tract"].map(bike_map).fillna(0.0)

    wifi_counts = _count_by_tract(
        PROCESSED / "Connect_Chicago_Locations_-_Historical_20260416_with_tracts.csv",
        "CENSUS_TRACT",
    )
    out["Wifi_Hotspots"] = out["census_tract"].map(wifi_counts).fillna(0).astype(float)

    # Education
    school_counts = _count_by_tract(
        PROCESSED / "Chicago_Public_Schools_-_School_Profile_Information_SY2425_with_tracts.csv",
        "CENSUS_TRACT",
    )
    out["School_Density"] = out["census_tract"].map(school_counts).fillna(0).astype(float)

    lib_path = (
        PROCESSED
        / "Libraries_-_Locations,__Contact_Information,_and_Usual_Hours_of_Operation_20260415_with_tracts.csv"
    )
    library_counts = _count_by_tract(lib_path, "CENSUS_TRACT")
    out["Library_Count"] = out["census_tract"].map(library_counts).fillna(0).astype(float)

    # Economic Development — active licenses only, one row per (account, site)
    biz_path = PROCESSED / "Business_Licenses_20260415_with_tracts.csv"
    biz = pd.read_csv(
        biz_path,
        usecols=[
            "CENSUS_TRACT",
            "LICENSE STATUS",
            "LICENSE DESCRIPTION",
            "ACCOUNT NUMBER",
            "SITE NUMBER",
        ],
        low_memory=False,
    )
    biz = biz.copy()
    biz["CENSUS_TRACT"] = _normalize_tract_series(biz["CENSUS_TRACT"])
    biz = biz[biz["CENSUS_TRACT"].notna()]

    active = biz[biz["LICENSE STATUS"].astype(str).str.upper().eq("AAI")].copy()
    acct = active["ACCOUNT NUMBER"].astype("string").str.strip()
    site = active["SITE NUMBER"].astype("string").str.strip()
    active["_dedupe_key"] = acct.fillna("") + "|" + site.fillna("")
    # Drop rows with no account/site id (cannot dedupe reliably); usually rare.
    active = active[active["_dedupe_key"].str.len() > 1]
    active = active.drop_duplicates(subset=["_dedupe_key"], keep="last")

    small_business = active["CENSUS_TRACT"].value_counts()
    out["Small_Business"] = out["census_tract"].map(small_business).fillna(0).astype(float)

    grocery_mask = active["LICENSE DESCRIPTION"].astype(str).str.contains(
        r"Retail Food Establishment|Produce Merchant",
        case=False,
        na=False,
        regex=True,
    )
    grocery_counts = active.loc[grocery_mask, "CENSUS_TRACT"].value_counts()
    out["Grocery_Store"] = out["census_tract"].map(grocery_counts).fillna(0).astype(float)

    print(
        f"Business licenses: {len(biz):,} rows -> {len(active):,} active unique (account|site); "
        f"citywide Small_Business sum {float(out['Small_Business'].sum()):,.0f}"
    )

    try:
        out.to_csv(OUT_PATH, index=False)
        print(f"Wrote {len(out):,} rows to {OUT_PATH}")
    except PermissionError:
        alt = OUT_PATH.with_name("all_tract_features_new.csv")
        out.to_csv(alt, index=False)
        print(
            f"Could not write {OUT_PATH} (close the file if it is open in another program). "
            f"Wrote {len(out):,} rows to {alt} instead."
        )
    try:
        PUBLIC_ALL_FEATURES_CSV.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(PUBLIC_ALL_FEATURES_CSV, index=False)
    except OSError as e:
        print(f"Note: could not write {PUBLIC_ALL_FEATURES_CSV}: {e}")
    print("Columns:", ", ".join(out.columns))


if __name__ == "__main__":
    main()

