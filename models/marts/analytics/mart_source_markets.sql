-- Grain: destination x source market (guest country of residence) x year.
-- Share is of nights by foreign guests: the destination's own residents are excluded.
{% set base = var('baseline_year') %}
with f as (
    select f.*, p.is_country, p.partner_name
    from {{ ref('fact_source_market_nights_annual') }} as f
    join {{ ref('dim_partner') }} as p using (partner_code)
),

totals as (
    select
        geo_code,
        year,
        coalesce(max(nights) filter (where partner_code = 'FOR'),
                 max(nights) filter (where partner_code = 'TOTAL') - max(nights) filter (where partner_code = geo_code))
            as foreign_nights
    from f
    group by all
),

markets as (
    select f.geo_code, f.partner_code, f.partner_name, f.year, f.nights
    from f
    where f.is_country and f.partner_code <> f.geo_code
)

select
    m.geo_code,
    m.partner_code,
    m.partner_name,
    m.year,
    m.nights,
    m.nights / nullif(t.foreign_nights, 0) as share_of_foreign_nights,
    m.nights / nullif(ly.nights, 0) - 1 as nights_yoy,
    m.nights / nullif(bl.nights, 0) - 1 as nights_vs_baseline,
    row_number() over (partition by m.geo_code, m.year order by m.nights desc) as market_rank
from markets as m
left join totals as t using (geo_code, year)
left join markets as ly on ly.geo_code = m.geo_code and ly.partner_code = m.partner_code and ly.year = m.year - 1
left join markets as bl on bl.geo_code = m.geo_code and bl.partner_code = m.partner_code and bl.year = {{ base }}
