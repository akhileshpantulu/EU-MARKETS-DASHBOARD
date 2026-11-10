-- Grain: source market x month. Indicators of household demand in the countries guests come from.
with keys as (
    select market_code, month_start from {{ ref('stg_oecd__indicators_monthly') }}
    union select market_code, month_start from {{ ref('stg_eurostat__retail_volume_monthly') }}
)

select
    k.market_code,
    {{ month_key('k.month_start') }} as date_key,
    o.oecd_cli,
    o.oecd_consumer_confidence,
    r.retail_volume_index
from keys as k
left join {{ ref('stg_oecd__indicators_monthly') }} as o using (market_code, month_start)
left join {{ ref('stg_eurostat__retail_volume_monthly') }} as r using (market_code, month_start)
where k.month_start >= date '{{ var("first_month") }}'
  and k.month_start <= (select max(month_start) from {{ ref('dim_date') }})
  and k.market_code in (select market_code from {{ ref('dim_market') }})
