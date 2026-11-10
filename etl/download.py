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
import csv
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
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


def fetch_fan_out(ds: EurostatDataset) -> tuple[list, dict]:
    """One request per dataset in ds.fan_out (e.g. avia_par_es, avia_par_it ...)."""
    cand = ds.candidates[0]
    docs, failed = [], []
    for item in ds.fan_out:
        code = cand.code.format(code=item)
        try:
            docs.append(eurostat_request(Candidate(code, cand.params)))
        except SourceError as exc:
            failed.append(code)
            print(f"    {code} skipped: {exc}")
    if not docs:
        raise SourceError(f"every dataset failed: {', '.join(failed)}")
    updated = max((d.get("updated") or "" for d in docs), default="")
    return docs, {"code": cand.code.format(code="*"), "url": config.EUROSTAT_API.format(code=cand.code),
                  "updated": updated or None, "datasets": len(docs), "skipped": failed}


def fetch_eurostat(ds: EurostatDataset) -> tuple[dict | list, dict]:
    if ds.fan_out:
        return fetch_fan_out(ds)
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


# ------------------------------------------------------------------------- OECD
def fetch_oecd(key: str) -> tuple[str, dict]:
    url = config.OECD_API.format(key=key)
    params = {"startPeriod": f"{config.SINCE_YEAR}-01", "dimensionAtObservation": "AllDimensions",
              "format": "csvfilewithlabels"}
    text = get(url, params=params, accept="text/csv").text
    frame = pd.read_csv(StringIO(text))
    if frame.empty or "OBS_VALUE" not in frame:
        raise SourceError("no observations")
    return text, {"code": key.split("/")[0], "url": f"{url}?{urlencode(params)}",
                  "updated": str(frame["TIME_PERIOD"].max())}


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


# -------------------------------------------------------- Statistics Portugal
def run_inept(manifest: dict) -> None:
    """One file per indicator and month in data/raw/inept/<name>/<S3Ayyyymm>.json."""
    for name, code in config.INEPT_INDICATORS.items():
        key = f"inept.{name}"
        print(f"- {key}")
        out_dir = config.RAW_DIR / "inept" / name
        out_dir.mkdir(parents=True, exist_ok=True)
        entry = {"description": f"Statistics Portugal indicator {code} ({name.replace('_', ' ')})",
                 "file": str(out_dir.relative_to(config.ROOT)), "code": f"INE.pt {code}",
                 "url": f"{config.INEPT_DATA_API}?op=2&varcd={code}&lang=EN"}
        try:
            meta = get(config.INEPT_META_API, params={"varcd": code, "lang": "EN"}).json()
            meta = meta[0] if isinstance(meta, list) else meta
            cats = meta["Dimensoes"]["Categoria_Dim"][0]
            periods = sorted(k.split("_")[-1] for k in cats if k.startswith("Dim_Num1_"))
            recent = set(periods[-config.INEPT_REFRESH_MONTHS:])
            # Values are published in units of 10^Potencia10 (lodging income: thousands of euros).
            power10 = int(meta.get("Potencia10") or 0)
            fetched = 0
            for period in periods:
                path = out_dir / f"{period}.json"
                if path.exists() and period not in recent:
                    try:
                        if "power10" in json.loads(path.read_text(encoding="utf-8")):
                            continue
                    except ValueError:
                        pass
                payload = get(config.INEPT_DATA_API, params={"op": "2", "varcd": code, "Dim1": period,
                                                              "lang": "EN"}).json()
                body = payload[0] if isinstance(payload, list) else payload
                if "Dados" not in body:
                    print(f"    {period}: no data ({str(body)[:120]})")
                    continue
                path.write_text(json.dumps({"period": period, "power10": power10, "Dados": body["Dados"]},
                                           ensure_ascii=False),
                                encoding="utf-8")
                fetched += 1
                time.sleep(0.3)
            entry.update(status="ok", fetched_at=now(), updated=meta.get("UltimoPeriodo"),
                         periods=len(periods), fetched_this_run=fetched)
            print(f"    ok  {len(periods)} periods, {fetched} fetched, latest {meta.get('UltimoPeriodo')}")
        except Exception as exc:  # noqa: BLE001
            previous = manifest.get(key, {})
            entry.update({k: previous[k] for k in ("updated", "fetched_at") if k in previous})
            entry.update(status="stale" if any(out_dir.glob("*.json")) else "failed", error=str(exc)[:300])
            print(f"    FAILED ({entry['status']}): {exc}")
        manifest[key] = entry


# ------------------------------------------------------------------- weather
def weather_tasks(today: date) -> list[tuple[str, float, float, int]]:
    """(location, lat, lon, year) still to fetch: the current year always, then
    missing or incomplete past years, newest first, up to the per-run budget."""
    with open(config.WEATHER_LOCATIONS, newline="", encoding="utf-8") as f:
        locations = [(r["location_code"], float(r["latitude"]), float(r["longitude"])) for r in csv.DictReader(f)]
    current = [(code, lat, lon, today.year) for code, lat, lon in locations]
    past = []
    for year in range(today.year - 1, config.WEATHER_START_YEAR - 1, -1):
        for code, lat, lon in locations:
            path = config.RAW_DIR / "openmeteo" / f"{code}_{year}.json"
            complete = False
            if path.exists():
                try:
                    days = json.loads(path.read_text())["daily"]["time"]
                    complete = bool(days) and days[-1] == f"{year}-12-31"
                except (ValueError, KeyError):
                    complete = False
            if not complete:
                past.append((code, lat, lon, year))
    return current + past[: config.WEATHER_BACKFILL_PER_RUN]


def run_weather(manifest: dict) -> None:
    print("- openmeteo.weather")
    today = date.today()
    last_day = today - timedelta(days=6)   # the archive lags about five days
    out_dir = config.RAW_DIR / "openmeteo"
    out_dir.mkdir(parents=True, exist_ok=True)
    tasks = weather_tasks(today)
    done, error = 0, None
    for code, lat, lon, year in tasks:
        end = min(date(year, 12, 31), last_day)
        if end < date(year, 1, 1):
            continue
        params = {"latitude": lat, "longitude": lon, "start_date": f"{year}-01-01", "end_date": end.isoformat(),
                  "daily": config.WEATHER_DAILY, "timezone": "UTC"}
        try:
            payload = get(config.OPENMETEO_API, params=params, retries=2).json()
            if "daily" not in payload:
                raise SourceError(str(payload)[:200])
        except (SourceError, ValueError) as exc:
            error = str(exc)
            print(f"    {code} {year} failed: {exc}; stopping weather for this run")
            break
        payload["location_code"] = code
        (out_dir / f"{code}_{year}.json").write_text(json.dumps(payload, separators=(",", ":")))
        done += 1
        time.sleep(config.WEATHER_PAUSE_SECONDS)
    files = sorted(out_dir.glob("*.json"))
    remaining = len(weather_tasks(today)) - len({t[0] for t in tasks if t[3] == today.year})
    status = "ok" if error is None else ("stale" if files else "failed")
    manifest["openmeteo.weather"] = {
        "description": "Open-Meteo ERA5 daily weather for main destinations",
        "file": str(out_dir.relative_to(config.ROOT)), "code": "archive-api daily",
        "url": config.OPENMETEO_API, "updated": last_day.isoformat(), "fetched_at": now(), "status": status,
        "location_years": len(files), "fetched_this_run": done, "backfill_remaining": max(remaining, 0),
        **({"error": error[:300]} if error else {}),
    }
    print(f"    {done} location-years fetched, {len(files)} on disk, backfill remaining {max(remaining, 0)}")


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

    for name, (key, description) in config.OECD_SERIES.items():
        if selected(name):
            path = config.RAW_DIR / "oecd" / f"{name}.csv"
            run_source(manifest, f"oecd.{name}", path, lambda k=key: fetch_oecd(k), description)
            time.sleep(3)   # the OECD API rate-limits bursts

    for name, table_id in config.INE_TABLES.items():
        if selected(name):
            path = config.RAW_DIR / "ine" / f"{name}.json"
            run_source(manifest, f"ine.{name}", path, lambda t=table_id: fetch_ine(t),
                       f"INE IRSH table {table_id}")

    if selected("inept"):
        run_inept(manifest)

    if selected("weather"):
        run_weather(manifest)

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
