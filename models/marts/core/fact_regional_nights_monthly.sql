-- Grain: NUTS 2 region x month (all guests, all tourist accommodation).
select geo_code, {{ month_key('month_start') }} as date_key, nights, flag
from {{ ref('stg_eurostat__regional_nights_monthly') }}
where month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('geo_code') }}
