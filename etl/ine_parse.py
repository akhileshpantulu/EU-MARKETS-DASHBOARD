"""Flatten raw INE Tempus3 JSON (downloaded with tip=AM) into a tidy DataFrame.

Adapted from carlosalomar/balearic-tourism-dw (MIT licence).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd


def load_ine_json(path: str | Path) -> pd.DataFrame:
    """One row per series and period.

    Columns: series_code, series_name, unit, one column per INE variable found in
    the series metadata (e.g. 'ZONAS TURÍSTICAS', 'Concepto turístico',
    'Tipo de dato'), year, month, period, data_status (Definitivo / Provisional), value.
    """
    series = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = []
    for s in series:
        meta = {
            (m.get("T3_Variable") or m.get("Variable", {}).get("Nombre")): m.get("Nombre")
            for m in s.get("MetaData", [])
        }
        for point in s.get("Data", []):
            period = point.get("T3_Periodo") or ""
            match = re.fullmatch(r"M(\d{2})", period)
            rows.append(
                {
                    "series_code": s.get("COD"),
                    "series_name": s.get("Nombre"),
                    "unit": s.get("T3_Unidad"),
                    **meta,
                    "year": point.get("Anyo"),
                    "month": int(match.group(1)) if match else None,
                    "period": period,
                    "data_status": point.get("T3_TipoDato"),
                    "value": point.get("Valor"),
                }
            )
    df = pd.DataFrame(rows)
    if not df.empty:
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df
