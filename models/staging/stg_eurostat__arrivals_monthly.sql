-- Arrivals (guests checking in) at tourist accommodation by country, month, residence and type.
select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    c_resid as residence_code,
    nace_r2 as nace_code,
    value as arrivals,
    flag
from {{ source('raw', 'eurostat_tour_occ_arm') }}
where unit = 'NR' and value is not null
