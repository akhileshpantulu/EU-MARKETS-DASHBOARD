-- Passengers carried on each airport pair, as reported by the first airport's country.
-- airp_pr = <CC>_<ICAO>_<CC>_<ICAO>, e.g. ES_LEPA_DE_EDDF (Palma - Frankfurt).
select
    split_part(airp_pr, '_', 1) || '_' || split_part(airp_pr, '_', 2) as airport_code,
    split_part(airp_pr, '_', 3) || '_' || split_part(airp_pr, '_', 4) as partner_airport_code,
    split_part(airp_pr, '_', 3) as partner_country_code,
    {{ eurostat_month('time') }} as month_start,
    sum(value) as passengers
from {{ source('raw', 'eurostat_avia_par') }}
where coalesce(unit, 'PAS') = 'PAS' and coalesce(tra_meas, 'PAS_CRD') = 'PAS_CRD'
  and value is not null and airp_pr similar to '[A-Z]{2}_[A-Z0-9]{4}_[A-Z]{2}_[A-Z0-9]{4}'
group by all
