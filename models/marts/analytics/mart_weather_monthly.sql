-- Grain: destination x month. Weather with the same-month normal over every
-- complete year in the archive (from 2016), and the anomaly against it.
with f as (
    select f.*, d.year, d.month, d.month_start
    from {{ ref('fact_weather_monthly') }} as f
    join {{ ref('dim_date') }} as d using (date_key)
),

normals as (
    select
        location_code,
        month,
        count(*) as normal_years,
        avg(avg_temp_c) as normal_temp_c,
        avg(avg_max_temp_c) as normal_max_temp_c,
        avg(precipitation_mm) as normal_precipitation_mm,
        avg(rainy_days) as normal_rainy_days,
        avg(sunshine_hours) as normal_sunshine_hours
    from f
    where year < year(current_date)
    group by all
)

select
    f.location_code,
    l.location_name,
    l.country_code,
    l.nuts2_code,
    f.date_key,
    f.month_start,
    f.year,
    f.month,
    f.avg_temp_c,
    f.avg_max_temp_c,
    f.precipitation_mm,
    f.rainy_days,
    f.sunshine_hours,
    n.normal_years,
    n.normal_temp_c,
    n.normal_max_temp_c,
    n.normal_precipitation_mm,
    n.normal_rainy_days,
    n.normal_sunshine_hours,
    case when n.normal_years >= 3 then f.avg_temp_c - n.normal_temp_c end as temp_anomaly_c,
    case when n.normal_years >= 3 then f.sunshine_hours - n.normal_sunshine_hours end as sunshine_anomaly_hours,
    case when n.normal_years >= 3 then f.precipitation_mm / nullif(n.normal_precipitation_mm, 0) end as precipitation_vs_normal
from f
join {{ ref('dim_weather_location') }} as l using (location_code)
left join normals as n on n.location_code = f.location_code and n.month = f.month
