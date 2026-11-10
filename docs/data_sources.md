# Data sources

Every source is declared in [`etl/config.py`](../etl/config.py). This page lists the
filters requested from each API and what the staging models keep.

## Eurostat (dissemination API, JSON-stat 2.0)

Endpoint: `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<code>?format=JSON&lang=EN&...`

Each dataset lists one or more *candidates*. The downloader tries them in order and keeps the
first that answers, so a retired dimension code or a renamed dataset degrades to a broader
request instead of failing the refresh.

| Raw table | Dataset | Requested | Staging keeps |
|---|---|---|---|
| `tour_occ_nim` | Nights spent, monthly | unit NR; c_resid TOTAL, DOM, FOR; nace_r2 I551-I553, I551, I552, I553 | all |
| `tour_occ_arm` | Arrivals, monthly | same as above | all |
| `tour_occ_mnor` | Net occupancy, hotels | accomunit BEDPL, BEDRM | values 0-100, one unit per cell |
| `tour_cap_nat` | Capacity, annual | unit NR; accomunit ESTBL, BEDRM, BEDPL; four NACE codes | pivoted to establishments, bedrooms, bed-places |
| `tour_occ_ninraw` | Nights by country of residence, annual | unit NR; nace_r2 I551-I553 | countries become source markets; `FOR` or `TOTAL` minus domestic gives the foreign total |
| `tour_occ_nin2` | Nights by NUTS 2, annual | unit NR; nace_r2 I551-I553; c_resid TOTAL, DOM, FOR | NUTS 2 codes only |
| `tour_occ_nin2m` | Nights by NUTS 2 and month | unit NR; c_resid TOTAL; from 2019 | `month` M01-M12 (TOTAL dropped), NUTS 2 only |
| `tour_ce_omn12` | Short-stay rentals via platforms | indic_to NGT_SP; c_resid TOTAL; from 2018 | `month` M01-M12; EU27, countries, NUTS 2 |
| `avia_paoc` | Air passengers by country | unit PAS; tra_meas PAS_CRD; schedule TOTAL; tra_cov TOTAL, NAT, INTL | pivoted to total, domestic, international |
| `avia_paoa` | Air passengers by airport | 58 airports listed in config; split per airport if the joint request fails | airports in `seeds/airport.csv` |
| `hicp` | `prc_hicp_minr` (ECOICOP 2, `coicop18`), fallback `prc_hicp_manr` (`coicop`) | unit RCH_A; TOTAL / CP00, CP111, CP112 | mapped to ALL, RESTAURANTS, ACCOMMODATION |
| `sts_setu_m` | Services turnover | nace_r2 I55, I56; unit I21 (fallback: any) | one variant per country: volume before value, SCA before CA before NSA |
| `une_rt_m` | Unemployment | SA, TOTAL age, both sexes, % of labour force | all |
| `ei_bsco_m` | Consumer confidence | BS-CSMCI, SA, balance | all |
| `namq_10_gdp` | GDP | CLV_PCH_SM, SCA, B1GQ | quarters to dates |
| `irt_lt_mcby_m` | Long-term bond yields | MCBY | all |
| `ert_bil_eur_m` | Euro FX, monthly average | 14 currencies, AVG, NAC | currencies in `seeds/currency.csv` |
| `demo_gind` | Population on 1 January | JAN | all |

Notes:

- **Release timing.** National monthly data arrive about two months after the month;
  the EU aggregate appears once enough countries report. `tour_occ_nin2m` is released once
  a year (about ten months after year end). `tour_ce_omn12` is released quarterly.
- **ECOICOP version 2.** From the January 2026 release, HICP datasets use the `coicop18`
  dimension (`prc_hicp_minr`); the version 1 datasets are frozen at December 2025.
- **Platform data** are experimental statistics from an agreement with Airbnb, Booking,
  Expedia and Tripadvisor (Tripadvisor stopped contributing in late 2024).
- **Geography.** The warehouse keeps codes in `dim_geo`: countries from the seed, EU
  aggregates (`EU27_2020`, euro area variants) and every NUTS 2 code seen in the regional
  datasets. Other aggregates and former members are dropped in the facts.

## ECB Data Portal (csvdata)

Endpoint: `https://data-api.ecb.europa.eu/service/data/<flow>/<key>?format=csvdata`

| Raw table | Key | Content |
|---|---|---|
| `ecb_fx_daily` | `EXR/D.<14 currencies>.EUR.SP00.A` | euro reference rates since 2019 |
| `ecb_deposit_rate` | `FM/D.U2.EUR.4F.KR.DFR.LEV` | deposit facility rate |
| `ecb_estr` | `EST/B.EU000A2X2A25.WT` | euro short-term rate |
| `ecb_euribor_3m` | `FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA` | Euribor 3-month, monthly average |
| `ecb_yield_10y` | `YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y` | AAA euro area 10-year spot rate |

## INE (Spain), Tempus3 JSON

Endpoint: `https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/<id>?tip=AM`

| Raw table | Table | Content |
|---|---|---|
| `ine_irsh_zone_adr` | 46297 | ADR by tourist zone, from 2021 |
| `ine_irsh_zone_revpar` | 46300 | RevPAR by tourist zone, from 2021 |

Staging keeps the level series (`Tipo de dato = Dato`) for all hotel categories combined.
RevPAR / ADR gives room occupancy; INE's own EOH survey agrees within about one point in the
high season. Some zones were redefined over time (for example *Costa Barcelona 2015 / 2016 /
2026*) and appear as separate rows.

## GISCO boundaries

`NUTS_RG_60M_<2024|2021>_4326_LEVL_<0|2>.geojson` from
`https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/`. The export keeps the
NUTS version that matches more region codes in the data, rounds coordinates to three
decimals, and the site trims overseas territories from the map frame.
