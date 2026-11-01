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
6. **Gradient boosting** (LightGBM; added 2026-10-31 after the first run): shallow
   trees (7 leaves, 30 rows per leaf at least), learning rate 0.03, 80% row and
   feature subsampling, a fixed seed. The number of rounds is tuned like the others,
   from 10 to 400. The grid first started at 50; it was widened when 50 came out
   best, and the choice didn't move. It is the check on whether non-linear forms
   carry signal the linear rungs miss.

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
- **Past ridge** (analogs, boosting): it must also beat by more than the spread
  across folds. Its mean improvement has to be larger than the largest fold's
  improvement less the smallest.
- **Dwelling value:** the folds are forward and reverse, where both rungs have them.
  With one fold, the spread test can't bite.

A margin far smaller than the fold-to-fold differences in MAE is a tie, whatever the
rule picks; the tables below say so where it applies.

## Demographic predictors (added after the first run)

Added 2026-10-31 at the user's request, after the first run's results were seen. The
hypothesis: housing demand differs by age and by time since arrival, and the
number of owners a neighbourhood gains or loses matters too. To keep this from being
a search over the test fold, the features are fixed here before any of them has been
computed:

- **Age:** population shares aged 25 to 34 and 35 to 44 (entering ownership), and 65
  to 74 and 75 and over (leaving it).
- **Immigration:** shares of the population in private households that immigrated in
  the five years before the census, and in the five years before that.
- **Owners:** the change in owner households over the five years to the origin, as
  a log ratio (known at the origin).

They are added to ridge's features, alongside the existing `age0_14` and `age65`,
as a new rung, `ridge_demog`. It comes after ridge, so it must clear the higher bar.
The change in owner households *during* the five years being forecast is oracle data.
It enters a separate conditional run, `ridge_demog_oracle`, reported apart and never
chosen.

The counts come from the DA profiles of 2006, 2011 (age from the census, immigration
and tenure from the NHS) and 2016 and 2021. They are summed to neighbourhoods by
`pipeline/demography.py` into `pipeline/demography/nbhd.csv`. That script checks
itself against the existing figures in insights.json (`age0_14`, `age65`,
`imm_recent`, `renter`) and against the City rows. The DA profiles have no
age of household maintainer by tenure, so the population's age structure stands in
for who is likely to buy or sell. The 2011 owner and immigration counts are
voluntary-survey estimates, so changes into or out of 2011 are noisier.

## Running it

    make forecast        # both; or python pipeline/forecast/schools.py, value.py

The harness writes the scores and predictions to `pipeline/out/model/`.

## First run (2026-10-31)

**Schools.** The rule chooses ridge for both grades. For Grade 3, though, ridge
against own mean is a tie (margins of 0.04 and 0.09 points). MAE in points, with skill
against persistence in brackets:

| Fold | Grade 3 persistence | Grade 3 own mean | Grade 3 ridge | Grade 3 analogs | Grade 3 boosting | Grade 6 persistence | Grade 6 own mean | Grade 6 ridge | Grade 6 analogs | Grade 6 boosting |
|---|---|---|---|---|---|---|---|---|---|---|
| 2022 to 2023 | 9.07 | 8.50 (6%) | 8.46 (7%) | 8.49 (6%) | 8.48 (7%) | 6.89 | 6.45 (6%) | 6.21 (10%) | 6.55 (5%) | 6.52 (5%) |
| 2023 to 2024 | 10.16 | 9.01 (11%) | 8.92 (12%) | 9.90 (3%) | 9.42 (7%) | 7.55 | 6.80 (10%) | 6.46 (15%) | 7.56 (0%) | 7.20 (5%) |

- Grade 3's neighbourhood figures are better from own mean in 2023 to 2024 (MAE 4.82
  against ridge's 5.22).
- Rank correlation of the forecast and actual change is about 0.47 for ridge and own
  mean.
- Boosting is worse than ridge in every school fold, in both grades (by up to 0.74
  points), and in the dwelling-value forward fold. With this much data, non-linear
  forms add nothing over the linear terms already in ridge.

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
| Boosting | 12.55 | −42% | 11.43 |
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

## Demographic predictors: first run (2026-10-31)

`pipeline/demography/nbhd.csv` reproduces insights.json for every census:
- **2006 and 2011:** the shares aged 0–14 and 65+, and recently arrived, match exactly.
- **2016 and 2021:** the age shares match to rounding (mean 0.1 points, largest 0.5).
  The page uses the DAs' published percentages, not pooled counts. The difference is
  unbiased (mean signed difference under 0.02).

The rule still chooses own mean. The demographic rung moves ridge only slightly:

| Rung | Forward MAE | Reverse MAE |
|---|---|---|
| Ridge | 12.70 | 12.29 |
| Ridge with demography | 12.40 | 12.18 |
| ... and oracle owner change | 12.45 | 12.58 |
| Own mean (chosen) | 7.86 | |
| Persistence | 8.84 | 10.52 |

Rank correlation of each share at the start of a period with the change in the
value ratio over it (description, not a forecast):

| Share at the start | 2011 to 2016 | 2016 to 2021 |
|---|---|---|
| Aged 25 to 34 | −0.29 | +0.10 |
| Aged 35 to 44 | −0.25 | +0.19 |
| Aged 65 to 74 | +0.32 | −0.29 |
| Aged 75 and over | +0.27 | −0.30 |
| Arrived in the last 5 years | −0.11 | −0.02 |
| Arrived 5 to 10 years before | −0.05 | +0.07 |
| Owners, change in the 5 years before | −0.33 | −0.17 |
| Owners, change during (oracle) | −0.25 | +0.03 |

- **Age structure tracks each period's movement, then flips.** Older neighbourhoods
  gained on the City in 2011–2016 and lost in 2016–2021; younger ones the reverse.
  That is the same reversal as the detached share's, so a fit on one period points
  the wrong way in the other.
- **Owner growth before the period is the one signal with the same sign in both.**
  Neighbourhoods that added owners fell back against the City. Because the target is
  a median of owners' estimates, added owners (mostly in new condominium buildings)
  also change whose values the median is taken over.

## Dwelling predictors (added after the demographic run)

Added 2026-10-31 at the user's request, after the demographic run's results were
seen. They are fixed here before any of them has been computed. Each is a share of
occupied private dwellings, or of owner households, at the origin, standardised
within the census:

- **Ground-oriented attached:** semi-detached, row houses and apartments in a duplex.
- **Three or more bedrooms.**
- **Major repairs needed.**
- **Owner households with a mortgage.** The DAs' published percentage is applied to
  their owner households, then pooled.

They are added to `ridge_demog`'s features as a new rung, `ridge_dwell`, after
`ridge_demog`, so it must clear the higher bar. The oracle owner change stays out of
it.

The fifth feature agreed, the five-year change in condominium share, can't be built:
the 2006 profile has no condominium status, so the change to the 2011 origin, which
the forward fold trains on, doesn't exist. It is dropped, not replaced. The change in
the share of apartments in buildings of five or more storeys (`d_apt5`) is already a
predictor.

Sources:
- **Structure types:** the 2011 census profile; the 2016 and 2021 profiles.
- **Bedrooms, repairs and mortgages:** the 2011 NHS; the 2016 and 2021 profiles.

2006 isn't needed: these are levels at the origins 2011 and 2016 (and 2021 for live
forecasts).

## Dwelling predictors: first run (2026-10-31)

The dwelling counts reproduce insights.json's single-detached share exactly for 2011,
2016 and 2021.

The rule still chooses own mean. `ridge_dwell` scores 12.68 forward and 12.37 reverse,
against `ridge_demog`'s 12.40 and 12.18.

Like age, the dwelling shares track each period's movement and then flip (Spearman
correlation with the change that followed):

| Share at the start | 2011 to 2016 | 2016 to 2021 |
|---|---|---|
| Semi, row and duplex | +0.27 | +0.01 |
| Three or more bedrooms | +0.37 | −0.15 |
| Major repairs needed | −0.05 | +0.35 |
| Owners with a mortgage | −0.32 | +0.40 |
| Single-detached (existing) | +0.44 | −0.21 |
| Apartments, 5+ storeys (existing) | −0.42 | +0.11 |

## Why own mean wins

No fitted rung sees the one thing own mean uses: the neighbourhood's previous ratio.

- **What own mean does.** It is the 2016 ratio less half the 2011-to-2016 change,
  i.e. it forecasts that half of the last period's move reverses.
- **What the data shows.** The 2016-to-2021 change regressed on the 2011-to-2016
  change has a slope of −0.33.
- **Why ridge can't learn it.** The forward fold trains on 2011 to 2016, and its
  previous change would need the 2006 value, which isn't comparable.

**Part of the reversal looks like measurement noise.**
- The correlation of successive changes is −0.49 in the half of neighbourhoods with
  fewer owners, and −0.36 in the half with more.
- The 2011 to 2016 changes are more spread out than the 2016 to 2021 changes (standard
  deviation 0.157 against 0.122), and 2011 is the voluntary NHS.

Noise in one census's median shows up as a move that reverses in the next.

Ridge, analogs and boosting already allow for non-linear forms and interactions:
analogs and boosting through their own structure (trees of 7 leaves combine up to six
features), ridge only through the squared and interaction terms in the school model.
None found more than the linear terms.

## The previous change (added after the dwelling run)

Added 2026-11-01 at the user's request, after the dwelling run's results were seen,
and fixed here before it has been computed.

**The feature.** The fitted rungs lack the neighbourhood's previous change in ratio,
because the 2006 median value isn't comparable. The censuses do publish the
*average* value of dwellings, 2006 included. The new feature, `lag_avg`, is the
change over the five years to the origin in the log ratio of the neighbourhood's
average value to the City's:
- 2006 to 2011 for the 2011 origin;
- 2011 to 2016 for 2016;
- 2016 to 2021 for live forecasts.

**How the averages are pooled.**
- **Neighbourhoods:** each DA's published average, weighted by its owner households,
  over the DAs with a figure. As `census2006.average()` does, a neighbourhood is
  left without a figure below half coverage of its owners.
- **The City:** the same pooled mean over all its DAs, so both sides of the ratio are
  built alike.
- **Excluded DAs:** an average of $0 marks a suppressed DA. NHS DAs with a global
  non-response rate of 50% or more are left out.

Two new rungs, both after `ridge_dwell` and so on the higher bar:
- **`reversion`:** ridge on `lag_avg` alone, which learns how much of the previous
  move carries on or reverses.
- **`ridge_lag`:** ridge's own features plus `lag_avg`.

Both folds can use it: the forward fold trains at the 2011 origin (2006 to 2011) and
tests at 2016 (2011 to 2016); the reverse fold is the other way round.
