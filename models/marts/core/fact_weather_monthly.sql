-- Grain: destination x month. Only months with at least 25 observed days are kept.
select
    location_code,
    {{ month_key("date_trunc('month', weather_date)") }} as date_key,
    count(*) as days_observed,
    avg(temp_mean_c) as avg_temp_c,
    avg(temp_max_c) as avg_max_temp_c,
    sum(precipitation_mm) as precipitation_mm,
    count(*) filter (where precipitation_mm >= 1) as rainy_days,
    sum(sunshine_hours) as sunshine_hours
from {{ ref('stg_openmeteo__weather_daily') }}
where weather_date >= date '{{ var("first_month") }}'
  and location_code in (select location_code from {{ ref('dim_weather_location') }})
group by all
having count(*) >= 25
