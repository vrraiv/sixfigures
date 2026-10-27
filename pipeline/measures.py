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
}

# Shares computed from two counts: key -> (numerator, denominator, label).
SHARES = {
    "renter": ("n_renter", "n_tenure", "Renter households (% of private households)"),
    "shelter30": ("n_shelter30", "n_shelter", "Households spending 30% or more of income on shelter costs (%)"),
}

# unit: "money" (dollars; change can be restated in 2020 dollars) or "rate"
# (percent, one decimal; change in percentage points). Figures refer to the
# income year (2015, 2020) except the housing shares, which StatCan dates by
# census (2016, 2021); see years().
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
}
MONEY = [m for m, s in MEASURES.items() if s["unit"] == "money"]
CENSUS_DATED = ["renter", "shelter30"]


def years(m: str) -> tuple[str, str]:
    """The (2016 Census, 2021 Census) reference years of measure m's figures."""
    return ("2016", "2021") if m in CENSUS_DATED else ("2015", "2020")


def targets(chars: dict) -> dict:
    """(ID as a string, name) -> key, for matching profile rows."""
    return {(str(i), n): k for k, (i, n) in chars.items()}


def label(chars: dict, m: str) -> str:
    return SHARES[m][2] if m in SHARES else chars[m][1]


def derive_shares(wide: pd.DataFrame) -> pd.DataFrame:
    """Add the SHARES columns (percent, one decimal) and drop the n_ counts.

    Census counts are randomly rounded to multiples of 5, so in a small DA the
    numerator can exceed the denominator: clip to 100. No households -> null.
    """
    out = wide.copy()
    for m, (num, den, _) in SHARES.items():
        d = out[den].where(out[den] > 0)
        out[m] = (out[num] / d * 100).clip(upper=100).round(1)
    return out.drop(columns=[c for c in out.columns if c.startswith("n_")])


def derive_city_shares(city: pd.Series) -> pd.Series:
    """derive_shares for the city-wide values (a Series by key)."""
    return derive_shares(city.to_frame().T).iloc[0]
