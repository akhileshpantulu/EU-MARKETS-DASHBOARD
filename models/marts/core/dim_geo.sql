-- Countries, EU aggregates and NUTS 2 regions. Country attributes come from the seed;
-- region names from Eurostat's own labels. Grain: one row per Eurostat geo code.
with country as (
    select
        c.geo_code,
        c.country_name as geo_name,
        'country' as geo_level,
        c.geo_code as country_code,
        c.country_name,
        c.iso2,
        c.is_eu27,
        c.euro_adoption_year is not null as is_euro_area,
        c.currency_code,
        c.region_group,
        null::integer as sort_order
    from {{ ref('country') }} as c
),

aggregate as (
    select
        a.geo_code,
        coalesce(l.label, a.geo_name) as geo_name,
        'aggregate' as geo_level,
        null as country_code,
        null as country_name,
        null as iso2,
        false as is_eu27,
        false as is_euro_area,
        null as currency_code,
        null as region_group,
        a.sort_order
    from {{ ref('geo_aggregate') }} as a
    left join {{ ref('stg_eurostat__labels') }} as l on l.dimension = 'geo' and l.code = a.geo_code
),

region_codes as (
    select geo_code from {{ ref('stg_eurostat__regional_nights_annual') }}
    union select geo_code from {{ ref('stg_eurostat__regional_nights_monthly') }}
    union select geo_code from {{ ref('stg_eurostat__platform_nights_monthly') }} where {{ is_nuts2('geo_code') }}
),

region as (
    select
        r.geo_code,
        coalesce(l.label, r.geo_code) as geo_name,
        'nuts2' as geo_level,
        c.geo_code as country_code,
        c.country_name,
        c.iso2,
        c.is_eu27,
        c.is_euro_area,
        c.currency_code,
        c.region_group,
        null::integer as sort_order
    from region_codes as r
    inner join country as c on c.geo_code = left(r.geo_code, 2)
    left join {{ ref('stg_eurostat__labels') }} as l on l.dimension = 'geo' and l.code = r.geo_code
)

select * from aggregate
union all select * from country
union all select * from region
