-- Grain: geo x metric x year. Long-horizon annual view of every monthly country series.
-- Flows (nights, passengers) are summed and compared as % change; rates and indices
-- are averaged and compared as a difference (rates) or % change (indices).
-- The latest, incomplete year is compared with the same months of the previous year (YTD).
{% set metrics = {
    'nights': 'sum', 'nights_domestic': 'sum', 'nights_foreign': 'sum', 'hotel_nights': 'sum',
    'arrivals': 'sum', 'platform_nights': 'sum', 'air_passengers': 'sum', 'air_passengers_international': 'sum',
    'bed_place_occupancy_rate': 'rate01', 'room_occupancy_rate': 'rate01', 'avg_length_of_stay': 'level',
    'hicp_all_items_pct': 'pct', 'hicp_accommodation_pct': 'pct', 'hicp_restaurants_pct': 'pct',
    'unemployment_rate_pct': 'pct', 'consumer_confidence_balance': 'level', 'bond_yield_10y_pct': 'pct',
    'accommodation_turnover_index': 'index',
} %}
with long as (
    {% for metric, kind in metrics.items() %}
    select geo_code, year, month, '{{ metric }}' as metric, '{{ kind }}' as kind, {{ metric }}::double as value
    from {{ ref('mart_country_monthly') }}
    where {{ metric }} is not null
    {% if not loop.last %}union all{% endif %}
    {% endfor %}
),

cur as (
    select geo_code, metric, any_value(kind) as kind, year,
           count(*) as months, max(month) as last_month, sum(value) as total, avg(value) as average
    from long
    group by geo_code, metric, year
),

-- The previous year restricted to the months the current year has.
prev as (
    select c.geo_code, c.metric, c.year,
           count(l.value) as months, sum(l.value) as total, avg(l.value) as average
    from cur as c
    join long as l on l.geo_code = c.geo_code and l.metric = c.metric
        and l.year = c.year - 1 and l.month <= c.last_month
    group by c.geo_code, c.metric, c.year
)

select
    c.geo_code,
    c.metric,
    c.kind,
    c.year,
    c.months,
    c.last_month,
    c.months = 12 as is_complete,
    c.months < 12 and c.year = max(c.year) over (partition by c.geo_code, c.metric) as is_ytd,
    case when c.kind = 'sum' then c.total else c.average end as value,
    case
        when p.months is null or p.months <> c.months then null
        when c.kind in ('sum') then c.total / nullif(p.total, 0) - 1
        when c.kind = 'index' then c.average / nullif(p.average, 0) - 1
        else c.average - p.average
    end as change
from cur as c
left join prev as p using (geo_code, metric, year)
-- Older partial years (a country that started reporting mid-year) are not comparable.
where c.months = 12 or c.year = (select max(year) from cur as x where x.geo_code = c.geo_code and x.metric = c.metric)
