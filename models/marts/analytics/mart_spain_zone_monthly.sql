-- Grain: Spanish tourist zone x month. Hotel ADR, RevPAR and implied occupancy with
-- growth on the same month a year earlier.
with f as (
    select z.zone_label, z.zone_name, z.region_name, d.year, d.month, d.month_start, f.*
    from {{ ref('fact_spain_zone_hotel_prices_monthly') }} as f
    join {{ ref('dim_spain_zone') }} as z using (zone_key)
    join {{ ref('dim_date') }} as d using (date_key)
)

select
    f.zone_key, f.zone_label, f.zone_name, f.region_name, f.date_key, f.month_start, f.year, f.month,
    f.adr_eur, f.revpar_eur, f.implied_room_occupancy_rate, f.is_provisional,
    f.adr_eur / nullif(ly.adr_eur, 0) - 1 as adr_yoy,
    f.revpar_eur / nullif(ly.revpar_eur, 0) - 1 as revpar_yoy
from f
left join f as ly on ly.zone_key = f.zone_key and ly.date_key = f.date_key - 100
