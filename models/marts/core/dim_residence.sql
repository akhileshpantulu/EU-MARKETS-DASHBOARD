select residence_code, residence_name, sort_order from {{ ref('residence') }}
