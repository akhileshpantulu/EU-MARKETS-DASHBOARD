-- Monthly calendar shared by every monthly fact (conformed dimension). Grain: one row per month.
with bounds as (
    select max(month_start) as last_month
    from (
        select month_start from {{ ref('stg_eurostat__nights_monthly') }}
        union all select month_start from {{ ref('stg_eurostat__air_passengers_monthly') }}
        union all select month_start from {{ ref('stg_eurostat__hicp_monthly') }}
        union all select month_start from {{ ref('stg_eurostat__unemployment_monthly') }}
        union all select month_start from {{ ref('stg_ine__zone_hotel_prices') }}
        union all select date_trunc('month', rate_date)::date from {{ ref('stg_ecb__interest_rates') }}
    )
),

months as (
    select cast(month_start as date) as month_start
    from bounds,
        generate_series(
            date '{{ var("first_month") }}',
            coalesce(bounds.last_month, date '{{ var("first_month") }}'),
            interval 1 month
        ) as t(month_start)
)

select
    {{ month_key('month_start') }} as date_key,
    month_start,
    last_day(month_start) as month_end,
    strftime(month_start, '%Y-%m') as year_month,
    year(month_start) as year,
    quarter(month_start) as quarter,
    month(month_start) as month,
    strftime(month_start, '%B') as month_name,
    strftime(month_start, '%b') as month_short_name,
    day(last_day(month_start)) as days_in_month,
    case
        when month(month_start) between 6 and 9 then 'High'
        when month(month_start) in (4, 5, 10) then 'Shoulder'
        else 'Low'
    end as season,
    -- Travel restrictions: useful to exclude from trends and growth comparisons.
    month_start between date '2020-03-01' and date '2021-12-01' as is_covid_period
from months
