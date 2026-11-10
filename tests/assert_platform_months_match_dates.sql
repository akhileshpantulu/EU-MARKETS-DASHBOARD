-- Every month code in the year-based Eurostat datasets became a real date.
select 'tour_occ_nin2m' as dataset, count(*) as unparsed
from {{ ref('stg_eurostat__regional_nights_monthly') }} where month_start is null
having count(*) > 0
union all
select 'tour_ce_omn12', count(*)
from {{ ref('stg_eurostat__platform_nights_monthly') }} where month_start is null
having count(*) > 0
