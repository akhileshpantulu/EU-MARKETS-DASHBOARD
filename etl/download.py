"""Download every source in etl/config.py into data/raw/.

Raw responses are saved untouched so the rest of the pipeline can be rerun
without hitting the APIs again:

    data/raw/eurostat/<name>.json   JSON-stat 2.0 (a list of documents if split)
    data/raw/ecb/<name>.csv         ECB Data Portal csvdata
    data/raw/ine/<name>.json        INE Tempus3 (tip=AM)
    data/raw/gisco/<name>.geojson   NUTS boundaries for the maps
    data/raw/manifest.json          status, timestamps and URLs per source

A source that fails keeps its previous raw file (status "stale") and the run
continues. The run exits non-zero only if a core source has no data at all.

Usage:
    python -m etl.download                 # everything
    python -m etl.download --only tour_occ_nim hicp
    python -m etl.download --skip-geo
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd
import requests

from etl import config
from etl.config import Candidate, EurostatDataset

USER_AGENT = "eu-markets-dashboard/1.0 (open-data ETL; python-requests)"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = USER_AGENT


class SourceError(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url: str, params=None, retries: int = 3, timeout: int = 180, accept: str | None = None) -> requests.Response:
    """GET with retries on network errors and 5xx / 429. 4xx fails fast."""
    headers = {"Accept": accept} if accept else {}
    for attempt in range(1, retries + 1):
        try:
            resp = SESSION.get(url, params=params, timeout=timeout, headers=headers)
            if resp.status_code < 400:
                return resp
            if resp.status_code < 500 and resp.status_code != 429:
                raise SourceError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            err: Exception = SourceError(f"HTTP {resp.status_code}")
        except requests.RequestException as exc:
            err = exc
        if attempt == retries:
            raise SourceError(str(err))
        wait = 2 ** attempt
        print(f"    attempt {attempt} failed ({err}); retrying in {wait}s")
        time.sleep(wait)
    raise SourceError("unreachable")


# --------------------------------------------------------------------- Eurostat
def eurostat_request(candidate: Candidate) -> dict:
    params = [("format", "JSON"), ("lang", "EN"), *candidate.params]
    url = config.EUROSTAT_API.format(code=candidate.code)
    doc = get(url, params=params).json()
    if "error" in doc and "value" not in doc:
        raise SourceError(json.dumps(doc["error"])[:300])
    if not doc.get("value"):
        raise SourceError("response has no observations")
    doc.setdefault("extension", {})["request_url"] = f"{url}?{urlencode(params)}"
    return doc


def fetch_eurostat(ds: EurostatDataset) -> tuple[dict | list, dict]:
    errors = []
    for cand in ds.candidates:
        try:
            doc = eurostat_request(cand)
            return doc, {"code": cand.code, "url": doc["extension"]["request_url"], "updated": doc.get("updated")}
        except SourceError as exc:
            errors.append(f"{cand.code}: {exc}")
            print(f"    candidate {cand.code} failed: {exc}")
    if ds.split_on:
        cand = ds.candidates[0]
        base = [p for p in cand.params if p[0] != ds.split_on]
        docs = []
        for key, value in cand.params:
            if key != ds.split_on:
                continue
            try:
                docs.append(eurostat_request(Candidate(cand.code, base + [(key, value)])))
            except SourceError as exc:
                print(f"    {ds.split_on}={value} skipped: {exc}")
        if docs:
            updated = max((d.get("updated") or "" for d in docs), default=None)
            return docs, {"code": cand.code, "url": config.EUROSTAT_API.format(code=cand.code),
                          "updated": updated or None, "split": len(docs)}
    raise SourceError("; ".join(errors))


# -------------------------------------------------------------------------- ECB
def fetch_ecb(series: config.EcbSeries) -> tuple[str, dict]:
    url = config.ECB_API.format(flow=series.flow, key=series.key)
    params = {"format": "csvdata", "startPeriod": series.start}
    text = get(url, params=params, accept="text/csv").text
    frame = pd.read_csv(StringIO(text))
    if frame.empty or "OBS_VALUE" not in frame:
        raise SourceError("no observations")
    last = str(frame["TIME_PERIOD"].max())
    return text, {"code": f"{series.flow}.{series.key}", "url": f"{url}?{urlencode(params)}", "updated": last}


# -------------------------------------------------------------------------- INE
def fetch_ine(table_id: int) -> tuple[list, dict]:
    url = config.INE_API.format(table_id=table_id)
    params = {"tip": "AM", "date": f"{config.SINCE_YEAR}0101:"}
    series = get(url, params=params).json()
    if not series:
        raise SourceError("empty table")
    last = max((p.get("Fecha") or "" for s in series for p in s.get("Data", [])), default="")
    return series, {"code": f"INE {table_id}", "url": f"{url}?{urlencode(params)}", "updated": last[:10] or None}


# ------------------------------------------------------------------------ GISCO
def fetch_gisco(files: list[str]) -> tuple[dict, dict]:
    errors = []
    for file in files:
        url = config.GISCO_API.format(file=file)
        try:
            geo = get(url).json()
            return geo, {"code": file, "url": url, "updated": None}
        except (SourceError, ValueError) as exc:
            errors.append(f"{file}: {exc}")
    raise SourceError("; ".join(errors))


# ---------------------------------------------------------------------- runner
def write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, str):
        path.write_text(payload, encoding="utf-8")
    else:
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def run_source(manifest: dict, key: str, path: Path, fetch, description: str) -> bool:
    print(f"- {key}")
    entry = {"description": description, "file": str(path.relative_to(config.ROOT))}
    try:
        payload, info = fetch()
        write(path, payload)
        entry.update(info, status="ok", fetched_at=now(), bytes=path.stat().st_size)
        print(f"    ok  {path.stat().st_size / 1e3:,.0f} kB  updated {info.get('updated')}")
        ok = True
    except Exception as exc:  # noqa: BLE001 - one bad source must not stop the refresh
        previous = manifest.get(key, {})
        entry.update({k: previous[k] for k in ("code", "url", "updated", "fetched_at") if k in previous})
        entry.update(status="stale" if path.exists() else "failed", error=str(exc)[:500])
        print(f"    FAILED ({entry['status']}): {exc}")
        ok = path.exists()
    manifest[key] = entry
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", help="source names to refresh")
    parser.add_argument("--skip-geo", action="store_true", help="do not download map boundaries")
    args = parser.parse_args(argv)
    wanted = set(args.only or [])

    def selected(name: str) -> bool:
        return not wanted or name in wanted

    manifest = json.loads(config.MANIFEST.read_text()) if config.MANIFEST.exists() else {}
    missing_core = []

    for ds in config.EUROSTAT_DATASETS:
        if not selected(ds.name):
            continue
        path = config.RAW_DIR / "eurostat" / f"{ds.name}.json"
        ok = run_source(manifest, f"eurostat.{ds.name}", path, lambda ds=ds: fetch_eurostat(ds), ds.description)
        if ds.core and not ok:
            missing_core.append(ds.name)

    for series in config.ECB_SERIES:
        if selected(series.name):
            path = config.RAW_DIR / "ecb" / f"{series.name}.csv"
            run_source(manifest, f"ecb.{series.name}", path, lambda s=series: fetch_ecb(s), series.description)

    for name, table_id in config.INE_TABLES.items():
        if selected(name):
            path = config.RAW_DIR / "ine" / f"{name}.json"
            run_source(manifest, f"ine.{name}", path, lambda t=table_id: fetch_ine(t),
                       f"INE IRSH table {table_id}")

    if not args.skip_geo:
        for name, files in config.GISCO_FILES.items():
            if selected(name):
                path = config.RAW_DIR / "gisco" / f"{name}.geojson"
                run_source(manifest, f"gisco.{name}", path, lambda f=files: fetch_gisco(f),
                           f"GISCO NUTS boundaries ({name})")

    config.MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    config.MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    statuses = [v["status"] for v in manifest.values()]
    print(f"\n{statuses.count('ok')} ok, {statuses.count('stale')} stale, {statuses.count('failed')} failed")
    if missing_core:
        print(f"Core sources missing: {', '.join(missing_core)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
