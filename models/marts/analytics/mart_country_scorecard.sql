-- One row per country / aggregate: the latest month each source has, with growth versus
-- the same month and the same year-to-date period a year earlier and in the baseline year.
{% set base = var('baseline_year') %}
with m as (select * from {{ ref('mart_country_monthly') }}),

latest as (
    select geo_code, max(date_key) filter (where nights is not null) as nights_date_key,
           max(date_key) filter (where air_passengers is not null) as air_date_key,
           max(date_key) filter (where platform_nights is not null) as platform_date_key,
           max(date_key) filter (where hicp_accommodation_pct is not null) as hicp_date_key,
           max(date_key) filter (where unemployment_rate_pct is not null) as unemployment_date_key,
           max(date_key) filter (where bed_place_occupancy_rate is not null) as occupancy_date_key
    from m group by geo_code
),

ytd as (
    select
        l.geo_code,
        sum(m.nights) filter (where m.year = l.nights_date_key // 100) as nights_ytd,
        sum(m.nights) filter (where m.year = l.nights_date_key // 100 - 1) as nights_ytd_prev_year,
        sum(m.nights) filter (where m.year = {{ base }}) as nights_ytd_baseline,
        count(m.nights) filter (where m.year = l.nights_date_key // 100 - 1) as months_prev_year,
        count(m.nights) filter (where m.year = l.nights_date_key // 100) as months_ytd
    from latest as l
    join m on m.geo_code = l.geo_code and m.month <= l.nights_date_key % 100
    group by l.geo_code
)

select
    g.geo_code, g.geo_name, g.geo_level, g.is_eu27, g.is_euro_area, g.region_group,
    l.nights_date_key,
    n.nights as latest_nights,
    n.nights_yoy as latest_nights_yoy,
    n.nights_vs_baseline as latest_nights_vs_baseline,
    n.foreign_share as latest_foreign_share,
    n.avg_length_of_stay as latest_avg_length_of_stay,
    y.nights_ytd,
    case when y.months_prev_year = y.months_ytd then y.nights_ytd / nullif(y.nights_ytd_prev_year, 0) - 1 end
        as nights_ytd_yoy,
    y.nights_ytd / nullif(y.nights_ytd_baseline, 0) - 1 as nights_ytd_vs_baseline,
    l.occupancy_date_key,
    o.bed_place_occupancy_rate as latest_bed_place_occupancy_rate,
    o.bed_place_occupancy_change as latest_bed_place_occupancy_change,
    l.platform_date_key,
    p.platform_nights as latest_platform_nights,
    p.platform_nights_yoy as latest_platform_nights_yoy,
    l.air_date_key,
    a.air_passengers as latest_air_passengers,
    a.air_passengers_yoy as latest_air_passengers_yoy,
    l.hicp_date_key,
    h.hicp_accommodation_pct as latest_hicp_accommodation_pct,
    h.hicp_all_items_pct as latest_hicp_all_items_pct,
    l.unemployment_date_key,
    u.unemployment_rate_pct as latest_unemployment_rate_pct
from {{ ref('dim_geo') }} as g
join latest as l using (geo_code)
left join ytd as y using (geo_code)
left join m as n on n.geo_code = l.geo_code and n.date_key = l.nights_date_key
left join m as o on o.geo_code = l.geo_code and o.date_key = l.occupancy_date_key
left join m as p on p.geo_code = l.geo_code and p.date_key = l.platform_date_key
left join m as a on a.geo_code = l.geo_code and a.date_key = l.air_date_key
left join m as h on h.geo_code = l.geo_code and h.date_key = l.hicp_date_key
left join m as u on u.geo_code = l.geo_code and u.date_key = l.unemployment_date_key
