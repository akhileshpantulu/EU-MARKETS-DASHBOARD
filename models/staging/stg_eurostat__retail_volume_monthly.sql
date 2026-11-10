-- Retail trade volume index (2021 = 100), seasonally and calendar adjusted.
select
    geo as market_code,
    {{ eurostat_month('time') }} as month_start,
    value as retail_volume_index
from {{ source('raw', 'eurostat_sts_trtu_m') }}
where coalesce(indic_bt, 'VOL_SLS') = 'VOL_SLS' and coalesce(nace_r2, 'G47') = 'G47'
  and coalesce(s_adj, 'SCA') = 'SCA' and coalesce(unit, 'I21') = 'I21' and value is not null
