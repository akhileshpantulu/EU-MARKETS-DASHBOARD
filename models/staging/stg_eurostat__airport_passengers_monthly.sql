-- Air passengers carried by main airport and month.
select
    rep_airp as airport_code,
    {{ eurostat_month('time') }} as month_start,
    max(value) as passengers
from {{ source('raw', 'eurostat_avia_paoa') }}
where coalesce(tra_meas, 'PAS_CRD') = 'PAS_CRD'
  and coalesce(schedule, 'TOTAL') = 'TOTAL'
  and coalesce(tra_cov, 'TOTAL') = 'TOTAL'
  and value is not null
group by all
