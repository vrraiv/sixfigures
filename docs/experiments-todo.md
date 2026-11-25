# Experiments: ideas to consider

Zoning and by-law changes since 2021 that could be tested the way the Sixplex zoning page
(`/experiments/sixplex/`) tests By-law 654-2025: a comparison group, or a clean break in time,
and data the site can get. Listed 25 November 2026; nothing here is decided.

## Strong fits

- [ ] **Fourplexes citywide (By-law 474-2023, May 2023), measured by how much the rule changed
  in each area.** Some residential zones already allowed several homes on a lot; others allowed
  only detached or semi-detached houses. Areas where the change unlocked the most lots should
  respond most.
  - Why first: this is the suburban catch-up the sixplex estimate assumes fades. It would show
    whether the catch-up is a zoning effect and how fast it levels off, which would give the
    sixplex page's one-year half-life something to rest on.
  - Data: building permits (in hand, `pipeline/multiplex/projects.csv`); the zoning by-law map
    (not checked on Open Data yet).

- [ ] **Rooming houses legalized citywide (31 March 2024).** Before, multi-tenant houses were
  allowed only in the former city of Toronto and parts of Etobicoke and York; the new rules
  opened up North York, Scarborough, East York and the rest.
  - Comparison: the newly permitted areas against those already permitted, before and after.
  - Data: rooming-house permits are in the permit files ("Boarding/Lodging House",
    "multi-tenant" descriptions); address points carry the former municipality.
  - Catches: licensing began citywide the same day (bundled, like the development charges
    with the sixplex rule); small counts; the old Etobicoke and York boundaries need the
    by-laws the new ones replaced.
  - Sources: [City news release](https://www.toronto.ca/news/city-of-toronto-helps-increase-availability-and-safety-of-multi-tenant-houses-across-toronto/),
    [By-law 157-2023](https://www.toronto.ca/legdocs/bylaws/2023/law0157.pdf).
  - The cheapest of these: it can be built from data the site already has.

- [ ] **Speed cameras banned by the province (14 November 2025).** Toronto's cameras, mostly in
  school zones, were switched off and removed that month.
  - Comparison: collisions near former camera sites against comparable streets that never had
    one, before and after. The staggered rollout since 2020 is a second test, the other way.
  - Data: the serious-injury collision points (in hand, `toronto_ksi_4326.csv`); camera
    locations (to find).
  - Catches: serious collisions are rare; the 2025 police file is due around February 2027,
    and a year after the ban would be more convincing.
  - Sources: [CP24](https://www.cp24.com/local/toronto/2025/11/14/speed-enforcement-cameras-officially-banned-across-ontario/),
    [Ontario](https://www.ontario.ca/page/transportation-safety).

## Later

- [ ] **Townhouses and small apartments on major streets (By-laws 1061-2025 and 1062-2025, in
  force 11 September 2025 after the Ontario Land Tribunal).** Lots fronting a major street
  against the lots behind them on the same blocks. Wait until about late 2027 for enough
  permits. [EHON](https://www.toronto.ca/EHON).

- [ ] **Garden suites (adopted February 2022, in force July 2022).** Citywide, but it mattered
  mainly for lots without a lane, since laneway suites were already allowed: lots without a
  lane against lots with one. The permit files lump laneway and garden suites together, so
  they'd need separating by description or lane adjacency. A provincial regulation
  (O. Reg. 462/24) changed the rules again in November 2024.
  [City news release](https://www.toronto.ca/news/garden-suites-permitted-in-toronto-after-ontario-land-tribunal-dismisses-appeal/).

## Poor fits

- **Rental renovation licence (31 July 2025):** citywide, no comparison group, and its effects
  (N13 notices, evictions) aren't in open data. [City page](https://www.toronto.ca/renovictions).
- **30 km/h local roads:** rolled out street by street with no published district schedule;
  the dates would have to be pieced together from many by-law amendments.

## Sixplex page: things to revisit

- [ ] If another ward opts in to six homes, it has to leave the comparison group, and the page
  needs redoing (`SIX` in `pipeline/sixplex.py`).
- [ ] The one-year half-life (`HALF_LIFE` in `pipeline/sixplex_insights.py`) is an assumption.
  Revisit it if the fourplex test above measures how fast the catch-up fades.
- [ ] **The catch-up is the weak spot: its rate and its end point are both assumed.** A note;
  this might be its own page, and the method may prove too uncertain to do.
  - The model has one setting, so rate and end point move together (at a one-year half-life
    the eight wards settle at about 56% of their standing at the by-law). The band runs from
    "stops at the by-law" to "full pace": it leaves out a catch-up that gains steam (which
    would make the estimated gain larger) and one that reverses (smaller).
  - An end point would bound it, however fast the catch-up went. The right one is a stock
    ratio, multiplex homes per residential lot, and where each group starts from. (Parity in
    new proposals per house ignores that the old city's suitable lots may already be
    converted while the suburbs' are untouched, so the suburbs could outpace it for years.)
  - The denominator is available: houses by ward from the 2021 Census (single-detached,
    semi-detached, row; the City's Ward Profiles, or `pipeline/demography.py` by
    neighbourhood), or lots from the zoning map.
  - The numerator isn't. The census has no multiplex category: triplexes, fourplexes and
    conversions sit in "apartment in a building of fewer than five storeys" with walk-ups and
    low-rise condos, and "duplex" is mostly houses with a basement suite. MPAC's property codes
    aren't open.
    - The sixteen wards: probably close to knowable. Before 2023 their house lots were mostly
      zoned for detached houses only, so their multiplexes are mainly those in the permits
      since 2000, plus a few that predate the rules.
    - The eight wards: the unknown, a century of conversions from before the permit files.
      Duplex plus under-five-storey homes gives only an upper bound.
  - So the end point would be a range, not a number. Even so, it would replace an assumption
    and give the band an upper side. It shares the zoning and stock data with the fourplex
    test above.
- [ ] **Did the city as a whole gain homes?** Not answerable yet; tried 25 November 2026 and
  judged not publishable.
  - What was tried: each group of wards, and the whole city, against its own trend before the
    by-law (an interrupted time series), with the page's three fades. Over 2025 Q3 to 2026 Q3
    the city came out between about +100 homes (the trend stops at the by-law) and about
    −1,350 (it carries on at full pace); a one-year half-life gave about −750.
  - Why it fails: the sixteen wards were growing about 24% a quarter as fourplexes caught on,
    and how fast that would have levelled off decides the answer. Applied to levels, a
    one-year half-life has the sixteen settle at about three times their pace at the by-law,
    a much stronger assumption than the one the page makes about the gap. A by-law imagined a
    year early gives errors of ×0.73 to ×1.55 under every fade, larger than the effect sought.
  - What it showed: against their own trend the eight wards were about on track, while the
    sixteen fell short every quarter after the by-law. Suites and new houses, which the by-law
    didn't touch, fell short too, consistent with the citywide slowdown commonly reported in
    2025–26. So the page's +252 is the eight wards holding their pace while the rest of the
    city slowed: a gain if the by-law shielded them, little or none if builders moved
    downtown, and the data can't tell these apart.
  - What it would take: a large comparison city with no rezoning and no Housing Accelerator
    Fund agreement, with permits that separate small multiplexes from towers; or a direct
    measure of the slowdown to condition the projection on; or another year or two of permits,
    until the suburbs' fourplex growth has visibly levelled off.
  - Meanwhile: consider a sentence in the page's "What this can't tell you" saying that the
    estimate is against a rest of the city that slowed, and that whether the whole city gained
    depends on why it slowed.
