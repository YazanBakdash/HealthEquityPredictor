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


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Compute bike-lane miles within each census tract by intersecting a bike routes "
            "GeoJSON with census tract boundaries."
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
        "--displayrou",
        default="Protected Bike Lane",
        help=(
            "Only include route segments whose displayrou attribute equals this value "
            "(exact string). Default: Protected Bike Lane. Use empty string to include all types."
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
    displayrou_filter: str | None = "Protected Bike Lane",
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

    if displayrou_filter:
        if "displayrou" not in routes.columns:
            raise ValueError(
                "Bike routes layer has no 'displayrou' column; cannot filter by route type."
            )
        mask = routes["displayrou"].astype(str).str.strip() == displayrou_filter.strip()
        routes = routes.loc[mask].copy()
        if len(routes) == 0:
            raise ValueError(
                f"No bike routes left after displayrou == {displayrou_filter!r}. "
                "Check spelling against the GeoJSON."
            )

    routes = routes.to_crs(tracts.crs)

    tracts = tracts[[tract_id_field, "geometry"]].copy()
    tracts[tract_id_field] = tracts[tract_id_field].astype(str)
    routes = routes[["geometry"]].copy()

    intersected = gpd.overlay(routes, tracts, how="intersection", keep_geom_type=False)
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

    filt = args.displayrou.strip() if args.displayrou else None

    df = compute_bike_lane_miles_by_tract(
        tracts_path=args.tracts,
        routes_path=args.routes,
        tract_id_field=args.tract_id_field,
        tract_fallback_crs=args.tract_crs,
        displayrou_filter=filt,
    )

    df.to_csv(out_path, index=False)
    total_mi = float(df["bike_lane_miles"].sum())
    print(
        f"Wrote {len(df):,} rows to {out_path} "
        f"(citywide bike_lane_miles sum ~ {total_mi:.2f}; "
        f"displayrou filter: {filt!r})"
    )


if __name__ == "__main__":
    main()

