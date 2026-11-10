-- Grain: geo x year x accommodation type.
select geo_code, year, nace_code, establishments, bedrooms, bed_places
from {{ ref('stg_eurostat__capacity_annual') }}
where {{ in_dim_geo('geo_code') }}
