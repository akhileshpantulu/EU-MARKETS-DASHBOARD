-- Grain: geo x year. Population on 1 January.
select geo_code, year, population from {{ ref('stg_eurostat__population_annual') }}
where {{ in_dim_geo('geo_code') }}
