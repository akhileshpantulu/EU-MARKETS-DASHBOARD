-- Grain: NUTS 2 region x month. Conventional accommodation and platform nights side by side.
with keys as (
    select geo_code, date_key from {{ ref('fact_regional_nights_monthly') }}
    union select geo_code, date_key from {{ ref('fact_platform_nights_monthly') }}
)

select
    k.geo_code,
    g.country_code,
    k.date_key,
    d.month_start,
    d.year,
    d.month,
    r.nights,
    p.platform_nights
from keys as k
join {{ ref('dim_geo') }} as g on g.geo_code = k.geo_code and g.geo_level = 'nuts2'
join {{ ref('dim_date') }} as d on d.date_key = k.date_key
left join {{ ref('fact_regional_nights_monthly') }} as r on r.geo_code = k.geo_code and r.date_key = k.date_key
left join {{ ref('fact_platform_nights_monthly') }} as p on p.geo_code = k.geo_code and p.date_key = k.date_key
