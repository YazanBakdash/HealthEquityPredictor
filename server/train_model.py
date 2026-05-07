"""
Optional dev helper: train a Random Forest regressor from public/all_tract_features.csv.

Production / local API expect you to supply your own trained estimator (e.g. joblib)
and point ADI_MODEL_PATH at it, or copy it to server/model.pkl.

Usage:
    cd server
    python train_model.py
"""
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import cross_val_score

FEATURE_COLS = [
    "Tree_Canopy", "Affordable_Housing", "Parks", "Transit_Stop",
    "Bike_Miles", "Wifi_Hotspots", "School_Density", "Library_Count",
    "Small_Business", "Food_Access",
    "Tract_Area_SqMi", "Population",
]
TARGET_COL = "adi"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = PROJECT_ROOT / "public" / "all_tract_features.csv"
MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"


def main():
    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} tracts from {CSV_PATH}")

    missing_cols = [c for c in FEATURE_COLS + [TARGET_COL] if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing columns: {missing_cols}")

    df = df.dropna(subset=[TARGET_COL])
    X = df[FEATURE_COLS].fillna(0).values
    y = df[TARGET_COL].values

    print(f"Training data: {X.shape[0]} samples, {X.shape[1]} features")
    print(f"ADI range: {y.min():.1f} - {y.max():.1f}, mean: {y.mean():.1f}")

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=15,
        min_samples_leaf=5,
        random_state=42,
        n_jobs=-1,
    )

    scores = cross_val_score(model, X, y, cv=5, scoring="r2")
    print(f"5-fold CV R²: {scores.mean():.4f} (+/- {scores.std():.4f})")

    mae_scores = -cross_val_score(model, X, y, cv=5, scoring="neg_mean_absolute_error")
    print(f"5-fold CV MAE: {mae_scores.mean():.2f} (+/- {mae_scores.std():.2f})")

    model.fit(X, y)
    print(f"\nFeature importances:")
    for name, imp in sorted(zip(FEATURE_COLS, model.feature_importances_), key=lambda x: -x[1]):
        print(f"  {name:25s} {imp:.4f}")

    joblib.dump(model, MODEL_PATH)
    print(f"\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
