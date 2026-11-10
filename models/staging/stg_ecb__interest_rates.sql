-- ECB policy and market rates in one long table (percent).
{% set series = {'deposit_rate': 'day', 'estr': 'day', 'yield_10y': 'day', 'euribor_3m': 'month'} %}
{% for name, grain in series.items() %}
select
    '{{ name }}' as series_code,
    {% if grain == 'month' -%}
    try_strptime(time_period || '-01', '%Y-%m-%d')::date as rate_date,
    {%- else -%}
    try_cast(time_period as date) as rate_date,
    {%- endif %}
    obs_value as rate_pct
from {{ source('raw', 'ecb_' ~ name) }}
where obs_value is not null
{% if not loop.last %}union all{% endif %}
{% endfor %}
