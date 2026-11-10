-- Nights spent in each destination country by the guest's country (or world region) of residence.
select
    geo as geo_code,
    cast(time as integer) as year,
    c_resid as partner_code,
    value as nights,
    flag
from {{ source('raw', 'eurostat_tour_occ_ninraw') }}
where unit = 'NR' and coalesce(nace_r2, 'I551-I553') = 'I551-I553' and value is not null
