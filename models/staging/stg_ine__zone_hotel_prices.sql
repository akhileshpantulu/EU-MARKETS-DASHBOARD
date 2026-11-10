-- INE hotel profitability indicators (IRSH) by Spanish tourist zone: ADR and RevPAR in euros.
-- Zone names come as 'Region: Zone'; zones without a region (the Pyrenees) keep the full name.
with source as (
    select 'adr' as measure, * from {{ source('raw', 'ine_irsh_zone_adr') }}
    union all
    select 'revpar' as measure, * from {{ source('raw', 'ine_irsh_zone_revpar') }}
),

cleaned as (
    select
        measure,
        regexp_replace(trim(zonas_turisticas), '\s+', ' ', 'g') as zone_label,
        make_date(cast(year as integer), cast(month as integer), 1) as month_start,
        data_status,
        value
    from source
    where tipo_de_dato = 'Dato'
      and coalesce(tipo_de_categoria, 'Total categorías') like 'Total%'
      and month is not null
      and value is not null
)

select
    zone_label,
    case when zone_label like '%:%' then trim(split_part(zone_label, ':', 1)) else 'Pirineos' end as region_name,
    case when zone_label like '%:%' then trim(split_part(zone_label, ':', 2)) else zone_label end as zone_name,
    month_start,
    max(value) filter (where measure = 'adr') as adr_eur,
    max(value) filter (where measure = 'revpar') as revpar_eur,
    bool_or(data_status = 'Provisional') as is_provisional
from cleaned
group by all
