"""The measures on the map, and the census characteristics they come from.

build.py, census2016.py, distributions.py, exports.py and refresh.py all take
their measure lists from here; web/src/main.js has the matching labels.
"""
import pandas as pd

# Characteristics read from each profile: key -> (ID, name after strip). The ID
# is CHARACTERISTIC_ID (2021) or Member ID (2016). Both must match, since some
# names repeat: 2021 has "Government transfers (%)" for 2020 and for 2019 income.
# Keys starting with n_ are counts used only to compute SHARES.
CHARS_2021 = {
    "med_hh_tot": (243, "Median total income of household in 2020 ($)"),
    "med_hh_at": (244, "Median after-tax income of household in 2020 ($)"),
    "med_ind_tot": (113, "Median total income in 2020 among recipients ($)"),
    "med_ind_at": (115, "Median after-tax income in 2020 among recipients ($)"),
    "avg_hh_tot": (252, "Average total income of household in 2020 ($)"),
    "lim_at": (345, "Prevalence of low income based on the Low-income measure, after tax (LIM-AT) (%)"),
    "transfers": (151, "Government transfers (%)"),
    "n_tenure": (1414, "Total - Private households by tenure - 25% sample data"),
    "n_renter": (1416, "Renter"),
    "n_shelter": (1465, "Total - Owner and tenant households with household total income greater than zero, "
                        "in non-farm, non-reserve private dwellings by shelter-cost-to-income ratio - 25% sample data"),
    "n_shelter30": (1467, "Spending 30% or more of income on shelter costs"),
    "pop21": (1, "Population, 2021"),
    "hh": (50, "Total - Private households by household size - 100% data"),
    "value": (1488, "Median value of dwellings ($)"),
    "own_cost": (1486, "Median monthly shelter costs for owned dwellings ($)"),
    "rent": (1494, "Median monthly shelter costs for rented dwellings ($)"),
    "owner30": (1484, "% of owner households spending 30% or more of its income on shelter costs"),
    "tenant30": (1492, "% of tenant households spending 30% or more of its income on shelter costs"),
    "subsidized": (1491, "% of tenant households in subsidized housing"),
    "n_struct": (41, "Total - Occupied private dwellings by structural type of dwelling - 100% data"),
    "n_detached": (42, "Single-detached house"),
    "n_apt5": (47, "Apartment in a building that has five or more storeys"),
    "n_condo_tot": (1418, "Total - Occupied private dwellings by condominium status - 25% sample data"),
    "n_condo": (1419, "Condominium"),
    "n_period": (1440, "Total - Occupied private dwellings by period of construction - 25% sample data"),
    "n_built_old": (1441, "1960 or before"),
    "n_built_new": (1448, "2016 to 2021"),
    "n_suit": (1437, "Total - Private households by housing suitability - 25% sample data"),
    "n_crowded": (1439, "Not suitable"),
    "age0_14": (35, "0 to 14 years"),
    "age65": (37, "65 years and over"),
    "n_degree_tot": (2014, "Total - Highest certificate, diploma or degree for the population aged 25 to 64 years "
                           "in private households - 25% sample data"),
    "n_degree": (2024, "Bachelor's degree or higher"),
    "n_mob1": (1974, "Total - Mobility status 1 year ago - 25% sample data"),
    "n_moved1": (1976, "Movers"),
    "n_mob5": (1983, "Total - Mobility status 5 years ago - 25% sample data"),
    "n_moved5": (1985, "Movers"),
    "n_imm_tot": (1527, "Total - Immigrant status and period of immigration for the population in private households "
                        "- 25% sample data"),
    "n_imm_recent": (1536, "2016 to 2021"),
}
CHARS_2016 = {
    "med_hh_tot": (742, "Median total income of households in 2015 ($)"),
    "med_hh_at": (743, "Median after-tax income of households in 2015 ($)"),
    "med_ind_tot": (663, "Median total income in 2015 among recipients ($)"),
    "med_ind_at": (665, "Median after-tax income in 2015 among recipients ($)"),
    "avg_hh_tot": (751, "Average total income of households in 2015 ($)"),
    "lim_at": (857, "Prevalence of low income based on the Low-income measure, after tax (LIM-AT) (%)"),
    "transfers": (690, "Government transfers (%)"),
    "n_tenure": (1617, "Total - Private households by tenure - 25% sample data"),
    "n_renter": (1619, "Renter"),
    # sic: two spaces after "Total -" in the 2016 file
    "n_shelter": (1667, "Total -  Owner and tenant households with household total income greater than zero, "
                        "in non-farm, non-reserve private dwellings by shelter-cost-to-income ratio - 25% sample data"),
    "n_shelter30": (1669, "Spending 30% or more of income on shelter costs"),
    "pop16": (1, "Population, 2016"),
    "hh": (51, "Total - Private households by household size - 100% data"),
    "value": (1676, "Median value of dwellings ($)"),
    "own_cost": (1674, "Median monthly shelter costs for owned dwellings ($)"),
    "rent": (1681, "Median monthly shelter costs for rented dwellings ($)"),
    "owner30": (1673, "% of owner households spending 30% or more of its income on shelter costs"),
    "tenant30": (1680, "% of tenant households spending 30% or more of its income on shelter costs"),
    "subsidized": (1679, "% of tenant households in subsidized housing"),
    "n_struct": (41, "Total - Occupied private dwellings by structural type of dwelling - 100% data"),
    "n_detached": (42, "Single-detached house"),
    "n_apt5": (43, "Apartment in a building that has five or more storeys"),
    "n_condo_tot": (1621, "Total - Occupied private dwellings by condominium status - 25% sample data"),
    "n_condo": (1622, "Condominium"),
    "n_period": (1643, "Total - Occupied private dwellings by period of construction - 25% sample data"),
    "n_built_old": (1644, "1960 or before"),
    "n_built_new": (1650, "2011 to 2016"),
    "n_suit": (1640, "Total - Private households by housing suitability - 25% sample data"),
    "n_crowded": (1642, "Not suitable"),
    "age0_14": (35, "0 to 14 years"),
    "age65": (37, "65 years and over"),
    "n_degree_tot": (1698, "Total - Highest certificate, diploma or degree for the population aged 25 to 64 years "
                           "in private households - 25% sample data"),
    "n_degree": (1707, "University certificate, diploma or degree at bachelor level or above"),
    "n_mob1": (2230, "Total - Mobility status 1 year ago - 25% sample data"),
    "n_moved1": (2232, "Movers"),
    "n_mob5": (2239, "Total - Mobility status 5 years ago - 25% sample data"),
    "n_moved5": (2241, "Movers"),
    "n_imm_tot": (1140, "Total - Immigrant status and period of immigration for the population in private households "
                        "- 25% sample data"),
    "n_imm_recent": (1149, "2011 to 2016"),
}

# 2011 Census, 100% (short-form) data only: the profile has no characteristic
# IDs, so rows are matched by (Topic, Characteristic with its indent stripped).
# The 2011 profile gives ages in five-year groups, not the 0-14 and 65+ shares
# that 2016 and 2021 publish; census2011.py sums them (AGE_SUMS_2011). Income,
# tenure, shelter costs, dwelling values, education, mobility, immigration and
# the rest of the long form were the National Household Survey in 2011; those
# come from the NHS Profile (census2011.py) when it is readable.
_DW11 = "Household and dwelling characteristics"
CHARS_2011 = {
    "pop11": ("Population and dwelling counts", "Population in 2011"),
    "hh": (_DW11, "Total number of private households by household size"),
    "n_age_tot": ("Age characteristics", "Total population by age groups"),
    "n_age0_4": ("Age characteristics", "0 to 4 years"),
    "n_age5_9": ("Age characteristics", "5 to 9 years"),
    "n_age10_14": ("Age characteristics", "10 to 14 years"),
    "n_age65_69": ("Age characteristics", "65 to 69 years"),
    "n_age70_74": ("Age characteristics", "70 to 74 years"),
    "n_age75_79": ("Age characteristics", "75 to 79 years"),
    "n_age80_84": ("Age characteristics", "80 to 84 years"),
    "n_age85": ("Age characteristics", "85 years and over"),
    "n_struct": (_DW11, "Total number of occupied private dwellings by structural type of dwelling"),
    "n_detached": (_DW11, "Single-detached house"),
    "n_apt5": (_DW11, "Apartment, building that has five or more storeys"),
}
AGE_SUMS_2011 = {
    "n_age0_14": ["n_age0_4", "n_age5_9", "n_age10_14"],
    "n_age65": ["n_age65_69", "n_age70_74", "n_age75_79", "n_age80_84", "n_age85"],
}
# Shares the 2011 profile doesn't publish as percentages (2016 and 2021 do).
SHARES_2011 = {
    "age0_14": ("n_age0_14", "n_age_tot", "Population aged 0 to 14 (%)"),
    "age65": ("n_age65", "n_age_tot", "Population aged 65 and over (%)"),
}

# Shares computed from two counts: key -> (numerator, denominator, label).
SHARES = {
    "renter": ("n_renter", "n_tenure", "Renter households (% of private households)"),
    "shelter30": ("n_shelter30", "n_shelter", "Households spending 30% or more of income on shelter costs (%)"),
    "detached": ("n_detached", "n_struct", "Single-detached houses (% of occupied private dwellings)"),
    "apt5": ("n_apt5", "n_struct", "Apartments in buildings of five or more storeys (% of occupied private dwellings)"),
    "condo": ("n_condo", "n_condo_tot", "Condominium dwellings (% of occupied private dwellings)"),
    "built_new": ("n_built_new", "n_period", "Dwellings built in the five years before the census (%)"),
    "built_old": ("n_built_old", "n_period", "Dwellings built in 1960 or before (%)"),
    "crowded": ("n_crowded", "n_suit", "Households in housing not suitable for their size (%)"),
    "degree": ("n_degree", "n_degree_tot", "Bachelor's degree or higher, aged 25 to 64 (%)"),
    "moved1": ("n_moved1", "n_mob1", "Moved in the past year (% of population aged 1+)"),
    "moved5": ("n_moved5", "n_mob5", "Moved in the past five years (% of population aged 5+)"),
    "imm_recent": ("n_imm_recent", "n_imm_tot", "Immigrated in the five years before the census (% of population)"),
}

# Labels for characteristics whose profile name is ambiguous on its own.
LABELS = {
    "age0_14": "Population aged 0 to 14 (%)",
    "age65": "Population aged 65 and over (%)",
}

# unit: "money" (dollars; change can be restated in the later year's dollars)
# or "rate" (percent, one decimal; change in percentage points). Income figures
# refer to the income year (2015, 2020); the rest are dated by census (2016,
# 2021); see years().
# width / change_width: histogram bins; change: the six change-class breaks
# (dollars or percentage points), symmetric round numbers centred on zero.
_MEDIAN_CHANGE = {"hh": [-20000, -10000, -2000, 2000, 10000, 20000], "ind": [-10000, -5000, -1000, 1000, 5000, 10000]}
MEASURES = {
    "med_hh_tot": {"unit": "money", "width": 10000, "change_width": 2000, "change": _MEDIAN_CHANGE["hh"]},
    "med_hh_at": {"unit": "money", "width": 8000, "change_width": 2000, "change": _MEDIAN_CHANGE["hh"]},
    "med_ind_tot": {"unit": "money", "width": 3000, "change_width": 1000, "change": _MEDIAN_CHANGE["ind"]},
    "med_ind_at": {"unit": "money", "width": 2500, "change_width": 1000, "change": _MEDIAN_CHANGE["ind"]},
    "avg_hh_tot": {"unit": "money", "width": 15000, "change_width": 5000, "change": [-30000, -15000, -3000, 3000, 15000, 30000]},
    "lim_at": {"unit": "rate", "width": 2, "change_width": 1, "change": [-10, -5, -1, 1, 5, 10]},
    "transfers": {"unit": "rate", "width": 2, "change_width": 1, "change": [-10, -5, -1, 1, 5, 10]},
    "renter": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -2, 2, 10, 20]},
    "shelter30": {"unit": "rate", "width": 2, "change_width": 1, "change": [-20, -10, -3, 3, 10, 20]},
    "owner30": {"unit": "rate", "width": 2, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "tenant30": {"unit": "rate", "width": 2, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "subsidized": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "value": {"unit": "money", "width": 100000, "change_width": 50000, "change": [-400000, -200000, -50000, 50000, 200000, 400000]},
    "own_cost": {"unit": "money", "width": 100, "change_width": 100, "change": [-500, -250, -50, 50, 250, 500]},
    "rent": {"unit": "money", "width": 100, "change_width": 50, "change": [-500, -250, -50, 50, 250, 500]},
    "detached": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "apt5": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "condo": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "built_new": {"unit": "rate", "width": 2, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "built_old": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "crowded": {"unit": "rate", "width": 2, "change_width": 1, "change": [-20, -10, -3, 3, 10, 20]},
    "degree": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "moved1": {"unit": "rate", "width": 2, "change_width": 1, "change": [-20, -10, -3, 3, 10, 20]},
    "moved5": {"unit": "rate", "width": 5, "change_width": 2, "change": [-20, -10, -3, 3, 10, 20]},
    "imm_recent": {"unit": "rate", "width": 1, "change_width": 1, "change": [-20, -10, -3, 3, 10, 20]},
    "age0_14": {"unit": "rate", "width": 1, "change_width": 1, "change": [-10, -5, -1, 1, 5, 10]},
    "age65": {"unit": "rate", "width": 2, "change_width": 1, "change": [-10, -5, -1, 1, 5, 10]},
}
MONEY = [m for m, s in MEASURES.items() if s["unit"] == "money"]
# Figures that refer to the income year (2015, 2020); all others are dated by census.
INCOME_DATED = ["med_hh_tot", "med_hh_at", "med_ind_tot", "med_ind_at", "avg_hh_tot", "lim_at", "transfers"]
CENSUS_DATED = [m for m in MEASURES if m not in INCOME_DATED]


def years(m: str) -> tuple[str, str]:
    """The (2016 Census, 2021 Census) reference years of measure m's figures."""
    return ("2016", "2021") if m in CENSUS_DATED else ("2015", "2020")


def targets(chars: dict) -> dict:
    """(ID as a string, name) -> key, for matching profile rows."""
    return {(str(i), n): k for k, (i, n) in chars.items()}


def label(chars: dict, m: str) -> str:
    return SHARES[m][2] if m in SHARES else LABELS.get(m, chars[m][1])


def derive_shares(wide: pd.DataFrame, shares: dict = SHARES) -> pd.DataFrame:
    """Add the `shares` columns (percent, one decimal) and drop the n_ counts.

    Census counts are randomly rounded to multiples of 5, so in a small DA the
    numerator can exceed the denominator: clip to 100. No households -> null.
    """
    out = wide.copy()
    for m, (num, den, _) in shares.items():
        d = out[den].where(out[den] > 0)
        out[m] = (out[num] / d * 100).clip(upper=100).round(1)
    return out.drop(columns=[c for c in out.columns if c.startswith("n_")])


# Where too few owner or tenant households answered, the 2016 profile publishes a
# median of 0 where 2021 has a suppression marker: a dwelling value, owner cost or
# rent of $0 is not a value. Percentages for the same households are kept as
# published; 2021 also publishes 0% for many of them.
UNPUBLISHED_ZERO_2016 = ["value", "own_cost", "rent"]


def null_unpublished_2016(wide: pd.DataFrame) -> pd.DataFrame:
    """Null the 2016 medians published as $0 (see above), and the published
    percentages above 100."""
    out = wide.copy()
    out[UNPUBLISHED_ZERO_2016] = out[UNPUBLISHED_ZERO_2016].where(out[UNPUBLISHED_ZERO_2016] != 0)
    pct = [m for m in out if m in MEASURES and MEASURES[m]["unit"] == "rate" and m not in SHARES]
    out[pct] = out[pct].where(~(out[pct] > 100))
    return out


def derive_city_shares(city: pd.Series) -> pd.Series:
    """derive_shares for the city-wide values (a Series by key)."""
    return derive_shares(city.to_frame().T).iloc[0]
