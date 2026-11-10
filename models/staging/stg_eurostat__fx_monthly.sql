-- Monthly average units of foreign currency per euro.
select
    currency as currency_code,
    {{ eurostat_month('time') }} as month_start,
    value as units_per_eur
from {{ source('raw', 'eurostat_ert_bil_eur_m') }}
where coalesce(statinfo, 'AVG') = 'AVG' and coalesce(unit, 'NAC') = 'NAC' and value is not null
