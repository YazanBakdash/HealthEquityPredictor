"""
Load Chicago Public Schools + CPL library coordinates from inputs_raw CSVs
for inserting into simulation_geometry (one row per POI).
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUTS_RAW = PROJECT_ROOT / "inputs_raw"

_SCHOOL_CSV = INPUTS_RAW / "Chicago_Public_Schools_-_School_Profile_Information_SY2425.csv"
_LIB_CSV = INPUTS_RAW / (
    "Libraries_-_Locations,__Contact_Information,_and_Usual_Hours_of_Operation_20260415.csv"
)


def _parse_library_location(loc) -> tuple[float | None, float | None]:
    if pd.isna(loc):
        return None, None
    m = re.search(r"\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", str(loc))
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def build_school_library_geometry_rows(simulation_id: str) -> list[dict]:
    """Rows ready for Supabase simulation_geometry insert."""
    rows: list[dict] = []

    if _SCHOOL_CSV.is_file():
        schools = pd.read_csv(_SCHOOL_CSV, low_memory=False)
        schools["School_Latitude"] = pd.to_numeric(schools["School_Latitude"], errors="coerce")
        schools["School_Longitude"] = pd.to_numeric(schools["School_Longitude"], errors="coerce")
        schools = schools.dropna(subset=["School_Latitude", "School_Longitude"])
        for _, r in schools.iterrows():
            lat = float(r["School_Latitude"])
            lon = float(r["School_Longitude"])
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                continue
            rows.append(
                {
                    "simulation_id": simulation_id,
                    "feature_type": "school",
                    "lat": lat,
                    "lon": lon,
                    "geometry": None,
                }
            )

    if _LIB_CSV.is_file():
        libs = pd.read_csv(_LIB_CSV, low_memory=False)
        libs[["Latitude", "Longitude"]] = libs["LOCATION"].apply(
            lambda x: pd.Series(_parse_library_location(x)),
        )
        libs = libs.dropna(subset=["Latitude", "Longitude"])
        for _, r in libs.iterrows():
            lat = float(r["Latitude"])
            lon = float(r["Longitude"])
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                continue
            rows.append(
                {
                    "simulation_id": simulation_id,
                    "feature_type": "library",
                    "lat": lat,
                    "lon": lon,
                    "geometry": None,
                }
            )

    return rows
