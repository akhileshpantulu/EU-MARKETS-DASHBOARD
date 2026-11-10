-- ECB euro reference rates: units of foreign currency per euro.
select
    coalesce(currency, split_part(key, '.', 3)) as currency_code,
    cast(time_period as date) as rate_date,
    obs_value as units_per_eur
from {{ source('raw', 'ecb_fx_daily') }}
where obs_value is not null
