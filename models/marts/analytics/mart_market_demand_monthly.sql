-- Grain: source market x month. OECD and Eurostat demand indicators with the EC
-- consumer confidence and unemployment already in the warehouse, plus year-on-year changes.
with m as (
    select
        f.market_code, f.date_key, d.month_start, d.year, d.month,
        f.oecd_cli, f.oecd_consumer_confidence, f.retail_volume_index,
        mac.consumer_confidence_balance as ec_consumer_confidence_balance,
        mac.unemployment_rate_pct
    from {{ ref('fact_market_demand_monthly') }} as f
    join {{ ref('dim_date') }} as d using (date_key)
    left join {{ ref('fact_macro_monthly') }} as mac on mac.geo_code = f.market_code and mac.date_key = f.date_key
)

select
    m.*,
    m.retail_volume_index / nullif(ly.retail_volume_index, 0) - 1 as retail_volume_yoy,
    m.oecd_cli - ly.oecd_cli as oecd_cli_change_yoy,
    m.oecd_cli - q.oecd_cli as oecd_cli_change_3m,
    m.oecd_consumer_confidence - ly.oecd_consumer_confidence as oecd_consumer_confidence_change_yoy
from m
left join m as ly on ly.market_code = m.market_code and ly.date_key = m.date_key - 100
left join m as q on q.market_code = m.market_code
    and q.month_start = cast(m.month_start - interval 3 month as date)
