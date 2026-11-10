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

TABLES = {
    "country_monthly": f"""
        select geo_code, {MONTH}, nights, nights_domestic, nights_foreign, hotel_nights, arrivals,
               avg_length_of_stay, foreign_share, nights_yoy, nights_vs_baseline,
               bed_place_occupancy_rate, room_occupancy_rate, bed_place_occupancy_change,
               platform_nights, platform_nights_yoy, air_passengers, air_passengers_international,
               air_passengers_yoy, hicp_all_items_pct, hicp_accommodation_pct, hicp_restaurants_pct,
               unemployment_rate_pct, consumer_confidence_balance, bond_yield_10y_pct,
               accommodation_turnover_index, food_service_turnover_index
        from analytics.mart_country_monthly order by geo_code, month_start""",
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
    "airports_monthly": """
        select f.airport_code, strftime(d.month_start, '%Y-%m') as month, f.passengers
        from core.fact_airport_passengers_monthly as f join core.dim_date as d using (date_key)
        order by 1, 2""",
    "fx_daily": """
        select currency_code, strftime(rate_date, '%Y-%m-%d') as date, units_per_eur
        from core.fact_fx_rates
        where frequency = 'daily' and rate_date >= current_date - interval 3 year
        order by 1, 2""",
    "fx_monthly": """
        select currency_code, strftime(rate_date, '%Y-%m') as month, units_per_eur
        from core.fact_fx_rates where frequency = 'monthly' order by 1, 2""",
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
    "airports": "select * from core.dim_airport order by airport_code",
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
