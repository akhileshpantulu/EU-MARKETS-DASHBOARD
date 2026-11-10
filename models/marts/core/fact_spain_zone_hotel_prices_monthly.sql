-- Grain: Spanish tourist zone x month. ADR and RevPAR (INE IRSH); their ratio is room occupancy.
select
    md5(zone_label) as zone_key,
    {{ month_key('month_start') }} as date_key,
    adr_eur,
    revpar_eur,
    revpar_eur / nullif(adr_eur, 0) as implied_room_occupancy_rate,
    is_provisional
from {{ ref('stg_ine__zone_hotel_prices') }}
where month_start >= date '{{ var("first_month") }}'
