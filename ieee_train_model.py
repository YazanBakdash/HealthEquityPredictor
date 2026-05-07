# Tune Random Forest for ADI Prediction ----
# Saves the fitted estimator to server/model.pkl for Flask (same FEATURE_COLS as server/recalculate.py).

import os
import pickle
import warnings

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore")

from sklearn.model_selection import train_test_split, RepeatedKFold, GridSearchCV
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_absolute_error, root_mean_squared_error

# Must match FEATURE_COLS order in server/recalculate.py (Flask inference).
FEATURE_COLS = [
    "Tree_Canopy",
    "Affordable_Housing",
    "Parks",
    "Transit_Stop",
    "Bike_Miles",
    "Wifi_Hotspots",
    "School_Density",
    "Library_Count",
    "Small_Business",
    "Food_Access",
    "Tract_Area_SqMi",
    "Population",
]

SEED = 73

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "adi.csv")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
SERVER_MODEL_PATH = os.path.join(BASE_DIR, "server", "model.pkl")

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(SERVER_MODEL_PATH), exist_ok=True)

adi = pd.read_csv(DATA_PATH)
print(adi.columns.tolist())

# Align legacy CSV header with pipeline naming
if "Food_Access" not in adi.columns and "Grocery_Store" in adi.columns:
    adi = adi.rename(columns={"Grocery_Store": "Food_Access"})

required = ["Area Deprivation Index (ADI)", "census_tract", *FEATURE_COLS]
missing = [c for c in required if c not in adi.columns]
if missing:
    raise ValueError(f"adi.csv missing columns: {missing}")

adi_cleaned = adi[required].rename(
    columns={"Area Deprivation Index (ADI)": "ADI"},
)

# Same matrix Flask sends to .predict() (infra + tract context)
X = adi_cleaned[FEATURE_COLS].copy()
y = adi_cleaned["ADI"]

# Stratified regression split
y_bins = pd.qcut(y, q=5, duplicates="drop")
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=SEED,
    stratify=y_bins,
)

adi_folds = RepeatedKFold(n_splits=10, n_repeats=3, random_state=SEED)

rf_spec = RandomForestRegressor(
    n_estimators=500,
    random_state=SEED,
    n_jobs=-1,
)

n_feat = len(FEATURE_COLS)
max_feat_opts = sorted({int(x) for x in np.round(np.linspace(2, n_feat, 6))})
max_feat_opts = [m for m in max_feat_opts if 1 <= m <= n_feat]

rf_grid = {
    "max_features": max_feat_opts,
    "min_samples_leaf": np.round(np.linspace(2, 40, 5)).astype(int),
}

rf_tuned = GridSearchCV(
    estimator=rf_spec,
    param_grid=rf_grid,
    scoring="neg_root_mean_squared_error",
    cv=adi_folds,
    n_jobs=-1,
    return_train_score=True,
)

rf_tuned.fit(X_train, y_train)

rf_tune_metrics = pd.DataFrame(rf_tuned.cv_results_)

best_rf = rf_tuned.best_params_
print("Best hyperparameters:")
print(best_rf)

rf_model = rf_tuned.best_estimator_

y_pred = rf_model.predict(X_test)

rf_preds = X_test.copy()
rf_preds.insert(0, "ADI", y_test.values)
rf_preds.insert(1, ".pred", y_pred)

print(rf_preds.head())

rf_test_metrics = pd.DataFrame({
    ".metric": ["rmse", "rsq", "mae"],
    ".estimator": ["standard", "standard", "standard"],
    ".estimate": [
        root_mean_squared_error(y_test, y_pred),
        r2_score(y_test, y_pred),
        mean_absolute_error(y_test, y_pred),
    ],
})

print(rf_test_metrics)

rel_err = np.abs(y_pred - y_test.values) / np.maximum(np.abs(y_test.values), 1e-9)
within_10 = pd.DataFrame({"prop": [float(np.mean(rel_err <= 0.10))]})
print(within_10)

plt.figure(figsize=(7, 5))
plt.scatter(y_test, y_pred, alpha=0.5)
plt.axline((0, 0), slope=1, linestyle="--")
plt.xlabel("Observed ADI")
plt.ylabel("Predicted ADI")
plt.title("Observed vs Predicted ADI (Random Forest)")
plt.tight_layout()
plt.show()

plt.figure(figsize=(7, 5))
plt.scatter(y_test, y_pred, alpha=0.5)
plt.axline((0, 0), slope=1, linestyle="--")
plt.xlabel("Observed ADI")
plt.ylabel("Predicted ADI")
plt.title("Observed vs Predicted ADI (Random Forest)")
plt.tight_layout()
plt.savefig(os.path.join(RESULTS_DIR, "visual.png"), dpi=300)

rf_tune_metrics.to_csv(os.path.join(RESULTS_DIR, "rf_tune_metrics.csv"), index=False)
rf_preds.to_csv(os.path.join(RESULTS_DIR, "rf_preds.csv"), index=False)
rf_test_metrics.to_csv(os.path.join(RESULTS_DIR, "rf_test_metrics.csv"), index=False)
within_10.to_csv(os.path.join(RESULTS_DIR, "within_10.csv"), index=False)

with open(os.path.join(RESULTS_DIR, "best_rf.pkl"), "wb") as f:
    pickle.dump(best_rf, f)

# Flask loads this with joblib — must be an estimator with .predict()
joblib.dump(rf_model, SERVER_MODEL_PATH)
print(f"Saved fitted model for API to: {SERVER_MODEL_PATH}")

# Optional legacy duplicate under results/
joblib.dump(rf_model, os.path.join(RESULTS_DIR, "rf_test.pkl"))
print(f"Also saved copy to: {os.path.join(RESULTS_DIR, 'rf_test.pkl')}")
