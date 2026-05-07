# Initial Setup
library(tidyverse)
library(tidymodels)
library(here)


# set seed
set.seed(73)

adi <- read.csv("data/adi.csv")
glimpse(adi)

adi_cleaned <- adi|>
  rename("ADI" = "Area.Deprivation.Index..ADI.")|>
           select(ADI:Population)

save(adi_cleaned, file = here("data/adi_cleaned.csv"))

save(adi_cleaned, file = here("data/adi_cleaned.rda"))

adi_cleaned_split <- initial_split(adi_cleaned, prop=0.8, strata = ADI)
adi_train<-training(adi_cleaned_split)
adi_test<-testing(adi_cleaned_split)

save(adi_train, file = here("splits/adi_train.rda"))
save(adi_test, file = here("splits/adi_test.rda"))


# vfold
adi_fold<-adi_train|>
  vfold_cv(
    v = 10, 
    repeats = 3,
    strata = ADI
  )

save(adi_fold, file = here("splits/adi_fold.rda"))


ggplot(adi_cleaned, aes(x = ))