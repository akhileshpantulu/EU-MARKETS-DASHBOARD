{#- Helpers for Eurostat time codes. -#}

{#- First day of the month for '2024-07' (monthly datasets), or for a year plus a
    'M07' month code (datasets such as tour_occ_nin2m whose time axis is the year). -#}
{% macro eurostat_month(time_col, month_col=none) -%}
    {%- if month_col is none -%}
    try_strptime({{ time_col }} || '-01', '%Y-%m-%d')::date
    {%- else -%}
    case
        when {{ time_col }} like '____-__' then try_strptime({{ time_col }} || '-01', '%Y-%m-%d')::date
        when {{ month_col }} similar to 'M[0-9]{2}'
            then make_date(cast({{ time_col }} as integer), cast(substr({{ month_col }}, 2, 2) as integer), 1)
    end
    {%- endif -%}
{%- endmacro %}

{#- yyyymm integer key used by dim_date and every monthly fact. -#}
{% macro month_key(date_col) -%}
    cast(strftime({{ date_col }}, '%Y%m') as integer)
{%- endmacro %}

{#- True for NUTS 2 codes (two letters + two characters), e.g. ES53, EL62, FRL0. -#}
{% macro is_nuts2(geo_col) -%}
    (length({{ geo_col }}) = 4 and {{ geo_col }} similar to '[A-Z]{2}[0-9A-Z]{2}'
     and left({{ geo_col }}, 2) not in ('EA', 'EU') and {{ geo_col }} not similar to '..ZZ')
{%- endmacro %}

{#- True for country codes: two letters. -#}
{% macro is_country(geo_col) -%}
    ({{ geo_col }} similar to '[A-Z]{2}' and {{ geo_col }} not in ('EA', 'EU'))
{%- endmacro %}

{#- Keep only geo codes the warehouse models (drops EU15, Kosovo, old aggregates...). -#}
{% macro in_dim_geo(geo_col) -%}
    {{ geo_col }} in (select geo_code from {{ ref('dim_geo') }})
{%- endmacro %}

{#- 'PALMA DE MALLORCA' -> 'Palma De Mallorca' (Eurostat airport labels are upper case). -#}
{% macro title_case(col) -%}
    array_to_string(list_transform(string_split(lower({{ col }}), ' '), w -> upper(left(w, 1)) || substr(w, 2)), ' ')
{%- endmacro %}
