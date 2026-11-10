-- House price index, annual rate of change (%), all dwellings.
select
    geo as market_code,
    make_date(cast(left(time, 4) as integer), cast(right(time, 1) as integer) * 3 - 2, 1) as quarter_start,
    value as house_prices_yoy_pct
from {{ source('raw', 'eurostat_prc_hpi_q') }}
where coalesce(purchase, 'TOTAL') = 'TOTAL' and coalesce(unit, 'RCH_A') = 'RCH_A'
  and time similar to '[0-9]{4}-Q[1-4]' and value is not null
