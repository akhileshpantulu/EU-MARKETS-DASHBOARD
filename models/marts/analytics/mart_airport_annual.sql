-- Grain: airport x year. Annual passengers since 2005; the latest, incomplete year is
-- compared with the same months of the previous year (YTD).
with m as (
    select f.airport_code, d.year, d.month, f.passengers
    from {{ ref('fact_airport_passengers_monthly') }} as f
    join {{ ref('dim_date') }} as d using (date_key)
),

cur as (
    select airport_code, year, count(*) as months, max(month) as last_month, sum(passengers) as passengers
    from m group by airport_code, year
),

prev as (
    select c.airport_code, c.year, count(*) as months, sum(m.passengers) as passengers
    from cur as c
    join m on m.airport_code = c.airport_code and m.year = c.year - 1 and m.month <= c.last_month
    group by c.airport_code, c.year
)

select
    c.airport_code,
    c.year,
    c.months,
    c.months < 12 and c.year = max(c.year) over (partition by c.airport_code) as is_ytd,
    c.passengers,
    case when p.months = c.months then c.passengers / nullif(p.passengers, 0) - 1 end as passengers_yoy
from cur as c
left join prev as p using (airport_code, year)
where c.months = 12 or c.year = (select max(year) from cur as x where x.airport_code = c.airport_code)
