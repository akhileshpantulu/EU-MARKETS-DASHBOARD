-- Grain: airport x partner airport x month. Passengers carried (both directions).
select
    airport_code,
    partner_airport_code,
    partner_country_code,
    {{ month_key('month_start') }} as date_key,
    passengers
from {{ ref('stg_eurostat__route_passengers_monthly') }}
where month_start >= date '{{ var("first_month") }}'
  and month_start <= (select max(month_start) from {{ ref('dim_date') }})
