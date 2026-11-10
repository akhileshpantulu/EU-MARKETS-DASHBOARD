-- Domestic + international passengers equal total passengers (avia_paoc), within 1 %.
{{ config(severity='error', warn_if='>0', error_if='>50') }}
select geo_code, date_key, passengers, domestic_passengers, international_passengers
from {{ ref('fact_air_passengers_monthly') }}
where domestic_passengers is not null and international_passengers is not null
  and abs(domestic_passengers + international_passengers - passengers) > 0.01 * passengers + 5
