select currency_code, currency_name from {{ ref('currency') }}
