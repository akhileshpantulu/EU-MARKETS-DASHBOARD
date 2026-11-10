-- Grain: geo (EU27, country or NUTS 2) x month. Short-stay rental nights booked via platforms.
select geo_code, {{ month_key('month_start') }} as date_key, platform_nights, flag
from {{ ref('stg_eurostat__platform_nights_monthly') }}
where month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('geo_code') }}
