-- Grain: market x quarter.
select market_code, quarter_start, house_prices_yoy_pct
from {{ ref('stg_eurostat__house_prices_quarterly') }}
where market_code in (select market_code from {{ ref('dim_market') }})
