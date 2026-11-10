-- Domestic + foreign nights equal all guests (Eurostat tour_occ_nim), within 1 %.
-- Warns on a few published rounding gaps; fails if the split is broadly wrong.
{{ config(severity='error', warn_if='>0', error_if='>50') }}
select geo_code, date_key, nace_code,
       max(nights) filter (where residence_code = 'TOTAL') as total,
       sum(nights) filter (where residence_code in ('DOM', 'FOR')) as parts
from {{ ref('fact_accommodation_monthly') }}
group by all
having count(nights) filter (where residence_code in ('DOM', 'FOR')) = 2
   and abs(parts - total) > 0.01 * total + 5
