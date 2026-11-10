-- Grain: airport x partner airport x year, top 30 routes per airport and year
-- (complete years only).
with yearly as (
    select r.airport_code, r.partner_airport_code, d.year, sum(r.passengers) as passengers
    from {{ ref('fact_route_passengers_monthly') }} as r
    join {{ ref('dim_date') }} as d using (date_key)
    group by all
),

complete as (
    select airport_code, year
    from {{ ref('fact_route_passengers_monthly') }} as r
    join {{ ref('dim_date') }} as d using (date_key)
    group by all
    having count(distinct d.month) = 12
),

ranked as (
    select y.*, row_number() over (partition by y.airport_code, y.year order by y.passengers desc) as route_rank
    from yearly as y join complete using (airport_code, year)
)

select
    r.airport_code,
    r.partner_airport_code,
    pa.airport_name as partner_airport_name,
    pa.country_name as partner_country_name,
    r.year,
    r.passengers,
    r.passengers / nullif(ly.passengers, 0) - 1 as passengers_yoy,
    r.route_rank
from ranked as r
left join yearly as ly on ly.airport_code = r.airport_code and ly.partner_airport_code = r.partner_airport_code
    and ly.year = r.year - 1
left join {{ ref('dim_airport') }} as pa on pa.airport_code = r.partner_airport_code
where r.route_rank <= 30
