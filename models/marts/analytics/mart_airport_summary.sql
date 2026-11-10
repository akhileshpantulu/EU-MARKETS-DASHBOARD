-- One row per airport with traffic: latest month, trailing twelve months, growth on a
-- year earlier and on the baseline year, and the coverage of its route data.
{% set base = var('baseline_year') %}
with m as (
    select f.airport_code, f.date_key, d.month_start, d.year, d.month, f.passengers
    from {{ ref('fact_airport_passengers_monthly') }} as f
    join {{ ref('dim_date') }} as d using (date_key)
),

latest as (select airport_code, max(month_start) as last_month from m group by airport_code),

windows as (
    select
        l.airport_code,
        l.last_month,
        sum(m.passengers) filter (where m.month_start > l.last_month - interval 12 month) as passengers_12m,
        count(*) filter (where m.month_start > l.last_month - interval 12 month) as months_12m,
        sum(m.passengers) filter (where m.month_start > l.last_month - interval 24 month
                                    and m.month_start <= l.last_month - interval 12 month) as passengers_prev_12m,
        count(*) filter (where m.month_start > l.last_month - interval 24 month
                           and m.month_start <= l.last_month - interval 12 month) as months_prev_12m,
        sum(m.passengers) filter (where m.year = {{ base }}) as passengers_baseline_year,
        count(*) filter (where m.year = {{ base }}) as months_baseline_year,
        max(m.passengers) filter (where m.month_start = l.last_month) as passengers_last_month,
        max(m.passengers) filter (where m.month_start = l.last_month - interval 12 month) as passengers_last_month_prev_year
    from latest as l
    join m using (airport_code)
    group by all
),

routes as (
    select airport_code, count(distinct partner_airport_code) as route_count,
           max(date_key) as routes_last_key
    from {{ ref('fact_route_passengers_monthly') }}
    group by airport_code
)

select
    a.airport_code, a.iata_code, a.airport_name, a.city, a.country_code, a.country_name,
    a.latitude, a.longitude, a.is_curated,
    w.last_month,
    w.passengers_last_month,
    w.passengers_last_month / nullif(w.passengers_last_month_prev_year, 0) - 1 as last_month_yoy,
    case when w.months_12m = 12 then w.passengers_12m end as passengers_12m,
    case when w.months_12m = 12 and w.months_prev_12m = 12
         then w.passengers_12m / nullif(w.passengers_prev_12m, 0) - 1 end as passengers_12m_yoy,
    case when w.months_12m = 12 and w.months_baseline_year = 12
         then w.passengers_12m / nullif(w.passengers_baseline_year, 0) - 1 end as passengers_12m_vs_baseline,
    r.route_count,
    r.routes_last_key
from {{ ref('dim_airport') }} as a
join windows as w using (airport_code)
left join routes as r using (airport_code)
