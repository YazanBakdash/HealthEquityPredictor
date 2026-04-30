# Tune Random Forest for ADI Prediction ----

# load packages ----
import os
import pickle
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings("ignore")

from sklearn.model_selection import train_test_split, RepeatedKFold, GridSearchCV
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_absolute_error
from sklearn.metrics import root_mean_squared_error

# set seed ----
SEED = 73

# load data ----
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "adi.csv")

adi = pd.read_csv(DATA_PATH)

print(adi.columns.tolist())


# clean/select variables ----
adi_cleaned = adi[[
    "Area Deprivation Index (ADI)",
    "census_tract",
    "Tree_Canopy",
    "Affordable_Housing",
    "Parks",
    "Transit_Stop",
    "Bike_Miles",
    "Wifi_Hotspots",
    "School_Density",
    "Library_Count",
    "Small_Business",
    "Grocery_Store",
    "Tract_Area_SqMi",
    "Population"
]]

adi_cleaned = adi_cleaned.rename(
    columns={"Area Deprivation Index (ADI)": "ADI"}
)

# split data ----
X = adi_cleaned.drop(columns=["ADI", "census_tract"])
y = adi_cleaned["ADI"]

# create ADI bins for stratified regression split
y_bins = pd.qcut(y, q=5, duplicates="drop")

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=SEED,
    stratify=y_bins
)

# create resamples ----
adi_folds = RepeatedKFold(
    n_splits=10,
    n_repeats=3,
    random_state=SEED
)

# model specification ----
rf_spec = RandomForestRegressor(
    n_estimators=500,
    random_state=SEED,
    n_jobs=-1
)

# hyperparameter grid ----
rf_grid = {
    "max_features": np.round(np.linspace(2, 12, 6)).astype(int),
    "min_samples_leaf": np.round(np.linspace(2, 40, 5)).astype(int)
}

# tune model ----
rf_tuned = GridSearchCV(
    estimator=rf_spec,
    param_grid=rf_grid,
    scoring="neg_root_mean_squared_error",
    cv=adi_folds,
    n_jobs=-1,
    return_train_score=True
)

rf_tuned.fit(X_train, y_train)

# tuning results ----
rf_tune_metrics = pd.DataFrame(rf_tuned.cv_results_)

best_rf = rf_tuned.best_params_
print("Best hyperparameters:")
print(best_rf)

# final model fit ----
rf_test = rf_tuned.best_estimator_

# predictions on test data ----
y_pred = rf_test.predict(X_test)

rf_preds = X_test.copy()
rf_preds.insert(0, "ADI", y_test.values)
rf_preds.insert(1, ".pred", y_pred)

print(rf_preds.head())

# combined test metrics table ----
rf_test_metrics = pd.DataFrame({
    ".metric": ["rmse", "rsq", "mae"],
    ".estimator": ["standard", "standard", "standard"],
    ".estimate": [
        root_mean_squared_error(y_test, y_pred),
        r2_score(y_test, y_pred),
        mean_absolute_error(y_test, y_pred)
    ]
})

print(rf_test_metrics)

# percentage of predictions within 10% of actual ADI ----
within_10 = pd.DataFrame({
    "prop": [np.mean(np.abs(y_pred - y_test) / np.abs(y_test) <= 0.10)]
})

print(within_10)

# visual representation ----
plt.figure(figsize=(7, 5))
plt.scatter(y_test, y_pred, alpha=0.5)
plt.axline((0, 0), slope=1, linestyle="--")
plt.xlabel("Observed ADI")
plt.ylabel("Predicted ADI")
plt.title("Observed vs Predicted ADI (Random Forest)")
plt.tight_layout()
plt.show()

# save visual ----
plt.figure(figsize=(7, 5))
plt.scatter(y_test, y_pred, alpha=0.5)
plt.axline((0, 0), slope=1, linestyle="--")
plt.xlabel("Observed ADI")
plt.ylabel("Predicted ADI")
plt.title("Observed vs Predicted ADI (Random Forest)")
plt.tight_layout()
plt.savefig("results/visual.png", dpi=300)

# save results ----
# rf_tune_metrics.to_csv("results/rf_tune_metrics.csv", index=False)
# rf_preds.to_csv("results/rf_preds.csv", index=False)
# rf_test_metrics.to_csv("results/rf_test_metrics.csv", index=False)
# within_10.to_csv("results/within_10.csv", index=False)

with open("results/best_rf.pkl", "wb") as f:
    pickle.dump(best_rf, f)

with open("results/rf_test.pkl", "wb") as f:
    pickle.dump(rf_test, f)