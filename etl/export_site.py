"""Export the analytics marts to compact JSON files that the static site reads.

Each table file is {"columns": [...], "rows": [[...], ...]} with numbers rounded,
so the whole site data stays small enough to commit and serve from GitHub Pages.

Usage:
    python -m etl.export_site                    # data/eu_markets.duckdb -> site/data/
    DUCKDB_PATH=/tmp/dw.duckdb SITE_DATA=/tmp/site python -m etl.export_site
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import duckdb

from etl import config
from etl.load_raw import DEFAULT_DB

MONTH = "strftime(month_start, '%Y-%m') as month"
# Airports shown on the site: curated ones plus any with 100k+ passengers in their last twelve months.
AIRPORTS_SHOWN = """select airport_code from analytics.mart_airport_summary
                    where is_curated or passengers_12m >= 100000"""

TABLES = {
    "country_monthly": f"""
        select geo_code, {MONTH}, nights, nights_domestic, nights_foreign, hotel_nights, arrivals,
               avg_length_of_stay, foreign_share, nights_yoy, nights_vs_baseline,
               bed_place_occupancy_rate, room_occupancy_rate, bed_place_occupancy_change,
               platform_nights, platform_nights_yoy, air_passengers, air_passengers_international,
               air_passengers_yoy, hicp_all_items_pct, hicp_accommodation_pct, hicp_restaurants_pct,
               unemployment_rate_pct, consumer_confidence_balance, bond_yield_10y_pct,
               accommodation_turnover_index, food_service_turnover_index
        from analytics.mart_country_monthly where year >= 2014 order by geo_code, month_start""",
    "annual_history": """
        select geo_code, metric, kind, year, months, is_ytd, value, change
        from analytics.mart_country_annual_history order by geo_code, metric, year""",
    "country_annual": """
        select geo_code, year, is_complete_year, nights, nights_foreign, hotel_nights, arrivals,
               high_season_share, peak_two_month_share, foreign_share, avg_length_of_stay,
               avg_bed_place_occupancy_rate, establishments, bedrooms, bed_places, hotel_bedrooms,
               population, nights_per_resident, platform_nights, platform_share, air_passengers,
               avg_hicp_accommodation_pct, nights_yoy, nights_vs_baseline
        from analytics.mart_country_annual order by geo_code, year""",
    "scorecard": """
        select * exclude (geo_name, geo_level, is_eu27, is_euro_area, region_group)
        from analytics.mart_country_scorecard order by geo_code""",
    "region_annual": """
        select geo_code, year, nights, nights_foreign, foreign_share, peak_two_month_share,
               high_season_share, peak_month, platform_nights, platform_share, nights_yoy,
               nights_vs_baseline, platform_nights_yoy, share_of_country_nights
        from analytics.mart_region_annual order by geo_code, year""",
    "region_monthly": f"""
        select geo_code, {MONTH}, nights, platform_nights
        from analytics.mart_region_monthly
        where year >= (select max(year) - 4 from analytics.mart_region_monthly)
        order by geo_code, month_start""",
    "source_markets": """
        select geo_code, partner_code, year, nights, share_of_foreign_nights, nights_yoy,
               nights_vs_baseline, market_rank
        from analytics.mart_source_markets order by geo_code, year, market_rank""",
    "airports_monthly": f"""
        select f.airport_code, strftime(d.month_start, '%Y-%m') as month, f.passengers
        from core.fact_airport_passengers_monthly as f join core.dim_date as d using (date_key)
        where d.year >= 2019 and f.airport_code in ({AIRPORTS_SHOWN})
        order by 1, 2""",
    "airport_summary": f"""
        select airport_code, iata_code, airport_name, city, country_code, country_name, latitude, longitude,
               is_curated, strftime(last_month, '%Y-%m') as last_month, passengers_last_month, last_month_yoy,
               passengers_12m, passengers_12m_yoy, passengers_12m_vs_baseline, route_count
        from analytics.mart_airport_summary
        where airport_code in ({AIRPORTS_SHOWN})
        order by passengers_12m desc nulls last""",
    "airport_origins": f"""
        select airport_code, partner_country_code, partner_country_name, year, passengers, share_of_airport,
               passengers_yoy
        from analytics.mart_airport_origins
        where country_rank <= 25 and airport_code in ({AIRPORTS_SHOWN})
        order by airport_code, year, passengers desc""",
    "airport_routes": f"""
        select airport_code, partner_airport_code, partner_airport_name, partner_country_name, year, passengers,
               passengers_yoy, route_rank
        from analytics.mart_airport_routes
        where airport_code in ({AIRPORTS_SHOWN})
        order by airport_code, year, route_rank""",
    "weather_monthly": f"""
        select location_code, {MONTH}, avg_temp_c, avg_max_temp_c, precipitation_mm, rainy_days, sunshine_hours,
               normal_years, normal_max_temp_c, normal_precipitation_mm, normal_sunshine_hours,
               temp_anomaly_c, sunshine_anomaly_hours, precipitation_vs_normal
        from analytics.mart_weather_monthly order by location_code, month_start""",
    "market_demand_monthly": f"""
        select market_code, {MONTH}, oecd_cli, oecd_consumer_confidence, retail_volume_index, retail_volume_yoy,
               ec_consumer_confidence_balance, unemployment_rate_pct
        from analytics.mart_market_demand_monthly where year >= 2018 order by market_code, month_start""",
    "market_scorecard": """
        select * exclude (cli_key, cci_key, ec_key, retail_key, unemp_key),
               cli_key, retail_key, strftime(house_prices_quarter, '%Y-%m') as house_prices_quarter_start
        from analytics.mart_market_demand_scorecard order by market_code""",
    "house_prices_quarterly": """
        select market_code, strftime(quarter_start, '%Y-%m') as quarter_start, house_prices_yoy_pct
        from core.fact_house_prices_quarterly where quarter_start >= date '2018-01-01' order by 1, 2""",
    "resident_travel_annual": """
        select market_code, year, trips_abroad, trips_domestic, spend_abroad_eur, spend_per_trip_abroad_eur,
               spend_per_night_abroad_eur
        from core.fact_resident_travel_annual order by 1, 2""",
    "portugal_prices_monthly": f"""
        select region_code, region_name, accommodation_type_code, {MONTH}, lodging_income_eur, nights,
               revenue_per_night_eur, revenue_per_night_yoy, nights_yoy
        from analytics.mart_portugal_prices_monthly order by region_code, accommodation_type_code, month_start""",
    "fx_daily": """
        select currency_code, strftime(rate_date, '%Y-%m-%d') as date, units_per_eur
        from core.fact_fx_rates
        where frequency = 'daily' and rate_date >= current_date - interval 3 year
        order by 1, 2""",
    "fx_monthly": """
        select currency_code, strftime(rate_date, '%Y-%m') as month, units_per_eur
        from core.fact_fx_rates where frequency = 'monthly' and rate_date >= date '2014-01-01' order by 1, 2""",
    "rates": """
        select series_code, strftime(rate_date, '%Y-%m-%d') as date, rate_pct
        from core.fact_interest_rates
        where rate_date >= date '2015-01-01'
          and (series_code = 'euribor_3m' or rate_date >= current_date - interval 4 year
               or day(rate_date) = 1 or dayofweek(rate_date) = 1)
        order by 1, 2""",
    "gdp_quarterly": """
        select geo_code, strftime(quarter_start, '%Y-%m') as quarter_start, gdp_growth_yoy_pct
        from core.fact_gdp_quarterly order by 1, 2""",
    "spain_zones_monthly": f"""
        select zone_key, {MONTH}, adr_eur, revpar_eur, implied_room_occupancy_rate, adr_yoy, revpar_yoy,
               is_provisional
        from analytics.mart_spain_zone_monthly order by zone_key, month_start""",
}

DIMENSIONS = {
    "geos": """select geo_code, geo_name, geo_level, country_code, is_eu27, is_euro_area, currency_code,
                      region_group, sort_order from core.dim_geo order by geo_level, sort_order, geo_code""",
    "partners": "select partner_code, partner_name, is_country from core.dim_partner order by partner_code",
    "airports": "select * from core.dim_airport where is_curated order by airport_code",
    "markets": "select * from core.dim_market order by market_code",
    "weather_locations": "select * from core.dim_weather_location order by location_name",
    "currencies": "select * from core.dim_currency order by currency_code",
    "rate_series": "select * from reference.interest_rate_series order by sort_order",
    "zones": "select zone_key, zone_label, zone_name, region_name from core.dim_spain_zone order by zone_label",
    "sources": "select * from analytics.mart_data_freshness order by source_key",
}


def clean(value):
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        if abs(value) >= 1000:
            return round(value)
        return round(value, 4)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def table(con: duckdb.DuckDBPyConnection, sql: str) -> dict:
    rel = con.sql(sql)
    return {"columns": rel.columns, "rows": [[clean(v) for v in row] for row in rel.fetchall()]}


def records(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    t = table(con, sql)
    return [dict(zip(t["columns"], row)) for row in t["rows"]]


def round_coords(coords, digits: int = 3):
    if isinstance(coords, (int, float)):
        return round(coords, digits)
    return [round_coords(c, digits) for c in coords]


def slim_geojson(src: Path, keep: set[str] | None = None) -> dict:
    """Keep id and name only, round coordinates to ~100 m."""
    fc = json.loads(src.read_text(encoding="utf-8"))
    features = []
    for f in fc.get("features", []):
        props = f.get("properties", {})
        code = props.get("NUTS_ID") or f.get("id")
        if keep is not None and code not in keep:
            continue
        geom = f["geometry"]
        features.append({"type": "Feature",
                         "properties": {"code": code, "name": props.get("NAME_LATN") or props.get("NUTS_NAME")},
                         "geometry": {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])}})
    return {"type": "FeatureCollection", "features": features}


def export_geo(raw_dir: Path, out: Path, region_codes: set[str]) -> dict:
    """Copy country boundaries and the NUTS 2 version that matches most region codes."""
    info = {}
    geo_dir = out / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    countries = raw_dir / "gisco" / "countries.geojson"
    if countries.exists():
        (geo_dir / "countries.geojson").write_text(json.dumps(slim_geojson(countries), separators=(",", ":")))
        info["countries"] = "geo/countries.geojson"
    best, best_hits = None, -1
    for version in ("regions_2024", "regions_2021"):
        path = raw_dir / "gisco" / f"{version}.geojson"
        if not path.exists():
            continue
        codes = {f["properties"].get("NUTS_ID") for f in json.loads(path.read_text())["features"]}
        hits = len(codes & region_codes)
        if hits > best_hits:
            best, best_hits = path, hits
    if best is not None:
        (geo_dir / "regions.geojson").write_text(json.dumps(slim_geojson(best), separators=(",", ":")))
        info["regions"] = "geo/regions.geojson"
        info["regions_version"] = best.stem.replace("regions_", "NUTS ")
        info["regions_matched"] = best_hits
    return info


def main() -> None:
    db_path = Path(os.environ.get("DUCKDB_PATH", DEFAULT_DB))
    raw_dir = Path(os.environ.get("RAW_DIR", config.RAW_DIR))
    out = Path(os.environ.get("SITE_DATA", config.SITE_DATA))
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=True)

    sizes = {}
    for name, sql in TABLES.items():
        path = out / f"{name}.json"
        path.write_text(json.dumps(table(con, sql), separators=(",", ":")), encoding="utf-8")
        sizes[name] = path.stat().st_size

    dims = {name: records(con, sql) for name, sql in DIMENSIONS.items()}
    region_codes = {g["geo_code"] for g in dims["geos"] if g["geo_level"] == "nuts2"}
    synthetic = any((s.get("url") or "") == "synthetic" for s in dims["sources"])
    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "synthetic": synthetic,
        "baseline_year": 2019,
        "files": {name: f"{name}.json" for name in TABLES},
        "geo": export_geo(raw_dir, out, region_codes),
        **dims,
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    con.close()

    total = sum(sizes.values()) + (out / "meta.json").stat().st_size
    for name, size in sizes.items():
        print(f"{name + '.json':<28} {size / 1e3:>8,.0f} kB")
    print(f"{'total':<28} {total / 1e3:>8,.0f} kB -> {out}{'  (SYNTHETIC)' if synthetic else ''}")


if __name__ == "__main__":
    main()
