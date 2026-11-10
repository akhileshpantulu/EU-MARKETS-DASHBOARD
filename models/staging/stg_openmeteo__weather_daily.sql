-- Daily weather per destination (Open-Meteo ERA5 reanalysis).
select
    location_code,
    cast(date as date) as weather_date,
    temperature_2m_mean as temp_mean_c,
    temperature_2m_max as temp_max_c,
    precipitation_sum as precipitation_mm,
    sunshine_duration / 3600.0 as sunshine_hours
from {{ source('raw', 'openmeteo_daily') }}
where date is not null
qualify row_number() over (partition by location_code, date order by date) = 1
