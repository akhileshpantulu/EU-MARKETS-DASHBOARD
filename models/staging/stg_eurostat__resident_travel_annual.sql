-- Trips and spending by residents of each country (1+ nights, all purposes):
-- the outbound demand a source market sends abroad.
with trips as (
    select geo, cast(time as integer) as year,
           max(value) filter (where c_dest = 'FOR') as trips_abroad,
           max(value) filter (where c_dest = 'DOM') as trips_domestic
    from {{ source('raw', 'eurostat_tour_dem_tttot') }}
    where coalesce(purpose, 'TOTAL') = 'TOTAL' and coalesce(duration, 'N_GE1') = 'N_GE1'
      and coalesce(unit, 'NR') = 'NR' and value is not null
    group by all
),

spend as (
    select geo, cast(time as integer) as year,
           max(value) filter (where c_dest = 'FOR' and statinfo = 'TOTAL') as spend_abroad_eur,
           max(value) filter (where c_dest = 'FOR' and statinfo = 'AVG_TRP') as spend_per_trip_abroad_eur,
           max(value) filter (where c_dest = 'FOR' and statinfo = 'AVG_NGT') as spend_per_night_abroad_eur
    from {{ source('raw', 'eurostat_tour_dem_extot') }}
    where coalesce(purpose, 'TOTAL') = 'TOTAL' and coalesce(duration, 'N_GE1') = 'N_GE1'
      and coalesce(expend, 'TOTXDUR') = 'TOTXDUR' and value is not null
    group by all
)

select
    coalesce(t.geo, s.geo) as market_code,
    coalesce(t.year, s.year) as year,
    t.trips_abroad, t.trips_domestic,
    s.spend_abroad_eur, s.spend_per_trip_abroad_eur, s.spend_per_night_abroad_eur
from trips as t
full outer join spend as s on s.geo = t.geo and s.year = t.year
