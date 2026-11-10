-- Hotel nights (I551) never exceed nights in all tourist accommodation (I551-I553).
select geo_code, date_key, nights, hotel_nights
from {{ ref('mart_country_monthly') }}
where hotel_nights > nights * 1.001 + 5
