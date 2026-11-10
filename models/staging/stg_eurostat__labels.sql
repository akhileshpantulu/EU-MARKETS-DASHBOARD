-- One English label per dimension code (first dataset wins when several publish it).
select dimension, code, label
from {{ source('raw', 'eurostat_labels') }}
qualify row_number() over (partition by dimension, code order by dataset) = 1
