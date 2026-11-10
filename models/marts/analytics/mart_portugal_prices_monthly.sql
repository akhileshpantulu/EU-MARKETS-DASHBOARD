-- Grain: Portuguese region x accommodation type x month, with growth on a year earlier.
-- Kept to the country and NUTS 2 regions and to all types, hotels and similar, and hotels.
with f as (
    select f.*, d.month_start, d.year, d.month
    from {{ ref('fact_portugal_accommodation_monthly') }} as f
    join {{ ref('dim_date') }} as d using (date_key)
    where f.region_level in ('country', 'nuts2') and f.accommodation_type_code in ('T', '01', '0101')
)

select
    f.region_code, f.region_name, f.accommodation_type_code, f.accommodation_type,
    f.date_key, f.month_start, f.year, f.month,
    f.lodging_income_eur, f.nights, f.revenue_per_night_eur,
    f.revenue_per_night_eur / nullif(ly.revenue_per_night_eur, 0) - 1 as revenue_per_night_yoy,
    f.lodging_income_eur / nullif(ly.lodging_income_eur, 0) - 1 as lodging_income_yoy,
    f.nights / nullif(ly.nights, 0) - 1 as nights_yoy
from f
left join f as ly on ly.region_code = f.region_code and ly.accommodation_type_code = f.accommodation_type_code
    and ly.date_key = f.date_key - 100
