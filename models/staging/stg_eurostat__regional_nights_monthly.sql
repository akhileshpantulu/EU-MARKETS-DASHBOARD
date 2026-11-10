-- Nights by NUTS 2 region and calendar month (published once a year, from 2020).
select
    geo as geo_code,
    {{ eurostat_month('time', 'month') }} as month_start,
    value as nights,
    flag
from {{ source('raw', 'eurostat_tour_occ_nin2m') }}
where coalesce(unit, 'NR') = 'NR'
  and coalesce(c_resid, 'TOTAL') = 'TOTAL'
  and coalesce(nace_r2, 'I551-I553') = 'I551-I553'
  and coalesce(month, '') <> 'TOTAL'
  and {{ is_nuts2('geo') }}
  and value is not null
