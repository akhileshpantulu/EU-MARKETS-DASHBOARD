"""Load the downloaded source files into the `raw` schema of the DuckDB warehouse.

This is the "EL" step: each file is flattened by its parser (Eurostat JSON-stat,
ECB csvdata, INE Tempus3) and written otherwise untouched. Codes are kept as the
sources publish them; renaming, filtering and typing happen in dbt staging.

A source with no raw file still gets an empty table with the expected columns,
so `dbt build` runs (and its facts are simply empty) when one API is down.

Usage:
    python -m etl.load_raw                       # -> data/eu_markets.duckdb
    DUCKDB_PATH=/tmp/dw.duckdb python -m etl.load_raw
    RAW_DIR=tests/fixtures/raw python -m etl.load_raw
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from io import StringIO
from pathlib import Path

import duckdb
import pandas as pd

from etl import config, jsonstat
from etl.ine_parse import load_ine_json

DEFAULT_DB = config.ROOT / "data" / "eu_markets.duckdb"

ECB_COLUMNS = ["key", "currency", "time_period", "obs_value"]
INE_COLUMNS = [
    "series_code", "series_name", "unit", "zonas_turisticas", "concepto_turistico",
    "tipo_de_categoria", "tipo_de_dato", "year", "month", "period", "data_status", "value",
]
MANIFEST_COLUMNS = ["source", "status", "code", "description", "url", "updated", "fetched_at", "error"]


def snake(name: str) -> str:
    """'ZONAS TURÍSTICAS' -> 'zonas_turisticas'."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^0-9a-z]+", "_", ascii_name.lower()).strip("_")


def ensure_columns(df: pd.DataFrame, columns: list[str], numeric: set[str]) -> pd.DataFrame:
    for col in columns:
        if col not in df.columns:
            df[col] = pd.Series(dtype="float64" if col in numeric else "object")
    for col in df.columns:
        if col not in numeric:
            df[col] = df[col].astype("object").where(df[col].notna(), None)
            df[col] = df[col].map(lambda v: None if v is None else str(v))
    return df


def eurostat_tables(raw_dir: Path) -> tuple[dict[str, pd.DataFrame], pd.DataFrame]:
    tables, all_labels = {}, []
    for ds in config.EUROSTAT_DATASETS:
        path = raw_dir / "eurostat" / f"{ds.name}.json"
        if path.exists():
            obs, labs = jsonstat.load(path)
            obs = obs.drop(columns=["freq"], errors="ignore")
            labs.insert(0, "dataset", ds.name)
            all_labels.append(labs)
        else:
            obs = pd.DataFrame()
        cols = [*ds.dims, "value", "flag"]
        tables[f"eurostat_{ds.name}"] = ensure_columns(obs, cols, numeric={"value"})
    labels = pd.concat(all_labels, ignore_index=True) if all_labels else pd.DataFrame()
    return tables, ensure_columns(labels, ["dataset", "dimension", "code", "label"], numeric=set())


def ecb_tables(raw_dir: Path) -> dict[str, pd.DataFrame]:
    tables = {}
    for series in config.ECB_SERIES:
        path = raw_dir / "ecb" / f"{series.name}.csv"
        if path.exists():
            df = pd.read_csv(StringIO(path.read_text(encoding="utf-8")), dtype=str)
            df.columns = [snake(c) for c in df.columns]
            df = df[[c for c in ECB_COLUMNS if c in df.columns]].copy()
            df["obs_value"] = pd.to_numeric(df["obs_value"], errors="coerce")
        else:
            df = pd.DataFrame()
        tables[f"ecb_{series.name}"] = ensure_columns(df, ECB_COLUMNS, numeric={"obs_value"})
    return tables


def ine_tables(raw_dir: Path) -> dict[str, pd.DataFrame]:
    tables = {}
    for name in config.INE_TABLES:
        path = raw_dir / "ine" / f"{name}.json"
        df = load_ine_json(path) if path.exists() else pd.DataFrame()
        df = df.rename(columns=snake)
        df = ensure_columns(df, INE_COLUMNS, numeric={"value", "year", "month"})
        tables[f"ine_{name}"] = df[INE_COLUMNS]
    return tables


def manifest_table(raw_dir: Path) -> pd.DataFrame:
    path = raw_dir / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    rows = [{"source": k, **{c: v.get(c) for c in MANIFEST_COLUMNS[1:]}} for k, v in manifest.items()]
    return ensure_columns(pd.DataFrame(rows), MANIFEST_COLUMNS, numeric=set())


def sources(raw_dir: Path) -> dict[str, pd.DataFrame]:
    eurostat, labels = eurostat_tables(raw_dir)
    return {
        **eurostat,
        "eurostat_labels": labels,
        **ecb_tables(raw_dir),
        **ine_tables(raw_dir),
        "source_manifest": manifest_table(raw_dir),
    }


def main() -> None:
    raw_dir = Path(os.environ.get("RAW_DIR", config.RAW_DIR))
    db_path = Path(os.environ.get("DUCKDB_PATH", DEFAULT_DB))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    con.execute("create schema if not exists raw")
    for table, df in sources(raw_dir).items():
        # Explicit types so empty placeholder tables still have usable columns.
        casts = ", ".join(
            f'cast("{c}" as {"double" if pd.api.types.is_numeric_dtype(df[c]) else "varchar"}) as "{c}"'
            for c in df.columns
        )
        con.register("df", df)
        con.execute(f"create or replace table raw.{table} as select {casts} from df")
        con.unregister("df")
        print(f"raw.{table:<32} {len(df):>9,} rows")
    con.close()
    print(f"Warehouse: {db_path}")


if __name__ == "__main__":
    main()
