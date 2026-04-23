from __future__ import annotations

import argparse
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


FEET_PER_MILE = 5280.0
BIKE_BUFFER_FEET = 1320.0  # 0.25 miles
DEFAULT_DISPLAYROU_CATEGORIES = [
    "Protected Bike Lane",
    "Buffered Bike Lane",
    "Neighborhood Greenway",
    "Shared Use Path",
]
DEFAULT_OFFSTREET_PATH = str(Path("inputs_raw") / "Off-Street_Bike_Trails.geojson")
EXCLUDED_TRACTS = {
    "17031840000",
    "17031760900",
    "17031770600",
    "17031770700",
    "17031000000",
    "17031770800",
    "17031811600",
}


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Compute bike-lane miles within each tract plus a 0.25-mile buffer by "
            "intersecting bike routes with tract-buffer polygons."
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
            "CRS for the tract file if it has no CRS metadata, or if its CRS metadata is "
            "incorrect. Default EPSG:3435 (NAD83 / Illinois East (ftUS))."
        ),
    )
    p.add_argument(
        "--tract-id-field",
        default="CENSUS_T_1",
        help=(
            "Column in tract layer to use as the tract identifier. "
            "Default: CENSUS_T_1 (e.g. 17031720500)."
        ),
    )
    p.add_argument(
        "--routes",
        default=str(Path("inputs_raw") / "bike_routes.geojson"),
        help="Path to bike routes GeoJSON.",
    )
    p.add_argument(
        "--displayrou-categories",
        default=",".join(DEFAULT_DISPLAYROU_CATEGORIES),
        help=(
            "Comma-separated list of displayrou categories to include. "
            "Default: Protected Bike Lane, Buffered Bike Lane, Neighborhood Greenway, Shared Use Path. "
            "Use empty string to include all categories."
        ),
    )
    p.add_argument(
        "--offstreet",
        default=DEFAULT_OFFSTREET_PATH,
        help=(
            "Optional off-street trail GeoJSON path to include in bike miles. "
            "Use empty string to disable."
        ),
    )
    p.add_argument(
        "--out",
        default=str(Path("inputs_processed") / "tract_bike_lane_miles.csv"),
        help="Output CSV path.",
    )
    return p.parse_args()


def _read_tracts(path: str, fallback_crs: str) -> gpd.GeoDataFrame:
    tracts = gpd.read_file(path)
    minx, miny, maxx, maxy = tracts.total_bounds
    looks_projected = any(abs(v) > 1000 for v in (minx, miny, maxx, maxy))

    if tracts.crs is None:
        tracts = tracts.set_crs(fallback_crs)
    elif str(tracts.crs).upper() in ("EPSG:4326", "WGS 84") and looks_projected:
        tracts = tracts.set_crs(fallback_crs, allow_override=True)

    return tracts


def compute_bike_lane_miles_by_tract(
    *,
    tracts_path: str,
    routes_path: str,
    tract_id_field: str,
    tract_fallback_crs: str,
    displayrou_categories: list[str] | None = None,
    offstreet_path: str | None = DEFAULT_OFFSTREET_PATH,
) -> pd.DataFrame:
    tracts = _read_tracts(tracts_path, tract_fallback_crs)
    if tract_id_field not in tracts.columns:
        raise ValueError(
            f"Tract id field '{tract_id_field}' not found in tract file. "
            f"Available columns: {sorted(list(tracts.columns))}"
        )

    routes = gpd.read_file(routes_path)
    if routes.crs is None:
        routes = routes.set_crs("EPSG:4326")

    if displayrou_categories:
        if "displayrou" not in routes.columns:
            raise ValueError(
                "Bike routes layer has no 'displayrou' column; cannot filter by route type."
            )
        route_type = routes["displayrou"].astype(str).str.strip()
        wanted = {c.strip() for c in displayrou_categories if c.strip()}
        available = set(route_type.dropna().unique().tolist())
        missing = sorted(wanted - available)
        if missing:
            print(
                "Warning: requested displayrou categories not found in source: "
                + ", ".join(missing)
            )
        mask = route_type.isin(wanted)
        routes = routes.loc[mask].copy()
        if len(routes) == 0:
            raise ValueError(
                "No bike routes left after applying displayrou category filter. "
                "Check requested categories against the GeoJSON."
            )

    routes = routes.to_crs(tracts.crs)
    onstreet = routes[["geometry"]].copy()

    if offstreet_path:
        off_path = Path(offstreet_path)
        if off_path.is_file():
            off = gpd.read_file(off_path)
            if off.crs is None:
                off = off.set_crs("EPSG:4326")
            # Keep Chicago, currently existing facilities only.
            if "Muni" in off.columns:
                muni = off["Muni"].astype(str).str.strip().str.upper()
                off = off.loc[muni.eq("CHICAGO")].copy()
            if "Status" in off.columns:
                status = off["Status"].astype(str).str.strip().str.upper()
                off = off.loc[status.eq("EXISTING")].copy()
            off = off.to_crs(tracts.crs)
            off = off[["geometry"]].copy()
            routes = gpd.GeoDataFrame(
                pd.concat([onstreet, off], ignore_index=True),
                geometry="geometry",
                crs=tracts.crs,
            )
        else:
            print(f"Warning: off-street file not found: {off_path}")
            routes = onstreet
    else:
        routes = onstreet

    tracts = tracts[[tract_id_field, "geometry"]].copy()
    tracts[tract_id_field] = tracts[tract_id_field].astype(str)
    tracts = tracts.loc[~tracts[tract_id_field].isin(EXCLUDED_TRACTS)].copy()

    tract_buffers = tracts.copy()
    tract_buffers["geometry"] = tract_buffers.geometry.buffer(BIKE_BUFFER_FEET)

    intersected = gpd.overlay(routes, tract_buffers, how="intersection", keep_geom_type=False)
    if len(intersected) == 0:
        miles = pd.DataFrame({tract_id_field: tracts[tract_id_field].values, "bike_lane_miles": 0.0})
        miles = miles.rename(columns={tract_id_field: "census_tract"})
        return miles

    intersected["length_ft"] = intersected.geometry.length
    grouped = (
        intersected.groupby(tract_id_field, as_index=False)["length_ft"]
        .sum()
        .assign(bike_lane_miles=lambda d: d["length_ft"] / FEET_PER_MILE)
        .drop(columns=["length_ft"])
    )

    all_tracts = pd.DataFrame({tract_id_field: tracts[tract_id_field].values})
    out = all_tracts.merge(grouped, on=tract_id_field, how="left").fillna({"bike_lane_miles": 0.0})
    out = out.rename(columns={tract_id_field: "census_tract"})
    return out


def main() -> None:
    args = _parse_args()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    categories = [c.strip() for c in args.displayrou_categories.split(",")] if args.displayrou_categories else []
    categories = [c for c in categories if c]
    filt = categories if categories else None

    df = compute_bike_lane_miles_by_tract(
        tracts_path=args.tracts,
        routes_path=args.routes,
        tract_id_field=args.tract_id_field,
        tract_fallback_crs=args.tract_crs,
        displayrou_categories=filt,
        offstreet_path=args.offstreet.strip() if args.offstreet else None,
    )

    df.to_csv(out_path, index=False)
    total_mi = float(df["bike_lane_miles"].sum())
    print(
        f"Wrote {len(df):,} rows to {out_path} "
        f"(citywide bike_lane_miles sum ~ {total_mi:.2f}; "
        f"displayrou categories: {filt if filt is not None else 'ALL'})"
    )


if __name__ == "__main__":
    main()

