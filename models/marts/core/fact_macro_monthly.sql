-- Grain: geo x month. Monthly macro backdrop for travel demand (drill-across of five sources).
with keys as (
    select geo_code, month_start from {{ ref('stg_eurostat__unemployment_monthly') }}
    union select geo_code, month_start from {{ ref('stg_eurostat__consumer_confidence_monthly') }}
    union select geo_code, month_start from {{ ref('stg_eurostat__bond_yield_monthly') }}
    union select geo_code, month_start from {{ ref('stg_eurostat__services_turnover_monthly') }}
),

turnover as (
    select
        geo_code,
        month_start,
        max(turnover_index) filter (where nace_code = 'I55') as accommodation_turnover_index,
        max(turnover_index) filter (where nace_code = 'I56') as food_service_turnover_index
    from {{ ref('stg_eurostat__services_turnover_monthly') }}
    group by all
)

select
    k.geo_code,
    {{ month_key('k.month_start') }} as date_key,
    u.unemployment_rate_pct,
    c.consumer_confidence_balance,
    b.bond_yield_10y_pct,
    t.accommodation_turnover_index,
    t.food_service_turnover_index
from keys as k
left join {{ ref('stg_eurostat__unemployment_monthly') }} as u using (geo_code, month_start)
left join {{ ref('stg_eurostat__consumer_confidence_monthly') }} as c using (geo_code, month_start)
left join {{ ref('stg_eurostat__bond_yield_monthly') }} as b using (geo_code, month_start)
left join turnover as t using (geo_code, month_start)
where k.month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('k.geo_code') }}
