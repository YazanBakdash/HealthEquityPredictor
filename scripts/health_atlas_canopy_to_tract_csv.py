"""
Join Chicago Health Atlas community-area tree canopy (xlsx) to census tracts
via TRACT_COMM on public/census_tracts.json. Each tract in a community area
gets the same CHAKUCW_2017 value.

Tracts with TRACT_COMM 0 (unassigned) or 76 (O'Hare — not in typical Atlas export)
get the citywide median canopy % among matched tracts.
"""
from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "inputs_raw" / "Chicago Health Atlas Tree Canopy.xlsx"
TRACTS_PATH = ROOT / "public" / "census_tracts.json"
OUT_CSV = ROOT / "inputs_processed" / "tract_tree_canopy_health_atlas.csv"


def _read_excel_community_areas(xlsx_path: Path) -> pd.DataFrame:
    def _load(p: Path) -> pd.DataFrame:
        return pd.read_excel(p, sheet_name="Community areas")

    try:
        return _load(xlsx_path)
    except PermissionError:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tpath = Path(tmp.name)
        try:
            shutil.copyfile(xlsx_path, tpath)
            return _load(tpath)
        except PermissionError:
            pass
        finally:
            tpath.unlink(missing_ok=True)

    fallback = xlsx_path.parent / "_health_atlas_tree_canopy_read_copy.xlsx"
    if fallback.is_file():
        return _load(fallback)

    raise SystemExit(
        f"Cannot read {xlsx_path} (file may be open in Excel). Close it and retry, or copy the "
        f"workbook to {fallback.name} in the same folder and run again."
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX, help="Health Atlas Tree Canopy xlsx")
    p.add_argument("--tracts", type=Path, default=TRACTS_PATH, help="Census tract GeoJSON")
    p.add_argument("--out", type=Path, default=OUT_CSV, help="Output CSV path")
    args = p.parse_args()

    atlas = _read_excel_community_areas(args.xlsx)
    need = {"GEOID", "Name", "CHAKUCW_2017"}
    missing_cols = need - set(atlas.columns)
    if missing_cols:
        raise SystemExit(f"Atlas sheet missing columns {missing_cols}; got {list(atlas.columns)}")

    atlas = atlas[list(need)].copy()
    atlas = atlas.rename(
        columns={
            "GEOID": "community_area_geoid",
            "Name": "community_area_name",
            "CHAKUCW_2017": "Tree_Canopy_Pct",
        }
    )
    atlas["community_area_geoid"] = (
        pd.to_numeric(atlas["community_area_geoid"], errors="coerce").astype("Int64").astype(str)
    )
    atlas["Tree_Canopy_Pct"] = pd.to_numeric(atlas["Tree_Canopy_Pct"], errors="coerce")

    tracts = gpd.read_file(args.tracts)
    tr = tracts[["CENSUS_T_1", "TRACT_COMM"]].copy()
    tr["census_tract"] = pd.to_numeric(tr["CENSUS_T_1"], errors="coerce").astype("Int64").astype(str)
    tr["TRACT_COMM"] = tr["TRACT_COMM"].astype(str).str.strip()

    out = tr.merge(
        atlas,
        left_on="TRACT_COMM",
        right_on="community_area_geoid",
        how="left",
    )

    matched = out["Tree_Canopy_Pct"].notna()
    median_pct = float(out.loc[matched, "Tree_Canopy_Pct"].median())
    imputed = ~matched
    out.loc[imputed, "Tree_Canopy_Pct"] = median_pct
    out["imputed"] = imputed.astype(int)

    out_final = out[
        ["census_tract", "Tree_Canopy_Pct", "community_area_geoid", "community_area_name", "imputed"]
    ].copy()
    out_final = out_final.rename(columns={"Tree_Canopy_Pct": "Tree_Canopy"})

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out_final.to_csv(args.out, index=False)

    print(f"Wrote {len(out_final)} rows to {args.out}")
    print(f"Matched to Atlas community area: {int(matched.sum())}; imputed (median {median_pct:.2f}%): {int(imputed.sum())}")


if __name__ == "__main__":
    main()
