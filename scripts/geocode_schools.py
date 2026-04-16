from __future__ import annotations

import csv
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import requests


@dataclass
class GeocodeResult:
    lat: Optional[float]
    lon: Optional[float]


def census_single_line_geocode(address: str, benchmark: str = "Public_AR_Current") -> GeocodeResult:
    """
    Geocode a single address using the free US Census Geocoder API.
    Docs: https://geocoding.geo.census.gov/
    """
    if not address:
        return GeocodeResult(lat=None, lon=None)

    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    params = {
        "address": address,
        "benchmark": benchmark,
        "format": "json",
    }
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return GeocodeResult(lat=None, lon=None)

    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return GeocodeResult(lat=None, lon=None)

    coords = matches[0].get("coordinates", {})
    lon = coords.get("x")
    lat = coords.get("y")
    if lon is None or lat is None:
        return GeocodeResult(lat=None, lon=None)

    return GeocodeResult(lat=float(lat), lon=float(lon))


def iter_rows(path: Path) -> Iterable[list[str]]:
    with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            yield row


def main() -> int:
    # Source and destination
    src = Path("inputs_raw") / "Schools_(deprecated_2012)_20260415.csv"
    dst = Path("inputs_raw") / "Schools_(deprecated_2012)_20260415_geocoded.csv"

    if not src.exists():
        raise SystemExit(f"Source schools file not found: {src}")

    rows = list(iter_rows(src))
    if not rows:
        raise SystemExit(f"No data in file: {src}")

    header = rows[0]

    try:
        name_idx = header.index("SCHOOL NAME")
        addr_idx = header.index("PRIMARY ADDRESS")
    except ValueError as e:
        raise SystemExit(f"Expected columns 'SCHOOL NAME' and 'PRIMARY ADDRESS' not found: {e}")

    # Build new header with Latitude / Longitude columns appended
    out_header = header + ["Latitude", "Longitude"]

    # Geocode each row
    out_rows: list[list[str]] = [out_header]
    for i, row in enumerate(rows[1:], start=1):
        school_name = row[name_idx].strip()
        street = row[addr_idx].strip()

        if street:
            full_addr = f"{street}, Chicago, IL"
        else:
            full_addr = ""

        result = census_single_line_geocode(full_addr)

        # Be polite to the API
        if i % 10 == 0:
            time.sleep(0.5)

        lat_str = f"{result.lat:.6f}" if result.lat is not None else ""
        lon_str = f"{result.lon:.6f}" if result.lon is not None else ""
        out_rows.append(row + [lat_str, lon_str])

    with dst.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(out_rows)

    print(f"Wrote geocoded schools to: {dst}")
    print("Next step: run assign_points_to_tracts.py on the geocoded file, e.g.:")
    print("  python scripts/assign_points_to_tracts.py --inputs \"inputs_raw/Schools_(deprecated_2012)_20260415_geocoded.csv\" --out-dir inputs_processed --drop-geometry --tract-out-col CENSUS_TRACT --tract-id-field CENSUS_T_1")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

