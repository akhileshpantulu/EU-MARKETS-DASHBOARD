select
    a.airport_code,
    a.iata_code,
    a.airport_name,
    a.city,
    a.country_code,
    c.country_name,
    a.latitude,
    a.longitude
from {{ ref('airport') }} as a
left join {{ ref('country') }} as c on c.geo_code = a.country_code
