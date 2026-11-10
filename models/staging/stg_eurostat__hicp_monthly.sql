-- HICP annual rate of change (%) for all items, restaurants and accommodation services.
-- ECOICOP ver. 2 (coicop18) and ver. 1 (coicop) codes are mapped to one key.
with source as (
    select
        geo,
        time,
        coalesce(coicop18, coicop) as source_code,
        value
    from {{ source('raw', 'eurostat_hicp') }}
    where coalesce(unit, 'RCH_A') = 'RCH_A' and value is not null
)

select
    source.geo as geo_code,
    {{ eurostat_month('source.time') }} as month_start,
    map.coicop_key,
    source.value as annual_rate_pct
from source
inner join {{ ref('coicop_map') }} as map on map.source_code = source.source_code
