"""
Extract valid GeoJSON from a browser-saved MHTML file that embeds JSON in <pre>,
decode quoted-printable artifacts (=20, =3D, soft line breaks), compare tract IDs
to public/census_tracts.json, and write a clean GeoJSON file.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "inputs_raw" / "tree_canopy.geojson"
DEFAULT_OUT = ROOT / "inputs_raw" / "tree_canopy.geojson"
TRACTS_PATH = ROOT / "public" / "census_tracts.json"


def _decode_qp_in_json_blob(text: str) -> str:
    # Remove QP soft line breaks: '=' at end of line continues next line
    text = re.sub(r"=\r?\n", "", text)
    # QP escapes
    text = text.replace("=3D", "=")
    text = text.replace("=20", " ")
    text = text.replace("=09", "\t")
    return text


def _extract_json_from_mhtml(raw: str) -> str:
    # Prefer content inside <pre>...</pre> (ArcGIS pgeojson in browser save)
    m = re.search(r"<pre[^>]*>([\s\S]*?)</pre>", raw, re.IGNORECASE)
    blob = m.group(1).strip() if m else raw.strip()
    # Strip optional HTML that leaked in
    if blob.startswith("{") and "</" in blob:
        end = blob.find("</")
        if end != -1:
            blob = blob[:end].strip()
    return _decode_qp_in_json_blob(blob)


def _normalize_geoid(s: str | int | float | None) -> str | None:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return None
    n = pd.to_numeric(s, errors="coerce")
    if pd.isna(n):
        t = str(s).strip()
        if not t:
            return None
        return t
    return str(int(n))


def main() -> int:
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

    raw = in_path.read_text(encoding="utf-8", errors="replace")
    blob = _extract_json_from_mhtml(raw)
    try:
        data = json.loads(blob)
    except json.JSONDecodeError as e:
        # Write intermediate for debugging
        dbg = in_path.with_suffix(in_path.suffix + ".extracted.txt")
        dbg.write_text(blob[:200_000], encoding="utf-8")
        print(f"JSON parse failed: {e}. First 500 chars:\n{blob[:500]!r}")
        print(f"Wrote excerpt to {dbg}")
        return 1

    if data.get("type") != "FeatureCollection" or "features" not in data:
        print("Expected a GeoJSON FeatureCollection with 'features'.")
        return 1

    # Official tracts for this project
    tracts = gpd.read_file(TRACTS_PATH)
    official = set(
        _normalize_geoid(x)
        for x in tracts["CENSUS_T_1"]
        if _normalize_geoid(x) is not None
    )

    fips_list: list[str] = []
    for feat in data["features"]:
        props = feat.get("properties") or {}
        fid = _normalize_geoid(props.get("FIPS"))
        if fid:
            fips_list.append(fid)
        # Normalize FIPS in-place to string without float artifacts
        if "FIPS" in props and fid:
            props["FIPS"] = fid

    in_tree = set(fips_list)
    missing = sorted(official - in_tree)
    extra = sorted(in_tree - official)

    print(f"Input file: {in_path}")
    print(f"Features in tree canopy layer: {len(data['features'])}")
    print(f"Unique FIPS in layer: {len(in_tree)}")
    print(f"Official census tracts (app): {len(official)}")
    print(f"Official tracts missing from tree canopy: {len(missing)}")
    if missing:
        print(f"  Sample missing: {missing[:12]}")
    print(f"FIPS in tree canopy not in official app layer: {len(extra)}")
    if extra:
        print(f"  Sample extra: {extra[:12]}")

    # RFC 7946 GeoJSON: coordinates are WGS84; do not emit deprecated "crs" member.
    out_obj = {
        "type": "FeatureCollection",
        "name": "tree_canopy_by_census_tract",
        "features": data["features"],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out_obj, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote formatted GeoJSON to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
