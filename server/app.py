"""
Flask API for the Health Equity Predictor.
Provides a /recalculate endpoint that re-computes tract features
when users place geometry or adjust sliders.
"""
from __future__ import annotations
import math
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client, Client

from recalculate import normalize_census_tract

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

# PostgREST / Supabase default max rows per request (often 1000). Geometry can exceed this
# (schools + libraries + many bike segments), which silently drops newer rows from reads.
_POSTGREST_PAGE_SIZE = 1000


def _select_all_by_simulation_id(sb: Client, table: str, simulation_id: str) -> list[dict]:
    """Fetch every row for a simulation_id, paginating past PostgREST row caps."""
    all_rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            sb.table(table)
            .select("*")
            .eq("simulation_id", simulation_id)
            .order("id")
            .range(offset, offset + _POSTGREST_PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data or []
        all_rows.extend(batch)
        if len(batch) < _POSTGREST_PAGE_SIZE:
            break
        offset += _POSTGREST_PAGE_SIZE
    return all_rows


def _dedupe_features_by_tract(features: list[dict]) -> list[dict]:
    """One row per tract; last wins. Uses canonical tract ids to avoid 23505 duplicates."""
    by_tract: dict[str, dict] = {}
    for f in features:
        tid = normalize_census_tract(f.get("census_tract"))
        if not tid:
            continue
        row = dict(f)
        row["census_tract"] = tid
        by_tract[tid] = row
    return [by_tract[k] for k in sorted(by_tract.keys())]


def _dedupe_simulation_feature_rows(rows: list[dict]) -> list[dict]:
    """Ensure at most one DB row per census_tract per upsert batch."""
    by_tid: dict[str, dict] = {}
    for r in rows:
        tid = normalize_census_tract(r.get("census_tract"))
        if not tid:
            continue
        rr = dict(r)
        rr["census_tract"] = tid
        by_tid[tid] = rr
    return list(by_tid.values())


def _finite_float(val):
    """Coerce DB / JSON lat-lon (float, Decimal, str) for spatial joins."""
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def geometry_items_from_db_rows(rows: list[dict]) -> list[dict]:
    """Convert simulation_geometry rows to TractEngine.recalculate() items."""
    items: list[dict] = []
    for r in rows:
        item: dict = {"feature_type": r["feature_type"]}
        lat_f = _finite_float(r.get("lat"))
        lon_f = _finite_float(r.get("lon"))
        if lat_f is not None:
            item["lat"] = lat_f
        if lon_f is not None:
            item["lon"] = lon_f
        geom = r.get("geometry")
        if geom is not None:
            item["geometry"] = geom
        items.append(item)
    return items


def _persist_simulation_features(sb: Client, simulation_id: str, features: list[dict]) -> None:
    """
    Upsert all tract rows (no delete). Avoids races with concurrent recalcs that caused 23505
    when delete + multi-batch upsert overlapped with another request.
    """
    features = _dedupe_features_by_tract(features)
    batch_size = 100
    for i in range(0, len(features), batch_size):
        batch = features[i : i + batch_size]
        rows = _dedupe_simulation_feature_rows(_rows_for_simulation_features(simulation_id, batch))
        if not rows:
            continue
        sb.table("simulation_features").upsert(
            rows,
            on_conflict=_SIMULATION_FEATURES_ON_CONFLICT,
        ).execute()


def _rows_for_simulation_features(simulation_id: str, batch: list[dict]) -> list[dict]:
    rows = []
    for f in batch:
        row = {"simulation_id": simulation_id}
        row.update({k: v for k, v in f.items() if k not in _SIMULATION_FEATURES_SKIP_KEYS})
        ct = normalize_census_tract(row.get("census_tract"))
        if not ct:
            continue
        row["census_tract"] = ct
        rows.append(row)
    return rows


def _upsert_simulation_features_partial(sb: Client, simulation_id: str, features: list[dict]) -> None:
    if not features:
        return
    rows = _dedupe_simulation_feature_rows(_rows_for_simulation_features(simulation_id, features))
    if not rows:
        return
    sb.table("simulation_features").upsert(rows, on_conflict=_SIMULATION_FEATURES_ON_CONFLICT).execute()


# Lowercase keys matching engine output + simulation_features columns (for delta detection).
_FEATURE_COMPARE_KEYS = (
    "tree_canopy",
    "affordable_housing",
    "parks",
    "transit_stop",
    "bike_miles",
    "wifi_hotspots",
    "school_density",
    "library_count",
    "small_business",
    "food_access",
    "predicted_adi",
)


def _normalize_feature_scalar(val) -> float | None:
    if val is None:
        return None
    try:
        x = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return round(x, 4)


def _feature_compare_tuple(row: dict) -> tuple:
    return tuple(_normalize_feature_scalar(row.get(k)) for k in _FEATURE_COMPARE_KEYS)


def _features_delta(saved_rows: list[dict], new_features: list[dict]) -> list[dict]:
    """Rows whose simulated metrics changed vs last persisted snapshot (by tract)."""
    old_map: dict[str, tuple] = {}
    for r in saved_rows:
        tid = normalize_census_tract(r.get("census_tract"))
        if tid:
            old_map[tid] = _feature_compare_tuple(r)
    delta: list[dict] = []
    for f in new_features:
        tid = normalize_census_tract(f.get("census_tract"))
        if not tid:
            continue
        new_t = _feature_compare_tuple(f)
        if old_map.get(tid) != new_t:
            delta.append(f)
    return delta


def _strip_point_slider_overrides(engine_items: list[dict], slider_overrides: dict) -> dict:
    """Slider snapshots must not overwrite densities recomputed from point geometry."""
    has_library = any(g.get("feature_type") == "library" for g in engine_items)
    has_school = any(g.get("feature_type") == "school" for g in engine_items)
    if not has_library and not has_school:
        return slider_overrides or {}

    out: dict[str, dict] = {}
    for tid_raw, cols in (slider_overrides or {}).items():
        tid = normalize_census_tract(tid_raw)
        if not tid or not isinstance(cols, dict):
            continue
        c = dict(cols)
        if has_library:
            c.pop("Library_Count", None)
        if has_school:
            c.pop("School_Density", None)
        if c:
            out[tid] = c
    return out


def _recalculate_after_geometry_mutation(
    sb: Client,
    simulation_id: str,
    slider_overrides: dict,
) -> tuple[list[dict], list[dict]]:
    """
    Load all geometry from DB, run engine, upsert only changed feature rows.
    Returns (changed_feature_rows, full_computed_features).
    """
    engine = get_engine()
    saved_rows = _select_all_by_simulation_id(sb, "simulation_features", simulation_id)

    stored_rows = _fetch_simulation_geometry_rows(sb, simulation_id)
    engine_items = geometry_items_from_db_rows(stored_rows)
    overrides = _strip_point_slider_overrides(engine_items, slider_overrides or {})
    features = _dedupe_features_by_tract(engine.recalculate(engine_items, overrides))

    if len(saved_rows) == 0:
        _persist_simulation_features(sb, simulation_id, features)
        changed = features
    else:
        changed = _features_delta(saved_rows, features)
        if changed:
            _upsert_simulation_features_partial(sb, simulation_id, changed)

    return changed, features


def _fetch_simulation_geometry_rows(sb: Client, simulation_id: str) -> list[dict]:
    return _select_all_by_simulation_id(sb, "simulation_geometry", simulation_id)


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
    Recalculate tract features.

    If the JSON body includes a ``geometry`` key, simulation_geometry is replaced and a full
    spatial recalculation runs (expensive). Omit ``geometry`` to only apply ``slider_overrides``
    against rows already stored in simulation_features (fast; returns only affected tracts).

    Request JSON (geometry update):
        simulation_id, geometry: [...], slider_overrides?: {...}

    Request JSON (sliders only — omit geometry):
        simulation_id, slider_overrides: {...}
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    simulation_id = data.get("simulation_id")
    if not simulation_id:
        return jsonify({"error": "simulation_id is required"}), 400

    slider_overrides = data.get("slider_overrides") or {}
    geometry_in_request = "geometry" in data

    engine = get_engine()
    sb = get_supabase()

    if not geometry_in_request:
        if not slider_overrides:
            return jsonify({"error": "slider_overrides required when geometry is omitted"}), 400

        saved_rows = _select_all_by_simulation_id(sb, "simulation_features", simulation_id)

        if len(saved_rows) == 0:
            stored_rows = _fetch_simulation_geometry_rows(sb, simulation_id)
            engine_items = geometry_items_from_db_rows(stored_rows)
            features = _dedupe_features_by_tract(engine.recalculate(engine_items, slider_overrides))
            _persist_simulation_features(sb, simulation_id, features)
            affected = {normalize_census_tract(k) for k in slider_overrides.keys()}
            partial = [
                f for f in features if normalize_census_tract(f.get("census_tract")) in affected
            ]
            return jsonify({"features": partial, "partial": True})

        partial_features = engine.recalculate_sliders_only(saved_rows, slider_overrides)
        _upsert_simulation_features_partial(sb, simulation_id, partial_features)
        return jsonify({"features": partial_features, "partial": True})

    geometry_items = data["geometry"]
    if geometry_items is None:
        geometry_items = []

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

    stored_rows = _fetch_simulation_geometry_rows(sb, simulation_id)
    engine_items = geometry_items_from_db_rows(stored_rows)
    features = _dedupe_features_by_tract(engine.recalculate(engine_items, slider_overrides))
    _persist_simulation_features(sb, simulation_id, features)

    return jsonify({"features": features, "geometry": stored_rows, "partial": False})


@app.route("/geometry_point", methods=["POST"])
def add_geometry_point():
    """
    Append one school/library point (incremental). Does not replace other geometry rows.
    Persists only simulation_features rows whose values changed vs the previous snapshot.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    simulation_id = data.get("simulation_id")
    if not simulation_id:
        return jsonify({"error": "simulation_id is required"}), 400

    feature_type = data.get("feature_type")
    if feature_type not in ("library", "school"):
        return jsonify({"error": "feature_type must be library or school"}), 400

    lat = _finite_float(data.get("lat"))
    lon = _finite_float(data.get("lon"))
    if lat is None or lon is None:
        return jsonify({"error": "valid lat and lon are required"}), 400

    sb = get_supabase()
    insert_row = {
        "simulation_id": simulation_id,
        "feature_type": feature_type,
        "lat": lat,
        "lon": lon,
        "geometry": None,
    }
    # supabase-py: .insert() does not chain .select(); rely on return payload or refetch.
    ins = sb.table("simulation_geometry").insert(insert_row).execute()
    raw = ins.data
    inserted_list = raw if isinstance(raw, list) else ([raw] if raw else [])
    inserted = inserted_list[0] if inserted_list else None

    if not inserted:
        tol = 1e-7
        rows = _fetch_simulation_geometry_rows(sb, simulation_id)
        matches = [
            r
            for r in rows
            if r.get("feature_type") == feature_type
            and _finite_float(r.get("lat")) is not None
            and _finite_float(r.get("lon")) is not None
            and abs(_finite_float(r.get("lat")) - lat) < tol
            and abs(_finite_float(r.get("lon")) - lon) < tol
        ]
        inserted = matches[-1] if matches else None

    slider_overrides = data.get("slider_overrides") or {}
    changed, _ = _recalculate_after_geometry_mutation(sb, simulation_id, slider_overrides)

    geo_out = [inserted] if inserted else []
    return jsonify({"features": changed, "geometry": geo_out, "partial": True})


@app.route("/geometry_point/remove", methods=["POST"])
def remove_geometry_point():
    """Remove one simulation_geometry row by primary key, then partial feature upsert."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    simulation_id = data.get("simulation_id")
    row_id = data.get("id")
    if not simulation_id or not row_id:
        return jsonify({"error": "simulation_id and id are required"}), 400

    sb = get_supabase()
    sb.table("simulation_geometry").delete().eq("simulation_id", simulation_id).eq("id", row_id).execute()

    slider_overrides = data.get("slider_overrides") or {}
    changed, _ = _recalculate_after_geometry_mutation(sb, simulation_id, slider_overrides)

    return jsonify({"features": changed, "partial": True})


@app.route("/seed_school_library_geometry", methods=["POST"])
def seed_school_library_geometry():
    """
    Insert one simulation_geometry row per CPS school and CPL library (from inputs_raw CSVs),
    preserve bike_trail / park rows, then recalculate and persist simulation_features.
    """
    from poi_seed import build_school_library_geometry_rows

    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    simulation_id = data.get("simulation_id")
    if not simulation_id:
        return jsonify({"error": "simulation_id is required"}), 400

    sb = get_supabase()
    engine = get_engine()

    sb.table("simulation_geometry").delete().eq("simulation_id", simulation_id).in_(
        "feature_type", ["school", "library"]
    ).execute()

    poi_rows = build_school_library_geometry_rows(simulation_id)
    batch_size = 400
    for i in range(0, len(poi_rows), batch_size):
        chunk = poi_rows[i : i + batch_size]
        sb.table("simulation_geometry").insert(chunk).execute()

    stored_rows = _fetch_simulation_geometry_rows(sb, simulation_id)
    engine_items = geometry_items_from_db_rows(stored_rows)
    features = _dedupe_features_by_tract(engine.recalculate(engine_items, {}))
    _persist_simulation_features(sb, simulation_id, features)

    return jsonify({"features": features, "geometry": stored_rows})


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
