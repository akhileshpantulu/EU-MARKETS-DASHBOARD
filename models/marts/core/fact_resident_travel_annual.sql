-- Grain: market (country of residence) x year. Trips and spending abroad and at home.
select market_code, year, trips_abroad, trips_domestic, spend_abroad_eur,
       spend_per_trip_abroad_eur, spend_per_night_abroad_eur
from {{ ref('stg_eurostat__resident_travel_annual') }}
where market_code in (select market_code from {{ ref('dim_market') }})
