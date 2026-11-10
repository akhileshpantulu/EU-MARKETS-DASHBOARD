-- Every destination-year with source-market nights also gets shares. Catches a change
-- in Eurostat's aggregate codes (WORLD / DOM vs TOTAL / FOR) that would blank the chart.
select geo_code, year, count(*) as markets
from {{ ref('mart_source_markets') }}
group by geo_code, year
having count(share_of_foreign_nights) = 0
