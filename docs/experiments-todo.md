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
