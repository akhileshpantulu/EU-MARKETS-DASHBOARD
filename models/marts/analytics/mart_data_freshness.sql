-- One row per source: download status from the manifest plus the latest period the
-- warehouse actually holds for it.
with periods as (
    select 'eurostat.tour_occ_nim' as source_key, max(date_key)::varchar as latest_period from {{ ref('fact_accommodation_monthly') }} where nights is not null
    union all select 'eurostat.tour_occ_arm', max(date_key)::varchar from {{ ref('fact_accommodation_monthly') }} where arrivals is not null
    union all select 'eurostat.tour_occ_mnor', max(date_key)::varchar from {{ ref('fact_hotel_occupancy_monthly') }}
    union all select 'eurostat.tour_cap_nat', max(year)::varchar from {{ ref('fact_accommodation_capacity_annual') }}
    union all select 'eurostat.tour_occ_ninraw', max(year)::varchar from {{ ref('fact_source_market_nights_annual') }}
    union all select 'eurostat.tour_occ_nin2', max(year)::varchar from {{ ref('fact_regional_nights_annual') }}
    union all select 'eurostat.tour_occ_nin2m', max(date_key)::varchar from {{ ref('fact_regional_nights_monthly') }}
    union all select 'eurostat.tour_ce_omn12', max(date_key)::varchar from {{ ref('fact_platform_nights_monthly') }}
    union all select 'eurostat.avia_paoc', max(date_key)::varchar from {{ ref('fact_air_passengers_monthly') }}
    union all select 'eurostat.avia_paoa', max(date_key)::varchar from {{ ref('fact_airport_passengers_monthly') }}
    union all select 'eurostat.hicp', max(date_key)::varchar from {{ ref('fact_consumer_prices_monthly') }}
    union all select 'eurostat.sts_setu_m', max(date_key)::varchar from {{ ref('fact_macro_monthly') }} where accommodation_turnover_index is not null
    union all select 'eurostat.une_rt_m', max(date_key)::varchar from {{ ref('fact_macro_monthly') }} where unemployment_rate_pct is not null
    union all select 'eurostat.ei_bsco_m', max(date_key)::varchar from {{ ref('fact_macro_monthly') }} where consumer_confidence_balance is not null
    union all select 'eurostat.irt_lt_mcby_m', max(date_key)::varchar from {{ ref('fact_macro_monthly') }} where bond_yield_10y_pct is not null
    union all select 'eurostat.namq_10_gdp', strftime(max(quarter_start), '%Y-%m') from {{ ref('fact_gdp_quarterly') }}
    union all select 'eurostat.ert_bil_eur_m', strftime(max(rate_date), '%Y-%m') from {{ ref('fact_fx_rates') }} where frequency = 'monthly'
    union all select 'eurostat.demo_gind', max(year)::varchar from {{ ref('fact_population_annual') }}
    union all select 'ecb.fx_daily', strftime(max(rate_date), '%Y-%m-%d') from {{ ref('fact_fx_rates') }} where frequency = 'daily'
    union all select 'ecb.' || series_code, strftime(max(rate_date), '%Y-%m-%d') from {{ ref('fact_interest_rates') }} group by series_code
    union all select 'ine.irsh_zone_adr', max(date_key)::varchar from {{ ref('fact_spain_zone_hotel_prices_monthly') }} where adr_eur is not null
    union all select 'ine.irsh_zone_revpar', max(date_key)::varchar from {{ ref('fact_spain_zone_hotel_prices_monthly') }} where revpar_eur is not null
    union all select 'eurostat.avia_par', max(date_key)::varchar from {{ ref('fact_route_passengers_monthly') }}
    union all select 'eurostat.sts_trtu_m', max(date_key)::varchar from {{ ref('fact_market_demand_monthly') }} where retail_volume_index is not null
    union all select 'oecd.oecd_cli', max(date_key)::varchar from {{ ref('fact_market_demand_monthly') }} where oecd_cli is not null
    union all select 'oecd.oecd_cci', max(date_key)::varchar from {{ ref('fact_market_demand_monthly') }} where oecd_consumer_confidence is not null
    union all select 'eurostat.prc_hpi_q', strftime(max(quarter_start), '%Y-%m') from {{ ref('fact_house_prices_quarterly') }}
    union all select 'eurostat.tour_dem_tttot', max(year)::varchar from {{ ref('fact_resident_travel_annual') }} where trips_abroad is not null
    union all select 'eurostat.tour_dem_extot', max(year)::varchar from {{ ref('fact_resident_travel_annual') }} where spend_abroad_eur is not null
    union all select 'openmeteo.weather', max(date_key)::varchar from {{ ref('fact_weather_monthly') }}
    union all select 'inept.lodging_income', max(date_key)::varchar from {{ ref('fact_portugal_accommodation_monthly') }} where lodging_income_eur is not null
    union all select 'inept.nights', max(date_key)::varchar from {{ ref('fact_portugal_accommodation_monthly') }} where nights is not null
)

select
    coalesce(s.source_key, p.source_key) as source_key,
    s.publisher,
    s.dataset_code,
    s.description,
    coalesce(s.status, 'missing') as status,
    s.source_updated,
    s.fetched_at,
    s.url,
    s.error,
    case when length(p.latest_period) = 6
         then substr(p.latest_period, 1, 4) || '-' || substr(p.latest_period, 5, 2)
         else p.latest_period end as latest_period
from {{ ref('stg_meta__sources') }} as s
full outer join periods as p using (source_key)
where coalesce(s.publisher, '') <> 'gisco'
