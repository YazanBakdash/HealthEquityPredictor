from __future__ import annotations

import argparse
import os
import re
import zipfile
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


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Assign latitude/longitude points to census tracts using a tract boundary file "
            "(GeoJSON/Shapefile/etc). Outputs a CSV with tract columns added."
        )
    )
    p.add_argument(
        "--tracts",
        default=str(Path("public") / "census_tracts.json"),
        help="Path to census tract boundaries (GeoJSON/Shapefile/GPKG/etc).",
    )
    p.add_argument(
        "--tract-crs",
        default="EPSG:3435",
        help=(
            "CRS for the tract file if it has no CRS metadata. "
            "Default EPSG:3435 (NAD83 / Illinois East (ftUS), common for Chicago)."
        ),
    )
    p.add_argument(
        "--tract-id-field",
        default=None,
        help=(
            "Column in tract layer to use as the tract identifier (e.g. GEOID). "
            "If omitted or not found, a synthetic ID (tract_index) is used."
        ),
    )
    p.add_argument(
        "--tract-out-col",
        default="census_tract",
        help="Output column name for the assigned census tract id (default: census_tract).",
    )
    p.add_argument(
        "--inputs",
        nargs="+",
        default=None,
        help="One or more input files (CSV or zipped shapefile). If omitted, all supported files in --input-dir are used.",
    )
    p.add_argument(
        "--input-dir",
        default="inputs_raw",
        help="Directory to scan for input files when --inputs is omitted (default: inputs_raw).",
    )
    p.add_argument(
        "--lat-col",
        default="latitude",
        help="Latitude column name in the input CSV(s). If not found, the script tries common variants.",
    )
    p.add_argument(
        "--lon-col",
        default="longitude",
        help="Longitude column name in the input CSV(s). If not found, the script tries common variants.",
    )
    p.add_argument(
        "--out-dir",
        default="processed",
        help="Directory to write output CSVs into (default: processed).",
    )
    p.add_argument(
        "--predicate",
        default="within",
        choices=["within", "intersects", "contains"],
        help="Spatial join predicate (default: within).",
    )
    p.add_argument(
        "--keep-tract-attrs",
        default=None,
        help=(
            "Comma-separated list of additional tract columns to include in output "
            "(besides the tract id). Example: --keep-tract-attrs=NAME,TRACTCE"
        ),
    )
    p.add_argument(
        "--drop-geometry",
        action="store_true",
        help="Do not include point geometry columns in output (recommended).",
    )
    return p.parse_args()


def _read_tracts(path: str, fallback_crs: str) -> gpd.GeoDataFrame:
    tracts = gpd.read_file(path)
    # Some sources ship incorrect CRS metadata (e.g. labeled EPSG:4326 but coordinates
    # are clearly projected). Detect that by looking at coordinate magnitudes.
    minx, miny, maxx, maxy = tracts.total_bounds
    looks_projected = any(abs(v) > 1000 for v in (minx, miny, maxx, maxy))

    if tracts.crs is None:
        tracts = tracts.set_crs(fallback_crs)
    elif str(tracts.crs).upper() in ("EPSG:4326", "WGS 84") and looks_projected:
        # Override incorrect CRS metadata without reprojecting coordinates.
        tracts = tracts.set_crs(fallback_crs, allow_override=True)
    return tracts


def _build_points(df: pd.DataFrame, lat_col: str, lon_col: str) -> gpd.GeoDataFrame:
    col_map = {c.casefold(): c for c in df.columns}

    lat_key = lat_col.casefold()
    lon_key = lon_col.casefold()

    # Auto-detect common variants
    if lat_key not in col_map:
        for candidate in ("latitude", "lat", "y", "y coordinate", "y_coordinate"):
            if candidate in col_map:
                lat_key = candidate
                break
    if lon_key not in col_map:
        for candidate in ("longitude", "lon", "lng", "long", "x", "x coordinate", "x_coordinate"):
            if candidate in col_map:
                lon_key = candidate
                break

    if lat_key not in col_map or lon_key not in col_map:
        raise ValueError(
            "Input is missing latitude/longitude columns. "
            f"Tried lat={lat_col!r}, lon={lon_col!r} (and common variants). "
            f"Found columns: {list(df.columns)}"
        )

    lat_col_actual = col_map[lat_key]
    lon_col_actual = col_map[lon_key]

    lat = pd.to_numeric(df[lat_col_actual], errors="coerce")
    lon = pd.to_numeric(df[lon_col_actual], errors="coerce")

    points = gpd.GeoDataFrame(
        df.copy(),
        geometry=gpd.points_from_xy(lon, lat, crs="EPSG:4326"),
    )
    return points


def _choose_tract_id_column(tracts: gpd.GeoDataFrame, tract_id_field: str | None) -> str:
    if tract_id_field and tract_id_field in tracts.columns:
        return tract_id_field

    # Common names, just in case (including your tract file's field)
    for candidate in (
        "CENSUS_T_1",
        "CENSUS_TRA",
        "GEOID",
        "geoid",
        "GEOID10",
        "GEOID20",
        "TRACTCE",
        "tractce",
    ):
        if candidate in tracts.columns:
            return candidate

    # Fall back to synthetic ID
    if "tract_index" not in tracts.columns:
        tracts["tract_index"] = range(len(tracts))
    return "tract_index"


def _spatial_join_points_to_tracts(
    points_wgs84: gpd.GeoDataFrame,
    tracts: gpd.GeoDataFrame,
    tract_id_col: str,
    keep_tract_attrs: list[str],
    predicate: str,
) -> gpd.GeoDataFrame:
    points = points_wgs84.to_crs(tracts.crs)

    keep_cols = [tract_id_col, "geometry"]
    for c in keep_tract_attrs:
        if c in tracts.columns and c not in keep_cols:
            keep_cols.append(c)

    tracts_keep = tracts[keep_cols].copy()
    # Build spatial index once; geopandas will use it internally when available
    joined = gpd.sjoin(points, tracts_keep, how="left", predicate=predicate)

    # `sjoin` adds index_right; keep it for debugging if someone wants it
    joined = joined.rename(columns={tract_id_col: "tract_id"})
    joined = joined.drop(columns=["index_right"], errors="ignore")
    return joined


def _default_output_path(out_dir: str, input_path: str) -> str:
    base = Path(input_path).name
    stem = base[: -len("".join(Path(base).suffixes))] if Path(base).suffixes else base
    return str(Path(out_dir) / f"{stem}_with_tracts.csv")


def _discover_input_files(input_dir: str) -> list[str]:
    root = Path(input_dir)
    if not root.exists():
        raise SystemExit(f"Input directory not found: {input_dir}")

    supported = []
    for path in sorted(root.iterdir()):
        if path.name.startswith("."):
            continue
        if path.suffix.lower() in {".csv", ".zip"}:
            supported.append(str(path))
    return supported


def _existing_tract_col(df: pd.DataFrame, desired_out_col: str) -> str | None:
    # If the dataset already has a census tract column (any common spelling), keep it.
    desired_cf = desired_out_col.casefold()
    for c in df.columns:
        cf = c.casefold()
        if cf == desired_cf:
            return c
        if cf in ("census tract", "censustract", "census_tract", "tract", "tract_id", "geoid"):
            return c
    return None


_WKT_POINT_RE = re.compile(r"point\s*\(\s*(-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)\s*\)", re.IGNORECASE)
_PAREN_POINT_RE = re.compile(r"^\s*\(?\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*\)?\s*$")


def _maybe_parse_location_column(df: pd.DataFrame) -> pd.DataFrame:
    """
    Some Chicago datasets only have a 'LOCATION' column like:
      - 'POINT (-87.6278 41.8819)'
      - '(41.8819, -87.6278)'
    If latitude/longitude columns are missing, try to extract them.
    """
    col_map = {c.casefold(): c for c in df.columns}
    loc_col = col_map.get("location")
    if not loc_col:
        return df

    # If any lat/lon already exist, don't duplicate work
    if any(k in col_map for k in ("latitude", "lat")) and any(k in col_map for k in ("longitude", "lon", "lng")):
        return df

    loc = df[loc_col].astype(str)

    # Try WKT POINT(lon lat)
    m = loc.str.extract(_WKT_POINT_RE)
    if not m.isna().all().all():
        df = df.copy()
        df["Longitude"] = pd.to_numeric(m[0], errors="coerce")
        df["Latitude"] = pd.to_numeric(m[2], errors="coerce")
        return df

    # Try "(lat, lon)"
    m2 = loc.str.extract(_PAREN_POINT_RE)
    if not m2.isna().all().all():
        df = df.copy()
        df["Latitude"] = pd.to_numeric(m2[0], errors="coerce")
        df["Longitude"] = pd.to_numeric(m2[2], errors="coerce")
        return df

    return df


def _read_input_as_geodataframe(input_path: str, lat_col: str, lon_col: str) -> tuple[gpd.GeoDataFrame, str]:
    """
    Returns (gdf, kind) where kind is 'csv' or 'vector'.
    """
    p = Path(input_path)

    if p.suffix.lower() == ".zip":
        # If it's a zipped shapefile, geopandas can read it directly.
        with zipfile.ZipFile(p, "r") as z:
            names = [n for n in z.namelist() if n.lower().endswith(".shp")]
        if names:
            gdf = gpd.read_file(f"zip://{p}")
            return gdf, "vector"

        raise ValueError(f"Zip file is not a shapefile (no .shp inside): {input_path}")

    if p.suffix.lower() == ".csv":
        df = pd.read_csv(input_path)
        df = _maybe_parse_location_column(df)
        gdf = _build_points(df, lat_col=lat_col, lon_col=lon_col)
        return gdf, "csv"

    raise ValueError(f"Unsupported input type (expected .csv or .zip): {input_path}")


def main() -> int:
    args = _parse_args()

    tracts_path = args.tracts
    if not os.path.exists(tracts_path):
        raise SystemExit(f"Tract file not found: {tracts_path}")

    input_paths = args.inputs if args.inputs else _discover_input_files(args.input_dir)
    if not input_paths:
        raise SystemExit(
            f"No supported input files (.csv, .zip) found in {args.input_dir}"
            if not args.inputs
            else "No input files were provided."
        )

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    keep_tract_attrs = []
    if args.keep_tract_attrs:
        keep_tract_attrs = [c.strip() for c in args.keep_tract_attrs.split(",") if c.strip()]

    tracts = _read_tracts(tracts_path, args.tract_crs)
    tract_id_col = _choose_tract_id_column(tracts, args.tract_id_field)

    for input_path in input_paths:
        if not os.path.exists(input_path):
            raise SystemExit(f"Input file not found: {input_path}")

        try:
            gdf, kind = _read_input_as_geodataframe(
                input_path=input_path,
                lat_col=args.lat_col,
                lon_col=args.lon_col,
            )
        except Exception as e:
            print(f"Skipping (can't interpret as point dataset): {input_path}\n  Reason: {e}")
            continue

        if kind == "csv":
            existing = _existing_tract_col(pd.DataFrame(gdf.drop(columns=["geometry"], errors="ignore")), args.tract_out_col)
            if existing is not None:
                print(f"Skipping (already has tract column '{existing}'): {input_path}")
                continue

        joined = _spatial_join_points_to_tracts(
            points_wgs84=gdf if kind == "csv" else gdf.to_crs("EPSG:4326"),
            tracts=tracts,
            tract_id_col=tract_id_col,
            keep_tract_attrs=keep_tract_attrs,
            predicate=args.predicate,
        )

        out_path = _default_output_path(str(out_dir), input_path)

        # Standardize output tract column name
        joined = joined.rename(columns={"tract_id": args.tract_out_col})

        if args.drop_geometry:
            out_df = pd.DataFrame(joined.drop(columns=["geometry"], errors="ignore"))
        else:
            out_df = pd.DataFrame(joined)

        out_df.to_csv(out_path, index=False)
        print(f"Wrote: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

