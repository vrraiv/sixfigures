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

## The previous change: first run (2026-11-01)

The pooled averages check out:
- **2006:** each neighbourhood's average matches `pipeline/census/nbhd_2006.csv`
  exactly.
- **City:** the pooled averages are within 0.7% of the City rows, every census.

The rule still chooses own mean:

| Rung | Forward MAE | Reverse MAE |
|---|---|---|
| Own mean (chosen) | 7.86 | |
| Persistence | 8.84 | 10.52 |
| Reversion (previous change alone) | 11.09 | 11.25 |
| Ridge with the previous change | 12.70 | 11.67 |
| Ridge | 12.70 | 12.29 |

**The previous change did not predict the next one the same way in both periods.**
Rank correlation of the previous change with the next:

| Previous change (average value) | Next change (median value) | Correlation |
|---|---|---|
| 2006 to 2011 | 2011 to 2016 | −0.06 |
| 2011 to 2016 | 2016 to 2021 | −0.36 |

- Fitted on 2011 to 2016, `reversion` learns almost no reversal (slope −0.02).
- Fitted on 2016 to 2021, it learns a strong one (−0.27).

**Why own mean wins forward.** It assumes half of the last move reverses. That
happened to be close for 2016 to 2021 (the slope was −0.33), but nothing in the
earlier period would have taught a model to expect it.

**This revises the measurement-noise reading above.** If noise in the 2011 NHS were
the main cause, the move into 2011 would also have reversed afterwards. It didn't
(−0.06). The reversal is mostly specific to the 2011–2016 run-up. Some noise remains
likely, since the reversal is stronger where there are fewer owners.

## Heavy building (added after the previous-change run)

Added 2026-11-01 at the user's request. **Unlike the earlier additions, this was chosen
after looking at both periods**, so its backtest is partly fitted to what was seen. The
2026 Census is its first clean test.

**What was seen.** Six neighbourhoods fell in dollars while the City rose 50%: five
from 2011 to 2016 and one from 2016 to 2021. Three of them were in the top tenth for
permits issued in the five years before the period. Ranking all neighbourhoods by
those permits:

| Period | Top tenth: share falling more than 20% against the City | The rest |
|---|---|---|
| 2011 to 2016 | 56% | 8% |
| 2016 to 2021 | 19% | 2% |

New units, often condominiums cheaper than the existing stock, enter the owners'
homes and pull the census median down. Ridge's `permits_before` enters only as a
linear term, which dilutes an effect confined to the tail.

**The feature.** `heavy_build` is 1 if a neighbourhood's permits issued in the five
years before the origin, per 1,000 households, are in the top tenth at that origin,
and 0 otherwise. Ranking within each origin means no threshold is fitted across
periods.

Three new rungs, all after `ridge_lag` and so on the higher bar:
- **`build`:** persistence plus a fitted shift for heavy-building neighbourhoods
  (ridge on `heavy_build` alone).
- **`ridge_build`:** ridge's own features plus `heavy_build`.
- **`own_mean_build`:** own mean plus `build`'s fitted shift for `heavy_build`
  (forward only, like own mean, so it is scored on one fold).

## Heavy building: first run (2026-11-01)

Sixteen neighbourhoods are flagged at each origin. The rule still chooses own mean:

| Rung | Forward MAE | Reverse MAE |
|---|---|---|
| Own mean (chosen) | 7.86 | |
| Own mean with the heavy-building shift | 8.25 | |
| Persistence | 8.84 | 10.52 |
| Build (shift on persistence) | 11.41 | 11.24 |
| Ridge with heavy building | 12.66 | 12.29 |
| Ridge | 12.70 | 12.29 |

**The shift doesn't carry from one period to the other.**
- Fitted on 2011 to 2016, heavy-building neighbourhoods fall 0.18 against the City.
- Fitted on 2016 to 2021, the tuning sets the shift to zero.

In 2016 to 2021 the flagged neighbourhoods' median relative change was +5%, against
+3% for the rest. More of them fell sharply (19% against 2%), but others rose: heavy
building widened the spread of outcomes without moving their centre. A shift in the
forecast can't capture that, though it could widen the range shown for those
neighbourhoods.

## The City's value: a nowcast (added 2026-11-01)

The ratio forecast can't be acted on in dollars until the City's 2026 median is
released. The 2026 Census reference day (May 2026) has passed, so the City's median
can be estimated from market prices already observed. A neighbourhood's dollar
forecast is then the City estimate times its forecast ratio.

**Rule.** The City's median at census t+5 is its Census median at t times the change
in a price index from May of year t to May of year t+5. The coefficient is fixed at 1;
nothing is fitted. It is scored on 2011 to 2016 and 2016 to 2021 against the Census
City median (+50% and +49.5%).

**Candidates.**
1. **Statistics Canada New Housing Price Index, Toronto** (table 18-10-0205-01, open
   licence). Computed before this section was written, so recorded here as seen:

   | Series | May 2011 to May 2016 | May 2016 to May 2021 |
   |---|---|---|
   | Total (house and land) | +20.6% | +14.5% |
   | Land only | +9.4% | +19.0% |
   | Census City median | +50.0% | +49.5% |

   It covers only new single, semi and row houses at a fixed specification, and misses
   by a factor of two to three that isn't stable between periods. Rejected; no
   multiplier is fitted to rescue it.
2. **TRREB Market Watch, City of Toronto, all home types, May** (pre-registered here,
   before extraction). Primary: the median sale price. Reported alongside: the
   average sale price. A glimpse of the May 2016 summary page was seen while checking
   the layout; no ratio was computed.
3. **Teranet–National Bank HPI, Toronto** (private comparator only; its terms bar
   creating other data from it without permission).

The extraction checks that districts sum to their region, the three regions sum to the
City, and sales times average price matches dollar volume.

## The City's value: first run (2026-11-01)

**TRREB Market Watch figures** (all home types, May; files in `pipeline/raw/trreb_mw`):

| May | City median | City average | Source |
|---|---|---|---|
| 2011 | none | $535,807 | pooled over the 36 Toronto districts (W01–W10, C01–C15 less C05, E01–E11) |
| 2016 | $595,000 | $782,051 | City of Toronto row |
| 2021 | $890,000 | $1,116,736 | City of Toronto row |
| 2026 | $885,000 | $1,108,292 | City of Toronto row |

- **Checks passed:**
  - In every district row and City row, sales times average equals dollar volume.
  - In 2016 the three regions sum to the City (1,151 + 2,283 + 1,204 = 4,638).
- **No City median in 2011:** the 2011 report gives no City total, and a median can't
  be pooled from districts, so the primary rule is scored on 2016 to 2021 only.

**Scores** (log error × 100 against the Census City median, about %):

| Rule | 2011 to 2016 | 2016 to 2021 |
|---|---|---|
| Median | not available | +0.0 (+49.6% against +49.5%) |
| Average | −2.7 (+46.0% against +50.0%) | −4.6 (+42.8% against +49.5%) |

- **The median's near-exact hit is partly luck.** The Census City median for 2021 is
  exactly $900,000, a round figure where owners' estimates bunch.
- **The average runs a few points under the Census in both periods.**

**The 2026 nowcast.** TRREB's May median fell 0.6% from 2021 to 2026, and the average
0.8%. The City's 2026 Census median is estimated at $895,000 by the median rule, or
$893,000 by the average.

## Neighbourhood market prices: nowcast rungs (added 2026-11-01)

Fixed here before any community figure has been compared with the Census.

**Source.** TRREB's quarterly Community Housing Market Reports for Toronto's three
regions (`pipeline/raw/trreb_community`, Q4 2011 to Q2 2026). Each gives every
community's sales, dollar volume, and average and median sale price (all home types).
TRREB's Toronto communities are the City's 140 neighbourhoods of before 2022.

**These rungs are nowcasts.** They use sales during the period, so they can be
issued only after the Census reference day, not five years ahead. For 2026 that is
now. They are reported apart from the forecast rungs, and the 2026 Census is their
first clean test.

**The feature.** `mkt` is the change over the period in a community's market standing:
- **Window:** for census year t, Q1 to Q3 of year t, centred on the May reference
  day. The 2011 origin has only Q4 2011 (the reports start then), five months late.
- **Level:** the sales-weighted mean of the quarterly log medians in the window.
- **Standing:** that level less the sales-weighted mean of every Toronto community's
  level in the same window.
- **Change:** standing at t+5 less standing at t.
- **Thin markets:** a community with fewer than 10 sales in either window gets
  `mkt` = 0, i.e. no market information.
- **The 158 neighbourhoods:** each takes the figure of the 2022-or-earlier community
  that contains it. Communities split in 2022 pass their figure to every part
  *(implementation: the name matching is checked by hand)*.

**Rungs**, after `own_mean_build`:
- **`market_full`:** persistence plus `mkt`, coefficient fixed at 1, nothing fitted.
- **`market`:** persistence plus a fitted slope on `mkt` (ridge on `mkt` alone).
- **`own_mean_market`:** own mean plus `market`'s fitted slope times `mkt` (forward
  only).
- **`ridge_market`:** ridge's own features plus `mkt`.

## Neighbourhood market prices: first run (2026-11-01)

**The extraction** (`pipeline/trreb.py`) covers 59 quarters, Q4 2011 to Q2 2026, with
138 to 140 of the 140 communities in each.
- Sales times average price matches dollar volume on every row.
- A district's communities add to TRREB's district total, except in 15 of 1,250
  district-quarters, where TRREB's own totals are off by one or two sales.
- Q3 2026 isn't published yet, so a live 2026 window would hold Q1 and Q2 only.

**The rule still chooses own mean:**

| Rung | Forward MAE | Reverse MAE |
|---|---|---|
| Own mean (chosen) | 7.86 | |
| Own mean plus the market slope | 7.92 | |
| Persistence | 8.84 | 10.52 |
| Market (fitted slope) | 12.10 | 11.40 |
| Ridge with the market | 12.38 | 12.58 |
| Market, coefficient 1 | 12.26 | 19.05 |

**The market change is the first predictor that holds in both periods.** Its rank
correlation with the change in the Census ratio is +0.38 (2011 to 2016) and +0.36
(2016 to 2021). Every earlier feature flipped sign between periods.
- Fitted slopes are +0.23 and +0.14: a sale-price move shows up in the Census ratio
  at a fifth of its size or less.
- At full size (`market_full`) it is much worse than persistence.

### Diagnostic: the average drift (chosen after looking)

The household-weighted mean change in the log ratio isn't zero:
- **2011 to 2016:** −0.047.
- **2016 to 2021:** +0.025.

The neighbourhoods as a whole shift against the City median, and the shift reverses.
Every fitted rung carries the training period's mean change into the test period
through its intercept, giving a bias of 6 to 9 points:

| Rung | Forward bias | Reverse bias |
|---|---|---|
| Persistence | −2.5 | +4.7 |
| Market | −8.9 | +8.2 |
| Build | −7.4 | +7.2 |
| Reversion | −7.1 | +7.0 |
| Ridge | −7.8 | +6.5 |

**Centred scores.** Re-scored with each rung's predicted changes centred to average
zero (this uses no outcomes):

| Rung | Forward, raw | Forward, centred | Reverse, raw | Reverse, centred |
|---|---|---|---|---|
| Own mean | 7.86 | 8.32 | | |
| Market | 12.10 | 8.69 | 11.40 | 10.16 |
| Reversion | 11.09 | 8.80 | 11.25 | 10.67 |
| Persistence | 8.84 | 8.84 | 10.52 | 10.52 |
| Ridge | 12.70 | 11.37 | 12.29 | 11.77 |

- **Market** beats persistence in both folds once centred, the first fitted rung to do
  so.
- **Own mean is still best forward.** The rule chooses it on raw and on centred scores.
- **Ridge and its variants, analogs and boosting** stay at 10.7 to 12.6 centred. Their
  losses weren't the intercept alone.

**This sharpens the explanation of own mean's win.** About half its edge over
persistence (7.86 against 8.84) is the average drift: it forecasts −½ times the
previous mean change (−0.047), about +0.024, against the actual +0.025. The other half
is neighbourhood-level reversion.

**For dollar figures**, the drift is a City-wide shift of the neighbourhoods against
the City median, of 2.5 to 4.7 points a period. A centred ratio forecast leaves it out,
so a dollar range has to carry it alongside the City nowcast's error.

Centring isn't part of the decision rule. Adopting it would be a rule change, made
after looking.

## Rule change: centred predictions (adopted 2026-11-01, after looking)

The user adopted centring after seeing the diagnostic above. From here on, every
rung's predicted changes in the dwelling-value ratio are centred to a
household-weighted average of zero before scoring. This uses no outcomes; persistence
is unchanged. The ratio forecast then says nothing about the group's average shift
against the City median, which is left to the range below. Raw scores are still
written alongside (`mae_raw`).

## Live dollar table, 2021 to 2026 (fixed before it is computed)

- **City:** the 2021 Census City median ($900,000) times TRREB's May City median
  change, 2021 to 2026 ($890,000 to $885,000), giving $894,944.
- **Ratios at the 2021 origin** (each centred, as above):
  - **persistence:** the 2021 ratio;
  - **own mean:** the mean of the 2011, 2016 and 2021 ratios;
  - **own mean plus market:** own mean plus a slope times `mkt` for 2021 to 2026. The
    2026 window has Q1 and Q2 only (Q3 isn't published). The slope is ridge on `mkt`
    alone, centred, fitted on both periods pooled.
- **Range:** from the lowest of the three ratios less 0.05 to the highest plus 0.05.
  The 0.05 allows for the group's average shift (up to 0.047 seen) and the City
  nowcast's error.
- **Dollars:** City times exp(ratio), rounded to the nearest $1,000.
- **Output:** written to `pipeline/out/model/value_live.csv`. Not yet published on the
  site.

## Centred scores and the live table: first run (2026-11-01)

**The rule, on centred scores, still chooses own mean** (forward 8.32, against
persistence's 8.84):

| Rung | Forward | Reverse |
|---|---|---|
| Own mean (chosen) | 8.32 | |
| Own mean plus market | 8.46 | |
| Market | 8.69 | 10.16 |
| Reversion | 8.80 | 10.67 |
| Persistence | 8.84 | 10.52 |
| Build | 9.58 | 10.52 |
| Analogs (k-NN) | 10.66 | 12.57 |
| Ridge | 11.37 | 11.77 |

**The live table** (`pipeline/out/model/value_live.csv`):
- **City median, 2026:** $894,944.
- **Market slope:** +0.211, from the two periods pooled.
- **Coverage:** 157 of 158 neighbourhoods have a market figure.
- **Range width:** the median neighbourhood's range spans 16% (high over low).
- **Median of the neighbourhoods:**

  | 2021 Census | Persistence | Own mean | Own mean plus market | Low | High |
  |---|---|---|---|---|---|
  | $925,000 | $920,000 | $911,500 | $916,000 | $851,000 | $993,000 |
