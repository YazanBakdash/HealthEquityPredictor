# Tune Random Forest for ADI Prediction ----

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

# load
adi_cleaned <- read.csv(here("data/adi_cleaned.csv"))
save(adi_cleaned, file = here("data/adi_cleaned.rda"))
load(here("data/adi_cleaned.rda"))

adi_split <- initial_split(
  adi_cleaned,
  prop = 0.8,
  strata = ADI
)

adi_train <- training(adi_split)
adi_test  <- testing(adi_split)

# create resamples ----
set.seed(73)

adi_folds <- vfold_cv(
  adi_train,
  v = 10,
  repeats = 3,
  strata = ADI
)

# metrics ----
reg_metrics <- metric_set(rmse, rsq, mae)

# recipe ----
adi_recipe <- recipe(ADI ~ ., data = adi_train) |>
  step_rm(census_tract) |>
  step_zv(all_predictors()) |>
  step_nzv(all_predictors())

# model specification ----
rf_spec <- rand_forest(
  trees = 500,
  mtry = tune(),
  min_n = tune()
) |>
  set_engine("ranger", importance = "impurity") |>
  set_mode("regression")

# hyperparameter grid ----
rf_params <- hardhat::extract_parameter_set_dials(rf_spec) |>
  update(
    mtry = mtry(c(2, 12)),
    min_n = min_n(c(2, 40))
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
  resamples = adi_folds,
  grid = rf_grid,
  metrics = reg_metrics,
  control = control_grid(save_workflow = TRUE)
)

# tuning results ----
rf_tune_metrics <- collect_metrics(rf_tuned)

best_rf <- select_best(
  rf_tuned,
  metric = "rmse"
)

best_rf

# finalize workflow ----
rf_final_wflow <- finalize_workflow(
  rf_wflow,
  best_rf
)

# final model fit on training data ----
rf_test <- rf_final_wflow |>
  fit(data = adi_train)

# predictions on test data ----
rf_preds <- rf_test |>
  predict(new_data = adi_test) |>
  bind_cols(adi_test) |>
  select(ADI, .pred, everything())

rf_preds

# combined test metrics table ----
rf_test_metrics <- rf_preds |>
  reg_metrics(truth = ADI, estimate = .pred)

rf_test_metrics

# percentage of predictions within 10% of actual ADI ----
within_10 <- rf_preds |>
  mutate(within_10pct = abs(.pred - ADI) / abs(ADI) <= 0.10) |>
  summarize(prop = mean(within_10pct))

within_10

# visual representation ----
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

# save results ----
save(rf_tuned, file = here("results/rf_tuned.rda"))
save(rf_tune_metrics, file = here("results/rf_tune_metrics.rda"))
save(best_rf, file = here("results/best_rf.rda"))
save(rf_test, file = here("results/rf_test.rda"))
save(rf_preds, file = here("results/rf_preds.rda"))
save(rf_test_metrics, file = here("results/rf_test_metrics.rda"))
save(within_10, file = here("results/within_10.rda"))
save(visual, file = here("results/visual.rda"))