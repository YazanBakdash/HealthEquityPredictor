"""
Core spatial recalculation logic.
Loads baseline data on startup, then recalculates all 791 tract features
when user-placed geometry or slider overrides are provided.
"""
from __future__ import annotations
import json
import math
import numbers
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, shape

FEET_PER_MILE = 5280.0
SQFT_PER_ACRE = 43560.0
SQFT_PER_SQMI = FEET_PER_MILE ** 2
PROJECTED_CRS = "EPSG:3435"

LIBRARY_BUFFER_FT = 1.0 * FEET_PER_MILE
SCHOOL_BUFFER_FT = 0.5 * FEET_PER_MILE
BIKE_BUFFER_FT = 0.25 * FEET_PER_MILE
PARK_BUFFER_FT = 0.25 * FEET_PER_MILE

POP_FLOOR = 500

FEATURE_COLS = [
    "Tree_Canopy", "Affordable_Housing", "Parks", "Transit_Stop",
    "Bike_Miles", "Wifi_Hotspots", "School_Density", "Library_Count",
    "Small_Business", "Food_Access",
    "Tract_Area_SqMi", "Population",
]

# simulation_features table columns (snake_case) -> FEATURE_COLS (excluding area/population)
_DB_ROW_TO_FEATURE_COL = (
    ("tree_canopy", "Tree_Canopy"),
    ("affordable_housing", "Affordable_Housing"),
    ("parks", "Parks"),
    ("transit_stop", "Transit_Stop"),
    ("bike_miles", "Bike_Miles"),
    ("wifi_hotspots", "Wifi_Hotspots"),
    ("school_density", "School_Density"),
    ("library_count", "Library_Count"),
    ("small_business", "Small_Business"),
    ("food_access", "Food_Access"),
)


def normalize_census_tract(val) -> str:
    """Canonical tract id strings so CSV ints match GeoJSON/frontend string ids."""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except TypeError:
        pass
    if isinstance(val, float):
        if not math.isfinite(val):
            return ""
        iv = int(val)
        return str(iv) if val == iv else str(val).strip()
    if isinstance(val, numbers.Integral):
        return str(int(val))
    s = str(val).strip()
    if not s:
        return ""
    if s.endswith(".0"):
        s = s[:-2]
    return s


class TractEngine:
    """Holds cached baseline data and performs recalculations."""

    def __init__(self, project_root: Path):
        self.root = project_root
        self._sklearn_model = None
        self._sklearn_model_checked = False
        self.model_path = Path(
            os.environ.get(
                "ADI_MODEL_PATH",
                str(Path(__file__).resolve().parent / "model.pkl"),
            )
        ).expanduser()
        self._load_baseline()

    def sklearn_predictor(self):
        """Lazy-load sklearn estimator from ADI_MODEL_PATH or server/model.pkl (optional)."""
        if not self._sklearn_model_checked:
            self._sklearn_model_checked = True
            if self.model_path.is_file():
                import joblib

                loaded = joblib.load(self.model_path)
                try:
                    self._sklearn_model = self._extract_predictor(loaded)
                except ValueError as exc:
                    # Do not hard-fail requests; fall back to baseline ADI if artifact is not a predictor.
                    print(f"Warning: {exc}")
                    self._sklearn_model = None
            else:
                self._sklearn_model = None
        return self._sklearn_model

    @staticmethod
    def _extract_predictor(loaded_obj):
        """
        Accept either a direct estimator or a common training-artifact dictionary.
        Returns an object exposing .predict(X), or raises ValueError with guidance.
        """
        if hasattr(loaded_obj, "predict"):
            return loaded_obj

        if isinstance(loaded_obj, dict):
            # Common key names used in saved training artifacts
            for key in ("model", "best_model", "estimator", "pipeline", "rf_model", "regressor"):
                candidate = loaded_obj.get(key)
                if hasattr(candidate, "predict"):
                    return candidate

            # Sometimes artifacts store folds/metadata and nest the model one level down
            for value in loaded_obj.values():
                if hasattr(value, "predict"):
                    return value
                if isinstance(value, dict):
                    for nested in value.values():
                        if hasattr(nested, "predict"):
                            return nested

            raise ValueError(
                "Loaded model artifact is a dict but no estimator with .predict() was found. "
                "Include a key like 'model'/'best_model'/'estimator' containing a sklearn regressor."
            )

        raise ValueError(
            f"Loaded model object of type {type(loaded_obj).__name__} has no .predict(). "
            "Provide a sklearn-compatible estimator or a dict wrapping one."
        )

    def _load_baseline(self):
        """Load baseline CSV and tract boundaries (called once on startup)."""
        csv_path = self.root / "public" / "all_tract_features.csv"
        self.baseline = pd.read_csv(csv_path)
        self.baseline["census_tract"] = self.baseline["census_tract"].map(normalize_census_tract)
        self.tract_ids = sorted(self.baseline["census_tract"].tolist())

        geojson_path = self.root / "public" / "census_tracts.json"
        with open(geojson_path) as f:
            gj = json.load(f)

        rows = []
        for feature in gj["features"]:
            props = feature["properties"]
            tract_id = (
                props.get("CENSUS_T_1")
                or props.get("census_tract")
                or props.get("GEOID")
                or ""
            )
            tid = normalize_census_tract(tract_id)
            if not tid:
                continue
            rows.append({"census_tract": tid, "geometry": shape(feature["geometry"])})

        self.tracts_gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
        self.tracts_proj = self.tracts_gdf.to_crs(PROJECTED_CRS)

        self.pop_map = dict(zip(
            self.baseline["census_tract"],
            self.baseline["Population"].clip(lower=POP_FLOOR)
        ))
        self.area_map = dict(zip(
            self.baseline["census_tract"],
            self.baseline["Tract_Area_SqMi"]
        ))

    def recalculate(
        self,
        geometry_items: list[dict],
        slider_overrides: dict[str, dict[str, float]],
    ) -> list[dict]:
        """
        Recalculate features for all tracts given user-placed geometry and slider overrides.

        Parameters
        ----------
        geometry_items : list of dicts with keys:
            - feature_type: 'library' | 'school' | 'bike_trail' | 'park'
            - lat, lon: for point features
            - geometry: GeoJSON dict for line/polygon features
        slider_overrides : dict mapping census_tract -> {column: value}

        Notes
        -----
        School and library layers: if the request includes one or more school (or library)
        points, tract-level densities are replaced from those points only (baseline CSV values
        for that layer are ignored). Bike trails and parks remain additive deltas on baseline.

        Returns
        -------
        List of 791 dicts, one per tract, with all feature columns + predicted_adi.
        """
        features_df = self.baseline[["census_tract"] + FEATURE_COLS].copy()

        libraries = [g for g in geometry_items if g["feature_type"] == "library"]
        schools = [g for g in geometry_items if g["feature_type"] == "school"]
        bike_trails = [g for g in geometry_items if g["feature_type"] == "bike_trail"]
        parks = [g for g in geometry_items if g["feature_type"] == "park"]

        if libraries:
            delta = self._count_points_buffered(libraries, LIBRARY_BUFFER_FT)
            for tract_id in self.tract_ids:
                count = int(delta.get(tract_id, 0))
                pop_k = self.pop_map.get(tract_id, POP_FLOOR) / 1000
                density = (count / pop_k) * 10
                mask = features_df["census_tract"] == tract_id
                features_df.loc[mask, "Library_Count"] = density

        if schools:
            delta = self._count_points_buffered(schools, SCHOOL_BUFFER_FT)
            for tract_id in self.tract_ids:
                count = int(delta.get(tract_id, 0))
                pop_k = self.pop_map.get(tract_id, POP_FLOOR) / 1000
                density = (count / pop_k) * 10
                mask = features_df["census_tract"] == tract_id
                features_df.loc[mask, "School_Density"] = density

        if bike_trails:
            delta = self._line_miles_buffered(bike_trails, BIKE_BUFFER_FT)
            for tract_id, miles in delta.items():
                area = self.area_map.get(tract_id, 1.0)
                density_add = miles / area
                mask = features_df["census_tract"] == tract_id
                features_df.loc[mask, "Bike_Miles"] = (
                    features_df.loc[mask, "Bike_Miles"].values[0] + density_add
                )

        if parks:
            delta = self._park_acreage_buffered(parks, PARK_BUFFER_FT)
            for tract_id, acres in delta.items():
                area = self.area_map.get(tract_id, 1.0)
                density_add = acres / area
                mask = features_df["census_tract"] == tract_id
                features_df.loc[mask, "Parks"] = (
                    features_df.loc[mask, "Parks"].values[0] + density_add
                )

        for tract_id_raw, overrides in slider_overrides.items():
            tid = normalize_census_tract(tract_id_raw)
            if not tid:
                continue
            mask = features_df["census_tract"] == tid
            if not mask.any():
                continue
            for col, value in overrides.items():
                if col in FEATURE_COLS:
                    features_df.loc[mask, col] = value

        features_df["predicted_adi"] = self._predict_adi(features_df)

        result = []
        for _, row in features_df.iterrows():
            d = {"census_tract": row["census_tract"]}
            for col in FEATURE_COLS:
                d[col.lower()] = round(float(row[col]), 4) if pd.notna(row[col]) else None
            d["predicted_adi"] = round(float(row["predicted_adi"]), 2) if pd.notna(row["predicted_adi"]) else None
            result.append(d)

        return result

    def recalculate_sliders_only(
        self,
        saved_feature_rows: list[dict],
        slider_overrides: dict[str, dict[str, float]],
    ) -> list[dict]:
        """
        Fast path: merge saved simulation_features onto baseline area/population, apply slider
        overrides, re-predict ADI. Skips all geometry / spatial work.

        Returns only rows for census tracts present in slider_overrides.
        """
        if not slider_overrides:
            return []

        df = self.baseline[["census_tract"] + FEATURE_COLS].copy()

        by_tid: dict[str, dict] = {}
        for r in saved_feature_rows:
            tid = normalize_census_tract(r.get("census_tract"))
            if tid:
                by_tid[tid] = r

        for i in df.index:
            tid = df.at[i, "census_tract"]
            sr = by_tid.get(tid)
            if not sr:
                continue
            for db_k, col in _DB_ROW_TO_FEATURE_COL:
                val = sr.get(db_k)
                if val is not None and pd.notna(val):
                    df.at[i, col] = float(val)

        for tract_id_raw, overrides in slider_overrides.items():
            tid = normalize_census_tract(tract_id_raw)
            if not tid:
                continue
            mask = df["census_tract"] == tid
            if not mask.any():
                continue
            for col, value in overrides.items():
                if col in FEATURE_COLS:
                    df.loc[mask, col] = value

        df["predicted_adi"] = self._predict_adi(df)

        affected = {normalize_census_tract(k) for k in slider_overrides.keys()}
        result = []
        for _, row in df.iterrows():
            tid = row["census_tract"]
            if tid not in affected:
                continue
            d = {"census_tract": tid}
            for col in FEATURE_COLS:
                d[col.lower()] = round(float(row[col]), 4) if pd.notna(row[col]) else None
            d["predicted_adi"] = round(float(row["predicted_adi"]), 2) if pd.notna(row["predicted_adi"]) else None
            result.append(d)

        return result

    def _count_points_buffered(self, items: list[dict], buffer_ft: float) -> dict[str, int]:
        """
        Count schools/libraries influencing each tract.

        Each point increments every tract whose polygon lies within ``buffer_ft``
        (projected CRS units — feet here): minimum distance from the point to the
        tract polygon is at most ``buffer_ft``. So the tract containing the point is
        included (distance 0), as are neighboring tracts whose geometry reaches into
        the buffer radius around that school/library.
        """
        if not items:
            return {}
        points = [Point(item["lon"], item["lat"]) for item in items]
        pts_gdf = gpd.GeoDataFrame(geometry=points, crs="EPSG:4326").to_crs(PROJECTED_CRS)
        tracts = self.tracts_proj[["census_tract", "geometry"]].reset_index(drop=True)

        counts: dict[str, int] = {}
        eps = 1e-9
        for _, pt_row in pts_gdf.iterrows():
            pt = pt_row.geometry
            dist_series = tracts.geometry.distance(pt)
            hits = tracts.loc[dist_series <= buffer_ft + eps]
            for tid_raw in hits["census_tract"]:
                tid = normalize_census_tract(tid_raw)
                if tid:
                    counts[tid] = counts.get(tid, 0) + 1
        return counts

    def _line_miles_buffered(self, items: list[dict], buffer_ft: float) -> dict[str, float]:
        """Clip user-drawn lines to buffered tracts and sum miles per tract."""
        lines = []
        for item in items:
            geom = shape(item["geometry"])
            lines.append({"geometry": geom})

        lines_gdf = gpd.GeoDataFrame(lines, geometry="geometry", crs="EPSG:4326").to_crs(PROJECTED_CRS)

        buffered = self.tracts_proj[["census_tract", "geometry"]].copy()
        buffered["geometry"] = buffered.geometry.buffer(buffer_ft)

        clipped = gpd.overlay(lines_gdf, buffered, how="intersection", keep_geom_type=False)
        if clipped.empty:
            return {}

        clipped["miles"] = clipped.geometry.length / FEET_PER_MILE
        sums = clipped.groupby("census_tract")["miles"].sum().to_dict()
        return sums

    def _park_acreage_buffered(self, items: list[dict], buffer_ft: float) -> dict[str, float]:
        """Intersect user-drawn park polygons with buffered tracts, compute acreage."""
        polys = []
        for item in items:
            geom = shape(item["geometry"])
            polys.append({"geometry": geom})

        polys_gdf = gpd.GeoDataFrame(polys, geometry="geometry", crs="EPSG:4326").to_crs(PROJECTED_CRS)

        buffered = self.tracts_proj[["census_tract", "geometry"]].copy()
        buffered["geometry"] = buffered.geometry.buffer(buffer_ft)

        intersected = gpd.overlay(polys_gdf, buffered, how="intersection", keep_geom_type=False)
        if intersected.empty:
            return {}

        intersected["acres"] = intersected.geometry.area / SQFT_PER_ACRE
        sums = intersected.groupby("census_tract")["acres"].sum().to_dict()
        return sums

    def _predict_adi(self, df: pd.DataFrame) -> pd.Series:
        """
        Predict ADI from FEATURE_COLS using your trained model file.
        Falls back to baseline CSV `adi` when no model file is present.
        """
        model = self.sklearn_predictor()
        if model is None:
            adi = (
                self.baseline.set_index("census_tract")["adi"]
                .reindex(df["census_tract"])
                .to_numpy()
            )
            return pd.Series(adi, index=df.index)

        X = df[FEATURE_COLS].fillna(0).values
        predictions = model.predict(X)
        return pd.Series(predictions, index=df.index)
