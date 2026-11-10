"""Print the shape of each public API response, for developing new sources.

Runs in the 'Probe APIs' workflow (GitHub runners can reach every API).
Usage: python scripts/probe_apis.py [section ...]
Sections: eurostat, routes, oecd, openmeteo, inept
"""
from __future__ import annotations

import json
import re
import sys
from io import StringIO

import pandas as pd
import requests

S = requests.Session()
S.headers["User-Agent"] = "eu-markets-dashboard/1.0 (open-data ETL; probe)"
ES = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"


def head(title):
    print(f"\n{'=' * 20} {title}")


def eurostat_shape(code, params):
    r = S.get(ES + code, params=[("format", "JSON"), ("lang", "EN"), *params], timeout=120)
    print(code, r.status_code, len(r.content), "bytes")
    try:
        d = r.json()
    except ValueError:
        print(r.text[:300]); return None
    if "error" in d and "value" not in d:
        print("ERROR", json.dumps(d["error"])[:400]); return None
    print(" id", d["id"], "size", d["size"], "n_values", len(d.get("value", {})))
    for dim in d["id"]:
        labs = d["dimension"][dim]["category"].get("label", {})
        items = list(labs.items())
        print(f"  {dim} ({len(items)}):", items[:6])
    return d


def eurostat():
    head("Eurostat: demand-side candidates")
    eurostat_shape("sts_trtu_m", [("freq", "M"), ("nace_r2", "G47"), ("indic_bt", "VOL_SLS"), ("unit", "I21"),
                                  ("s_adj", "SCA"), ("geo", "DE"), ("lastTimePeriod", "2")])
    eurostat_shape("prc_hpi_q", [("geo", "DE"), ("lastTimePeriod", "2")])
    eurostat_shape("tour_dem_tttot", [("geo", "DE"), ("lastTimePeriod", "1")])
    eurostat_shape("tour_dem_ttw", [("geo", "DE"), ("lastTimePeriod", "1")])
    eurostat_shape("tour_dem_extot", [("geo", "DE"), ("lastTimePeriod", "1")])
    eurostat_shape("namq_10_fcs", [("geo", "DE"), ("lastTimePeriod", "1")])


def routes():
    head("Eurostat: routes and all airports")
    eurostat_shape("avia_par_mt", [("freq", "M"), ("unit", "PAS"), ("tra_meas", "PAS_CRD"), ("lastTimePeriod", "1")])
    eurostat_shape("avia_par_es", [("freq", "M"), ("unit", "PAS"), ("tra_meas", "PAS_CRD"), ("lastTimePeriod", "1")])
    d = eurostat_shape("avia_paoa", [("freq", "M"), ("unit", "PAS"), ("tra_meas", "PAS_CRD"), ("schedule", "TOTAL"),
                                     ("tra_cov", "TOTAL"), ("lastTimePeriod", "1")])
    if d:
        print(" airports with a value:", len(d["value"]))


def oecd():
    head("OECD SDMX")
    base = "https://sdmx.oecd.org/public/rest/data/"
    for key in ["OECD.SDD.STES,DSD_STES@DF_CLI,4.1/.M.LI.IX._Z.AA.IX._Z.H",
                "OECD.SDD.STES,DSD_STES@DF_CLI,4.1/.M.CCICP.IX._Z.AA.IX._Z.H"]:
        r = S.get(base + key, params={"startPeriod": "2026-01", "dimensionAtObservation": "AllDimensions",
                                      "format": "csvfilewithlabels"}, timeout=120)
        print(key, r.status_code, len(r.content))
        if r.ok:
            df = pd.read_csv(StringIO(r.text))
            print(" columns:", list(df.columns))
            print(df[["REF_AREA", "TIME_PERIOD", "OBS_VALUE"]].head(3).to_string())
            print(" areas:", sorted(df["REF_AREA"].unique())[:80])
        else:
            print(r.text[:300])


def openmeteo():
    head("Open-Meteo archive")
    r = S.get("https://archive-api.open-meteo.com/v1/archive", params={
        "latitude": "39.55,41.30", "longitude": "2.74,2.08", "start_date": "2026-10-01", "end_date": "2026-10-03",
        "daily": "temperature_2m_mean,temperature_2m_max,precipitation_sum,sunshine_duration", "timezone": "UTC"},
        timeout=120)
    print(r.status_code, r.text[:900])


def inept():
    head("Statistics Portugal (INE.pt): scan for tourism indicators")
    meta_url = "https://www.ine.pt/ine/json_indicador/pindicaMeta.jsp"
    pattern = re.compile(r"revpar|adr|room|accommodation|overnight|guest|quarto|aposento|alojamento|dormida", re.I)
    ranges = [range(9800, 9830), range(10725, 10765), range(12080, 12115), range(13560, 13600)]
    first = True
    hits = []
    for rg in ranges:
        for n in rg:
            code = f"{n:07d}"
            try:
                m = S.get(meta_url, params={"varcd": code, "lang": "EN"}, timeout=30).json()
            except Exception as exc:  # noqa: BLE001
                print(code, "error", exc, flush=True); continue
            m0 = m[0] if isinstance(m, list) and m else m
            if first:
                print("META SHAPE", json.dumps(m0, ensure_ascii=False)[:1500], flush=True)
                first = False
            text = json.dumps(m0, ensure_ascii=False)
            name = next((str(v) for k, v in m0.items() if "nome" in k.lower() or "name" in k.lower()), text[:150]) \
                if isinstance(m0, dict) else text[:150]
            flag = "*" if pattern.search(name) else " "
            print(flag, code, name[:170], flush=True)
            if re.search(r"revpar|average daily rate|\badr\b", name, re.I):
                hits.append((code, m0))
    for code, m0 in hits[:2]:
        print("\nFULL META", code, json.dumps(m0, ensure_ascii=False)[:3000], flush=True)
        dims = {}
        data = S.get("https://www.ine.pt/ine/json_indicador/pindica.jsp",
                     params={"op": "2", "varcd": code, "lang": "EN"}, timeout=60)
        print("DATA (latest period)", data.status_code, data.text[:1500], flush=True)


def inept_catalog():
    head("INE.pt catalogue search")
    for url in ["https://www.ine.pt/ine/xml_indic.jsp?opc=3&lang=EN",
                "https://www.ine.pt/ine/xml_indic.jsp?opc=1&lang=EN"]:
        try:
            r = S.get(url, timeout=180)
        except Exception as exc:  # noqa: BLE001
            print(url, "error", exc, flush=True); continue
        print(url, r.status_code, len(r.content), r.headers.get("content-type"), flush=True)
        text = r.text
        print(" head:", text[:600].replace("\n", " "), flush=True)
        for m in re.finditer(r"(?i)revpar|average daily rate|per available room|per occupied room|bed[- ]places? occupancy", text):
            start = max(0, m.start() - 700)
            print("  ...", text[start:m.end() + 300].replace("\n", " "), flush=True)
            print("-----", flush=True)
        if "RevPAR" in text or "revpar" in text.lower():
            break
    meta_url = "https://www.ine.pt/ine/json_indicador/pindicaMeta.jsp"
    for code in ["0012091", "0012092"]:
        m = S.get(meta_url, params={"varcd": code, "lang": "EN"}, timeout=60).json()
        m0 = m[0] if isinstance(m, list) else m
        dims = m0.get("Dimensoes", {})
        print("\nMETA", code, m0.get("IndicadorNome"), m0.get("PrimeiroPeriodo"), m0.get("UltimoPeriodo"), m0.get("UnidadeMedida"))
        print(" dims:", json.dumps(dims.get("Descricao_Dim"), ensure_ascii=False))
        cats = dims.get("Categoria_Dim", [{}])[0]
        for key in list(cats)[-40:]:
            if not key.startswith("Dim_Num1"):
                print("  ", key, json.dumps(cats[key], ensure_ascii=False)[:200])
        last = [k for k in cats if k.startswith("Dim_Num1")][-1].split("_")[-1]
        data = S.get("https://www.ine.pt/ine/json_indicador/pindica.jsp",
                     params={"op": "2", "varcd": code, "Dim1": last, "lang": "EN"}, timeout=60)
        print(" DATA", last, data.status_code, data.text[:1800], flush=True)


SECTIONS = {"eurostat": eurostat, "routes": routes, "oecd": oecd, "openmeteo": openmeteo, "inept": inept, "inept_catalog": inept_catalog}

if __name__ == "__main__":
    for name in sys.argv[1:] or SECTIONS:
        try:
            SECTIONS[name]()
        except Exception as exc:  # noqa: BLE001
            print(f"{name} failed: {exc!r}")
