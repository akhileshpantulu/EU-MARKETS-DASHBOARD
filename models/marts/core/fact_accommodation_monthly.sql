-- Grain: geo x month x guest residence x accommodation type.
-- Nights (tour_occ_nim) and arrivals (tour_occ_arm) share the grain, so they sit in one fact.
select
    coalesce(n.geo_code, a.geo_code) as geo_code,
    {{ month_key('coalesce(n.month_start, a.month_start)') }} as date_key,
    coalesce(n.residence_code, a.residence_code) as residence_code,
    coalesce(n.nace_code, a.nace_code) as nace_code,
    n.nights,
    a.arrivals,
    coalesce(n.flag, a.flag) as flag
from {{ ref('stg_eurostat__nights_monthly') }} as n
full outer join {{ ref('stg_eurostat__arrivals_monthly') }} as a
    on a.geo_code = n.geo_code
   and a.month_start = n.month_start
   and a.residence_code = n.residence_code
   and a.nace_code = n.nace_code
where coalesce(n.month_start, a.month_start) >= date '{{ var("first_month") }}'
  and {{ in_dim_geo('coalesce(n.geo_code, a.geo_code)') }}
