# Forecast spec and backtest harness

The targets, folds, as-of predictors, scores, decision rule and outputs were agreed
2026-10-31, before any model was run. Choices marked *(implementation)* were made
while building the harness, also before the first run. The harness in
`pipeline/forecast/` implements all of it. Nothing here is to be changed to suit the
results: change it only with a note here saying why, and before rerunning.

## Targets

- **Schools.** Each English public or Catholic elementary school's Grade 3 and
  Grade 6 score (the mean of its reading, writing and math results), forecast at the
  school level one test year ahead. Neighbourhood figures are the schools' forecasts
  weighted by enrolment. Grade 3 and Grade 6 are separate targets: about 540 schools
  have a Grade 3 score and 460 a Grade 6, so a combined score would change meaning
  where one is missing.
- **Dwelling value.** Each neighbourhood's census median value of dwellings as a log
  ratio to the City's median, five years ahead. The City's own level is not
  forecast.

*(Implementation)* Every rung forecasts a unit's position against the City (for
schools, its logit score less the City's enrolment-weighted logit), and the City's
level carries over from the origin. The rungs differ only in where they place each
unit.

## Rungs

1. **Persistence**: the same position as at the origin.
2. **Own mean**: the unit's mean position to date (needs two or more years).
3. **Trend** (dwelling value only): the last five years' change, again.
4. **Ridge regression**, fitted to the transitions before the origin. The penalty is
   tuned by five-fold cross-validation on those transitions, with a unit's rows kept
   in one fold.
5. **Nearest-neighbour analogs**: the weighted mean change of the k most similar
   units in the training transitions, with k tuned the same way.
6. **Gradient boosting**, later, if 4 and 5 leave room. It needs LightGBM, which
   isn't installed yet.

Simplex projection (empirical dynamic modelling) is folded into rung 5. Six points
per school with a three-year gap are too short for an embedding of its own, so
pooled across schools it reduces to nearest neighbours in lag space. No neural
network: about 2,800 school rows and 316 neighbourhood rows are too few.

## Folds

**Schools.** Rolling origin over the test years 2018, 2019 and 2022 to 2025:

| Fold | Use |
|---|---|
| 2018 to 2019 | Persistence only; nothing earlier to fit on |
| 2019 to 2022 | Three years across the COVID-19 closures. Scored on its own, with models fitted on 2018 to 2019; never used to choose, and *(implementation)* never fitted on |
| 2022 to 2023, 2023 to 2024 | The selection folds. Fitted on the one-year transitions before each |
| 2024 to 2025 | The holdout: `--holdout`, run once, after the rung is chosen |

2024 is the Ministry's preliminary 2023-24 file. As of 2026-10-31 that file (January
2026) is still the only edition, so it is used as published. The 2024-25 file is named
final, but data.ontario lists it as "Preliminary 2024-2025", so the holdout's target
year may be revised too.

*(Implementation)* A history feature is the previous test year's result, so its lag
varies. In the 2023-to-2024 fold, ridge learns its weight from 2022-to-2023 rows,
where the previous year is 2019. It applies that weight to 2023 rows, where the
previous year is 2022. Where no training row has a history (the 2022-to-2023 fold),
the history features are left out.

**Dwelling value.** There are two comparable transitions, because 2006 has no
comparable value.

- **Forward:** fitted on 2011 to 2016, tested on 2016 to 2021. This is the backtest.
- **Reverse:** fitted on 2016 to 2021, tested on 2011 to 2016. It checks that what a
  fit learns holds both ways.

Own mean and trend need the 2011 value as history, so they are forward only.

## Predictors: only what was known at the origin

- **School results and demographics** are from the origin year and earlier.
  *(Implementation)* The Ministry's six demographic shares are standardised within
  each year, because the 2022-23 file moves the low-income and no-degree shares to
  the 2021 Census and shifts their levels.
- **Neighbourhood census.** *(Implementation)* The census c is usable from test year
  c + 2, since its last profile releases come late in the year after it. That
  means:
  - 2016 for the origins 2018, 2019 and 2022;
  - 2021 from 2023.
- **Dwelling value predictors:**
  - the census at the origin;
  - its five-year change in standing, from 2006 for the 2011 origin;
  - the mean ratio of the neighbouring neighbourhoods;
  - permits issued in the five years before the origin, per 1,000 households.
- **Oracle permits.** Permits issued during the five years being forecast are only
  known after the fact. They enter a separate, conditional run (`ridge_oracle`),
  reported apart and never chosen.

## Scores and the decision rule

- **MAE** (mean absolute error): in percentage points for schools, weighted by
  enrolment. For dwelling value it is the log ratio × 100 (about a percentage),
  weighted by households.
- **Skill**: 1 − MAE / persistence's MAE.
- **Rank correlation**: Spearman's, of the forecast against the actual levels, and
  of the forecast changes against the actual changes.
- **Schools:** also the MAE of the neighbourhood figures.

**The rule** (`choose()` in `fit.py`). Walk the rungs in order from persistence.

- **Up to ridge:** a rung replaces the one chosen so far only if its MAE is lower in
  every selection fold.
- **Past ridge** (analogs, later boosting): it must also beat by more than the spread
  across folds. Its mean improvement has to be larger than the largest fold's
  improvement less the smallest.
- **Dwelling value:** the folds are forward and reverse, where both rungs have them.
  With one fold, the spread test can't bite.

A margin far smaller than the fold-to-fold differences in MAE is a tie, whatever the
rule picks; the tables below say so where it applies.

## Running it

    make forecast        # both; or python pipeline/forecast/schools.py, value.py

The harness writes the scores and predictions to `pipeline/out/model/`.

## First run (2026-10-31)

**Schools.** The rule chooses ridge for both grades. For Grade 3, though, ridge
against own mean is a tie (margins of 0.04 and 0.09 points). MAE in points, with skill
against persistence in brackets:

| Fold | Grade 3 persistence | Grade 3 own mean | Grade 3 ridge | Grade 3 analogs | Grade 6 persistence | Grade 6 own mean | Grade 6 ridge | Grade 6 analogs |
|---|---|---|---|---|---|---|---|---|
| 2022 to 2023 | 9.07 | 8.50 (6%) | 8.46 (7%) | 8.49 (6%) | 6.89 | 6.45 (6%) | 6.21 (10%) | 6.55 (5%) |
| 2023 to 2024 | 10.16 | 9.01 (11%) | 8.92 (12%) | 9.90 (3%) | 7.55 | 6.80 (10%) | 6.46 (15%) | 7.56 (0%) |

- Grade 3's neighbourhood figures are better from own mean in 2023 to 2024 (MAE 4.82
  against ridge's 5.22).
- Rank correlation of the forecast and actual change is about 0.47 for ridge and own
  mean.

**2019 to 2022.**

City scores: Grade 3 fell from 69.7% to 67.0%; Grade 6 rose from 71.2% to 73.1%.

Schools are split into thirds by their 2019 low-income share. Each figure below is
the highest third less the lowest, enrolment-weighted, with a bootstrap standard
error:

| Grade | Against the ridge forecast | Change against the mean change |
|---|---|---|
| Grade 3 | −4.1 pp (se 1.2) | −4.4 pp (se 1.3) |
| Grade 6 | −1.2 pp (se 1.1) | +0.0 pp (se 1.3) |

The Grade 6 gap against the forecast comes from the reversion the model expected, not
from the observed change, which shows no gap.

**Dwelling value.** The rule chooses own mean.

| Rung | Forward MAE | Skill | Reverse MAE |
|---|---|---|---|
| Persistence | 8.84 | | 10.52 |
| Own mean | 7.86 | 11% | |
| Trend | 18.03 | −104% | |
| Ridge | 12.70 | −44% | 12.29 |
| Analogs | 11.40 | −29% | 12.92 |
| Ridge with oracle permits | 12.86 | −45% | 12.40 |

The two periods' changes run opposite ways:
- **Correlation of the changes:** −0.42 between the 2011–2016 and 2016–2021 changes in
  ratio.
- **Slope of the change on the starting ratio:** +0.06 in the first period, −0.14 in
  the second.
- **Detached share and the change that followed:** correlation +0.38 in 2011–2016,
  −0.15 in 2016–2021.

A model fitted on one five-year period learns that period's direction, and with two
periods there is nothing to learn a stable one from.
