-- Destinations with weather data. Linked to their NUTS 2 region and country.
select location_code, location_name, country_code, nuts2_code, latitude, longitude
from {{ ref('weather_location') }}
