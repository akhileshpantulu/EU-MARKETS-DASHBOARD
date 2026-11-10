select nace_code, accommodation_type, short_name, is_total, sort_order from {{ ref('accommodation_type') }}
