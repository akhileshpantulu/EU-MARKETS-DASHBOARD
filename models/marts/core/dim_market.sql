-- Source markets: European countries (seed) plus the non-European economies the
-- OECD covers. market_code matches the Eurostat partner codes in dim_partner.
with codes as (
    select geo_code as market_code, country_name as market_name, currency_code from {{ ref('country') }}
    union all
    select a.market_code, a.market_name,
           case a.market_code when 'US' then 'USD' when 'CN' then 'CNY' when 'JP' then 'JPY' end
    from {{ ref('oecd_area') }} as a
    where a.market_code not in (select geo_code from {{ ref('country') }})
)

select
    market_code,
    any_value(market_name) as market_name,
    any_value(currency_code) as currency_code,
    market_code in (select market_code from {{ ref('oecd_area') }}) as has_oecd_indicators
from codes
group by market_code
