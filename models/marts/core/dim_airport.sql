-- Every airport seen in airport traffic or route data. Curated airports (seed) add
-- IATA codes, city names and coordinates for the map; the rest use Eurostat's name.
with codes as (
    select airport_code from {{ ref('stg_eurostat__airport_passengers_monthly') }}
    union select airport_code from {{ ref('stg_eurostat__route_passengers_monthly') }}
    union select partner_airport_code from {{ ref('stg_eurostat__route_passengers_monthly') }}
    union select airport_code from {{ ref('airport') }}
)

select
    c.airport_code,
    s.iata_code,
    coalesce(s.airport_name, n.airport_name, c.airport_code) as airport_name,
    coalesce(s.city, n.airport_name) as city,
    left(c.airport_code, 2) as country_code,
    coalesce(country.country_name, mk.market_name, left(c.airport_code, 2)) as country_name,
    s.latitude,
    s.longitude,
    s.airport_code is not null as is_curated,
    c.airport_code in (select airport_code from {{ ref('stg_eurostat__airport_passengers_monthly') }}) as reports_traffic
from codes as c
left join {{ ref('airport') }} as s on s.airport_code = c.airport_code
left join {{ ref('stg_eurostat__airport_names') }} as n on n.airport_code = c.airport_code
left join {{ ref('country') }} as country on country.geo_code = left(c.airport_code, 2)
left join {{ ref('oecd_area') }} as mk on mk.market_code = left(c.airport_code, 2)
where c.airport_code similar to '[A-Z]{2}_[A-Z0-9]{4}'
