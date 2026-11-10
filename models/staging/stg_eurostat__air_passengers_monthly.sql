-- Air passengers carried (arrivals + departures) by reporting country, split by flight scope.
select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    max(value) filter (where coalesce(tra_cov, 'TOTAL') = 'TOTAL') as passengers,
    max(value) filter (where tra_cov = 'NAT') as domestic_passengers,
    max(value) filter (where tra_cov = 'INTL') as international_passengers
from {{ source('raw', 'eurostat_avia_paoc') }}
where coalesce(tra_meas, 'PAS_CRD') = 'PAS_CRD'
  and coalesce(schedule, 'TOTAL') = 'TOTAL'
  and value is not null
group by all
