-- Statistics Portugal: lodging income (EUR) and nights by region and accommodation type.
-- geocod: PT (country), 1/2/3 (NUTS 1), two characters (NUTS 2 2024 without the PT prefix).
select
    case when geocod = 'PT' then 'PT'
         when length(geocod) = 2 then 'PT' || geocod
         else 'PT_' || geocod end as region_code,
    any_value(geodsg) as region_name,
    case when geocod = 'PT' then 'country' when length(geocod) = 2 then 'nuts2' else 'nuts1' end as region_level,
    dim_3 as accommodation_type_code,
    any_value(dim_3_t) as accommodation_type,
    make_date(cast(substr(period, 4, 4) as integer), cast(substr(period, 8, 2) as integer), 1) as month_start,
    max(valor) filter (where indicator = 'lodging_income') as lodging_income_eur,
    max(valor) filter (where indicator = 'nights') as nights
from {{ source('raw', 'inept_accommodation_monthly') }}
where period similar to 'S3A[0-9]{6}'
group by geocod, dim_3, period
