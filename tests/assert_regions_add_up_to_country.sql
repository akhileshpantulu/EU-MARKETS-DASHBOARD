-- NUTS 2 nights add up to the national total for the same year (all published regions),
-- within 3 %. Countries with confidential regions fall short, so this one only warns.
{{ config(severity='warn') }}
with regions as (
    select left(geo_code, 2) as country_code, year, sum(nights) as region_nights, count(*) as n_regions
    from {{ ref('fact_regional_nights_annual') }}
    where residence_code = 'TOTAL'
    group by all
),
national as (
    select geo_code as country_code, year, nights
    from {{ ref('mart_country_annual') }}
    where is_complete_year
)
select r.*, n.nights as national_nights
from regions as r
join national as n using (country_code, year)
where abs(r.region_nights - n.nights) > 0.03 * n.nights
