"""Flatten Eurostat JSON-stat 2.0 responses into tidy DataFrames."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def _docs(payload: dict | list) -> list[dict]:
    """A raw file holds one JSON-stat document, or a list of them when the
    download was split (one request per airport, for instance)."""
    return payload if isinstance(payload, list) else [payload]


def observations(doc: dict) -> pd.DataFrame:
    """One row per published cell: one column per dimension code, `value`, `flag`.

    JSON-stat stores values in a flat dict keyed by the row-major position in the
    cube defined by `id` (dimension order) and `size` (categories per dimension).
    Only populated cells are walked, so sparse cubes stay cheap.
    """
    dims: list[str] = doc["id"]
    sizes: list[int] = doc["size"]
    codes = []
    for dim in dims:
        index = doc["dimension"][dim]["category"]["index"]
        if isinstance(index, list):
            index = {code: i for i, code in enumerate(index)}
        codes.append(sorted(index, key=index.get))

    values = doc.get("value") or {}
    if isinstance(values, list):
        values = {str(i): v for i, v in enumerate(values) if v is not None}
    status = doc.get("status") or {}
    if isinstance(status, list):
        status = {str(i): s for i, s in enumerate(status) if s}

    rows = []
    for pos_str, value in values.items():
        if value is None:
            continue
        pos = int(pos_str)
        combo = [None] * len(dims)
        for d in range(len(dims) - 1, -1, -1):
            pos, i = divmod(pos, sizes[d])
            combo[d] = codes[d][i]
        rows.append((*combo, float(value), status.get(pos_str)))
    return pd.DataFrame(rows, columns=[*dims, "value", "flag"])


def labels(doc: dict) -> pd.DataFrame:
    """dimension, code, label for every category in the document."""
    rows = []
    for dim in doc["id"]:
        category = doc["dimension"][dim]["category"]
        for code, label in (category.get("label") or {}).items():
            rows.append((dim, code, label))
    return pd.DataFrame(rows, columns=["dimension", "code", "label"])


def load(path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(observations, labels) for a raw file, merging split downloads."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    docs = _docs(payload)
    obs = pd.concat([observations(d) for d in docs], ignore_index=True) if docs else pd.DataFrame()
    labs = pd.concat([labels(d) for d in docs], ignore_index=True).drop_duplicates(["dimension", "code"])
    return obs, labs


def updated(path: str | Path) -> str | None:
    """Latest `updated` timestamp across the documents in a raw file."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    stamps = [d.get("updated") for d in _docs(payload) if d.get("updated")]
    return max(stamps) if stamps else None
