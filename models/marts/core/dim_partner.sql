-- Guest country (or world region) of residence in tour_occ_ninraw.
-- Two-letter codes are countries; anything else is an aggregate (EU27, Americas, ...).
with codes as (
    select distinct partner_code from {{ ref('stg_eurostat__nights_by_residence_annual') }}
)

select
    codes.partner_code,
    coalesce(country.country_name, labels.label, codes.partner_code) as partner_name,
    {{ is_country('codes.partner_code') }} as is_country,
    country.region_group
from codes
left join {{ ref('stg_eurostat__labels') }} as labels
    on labels.dimension = 'c_resid' and labels.code = codes.partner_code
left join {{ ref('country') }} as country on country.geo_code = codes.partner_code
