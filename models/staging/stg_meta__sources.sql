select
    source as source_key,
    split_part(source, '.', 1) as publisher,
    split_part(source, '.', 2) as source_name,
    status,
    code as dataset_code,
    description,
    url,
    updated as source_updated,
    fetched_at,
    error
from {{ source('raw', 'source_manifest') }}
