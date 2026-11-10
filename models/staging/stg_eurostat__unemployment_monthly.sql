select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    value as unemployment_rate_pct
from {{ source('raw', 'eurostat_une_rt_m') }}
where coalesce(s_adj, 'SA') = 'SA' and coalesce(age, 'TOTAL') = 'TOTAL'
  and coalesce(sex, 'T') = 'T' and coalesce(unit, 'PC_ACT') = 'PC_ACT'
  and value is not null
