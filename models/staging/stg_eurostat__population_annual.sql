select
    geo as geo_code,
    cast(time as integer) as year,
    value as population
from {{ source('raw', 'eurostat_demo_gind') }}
where coalesce(indic_de, 'JAN') = 'JAN' and value is not null
