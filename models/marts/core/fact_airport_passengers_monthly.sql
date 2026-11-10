-- Grain: airport x month.
select airport_code, {{ month_key('month_start') }} as date_key, passengers
from {{ ref('stg_eurostat__airport_passengers_monthly') }}
where month_start >= date '{{ var("first_month") }}'
  and airport_code in (select airport_code from {{ ref('dim_airport') }})
