-- Grain: Portuguese region x accommodation type x month. Revenue per guest night =
-- lodging income / nights (INE.pt publishes no RevPAR or ADR series).
select
    region_code,
    region_name,
    region_level,
    accommodation_type_code,
    accommodation_type,
    {{ month_key('month_start') }} as date_key,
    lodging_income_eur,
    nights,
    lodging_income_eur / nullif(nights, 0) as revenue_per_night_eur
from {{ ref('stg_inept__accommodation_monthly') }}
where month_start >= date '{{ var("first_month") }}'
  and month_start <= (select max(month_start) from {{ ref('dim_date') }})
