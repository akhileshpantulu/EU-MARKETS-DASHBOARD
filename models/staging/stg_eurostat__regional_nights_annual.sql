-- Nights by NUTS 2 region, year and guest residence (all tourist accommodation).
select
    geo as geo_code,
    cast(time as integer) as year,
    c_resid as residence_code,
    value as nights,
    flag
from {{ source('raw', 'eurostat_tour_occ_nin2') }}
where unit = 'NR'
  and coalesce(nace_r2, 'I551-I553') = 'I551-I553'
  and {{ is_nuts2('geo') }}
  and value is not null
