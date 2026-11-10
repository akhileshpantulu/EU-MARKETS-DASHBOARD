-- Grain: destination geo x guest residence (partner) x year. Nights in all tourist accommodation.
select geo_code, partner_code, year, nights, flag
from {{ ref('stg_eurostat__nights_by_residence_annual') }}
where {{ in_dim_geo('geo_code') }}
