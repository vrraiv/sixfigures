# Toronto's rows of the Statistics Canada tables

These files are what the site's census figures are computed from. Each is the part of a bulk
Statistics Canada table that concerns the City of Toronto: its dissemination areas and, in most,
the city's own row, for the characteristics `pipeline/measures.py` names. `pipeline/extracts.py`
explains why they are kept here; `make extracts` collects and checks them, and
`make from-extracts` rebuilds the neighbourhood figures from them on any checkout.

| File | From | Written by |
|---|---|---|
| `toronto_profile_long.csv` | 2021 Census Profile, 98-401-X2021006 (Ontario, dissemination areas) | `build.py` |
| `toronto_profile_2016_long.csv` | 2016 Census Profile, 98-401-X2016044 (Ontario, dissemination areas) | `census2016.py` |
| `toronto_profile_2011_long.csv` | 2011 Census Profile, 98-316-XWE2011001 (Ontario, dissemination areas) | `census2011.py` |
| `toronto_nhs_2011.csv` | 2011 National Household Survey Profile, dissemination areas (a Beyond 20/20 table); also the 2011 income groups | `nhs2011.py`, with pyivt |
| `toronto_profile_2006.csv` | 2006 Census Profile, 94-581-XCB2006002 (a Beyond 20/20 table) | `profile2006.py`, with pyivt |
| `toronto_income_groups_2021.csv` | 2021 Census Profile: households and people by income group | `insights.py` |
| `toronto_income_groups_2016.csv` | 2016 Census Profile: households and people by income group | `insights.py` |

Values are as published, suppression markers and all: the clean-up (a $0 that stands for "not
published", a percentage above 100) happens when they are read (`measures.null_unpublished`), so
a change to those rules needs no new extract.

A census isn't revised, so these change only when `measures.py` asks for a characteristic one
doesn't hold. The script that reads it then stops and names the raw file to fetch; with that file
in `pipeline/raw/` it rewrites the extract.

Source: Statistics Canada, 2006, 2011, 2016 and 2021 Censuses of Population and 2011 National
Household Survey. Reproduced and distributed on an "as is" basis with the permission of
Statistics Canada, under the
[Statistics Canada Open Licence](https://www.statcan.gc.ca/en/terms-conditions/open-licence).
