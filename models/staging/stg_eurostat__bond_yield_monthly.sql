select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    value as bond_yield_10y_pct
from {{ source('raw', 'eurostat_irt_lt_mcby_m') }}
where coalesce(int_rt, 'MCBY') = 'MCBY' and value is not null
