-- Spanish tourist zones with INE hotel price data.
select
    md5(zone_label) as zone_key,
    zone_label,
    any_value(zone_name) as zone_name,
    any_value(region_name) as region_name,
    min(month_start) as first_month,
    max(month_start) as last_month
from {{ ref('stg_ine__zone_hotel_prices') }}
group by zone_label
