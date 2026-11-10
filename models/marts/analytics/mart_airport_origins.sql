-- Grain: airport x partner country x year (complete years of route data only).
-- Share of the airport's route passengers and change on the previous year.
with yearly as (
    select r.airport_code, r.partner_country_code, d.year, sum(r.passengers) as passengers,
           count(distinct r.date_key) as months
    from {{ ref('fact_route_passengers_monthly') }} as r
    join {{ ref('dim_date') }} as d using (date_key)
    group by all
),

complete as (
    -- A year counts when the airport reported routes in all twelve months.
    select airport_code, year
    from {{ ref('fact_route_passengers_monthly') }} as r
    join {{ ref('dim_date') }} as d using (date_key)
    group by all
    having count(distinct d.month) = 12
),

y as (
    select yearly.* from yearly join complete using (airport_code, year)
)

select
    y.airport_code,
    y.partner_country_code,
    coalesce(c.country_name, p.partner_name, mk.market_name, y.partner_country_code) as partner_country_name,
    y.year,
    y.passengers,
    y.passengers / sum(y.passengers) over (partition by y.airport_code, y.year) as share_of_airport,
    y.passengers / nullif(ly.passengers, 0) - 1 as passengers_yoy,
    row_number() over (partition by y.airport_code, y.year order by y.passengers desc) as country_rank
from y
left join y as ly on ly.airport_code = y.airport_code and ly.partner_country_code = y.partner_country_code
    and ly.year = y.year - 1
left join {{ ref('country') }} as c on c.geo_code = y.partner_country_code
left join {{ ref('dim_partner') }} as p on p.partner_code = y.partner_country_code
left join {{ ref('oecd_area') }} as mk on mk.market_code = y.partner_country_code
