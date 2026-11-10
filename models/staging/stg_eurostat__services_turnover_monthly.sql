-- Turnover index for accommodation (I55) and food services (I56).
-- One variant per country and month: volume before value, seasonally and calendar
-- adjusted before calendar-adjusted before unadjusted, base 2021 before others.
with ranked as (
    select
        geo as geo_code,
        {{ eurostat_month('time') }} as month_start,
        nace_r2 as nace_code,
        indic_bt,
        s_adj,
        unit,
        value as turnover_index
    from {{ source('raw', 'eurostat_sts_setu_m') }}
    where value is not null and nace_r2 in ('I55', 'I56')
),

variant as (
    -- Pick one variant per country and activity for the whole series, not per month.
    select geo_code, nace_code, indic_bt, s_adj, unit
    from ranked
    group by geo_code, nace_code, indic_bt, s_adj, unit
    qualify row_number() over (
        partition by geo_code, nace_code
        order by
            case indic_bt when 'VOL_SLS' then 1 when 'NETTUR' then 2 else 3 end,
            case s_adj when 'SCA' then 1 when 'CA' then 2 when 'NSA' then 3 else 4 end,
            case unit when 'I21' then 1 when 'I15' then 2 else 3 end,
            count(*) desc
    ) = 1
)

select ranked.geo_code, ranked.month_start, ranked.nace_code,
       ranked.indic_bt, ranked.s_adj, ranked.unit, ranked.turnover_index
from ranked
inner join variant using (geo_code, nace_code, indic_bt, s_adj, unit)
