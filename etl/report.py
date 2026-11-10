"""Print a freshness and row-count report for the warehouse (also to the GitHub step summary).

Usage:
    python -m etl.report
"""
from __future__ import annotations

import os
from pathlib import Path

import duckdb

from etl.load_raw import DEFAULT_DB


def main() -> None:
    db = Path(os.environ.get("DUCKDB_PATH", DEFAULT_DB))
    con = duckdb.connect(str(db), read_only=True)
    sources = con.sql("""
        select source_key, status, dataset_code, latest_period, coalesce(left(source_updated, 10), '') as updated,
               coalesce(left(error, 120), '') as error
        from analytics.mart_data_freshness order by source_key""").fetchall()
    counts = con.sql("""
        select table_schema || '.' || table_name as t, estimated_size as n
        from duckdb_tables() where table_schema in ('core', 'analytics') order by 1""").fetchall()
    lines = ["## Sources", "", "| source | status | dataset | latest period | publisher update | error |",
             "|---|---|---|---|---|---|"]
    lines += [f"| {' | '.join(str(x) if x is not None else '' for x in row)} |" for row in sources]
    lines += ["", "## Tables", "", "| table | rows |", "|---|---:|"]
    lines += [f"| {t} | {n:,} |" for t, n in counts]
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    main()
