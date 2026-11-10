-- Nights spent at tourist accommodation by country, month, guest residence and accommodation type.
select
    geo as geo_code,
    {{ eurostat_month('time') }} as month_start,
    c_resid as residence_code,
    nace_r2 as nace_code,
    value as nights,
    flag
from {{ source('raw', 'eurostat_tour_occ_nim') }}
where unit = 'NR' and value is not null
