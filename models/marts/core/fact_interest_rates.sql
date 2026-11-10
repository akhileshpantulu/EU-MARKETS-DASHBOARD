-- Grain: series x date. ECB policy and market rates (percent).
select series_code, rate_date, rate_pct
from {{ ref('stg_ecb__interest_rates') }}
where rate_date is not null
