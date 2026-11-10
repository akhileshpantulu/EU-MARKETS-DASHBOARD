-- One name per airport code from Eurostat labels: rep_airp labels ('PALMA DE MALLORCA airport')
-- and the partner side of route labels ('LUQA airport - WIEN-SCHWECHAT airport').
with reporting as (
    select code as airport_code, regexp_replace(label, ' airport$', '') as raw_name, 1 as priority
    from {{ ref('stg_eurostat__labels') }}
    where dimension = 'rep_airp'
),

route_partner as (
    select
        split_part(code, '_', 3) || '_' || split_part(code, '_', 4) as airport_code,
        regexp_replace(regexp_extract(label, '^.*? airport - (.*)$', 1), ' airport$', '') as raw_name,
        2 as priority
    from {{ ref('stg_eurostat__labels') }}
    where dimension = 'airp_pr'
),

route_reporting as (
    select
        split_part(code, '_', 1) || '_' || split_part(code, '_', 2) as airport_code,
        regexp_extract(label, '^(.*?) airport - ', 1) as raw_name,
        3 as priority
    from {{ ref('stg_eurostat__labels') }}
    where dimension = 'airp_pr'
)

select airport_code, {{ title_case('raw_name') }} as airport_name
from (select * from reporting union all select * from route_partner union all select * from route_reporting)
where coalesce(raw_name, '') <> ''
qualify row_number() over (partition by airport_code order by priority) = 1
