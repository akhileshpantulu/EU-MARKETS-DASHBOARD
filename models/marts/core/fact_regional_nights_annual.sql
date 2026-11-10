-- Grain: NUTS 2 region x year x guest residence.
select geo_code, year, residence_code, nights, flag
from {{ ref('stg_eurostat__regional_nights_annual') }}
where {{ in_dim_geo('geo_code') }}
