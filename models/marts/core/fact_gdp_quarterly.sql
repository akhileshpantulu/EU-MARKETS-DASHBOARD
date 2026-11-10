-- Grain: geo x quarter.
select geo_code, quarter_start, gdp_growth_yoy_pct
from {{ ref('stg_eurostat__gdp_quarterly') }}
where {{ in_dim_geo('geo_code') }}
