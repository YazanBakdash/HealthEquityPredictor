# Recipe

# load packages ----
library(tidyverse)
library(tidymodels)
library(here)


# handle common conflicts
tidymodels_prefer()

# load training data ----
load(here("splits/adi_train.rda"))


adi_recipe <- recipe(ADI ~ ., data = adi_train) |>
  step_rm(census_tract)|>
  step_zv(all_predictors())|>
  step_nzv(all_predictors())


save(adi_recipe, file = here("recipe/adi_recipe.rda"))

  