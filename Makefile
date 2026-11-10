# EU Markets Dashboard: download -> DuckDB -> dbt -> JSON -> static site.
PY ?= python
DB ?= data/eu_markets.duckdb
FIXTURES := tests/fixtures/raw

.PHONY: install download load build export refresh serve test fixtures clean

install:
	$(PY) -m pip install -r requirements.txt

download:            ## fetch every source into data/raw/
	$(PY) -m etl.download

load:                ## flatten data/raw/ into the DuckDB raw schema
	DUCKDB_PATH=$(DB) $(PY) -m etl.load_raw

build:               ## dbt seeds, models and tests
	DUCKDB_PATH=$(DB) dbt build --profiles-dir .

export:              ## marts -> site/data/*.json
	DUCKDB_PATH=$(DB) $(PY) -m etl.export_site

refresh: download load build export

serve:               ## http://localhost:8000
	cd site && $(PY) -m http.server 8000

fixtures:            ## synthetic raw files for offline runs
	$(PY) -m etl.fixtures $(FIXTURES)

test: fixtures       ## unit tests + full dbt build on synthetic fixtures (no network)
	$(PY) -m pytest -q
	RAW_DIR=$(FIXTURES) DUCKDB_PATH=data/test.duckdb $(PY) -m etl.load_raw
	DUCKDB_PATH=data/test.duckdb dbt build --profiles-dir .
	RAW_DIR=$(FIXTURES) DUCKDB_PATH=data/test.duckdb SITE_DATA=data/test_site $(PY) -m etl.export_site

clean:
	rm -rf target logs data/*.duckdb data/test_site $(FIXTURES)
