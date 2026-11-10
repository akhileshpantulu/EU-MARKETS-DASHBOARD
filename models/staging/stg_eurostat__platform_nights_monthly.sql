-- Guest nights in short-stay rentals booked through Airbnb, Booking and Expedia
-- (Tripadvisor until 2024), by country or NUTS 2 region and month. Experimental statistics.
select
    geo as geo_code,
    {{ eurostat_month('time', 'month') }} as month_start,
    value as platform_nights,
    flag
from {{ source('raw', 'eurostat_tour_ce_omn12') }}
where coalesce(indic_to, 'NGT_SP') = 'NGT_SP'
  and coalesce(c_resid, 'TOTAL') = 'TOTAL'
  and coalesce(unit, 'NR') = 'NR'
  and coalesce(month, '') <> 'TOTAL'
  and ({{ is_nuts2('geo') }} or {{ is_country('geo') }} or geo = 'EU27_2020')
  and value is not null
