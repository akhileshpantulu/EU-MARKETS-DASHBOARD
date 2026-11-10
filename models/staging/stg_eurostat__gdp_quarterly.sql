-- Real GDP growth versus the same quarter of the previous year (%), '2025-Q3' -> 2025-07-01.
select
    geo as geo_code,
    make_date(cast(left(time, 4) as integer), cast(right(time, 1) as integer) * 3 - 2, 1) as quarter_start,
    value as gdp_growth_yoy_pct
from {{ source('raw', 'eurostat_namq_10_gdp') }}
where time similar to '[0-9]{4}-Q[1-4]' and value is not null
