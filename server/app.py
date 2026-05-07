"""
Flask API for the Health Equity Predictor.
Provides a /recalculate endpoint that re-computes tract features
when users place geometry or adjust sliders.
"""
from __future__ import annotations
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client, Client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# utf-8-sig strips a UTF-8 BOM so the first key is not "\ufeffVITE_..."
_env_path = PROJECT_ROOT / ".env"
if _env_path.is_file():
    load_dotenv(_env_path, encoding="utf-8-sig")
else:
    load_dotenv(encoding="utf-8-sig")

app = Flask(__name__)
CORS(
    app,
    origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)

_supabase: Client | None = None
_engine = None

# Baseline CSV supplies these for inference; do not persist to simulation_features.
_SIMULATION_FEATURES_SKIP_KEYS = frozenset({"tract_area_sqmi", "population"})

# Must match unique constraint simulation_features (simulation_id, census_tract).
_SIMULATION_FEATURES_ON_CONFLICT = "simulation_id,census_tract"


def _dedupe_features_by_tract(features: list[dict]) -> list[dict]:
    """One row per tract; last wins. Keeps DB inserts safe if callers duplicate."""
    by_tract: dict[str, dict] = {}
    for f in features:
        tid = str(f.get("census_tract", "")).strip()
        if tid.endswith(".0"):
            tid = tid[:-2]
        if not tid:
            continue
        by_tract[tid] = f
    return [by_tract[k] for k in sorted(by_tract.keys())]


def _rows_for_simulation_features(simulation_id: str, batch: list[dict]) -> list[dict]:
    rows = []
    for f in batch:
        row = {"simulation_id": simulation_id}
        row.update({k: v for k, v in f.items() if k not in _SIMULATION_FEATURES_SKIP_KEYS})
        ct = row.get("census_tract")
        if ct is not None:
            row["census_tract"] = str(ct).strip()
            if row["census_tract"].endswith(".0"):
                row["census_tract"] = row["census_tract"][:-2]
        rows.append(row)
    return rows


def _supabase_url() -> str:
    return (
        (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").strip()
    )


def _supabase_service_key() -> str:
    return (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = _supabase_url()
        key = _supabase_service_key()
        if not url or not key:
            hint = (
                f"Loaded .env from {_env_path.resolve()} (exists={_env_path.is_file()}). "
                "Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL or SUPABASE_URL."
            )
            raise RuntimeError(
                "Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY. " + hint
            )
        _supabase = create_client(url, key)
    return _supabase


def get_engine():
    global _engine
    if _engine is None:
        from recalculate import TractEngine
        _engine = TractEngine(PROJECT_ROOT)
    return _engine


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/recalculate", methods=["POST"])
def recalculate():
    """
    Recalculate all tract features based on user-placed geometry and slider overrides.

    Request JSON:
    {
        "simulation_id": "uuid",
        "geometry": [
            {"feature_type": "library", "lat": 41.88, "lon": -87.63},
            {"feature_type": "bike_trail", "geometry": {"type": "LineString", "coordinates": [...]}}
        ],
        "slider_overrides": {
            "17031010100": {"Tree_Canopy": 45.0}
        }
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    simulation_id = data.get("simulation_id")
    if not simulation_id:
        return jsonify({"error": "simulation_id is required"}), 400

    geometry_items = data.get("geometry", [])
    slider_overrides = data.get("slider_overrides", {})

    engine = get_engine()
    features = _dedupe_features_by_tract(engine.recalculate(geometry_items, slider_overrides))

    sb = get_supabase()

    sb.table("simulation_geometry").delete().eq("simulation_id", simulation_id).execute()
    if geometry_items:
        geo_rows = []
        for item in geometry_items:
            row = {
                "simulation_id": simulation_id,
                "feature_type": item["feature_type"],
                "lat": item.get("lat"),
                "lon": item.get("lon"),
                "geometry": item.get("geometry"),
            }
            geo_rows.append(row)
        sb.table("simulation_geometry").insert(geo_rows).execute()

    sb.table("simulation_features").delete().eq("simulation_id", simulation_id).execute()
    batch_size = 200
    for i in range(0, len(features), batch_size):
        batch = features[i:i + batch_size]
        rows = _rows_for_simulation_features(simulation_id, batch)
        sb.table("simulation_features").upsert(
            rows,
            on_conflict=_SIMULATION_FEATURES_ON_CONFLICT,
        ).execute()

    return jsonify({"features": features})


if __name__ == "__main__":
    engine = get_engine()
    print(f"Tract engine loaded with {len(engine.tract_ids)} tracts")
    pred = engine.sklearn_predictor()
    if pred is not None:
        print(f"ADI predictor loaded from {engine.model_path}")
    else:
        print(
            f"No sklearn model at {engine.model_path}; "
            "set ADI_MODEL_PATH or add model.pkl — using baseline ADI until then."
        )
    app.run(host="127.0.0.1", port=5000, debug=True)
