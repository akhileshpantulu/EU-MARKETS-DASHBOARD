-- Grain: geo (country or EU aggregate) x year. Seasonality, intensity and supply.
{% set base = var('baseline_year') %}
with monthly as (
    select * from {{ ref('mart_country_monthly') }}
),

ranked as (
    select geo_code, year, nights,
           row_number() over (partition by geo_code, year order by nights desc nulls last) as rank_in_year
    from monthly
    where nights is not null
),

annual as (
    select
        geo_code,
        any_value(geo_name) as geo_name,
        any_value(geo_level) as geo_level,
        year,
        count(nights) as months_with_nights,
        sum(nights) as nights,
        sum(nights_foreign) as nights_foreign,
        sum(hotel_nights) as hotel_nights,
        sum(arrivals) as arrivals,
        sum(nights) filter (where month between 6 and 9) as nights_jun_sep,
        avg(bed_place_occupancy_rate) as avg_bed_place_occupancy_rate,
        avg(room_occupancy_rate) as avg_room_occupancy_rate,
        sum(platform_nights) as platform_nights,
        count(platform_nights) as months_with_platform_nights,
        sum(air_passengers) as air_passengers,
        count(air_passengers) as months_with_air_passengers,
        avg(hicp_accommodation_pct) as avg_hicp_accommodation_pct,
        avg(hicp_all_items_pct) as avg_hicp_all_items_pct
    from monthly
    group by geo_code, year
),

peak as (
    select geo_code, year, sum(nights) as nights_peak_two_months
    from ranked
    where rank_in_year <= 2
    group by all
),

capacity as (
    select geo_code, year,
           max(establishments) filter (where nace_code = 'I551-I553') as establishments,
           max(bedrooms) filter (where nace_code = 'I551-I553') as bedrooms,
           max(bed_places) filter (where nace_code = 'I551-I553') as bed_places,
           max(bedrooms) filter (where nace_code = 'I551') as hotel_bedrooms
    from {{ ref('fact_accommodation_capacity_annual') }}
    group by all
),

combined as (
    select
        a.*,
        a.months_with_nights = 12 as is_complete_year,
        a.nights_jun_sep / nullif(a.nights, 0) as high_season_share,
        p.nights_peak_two_months / nullif(a.nights, 0) as peak_two_month_share,
        a.nights_foreign / nullif(a.nights, 0) as foreign_share,
        a.nights / nullif(a.arrivals, 0) as avg_length_of_stay,
        c.establishments, c.bedrooms, c.bed_places, c.hotel_bedrooms,
        pop.population,
        a.nights / nullif(pop.population, 0) as nights_per_resident,
        case when a.months_with_platform_nights = 12
             then a.platform_nights / nullif(a.platform_nights + a.nights, 0) end as platform_share
    from annual as a
    left join peak as p using (geo_code, year)
    left join capacity as c using (geo_code, year)
    left join {{ ref('fact_population_annual') }} as pop using (geo_code, year)
)

select
    c.*,
    case when c.is_complete_year and ly.is_complete_year then c.nights / nullif(ly.nights, 0) - 1 end as nights_yoy,
    case when c.is_complete_year and bl.is_complete_year then c.nights / nullif(bl.nights, 0) - 1 end as nights_vs_baseline
from combined as c
left join combined as ly on ly.geo_code = c.geo_code and ly.year = c.year - 1
left join combined as bl on bl.geo_code = c.geo_code and bl.year = {{ base }}
