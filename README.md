# EU Markets Dashboard

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![dbt](https://img.shields.io/badge/dbt-1.9-FF694B?logo=dbt&logoColor=white)
![DuckDB](https://img.shields.io/badge/DuckDB-1.x-FFF000?logo=duckdb&logoColor=black)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-static-222?logo=github)

**Business question:** how do tourism demand, hotel occupancy, seasonality, source markets,
short-stay rentals, air traffic and prices behave across European markets, and what is
the macro and rates backdrop?

A star-schema data warehouse built on public APIs (24 Eurostat datasets plus 30 per-country
route datasets, the ECB Data Portal, the OECD, Open-Meteo, INE Spain and Statistics Portugal), modelled with **DuckDB + dbt**, refreshed daily by **GitHub Actions** and
published as a static **GitHub Pages** site. No server: the site is HTML, JavaScript and
JSON files.

**Live site:** https://akhileshpantulu.github.io/EU-MARKETS-DASHBOARD/ (once GitHub Pages is enabled, see [Deploy](#deploy-to-github-pages))

Modelled on [carlosalomar/balearic-tourism-dw](https://github.com/carlosalomar/balearic-tourism-dw)
(Balearic Islands, Streamlit). This version widens the scope from three islands to every
market Eurostat covers, adds 15 more sources and replaces Streamlit with a static site.

## What changed from the reference project

| | balearic-tourism-dw | EU Markets Dashboard |
|---|---|---|
| Geography | 3 Balearic islands | 27 EU countries, EFTA and candidates, EU totals, ~240 NUTS 2 regions, every reporting airport |
| Sources | INE EOH/IRSH, IBESTAT, Eurostat `avia_paoa` | Eurostat (tourism, air routes, prices, macro, household demand), ECB, OECD, Open-Meteo, INE Spain, Statistics Portugal, GISCO |
| Frontend | Streamlit app | Static site on GitHub Pages (ECharts), 14 tabs, light and dark |
| Refresh | Manual | Daily GitHub Actions run, plus live ECB / Eurostat calls from the browser |
| Resilience | n/a | Per-source fallbacks; a failed source keeps its last file and the build continues |

## The dashboard

The site is dark by default (light on the toggle). The header states when the data was last
refreshed and how many sources are healthy; the data is monthly, so there is no live clock.

**01 Overview (home page).** A map of Europe with a Countries / Regions layer switch and a year
selector for regions. Hovering shows a brief; clicking a country or region opens its dossier.
The Highlights list beside it is derived from the latest releases: biggest movers, occupancy
swings, air growth, accommodation inflation, platform rentals, leading indicators, weather.

**02 Country dossier.** Pick a country (or the EU total) and every section is laid out for it on
one page: demand, occupancy and length of stay, seasonality, regions, source markets,
short-stay rentals, air traffic, prices, macro, source-market demand health, weather, hotel
prices, and FX and rates. A view switch (monthly pace, annual totals, annual change) and a
year selector apply to every chart. Hovering an annual bar shows its value and the change on
the previous year (same months for the year to date).

**03 Reports.** A report builder over the same data:

- **Level**: country, NUTS 2 region or airport.
- **Standalone or comparison**: one place, or two to four of the same level side by side
  (Italy v Spain, Balearics v Canaries v Crete, Palma v Chania).
- **Sections** (check boxes, per level) and **analytics** (year-on-year change, compound annual
  growth, indexed growth, change vs 2019, monthly detail for the final year, share of the wider
  total, nights per resident, data tables, written commentary).
- **Final year and number of years** (3, 5, 10, 15 or 20).

The report renders as a 4:3 slide deck (10 x 7.5 in) in the house market-overview format:
beige title band, Arial Nova titles, Century Gothic text, navy-headed tables, red / navy / grey
series. Each section is one slide with an action headline (the conclusion), supporting bullets,
a comparative table (places side by side, leaders in bold, negatives in brackets) and two or
three charts. Standalone reports are benchmarked (a country against the EU-27, a region against
its country, an airport against national air traffic). The executive summary ranks the places on
a scorecard (scale, growth, recovery, momentum, occupancy, seasonality, international mix, air
growth, pricing) and lists the conclusions. Year-by-year tables go in an appendix when "Data
tables" is ticked. Save as PDF from the browser's print dialog. The Excel workbook is in HG
format (one sheet per section; navy headers, grey subheaders, light-blue totals, Arial 14, 55%
zoom, tables from D3). The logo files for the deck (`site/assets/brand/`) are kept out of the
repository; without them the deck renders without the logo.

**Explore tabs** compare markets side by side:

| Tab | What it shows |
|---|---|
| Markets | Country map (YTD growth, vs 2019, foreign share, intensity, occupancy), YTD ranking and a sortable scorecard |
| Seasonality | Country x month heatmap, peak two-month share, NUTS 2 seasonality map with regional monthly profiles |
| Regions | NUTS 2 map and table: nights, growth, vs 2019, foreign share, platform share, seasonality |
| Source markets | Top origin markets for a destination, growth vs 2019, and where a given origin market travels |
| Short-stay rentals | Airbnb / Booking / Expedia nights vs tourist accommodation, platform share by country and region |
| Air traffic | Passengers by country; filter to any airport for its traffic, origin countries and top routes |
| Prices & macro | HICP accommodation and restaurants vs headline, GDP, unemployment, consumer confidence, bond yields |
| Market demand | Demand health of a destination's top source markets |
| Weather | Monthly temperature, sunshine and rain for 37 destinations against the normal |
| Rates & FX | ECB rates and 14 euro FX pairs, loaded live from the ECB |
| Hotel prices | Spain: ADR, RevPAR and occupancy by tourist zone. Portugal: revenue per guest night by region |
| Data | Source status and freshness, CSV downloads of every mart, definitions |

One filter row above each tab scopes every chart on it; the selected market carries across
tabs and lives in the URL, so views are shareable. Every chart has a table view and a CSV
download.

## Data sources

All monthly sources are requested from January 2005 (the annual history); the site's monthly files start in 2014. See
[docs/data_sources.md](docs/data_sources.md) for dimensions, filters and caveats.

| Area | Source | Dataset | Grain |
|---|---|---|---|
| Demand | Eurostat | `tour_occ_nim`, `tour_occ_arm` | country x month x residence (domestic / foreign) x accommodation type |
| Occupancy | Eurostat | `tour_occ_mnor` | country x month, hotel bed-places and bedrooms |
| Supply | Eurostat | `tour_cap_nat` | country x year x accommodation type |
| Source markets | Eurostat | `tour_occ_ninraw` | destination x guest country of residence x year |
| Regions | Eurostat | `tour_occ_nin2`, `tour_occ_nin2m` | NUTS 2 x year; NUTS 2 x month (from 2020) |
| Short-stay rentals | Eurostat (experimental) | `tour_ce_omn12` | country / NUTS 2 x month |
| Air | Eurostat | `avia_paoc`, `avia_paoa` | country x month x domestic / international; every reporting airport x month |
| Air routes | Eurostat | `avia_par_<country>` (30 datasets) | airport pair x month, from 2023 (Eurostat publishes with a long lag) |
| Prices | Eurostat | `prc_hicp_minr` (ECOICOP 2), fallback `prc_hicp_manr` | country x month: all items, restaurants, accommodation |
| Activity | Eurostat | `sts_setu_m` | accommodation (I55) and food service (I56) turnover index |
| Macro | Eurostat | `une_rt_m`, `ei_bsco_m`, `namq_10_gdp`, `irt_lt_mcby_m`, `demo_gind` | unemployment, consumer confidence, GDP, bond yields, population |
| Household demand | Eurostat | `sts_trtu_m`, `prc_hpi_q`, `tour_dem_tttot`, `tour_dem_extot` | retail volume, house prices, residents' trips and spending abroad |
| Source-market outlook | OECD | `DF_CLI` (LI, CCICP) | leading indicator and consumer confidence, incl. UK, US, China, Japan |
| Weather | Open-Meteo | ERA5 archive | 37 destinations x day, aggregated to months; backfilled over the first runs |
| FX | Eurostat + ECB | `ert_bil_eur_m`, ECB `EXR` | monthly averages since 2015; daily reference rates |
| Rates | ECB | `FM` (DFR, Euribor 3M), `EST` (EUR STR), `YC` (AAA 10Y) | daily / monthly |
| Hotel prices | INE (Spain) | IRSH tables 46297, 46300 | Spanish tourist zone x month: ADR, RevPAR |
| Hotel prices | Statistics Portugal | indicators 0012091, 0012092 | NUTS 2 region x type x month: lodging income, nights |
| Maps | Eurostat GISCO | NUTS 2024 / 2021 boundaries, 1:60M | countries, NUTS 2 |

Eurostat publishes no hotel prices, so national offices are the price layer: INE's IRSH survey
for Spain (ADR, RevPAR) and Statistics Portugal (revenue per guest night; it publishes no RevPAR
or ADR series). Other offices can be added the same way.

`scripts/probe_apis.py` (the **Probe APIs** workflow) prints the shape of each API response;
it is how the codes for new sources were checked.

## How it works

```
 Eurostat / ECB / INE / GISCO APIs
            │  etl/download.py   (raw responses saved untouched, per-source fallbacks)
            ▼
       data/raw/*.json|csv  ──►  etl/load_raw.py  ──►  DuckDB  raw schema
                                                          │  dbt build
                                                          ▼
                     staging (views) ─► core star schema ─► analytics marts  (+ data tests)
                                                          │  etl/export_site.py
                                                          ▼
                                   site/data/*.json  +  site/ (HTML, JS, ECharts)
                                                          │  GitHub Actions
                                                          ▼
                                                    GitHub Pages
                                                          │  in the browser
                                                          ▼
                                     live ECB rates / FX and Eurostat release check
```

### The warehouse

| Layer | Schema | Contents |
|---|---|---|
| Seeds | `reference` | Countries (EU / euro flags, currency, region group), EU aggregates, airports with coordinates, residence, accommodation types, COICOP mapping, currencies, rate series |
| Staging | `staging` | One view per source: codes filtered and renamed, Eurostat month codes turned into dates, ECOICOP 1 and 2 mapped to one key |
| Core | `core` | 9 dimensions and 15 facts (tables) |
| Analytics | `analytics` | 8 marts the site reads |

**Dimensions:** `dim_date`, `dim_geo` (aggregates, countries and NUTS 2 regions rolled up to
their country), `dim_residence`, `dim_accommodation_type`, `dim_partner`, `dim_airport`,
`dim_currency`, `dim_spain_zone`.

**Facts:**

| Fact | Grain | Measures |
|---|---|---|
| `fact_accommodation_monthly` | geo x month x residence x accommodation type | nights, arrivals |
| `fact_hotel_occupancy_monthly` | geo x month | bed-place and bedroom occupancy |
| `fact_accommodation_capacity_annual` | geo x year x accommodation type | establishments, bedrooms, bed-places |
| `fact_source_market_nights_annual` | destination x partner x year | nights |
| `fact_regional_nights_annual` / `_monthly` | NUTS 2 x year x residence / NUTS 2 x month | nights |
| `fact_platform_nights_monthly` | geo x month | short-stay rental nights |
| `fact_air_passengers_monthly` | country x month | passengers: total, domestic, international |
| `fact_airport_passengers_monthly` | airport x month | passengers |
| `fact_consumer_prices_monthly` | geo x month x COICOP group | HICP annual rate |
| `fact_macro_monthly` | geo x month | unemployment, confidence, bond yield, turnover indices |
| `fact_gdp_quarterly`, `fact_population_annual` | geo x quarter / year | GDP growth, population |
| `fact_fx_rates`, `fact_interest_rates` | currency / series x date | ECB and Eurostat rates |
| `fact_spain_zone_hotel_prices_monthly` | zone x month | ADR, RevPAR, implied occupancy |

**Marts:** `mart_country_monthly` (drill-across of every monthly fact, with YoY and vs-2019),
`mart_country_annual_history` (every monthly series by year since 2005, with year-to-date comparisons),
`mart_country_annual` (seasonality, intensity, capacity, platform share),
`mart_country_scorecard`, `mart_region_annual`, `mart_region_monthly`, `mart_source_markets`,
`mart_spain_zone_monthly`, `mart_data_freshness`.

**Modelling choices worth knowing:**

- Rates (occupancy, length of stay, shares) are recomputed from additive measures in the
  marts, never averaged from published rates.
- `tour_occ_nin2m` and `tour_ce_omn12` use the year as their time axis with the calendar month
  as a separate `month` dimension; staging turns both into real months.
- YTD growth compares the same months of the previous year for each market's own latest
  month, so markets that publish at different speeds stay comparable.
- Platform share = platform nights / (platform + tourist accommodation nights). The two
  sources can overlap where rentals also report as holiday homes.
- A source that is down gives an empty but correctly typed raw table, so the build and the
  site still work; the Data tab shows it as stale or missing.

**Tests** (about 150 dbt tests): unique and not-null keys, relationships from every fact to
its dimensions, non-negative measures, rates within bounds, plus reconciliation tests in
[`tests/`](tests/): domestic + foreign = total nights, domestic + international = total air
passengers, NUTS 2 regions add up to the country (warning only, confidential regions fall
short), hotel nights never exceed all accommodation, and every month code parses.

## Run it locally

Requires Python 3.11+.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
make refresh     # download -> load -> dbt build -> export to site/data/
make serve       # http://localhost:8000
```

Offline (no API calls), with synthetic fixtures in the exact API formats:

```bash
make test        # pytest + full dbt build + export on fixtures
```

A site built from fixtures shows a "Test data" banner.

## Deploy to GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Run the **Refresh data and deploy** workflow (Actions tab → Run workflow). Tick
   *Commit the exported site/data snapshot* if you also want the JSON committed.
3. The workflow then runs every day at 05:37 UTC and on pushes that change the pipeline or
   the site.

The raw downloads are cached between runs, so a source that fails one day falls back to
its previous file instead of breaking the build.

## Live data in the browser

The site is a daily snapshot. On top of it:

- **Rates & FX** draws the snapshot, then fetches the latest ECB reference rates, deposit
  rate, EUR STR and 10-year yield from the ECB Data Portal and redraws with a *live* badge.
- **Overview** (EU total) asks Eurostat for the newest EU month and says so when Eurostat
  is ahead of the snapshot.

If either API is unreachable from the viewer's browser, the snapshot stays on screen.

## Repository layout

```
├── etl/                 # download, load, export, fixtures, report (Python)
│   └── tests/           # parser unit tests
├── models/
│   ├── staging/         # one view per source
│   └── marts/
│       ├── core/        # dimensions and facts
│       └── analytics/   # marts read by the site
├── seeds/               # countries, airports, mappings
├── macros/              # Eurostat time/geo helpers, generic tests
├── tests/               # dbt reconciliation tests, real Eurostat sample fixture
├── site/                # static site: index.html, assets/, data/ (generated)
├── docs/data_sources.md
├── .github/workflows/   # refresh.yml (daily + deploy), ci.yml (offline tests)
├── dbt_project.yml, profiles.yml, Makefile, requirements.txt
```

## Licence

Code under the [MIT licence](LICENSE). Parts of the INE parser and dbt macros are adapted
from carlosalomar/balearic-tourism-dw (MIT). Data belongs to Eurostat, the European Central
Bank and INE and is reused under their open-data terms with attribution. Boundaries
© EuroGeographics for the administrative boundaries.
