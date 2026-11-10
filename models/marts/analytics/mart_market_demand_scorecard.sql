-- One row per source market: the latest reading of each demand indicator and its change.
with m as (select * from {{ ref('mart_market_demand_monthly') }}),

last_of as (
    select
        market_code,
        max(date_key) filter (where oecd_cli is not null) as cli_key,
        max(date_key) filter (where oecd_consumer_confidence is not null) as cci_key,
        max(date_key) filter (where retail_volume_yoy is not null) as retail_key,
        max(date_key) filter (where ec_consumer_confidence_balance is not null) as ec_key,
        max(date_key) filter (where unemployment_rate_pct is not null) as unemp_key
    from m group by market_code
),

-- Readings more than a year behind the newest one any market has are dropped
-- (Eurostat stopped UK series after 2020; a 2020 value is not a current signal).
frontier as (
    select max(cli_key) as cli_max, max(cci_key) as cci_max, max(ec_key) as ec_max,
           max(retail_key) as retail_max, max(unemp_key) as unemp_max
    from last_of
),

current_keys as (
    select
        l.market_code,
        case when l.cli_key >= f.cli_max - 100 then l.cli_key end as cli_key,
        case when l.cci_key >= f.cci_max - 100 then l.cci_key end as cci_key,
        case when l.ec_key >= f.ec_max - 100 then l.ec_key end as ec_key,
        case when l.retail_key >= f.retail_max - 100 then l.retail_key end as retail_key,
        case when l.unemp_key >= f.unemp_max - 100 then l.unemp_key end as unemp_key
    from last_of as l cross join frontier as f
),

hpi as (
    select market_code, arg_max(house_prices_yoy_pct, quarter_start) as house_prices_yoy_pct,
           max(quarter_start) as house_prices_quarter
    from {{ ref('fact_house_prices_quarterly') }} group by market_code
    having max(quarter_start) >= (select max(quarter_start) from {{ ref('fact_house_prices_quarterly') }}) - interval 1 year
),

travel as (
    select t.market_code, t.year as travel_year, t.trips_abroad, t.spend_abroad_eur, t.spend_per_night_abroad_eur,
           t.trips_abroad / nullif(p.trips_abroad, 0) - 1 as trips_abroad_yoy,
           t.spend_abroad_eur / nullif(p.spend_abroad_eur, 0) - 1 as spend_abroad_yoy
    from {{ ref('fact_resident_travel_annual') }} as t
    left join {{ ref('fact_resident_travel_annual') }} as p on p.market_code = t.market_code and p.year = t.year - 1
    where t.trips_abroad is not null
      and t.year >= (select max(year) - 1 from {{ ref('fact_resident_travel_annual') }} where trips_abroad is not null)
    qualify row_number() over (partition by t.market_code order by t.year desc) = 1
)

select
    dm.market_code, dm.market_name, dm.currency_code,
    l.cli_key, c.oecd_cli, c.oecd_cli_change_3m, c.oecd_cli_change_yoy,
    l.cci_key, cc.oecd_consumer_confidence, cc.oecd_consumer_confidence_change_yoy,
    l.ec_key, ec.ec_consumer_confidence_balance,
    l.retail_key, r.retail_volume_yoy,
    l.unemp_key, u.unemployment_rate_pct,
    h.house_prices_quarter, h.house_prices_yoy_pct,
    t.travel_year, t.trips_abroad, t.trips_abroad_yoy, t.spend_abroad_eur, t.spend_abroad_yoy,
    t.spend_per_night_abroad_eur
from {{ ref('dim_market') }} as dm
left join current_keys as l using (market_code)
left join m as c on c.market_code = dm.market_code and c.date_key = l.cli_key
left join m as cc on cc.market_code = dm.market_code and cc.date_key = l.cci_key
left join m as ec on ec.market_code = dm.market_code and ec.date_key = l.ec_key
left join m as r on r.market_code = dm.market_code and r.date_key = l.retail_key
left join m as u on u.market_code = dm.market_code and u.date_key = l.unemp_key
left join hpi as h on h.market_code = dm.market_code
left join travel as t on t.market_code = dm.market_code
where coalesce(l.cli_key, l.cci_key, l.retail_key, l.ec_key, l.unemp_key) is not null
   or h.house_prices_quarter is not null or t.travel_year is not null
