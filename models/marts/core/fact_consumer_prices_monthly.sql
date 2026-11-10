-- Grain: geo x month x COICOP group. HICP annual rate of change.
select geo_code, {{ month_key('month_start') }} as date_key, coicop_key, annual_rate_pct
from {{ ref('stg_eurostat__hicp_monthly') }}
where month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('geo_code') }}
