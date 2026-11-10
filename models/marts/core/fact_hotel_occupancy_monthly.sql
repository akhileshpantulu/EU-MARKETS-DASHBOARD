-- Grain: geo x month. Net occupancy of hotels (NACE I551), as 0-1 shares.
select
    geo_code,
    {{ month_key('month_start') }} as date_key,
    bed_place_occupancy_rate,
    room_occupancy_rate
from {{ ref('stg_eurostat__hotel_occupancy_monthly') }}
where month_start >= date '{{ var("first_month") }}' and {{ in_dim_geo('geo_code') }}
