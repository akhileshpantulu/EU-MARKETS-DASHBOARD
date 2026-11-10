-- Grain: reporting country x month.
select
    geo_code,
    {{ month_key('month_start') }} as date_key,
    passengers,
    domestic_passengers,
    international_passengers
from {{ ref('stg_eurostat__air_passengers_monthly') }}
where month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('geo_code') }}
