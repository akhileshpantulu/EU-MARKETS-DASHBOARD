-- Accommodation supply: establishments, bedrooms and bed-places by country, year and type.
select
    geo as geo_code,
    cast(time as integer) as year,
    nace_r2 as nace_code,
    max(value) filter (where accomunit = 'ESTBL') as establishments,
    max(value) filter (where accomunit = 'BEDRM') as bedrooms,
    max(value) filter (where accomunit = 'BEDPL') as bed_places
from {{ source('raw', 'eurostat_tour_cap_nat') }}
where unit = 'NR' and value is not null
group by all
