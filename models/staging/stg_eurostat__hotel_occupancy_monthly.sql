-- Net occupancy of bed-places and bedrooms in hotels (NACE I551), as a 0-1 share.
-- If Eurostat ever publishes more than one unit, prefer the plain percentage.
with ranked as (
    select
        geo as geo_code,
        {{ eurostat_month('time') }} as month_start,
        accomunit,
        value / 100.0 as rate
    from {{ source('raw', 'eurostat_tour_occ_mnor') }}
    where value between 0 and 100 and accomunit in ('BEDPL', 'BEDRM')
    qualify row_number() over (
        partition by geo, time, accomunit order by coalesce(unit, '') = 'PC' desc, unit
    ) = 1
)

select
    geo_code,
    month_start,
    max(rate) filter (where accomunit = 'BEDPL') as bed_place_occupancy_rate,
    max(rate) filter (where accomunit = 'BEDRM') as room_occupancy_rate
from ranked
group by geo_code, month_start
