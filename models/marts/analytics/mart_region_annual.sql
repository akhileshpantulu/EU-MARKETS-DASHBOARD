-- Grain: NUTS 2 region x year. Volume, growth, foreign share, seasonality and the
-- share of short-stay rentals booked through platforms.
{% set base = var('baseline_year') %}
with annual as (
    select
        geo_code,
        year,
        max(nights) filter (where residence_code = 'TOTAL') as nights,
        max(nights) filter (where residence_code = 'FOR') as nights_foreign
    from {{ ref('fact_regional_nights_annual') }}
    group by all
),

monthly as (
    select r.geo_code, d.year, d.month, r.nights,
           row_number() over (partition by r.geo_code, d.year order by r.nights desc) as rank_in_year
    from {{ ref('fact_regional_nights_monthly') }} as r
    join {{ ref('dim_date') }} as d using (date_key)
),

seasonality as (
    select
        geo_code,
        year,
        count(*) as months_reported,
        sum(nights) as nights_monthly_total,
        sum(nights) filter (where rank_in_year <= 2) / nullif(sum(nights), 0) as peak_two_month_share,
        sum(nights) filter (where month between 6 and 9) / nullif(sum(nights), 0) as high_season_share,
        arg_max(month, nights) as peak_month
    from monthly
    group by all
    having count(*) = 12
),

platform as (
    select p.geo_code, d.year, sum(p.platform_nights) as platform_nights, count(*) as months_reported
    from {{ ref('fact_platform_nights_monthly') }} as p
    join {{ ref('dim_date') }} as d using (date_key)
    group by all
    having count(*) = 12
),

keys as (
    select geo_code, year from annual
    union select geo_code, year from seasonality
    union select geo_code, year from platform
),

combined as (
    select
        k.geo_code,
        g.geo_name,
        g.country_code,
        g.country_name,
        k.year,
        coalesce(a.nights, s.nights_monthly_total) as nights,
        a.nights_foreign,
        a.nights_foreign / nullif(a.nights, 0) as foreign_share,
        s.peak_two_month_share,
        s.high_season_share,
        s.peak_month,
        pl.platform_nights,
        pl.platform_nights / nullif(pl.platform_nights + coalesce(a.nights, s.nights_monthly_total), 0)
            as platform_share
    from keys as k
    join {{ ref('dim_geo') }} as g on g.geo_code = k.geo_code and g.geo_level = 'nuts2'
    left join annual as a on a.geo_code = k.geo_code and a.year = k.year
    left join seasonality as s on s.geo_code = k.geo_code and s.year = k.year
    left join platform as pl on pl.geo_code = k.geo_code and pl.year = k.year
)

select
    c.*,
    c.nights / nullif(ly.nights, 0) - 1 as nights_yoy,
    c.nights / nullif(bl.nights, 0) - 1 as nights_vs_baseline,
    c.platform_nights / nullif(ly.platform_nights, 0) - 1 as platform_nights_yoy,
    c.nights / nullif(sum(c.nights) over (partition by c.country_code, c.year), 0) as share_of_country_nights
from combined as c
left join combined as ly on ly.geo_code = c.geo_code and ly.year = c.year - 1
left join combined as bl on bl.geo_code = c.geo_code and bl.year = {{ base }}
