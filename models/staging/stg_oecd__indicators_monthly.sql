-- OECD leading indicator and consumer confidence, mapped from ISO3 areas to the
-- Eurostat-style market codes used everywhere else (GBR -> UK, GRC -> EL ...).
with source as (
    select 'cli' as indicator, ref_area, time_period, obs_value from {{ source('raw', 'oecd_cli') }}
    union all
    select 'cci', ref_area, time_period, obs_value from {{ source('raw', 'oecd_cci') }}
)

select
    a.market_code,
    try_strptime(s.time_period || '-01', '%Y-%m-%d')::date as month_start,
    max(s.obs_value) filter (where s.indicator = 'cli') as oecd_cli,
    max(s.obs_value) filter (where s.indicator = 'cci') as oecd_consumer_confidence
from source as s
join {{ ref('oecd_area') }} as a on a.iso3 = s.ref_area
where s.obs_value is not null and s.time_period similar to '[0-9]{4}-[0-9]{2}'
group by all
