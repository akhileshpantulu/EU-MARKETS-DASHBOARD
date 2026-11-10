"""Source configuration: every public table that feeds the warehouse.

Each source is declared once here. `etl/download.py` fetches it, `etl/load_raw.py`
flattens it into the DuckDB `raw` schema and the dbt staging models pick it up.

Eurostat datasets list one or more *candidates*. The downloader tries them in
order and keeps the first that answers, so a renamed dataset or a dimension code
that Eurostat retires does not break the whole refresh (HICP moved from
`prc_hicp_manr` to `prc_hicp_minr` with ECOICOP ver. 2 in 2026, for example).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
SITE_DIR = ROOT / "site"
SITE_DATA = SITE_DIR / "data"
MANIFEST = RAW_DIR / "manifest.json"

# First period requested from every monthly / annual source.
SINCE_YEAR = 2015

EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{code}"
ECB_API = "https://data-api.ecb.europa.eu/service/data/{flow}/{key}"
INE_API = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{table_id}"
GISCO_API = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/{file}"

Params = list[tuple[str, str]]


def multi(name: str, *values: str) -> Params:
    """('c_resid', 'TOTAL', 'DOM') -> [('c_resid', 'TOTAL'), ('c_resid', 'DOM')]."""
    return [(name, v) for v in values]


@dataclass(frozen=True)
class Candidate:
    code: str
    params: Params = field(default_factory=list)


@dataclass(frozen=True)
class EurostatDataset:
    name: str                       # raw table: raw.eurostat_<name>
    description: str
    candidates: tuple[Candidate, ...]
    # Dimensions the staging model reads. Missing ones are added as NULL so the
    # SQL keeps working if Eurostat drops a single-valued dimension.
    dims: tuple[str, ...]
    # If every candidate fails as a whole, retry one value of this parameter at a
    # time and keep the ones that answer (used for long airport lists).
    split_on: str | None = None
    core: bool = False              # the refresh fails if a core source fails


NACE_ACCOM = multi("nace_r2", "I551-I553", "I551", "I552", "I553")
RESID = multi("c_resid", "TOTAL", "DOM", "FOR")
M = [("freq", "M")]
A = [("freq", "A")]


def since_month() -> Params:
    return [("sinceTimePeriod", f"{SINCE_YEAR}-01")]


def since_year(year: int = SINCE_YEAR) -> Params:
    return [("sinceTimePeriod", str(year))]


# Major gateway and leisure airports (Eurostat rep_airp = country_ICAO).
# Names and coordinates live in seeds/airport.csv.
AIRPORTS = [
    "ES_LEMD", "ES_LEBL", "ES_LEPA", "ES_LEMG", "ES_LEAL", "ES_GCLP", "ES_GCTS", "ES_LEIB",
    "ES_GCRR", "ES_LEZL", "ES_LEVC", "ES_GCFV", "ES_LEMH",
    "FR_LFPG", "FR_LFPO", "FR_LFMN", "FR_LFLL", "FR_LFML",
    "IT_LIRF", "IT_LIMC", "IT_LIME", "IT_LIPZ", "IT_LICC", "IT_LIRN", "IT_LIEO",
    "DE_EDDF", "DE_EDDM", "DE_EDDB", "DE_EDDL", "DE_EDDH",
    "NL_EHAM", "BE_EBBR", "IE_EIDW", "AT_LOWW", "DK_EKCH", "SE_ESSA", "FI_EFHK",
    "PT_LPPT", "PT_LPFR", "PT_LPPR", "PT_LPMA",
    "EL_LGAV", "EL_LGIR", "EL_LGRP", "EL_LGKR", "EL_LGTS",
    "CY_LCLK", "MT_LMML", "HR_LDDU", "HR_LDSP",
    "PL_EPWA", "PL_EPKK", "CZ_LKPR", "HU_LHBP",
    "CH_LSZH", "CH_LSGG", "NO_ENGM", "IS_BIKF",
]

EUROSTAT_DATASETS: list[EurostatDataset] = [
    # ------------------------------------------------------------- accommodation
    EurostatDataset(
        "tour_occ_nim", "Nights spent at tourist accommodation, monthly, by country",
        (Candidate("tour_occ_nim", M + [("unit", "NR")] + RESID + NACE_ACCOM + since_month()),),
        dims=("c_resid", "unit", "nace_r2", "geo", "time"), core=True,
    ),
    EurostatDataset(
        "tour_occ_arm", "Arrivals at tourist accommodation, monthly, by country",
        (Candidate("tour_occ_arm", M + [("unit", "NR")] + RESID + NACE_ACCOM + since_month()),),
        dims=("c_resid", "unit", "nace_r2", "geo", "time"),
    ),
    EurostatDataset(
        "tour_occ_mnor", "Net occupancy rate of bed-places and bedrooms in hotels, monthly",
        (
            Candidate("tour_occ_mnor", M + multi("accomunit", "BEDPL", "BEDRM") + since_month()),
            Candidate("tour_occ_mnor", since_month()),
        ),
        dims=("accomunit", "unit", "geo", "time"),
    ),
    EurostatDataset(
        "tour_cap_nat", "Establishments, bedrooms and bed-places, annual, by country",
        (Candidate("tour_cap_nat", A + [("unit", "NR")] + multi("accomunit", "ESTBL", "BEDRM", "BEDPL")
                   + NACE_ACCOM + since_year()),),
        dims=("accomunit", "unit", "nace_r2", "geo", "time"),
    ),
    EurostatDataset(
        "tour_occ_ninraw", "Nights spent by country of residence of the guest, annual",
        (Candidate("tour_occ_ninraw", A + [("unit", "NR"), ("nace_r2", "I551-I553")] + since_year()),),
        dims=("c_resid", "unit", "nace_r2", "geo", "time"),
    ),
    # ------------------------------------------------------------------ regional
    EurostatDataset(
        "tour_occ_nin2", "Nights spent by NUTS 2 region, annual",
        (Candidate("tour_occ_nin2", A + [("unit", "NR"), ("nace_r2", "I551-I553")] + RESID + since_year()),),
        dims=("c_resid", "unit", "nace_r2", "geo", "time"),
    ),
    EurostatDataset(
        # Time is the year; the calendar month is its own `month` dimension.
        "tour_occ_nin2m", "Nights spent by NUTS 2 region and month (from 2020)",
        (
            Candidate("tour_occ_nin2m", [("unit", "NR"), ("c_resid", "TOTAL")] + since_year(2019)),
            Candidate("tour_occ_nin2m", since_year(2019)),
        ),
        dims=("c_resid", "unit", "nace_r2", "month", "geo", "time"),
    ),
    EurostatDataset(
        "tour_ce_omn12",
        "Guest nights in short-stay rentals booked via Airbnb, Booking and Expedia, by NUTS 2 and month",
        (
            Candidate("tour_ce_omn12", [("indic_to", "NGT_SP"), ("c_resid", "TOTAL")] + since_year(2018)),
            Candidate("tour_ce_omn12", since_year(2018)),
        ),
        dims=("indic_to", "c_resid", "unit", "month", "geo", "time"),
    ),
    # ------------------------------------------------------------------- air
    EurostatDataset(
        "avia_paoc", "Air passengers carried, monthly, by reporting country",
        (
            Candidate("avia_paoc", M + [("unit", "PAS"), ("tra_meas", "PAS_CRD"), ("schedule", "TOTAL")]
                      + multi("tra_cov", "TOTAL", "NAT", "INTL") + since_month()),
            Candidate("avia_paoc", M + [("unit", "PAS"), ("tra_meas", "PAS_CRD")] + since_month()),
        ),
        dims=("unit", "tra_meas", "schedule", "tra_cov", "geo", "time"),
    ),
    EurostatDataset(
        "avia_paoa", "Air passengers carried, monthly, by main airport",
        (Candidate("avia_paoa", M + [("unit", "PAS"), ("tra_meas", "PAS_CRD"), ("schedule", "TOTAL"),
                                     ("tra_cov", "TOTAL")] + multi("rep_airp", *AIRPORTS) + since_month()),),
        dims=("unit", "tra_meas", "schedule", "tra_cov", "rep_airp", "time"),
        split_on="rep_airp",
    ),
    # ------------------------------------------------------- prices and macro
    EurostatDataset(
        "hicp", "HICP annual rate of change: all items, restaurants, accommodation services",
        (
            # ECOICOP ver. 2 (from January 2026 releases): dimension `coicop18`.
            Candidate("prc_hicp_minr", M + [("unit", "RCH_A")] + multi("coicop18", "TOTAL", "CP111", "CP112")
                      + since_month()),
            # ECOICOP ver. 1 (frozen at December 2025).
            Candidate("prc_hicp_manr", M + [("unit", "RCH_A")] + multi("coicop", "CP00", "CP111", "CP112")
                      + since_month()),
        ),
        dims=("unit", "coicop", "coicop18", "geo", "time"),
    ),
    EurostatDataset(
        "sts_setu_m", "Services turnover index, accommodation (NACE I55) and food services (I56)",
        (
            Candidate("sts_setu_m", M + multi("nace_r2", "I55", "I56") + [("unit", "I21")] + since_month()),
            Candidate("sts_setu_m", M + multi("nace_r2", "I55", "I56") + since_month()),
        ),
        dims=("indic_bt", "nace_r2", "s_adj", "unit", "geo", "time"),
    ),
    EurostatDataset(
        "une_rt_m", "Unemployment rate, monthly, seasonally adjusted",
        (Candidate("une_rt_m", M + [("s_adj", "SA"), ("age", "TOTAL"), ("sex", "T"), ("unit", "PC_ACT")]
                   + since_month()),),
        dims=("s_adj", "age", "sex", "unit", "geo", "time"),
    ),
    EurostatDataset(
        "ei_bsco_m", "Consumer confidence indicator, monthly, seasonally adjusted",
        (
            Candidate("ei_bsco_m", M + [("indic", "BS-CSMCI"), ("s_adj", "SA"), ("unit", "BAL")] + since_month()),
            Candidate("ei_bsco_m", M + [("indic", "BS-CSMCI")] + since_month()),
        ),
        dims=("indic", "s_adj", "unit", "geo", "time"),
    ),
    EurostatDataset(
        "namq_10_gdp", "Real GDP growth, quarterly, same quarter of previous year",
        (Candidate("namq_10_gdp", [("freq", "Q"), ("unit", "CLV_PCH_SM"), ("s_adj", "SCA"), ("na_item", "B1GQ"),
                                   ("sinceTimePeriod", f"{SINCE_YEAR}-Q1")]),),
        dims=("unit", "s_adj", "na_item", "geo", "time"),
    ),
    EurostatDataset(
        "irt_lt_mcby_m", "Long-term government bond yields (Maastricht criterion), monthly",
        (Candidate("irt_lt_mcby_m", M + [("int_rt", "MCBY")] + since_month()),),
        dims=("int_rt", "geo", "time"),
    ),
    EurostatDataset(
        "ert_bil_eur_m", "Euro exchange rates, monthly average",
        (Candidate("ert_bil_eur_m", M + [("statinfo", "AVG"), ("unit", "NAC")]
                   + multi("currency", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
                           "ISK", "TRY", "JPY", "CNY")
                   + since_month()),),
        dims=("statinfo", "unit", "currency", "time"),
    ),
    EurostatDataset(
        "demo_gind", "Population on 1 January, annual",
        (Candidate("demo_gind", A + [("indic_de", "JAN")] + since_year()),),
        dims=("indic_de", "geo", "time"),
    ),
]


# ---------------------------------------------------------------- ECB Data Portal
@dataclass(frozen=True)
class EcbSeries:
    name: str
    flow: str
    key: str
    description: str
    start: str


FX_CURRENCIES = ["USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "ISK", "TRY", "JPY", "CNY"]

ECB_SERIES = [
    EcbSeries("fx_daily", "EXR", f"D.{'+'.join(FX_CURRENCIES)}.EUR.SP00.A",
              "ECB euro reference exchange rates, daily", "2019-01-01"),
    EcbSeries("deposit_rate", "FM", "D.U2.EUR.4F.KR.DFR.LEV",
              "ECB deposit facility rate", "2015-01-01"),
    EcbSeries("estr", "EST", "B.EU000A2X2A25.WT",
              "Euro short-term rate (EUR STR), volume-weighted trimmed mean", "2019-10-01"),
    EcbSeries("euribor_3m", "FM", "M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA",
              "Euribor 3-month, monthly average", "2015-01-01"),
    EcbSeries("yield_10y", "YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y",
              "Euro area AAA government bond 10-year spot rate", "2015-01-01"),
]

# ------------------------------------------------------------------- INE (Spain)
# Hotel Sector Profitability Indicators (IRSH): ADR and RevPAR by tourist zone.
# Eurostat publishes no hotel prices, so this is the price layer for Spain.
INE_TABLES = {
    "irsh_zone_adr": 46297,
    "irsh_zone_revpar": 46300,
}

# ------------------------------------------------------------------ GISCO maps
GISCO_FILES = {
    "countries": ["NUTS_RG_60M_2024_4326_LEVL_0.geojson", "NUTS_RG_60M_2021_4326_LEVL_0.geojson"],
    "regions_2024": ["NUTS_RG_60M_2024_4326_LEVL_2.geojson"],
    "regions_2021": ["NUTS_RG_60M_2021_4326_LEVL_2.geojson"],
}
