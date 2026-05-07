# Tune Random Forest for ADI Prediction

# load packages ----
library(tidyverse)
library(tidymodels)
library(here)
library(future)

tidymodels_prefer()

# parallel processing ----
num_cores <- parallel::detectCores(logical = TRUE) / 2
plan(multisession, workers = num_cores)

# split data ----
set.seed(73)

adi_split <- initial_split(
  adi_cleaned,
  prop = 0.8,
  strata = ADI
)

adi_train <- training(adi_split)
adi_test  <- testing(adi_split)

# create folds ----
set.seed(73)

adi_fold <- vfold_cv(
  adi_train,
  v = 10,
  repeats = 3,
  strata = ADI
)


# metrics ----
reg_metrics <- metric_set(rmse, rsq, mae)

# recipe  ----
adi_recipe <- recipe(ADI ~ ., data = adi_train) |>
  step_rm(census_tract)|>
  step_zv(all_predictors())|>
  step_nzv(all_predictors())


# model specification ----
rf_spec <- rand_forest(
  trees = 500,
  mtry = tune(),
  min_n = tune()
) |>
  set_engine("ranger", importance = "impurity") |>
  set_mode("regression")

# hyperparameter tuning values ----
rf_params <- hardhat::extract_parameter_set_dials(rf_spec) |>
  update(
    mtry = mtry(c(2, 12)),
    min_n = min_n(c(2, 25))
  )

rf_grid <- grid_regular(
  rf_params,
  levels = c(6, 5)
)

# workflow ----
rf_wflow <- workflow() |>
  add_model(rf_spec) |>
  add_recipe(adi_recipe)

# tune model ----
set.seed(73)

rf_tuned <- tune_grid(
  rf_wflow,
  resamples = adi_fold,
  grid = rf_grid,
  metrics = reg_metrics,
  control = control_grid(save_workflow = TRUE)
)

# view results ----
collect_metrics(rf_tuned)

# select best model based on RMSE ----
best_rf <- select_best(rf_tuned, metric = "rmse")

best_rf


rf_final_wflow <- finalize_workflow(
  rf_wflow,
  best_rf
)

rf_final_fit <- last_fit(
  rf_final_wflow,
  split = adi_cleaned_split,
  metrics = reg_metrics
)

collect_metrics(rf_final_fit)

# predict on the testing dataset
rf_test <- rf_final_wflow |>
  fit(data = adi_train)

rf_preds <- rf_test |>
  predict(new_data = adi_test) |>
  bind_cols(adi_test)

within_10 <- rf_preds |>
  mutate(within_10pct = abs(.pred - ADI) / abs(ADI) <= 0.10) |>
  summarize(prop = mean(within_10pct))

within_10


# visual

visual <- ggplot(rf_preds, aes(x = ADI, y = .pred)) +
  geom_abline(linetype = 2) +
  geom_point(alpha = 0.5) +
  labs(
    x = "Observed ADI",
    y = "Predicted ADI",
    title = "Observed vs Predicted ADI (Random Forest)"
  ) +
  theme_minimal()

visual


# save results
save(rf_rmse, file = here("results/rf_rmse.rda"))
save(rf_rsq, file = here("results/rf_rsq.rda"))
save(within_10, file = here("results/within_10.rda"))
save(visual, file = here("results/visual.rda"))
