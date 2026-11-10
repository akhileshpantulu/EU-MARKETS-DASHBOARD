-- Drill-across of every monthly country fact. Grain: geo (country or EU aggregate) x month.
-- Rates are recomputed from the additive measures, so they hold at any level.
{% set base = var('baseline_year') %}
with accommodation as (
    select
        geo_code,
        date_key,
        sum(nights) filter (where nace_code = 'I551-I553' and residence_code = 'TOTAL') as nights,
        sum(nights) filter (where nace_code = 'I551-I553' and residence_code = 'DOM') as nights_domestic,
        sum(nights) filter (where nace_code = 'I551-I553' and residence_code = 'FOR') as nights_foreign,
        sum(nights) filter (where nace_code = 'I551' and residence_code = 'TOTAL') as hotel_nights,
        sum(arrivals) filter (where nace_code = 'I551-I553' and residence_code = 'TOTAL') as arrivals,
        sum(arrivals) filter (where nace_code = 'I551-I553' and residence_code = 'FOR') as arrivals_foreign
    from {{ ref('fact_accommodation_monthly') }}
    group by all
),

prices as (
    select
        geo_code,
        date_key,
        max(annual_rate_pct) filter (where coicop_key = 'ALL') as hicp_all_items_pct,
        max(annual_rate_pct) filter (where coicop_key = 'ACCOMMODATION') as hicp_accommodation_pct,
        max(annual_rate_pct) filter (where coicop_key = 'RESTAURANTS') as hicp_restaurants_pct
    from {{ ref('fact_consumer_prices_monthly') }}
    group by all
),

spine as (
    select g.geo_code, g.geo_name, g.geo_level, d.date_key, d.month_start, d.year, d.month
    from {{ ref('dim_geo') }} as g
    cross join {{ ref('dim_date') }} as d
    where g.geo_level in ('country', 'aggregate')
),

joined as (
    select
        s.*,
        a.nights, a.nights_domestic, a.nights_foreign, a.hotel_nights, a.arrivals, a.arrivals_foreign,
        o.bed_place_occupancy_rate, o.room_occupancy_rate,
        p.platform_nights,
        air.passengers as air_passengers,
        air.international_passengers as air_passengers_international,
        pr.hicp_all_items_pct, pr.hicp_accommodation_pct, pr.hicp_restaurants_pct,
        m.unemployment_rate_pct, m.consumer_confidence_balance, m.bond_yield_10y_pct,
        m.accommodation_turnover_index, m.food_service_turnover_index
    from spine as s
    left join accommodation as a using (geo_code, date_key)
    left join {{ ref('fact_hotel_occupancy_monthly') }} as o using (geo_code, date_key)
    left join {{ ref('fact_platform_nights_monthly') }} as p using (geo_code, date_key)
    left join {{ ref('fact_air_passengers_monthly') }} as air using (geo_code, date_key)
    left join prices as pr using (geo_code, date_key)
    left join {{ ref('fact_macro_monthly') }} as m using (geo_code, date_key)
),

with_comparisons as (
    select
        j.*,
        j.nights / nullif(j.arrivals, 0) as avg_length_of_stay,
        j.nights_foreign / nullif(j.nights, 0) as foreign_share,
        ly.nights as nights_prev_year,
        bl.nights as nights_baseline,
        ly.platform_nights as platform_nights_prev_year,
        ly.air_passengers as air_passengers_prev_year,
        ly.bed_place_occupancy_rate as bed_place_occupancy_rate_prev_year
    from joined as j
    left join joined as ly on ly.geo_code = j.geo_code and ly.date_key = j.date_key - 100
    left join joined as bl on bl.geo_code = j.geo_code and bl.year = {{ base }} and bl.month = j.month
)

select
    *,
    nights / nullif(nights_prev_year, 0) - 1 as nights_yoy,
    nights / nullif(nights_baseline, 0) - 1 as nights_vs_baseline,
    platform_nights / nullif(platform_nights_prev_year, 0) - 1 as platform_nights_yoy,
    air_passengers / nullif(air_passengers_prev_year, 0) - 1 as air_passengers_yoy,
    bed_place_occupancy_rate - bed_place_occupancy_rate_prev_year as bed_place_occupancy_change
from with_comparisons
where coalesce(
    nights, arrivals, bed_place_occupancy_rate, platform_nights, air_passengers, hicp_all_items_pct,
    unemployment_rate_pct, consumer_confidence_balance, bond_yield_10y_pct, accommodation_turnover_index
) is not null
