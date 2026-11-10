select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    value as consumer_confidence_balance
from {{ source('raw', 'eurostat_ei_bsco_m') }}
where coalesce(indic, 'BS-CSMCI') = 'BS-CSMCI' and coalesce(s_adj, 'SA') = 'SA'
  and coalesce(unit, 'BAL') = 'BAL' and value is not null
