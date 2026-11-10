-- Grain: currency x date x frequency. ECB daily reference rates and Eurostat monthly averages.
select currency_code, rate_date, 'daily' as frequency, units_per_eur
from {{ ref('stg_ecb__fx_daily') }}
where currency_code in (select currency_code from {{ ref('dim_currency') }})
union all
select currency_code, month_start as rate_date, 'monthly' as frequency, units_per_eur
from {{ ref('stg_eurostat__fx_monthly') }}
where currency_code in (select currency_code from {{ ref('dim_currency') }})
