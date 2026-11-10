"""Write SYNTHETIC raw files in the exact formats the real APIs return.

The numbers are made up (seasonal curves with noise). They exist so the whole
pipeline (load -> dbt build -> export -> site) can be tested offline and in CI
without calling Eurostat, the ECB or INE. Never publish a site built from them:
the export marks every file with "synthetic": true and the site shows a banner.

Usage:
    python -m etl.fixtures tests/fixtures/raw
    RAW_DIR=tests/fixtures/raw python -m etl.load_raw
"""
from __future__ import annotations

import itertools
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from etl import config

RNG = random.Random(42)
COUNTRIES = {"ES": 3.2, "FR": 4.0, "IT": 3.6, "DE": 3.9, "EL": 1.3, "PT": 0.8, "HR": 1.0, "AT": 1.5, "NL": 1.2,
             "PL": 0.9, "SE": 0.6}
AGGREGATES = {"EU27_2020": 30.0, "EA20": 24.0}
REGIONS = {"ES53": ("ES", 0.20), "ES61": ("ES", 0.18), "ES70": ("ES", 0.20), "ES51": ("ES", 0.22),
           "ES30": ("ES", 0.12), "FRL0": ("FR", 0.12), "FR10": ("FR", 0.25), "ITF3": ("IT", 0.08),
           "ITI4": ("IT", 0.12), "EL62": ("EL", 0.15), "EL43": ("EL", 0.25), "PT15": ("PT", 0.30),
           "HR03": ("HR", 0.85), "DE21": ("DE", 0.12), "AT33": ("AT", 0.25)}
REGION_NAMES = {"ES53": "Illes Balears", "ES61": "Andalucía", "ES70": "Canarias", "ES51": "Cataluña",
                "ES30": "Comunidad de Madrid", "FRL0": "Provence-Alpes-Côte d'Azur", "FR10": "Ile-de-France",
                "ITF3": "Campania", "ITI4": "Lazio", "EL62": "Ionia Nisia", "EL43": "Kriti", "PT15": "Algarve",
                "HR03": "Jadranska Hrvatska", "DE21": "Oberbayern", "AT33": "Tirol"}
PARTNERS = ["DE", "UK", "FR", "NL", "IT", "ES", "US", "BE", "CH", "PL", "SE", "IE", "AT", "EL", "PT"]
SEASONAL_PEAK = {"ES": 0.45, "EL": 0.9, "HR": 1.0, "PT": 0.5, "IT": 0.55, "FR": 0.4, "DE": 0.25, "AT": 0.2,
                 "NL": 0.3, "PL": 0.3, "SE": 0.35}


def months(start: str = "2015-01", end: str = "2026-08") -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def level(year: int, month: int) -> float:
    """Demand level: steady growth, a 2020-21 collapse, recovery by 2023."""
    trend = 1 + 0.03 * (year - 2015)
    if (year, month) >= (2020, 3) and (year, month) <= (2021, 5):
        return trend * 0.25
    if year == 2021:
        return trend * 0.6
    if year == 2022:
        return trend * 0.92
    return trend


def season(month: int, amplitude: float) -> float:
    return 1 + amplitude * math.cos((month - 8) / 12 * 2 * math.pi)


def jsonstat(label: str, dims: dict[str, list[str]], value_fn, labels: dict | None = None) -> dict:
    ids = list(dims)
    sizes = [len(v) for v in dims.values()]
    values = {}
    for pos, combo in enumerate(itertools.product(*dims.values())):
        v = value_fn(dict(zip(ids, combo)))
        if v is not None:
            values[str(pos)] = round(v, 1)
    labels = labels or {}
    return {
        "version": "2.0", "class": "dataset", "label": f"[SYNTHETIC] {label}", "source": "ESTAT",
        "updated": "2026-10-01T23:00:00+0200", "value": values, "id": ids, "size": sizes,
        "dimension": {
            d: {"label": d, "category": {"index": {c: i for i, c in enumerate(codes)},
                                         "label": {c: labels.get(c, c) for c in codes}}}
            for d, codes in dims.items()
        },
    }


def base_nights(geo: str, ym: str) -> float:
    y, m = map(int, ym.split("-"))
    size = COUNTRIES.get(geo) or AGGREGATES.get(geo, 1.0)
    amp = SEASONAL_PEAK.get(geo, 0.4)
    return 1e6 * size * level(y, m) * season(m, amp) * (1 + RNG.uniform(-0.03, 0.03))


def eurostat_docs() -> dict[str, dict | list]:
    geos = list(AGGREGATES) + list(COUNTRIES)
    ms = months()
    geo_labels = {"EU27_2020": "European Union - 27 countries (from 2020)", "EA20": "Euro area – 20 countries",
                  **REGION_NAMES}
    nights_cache = {(g, t): base_nights(g, t) for g in geos for t in ms}
    foreign_share = {g: 0.35 + 0.4 * RNG.random() for g in geos}
    nace_share = {"I551-I553": 1.0, "I551": 0.62, "I552": 0.25, "I553": 0.13}
    resid_share = lambda g, r: {"TOTAL": 1, "FOR": foreign_share[g], "DOM": 1 - foreign_share[g]}[r]

    def nim(c):
        if c["time"] > "2026-07" and c["geo"] in ("EU27_2020", "EA20"):
            return None
        return nights_cache[(c["geo"], c["time"])] * nace_share[c["nace_r2"]] * resid_share(c["geo"], c["c_resid"])

    accom_dims = {"freq": ["M"], "c_resid": ["TOTAL", "DOM", "FOR"], "unit": ["NR"],
                  "nace_r2": list(nace_share), "geo": geos, "time": ms}
    docs = {
        "tour_occ_nim": jsonstat("Nights spent", accom_dims, nim, geo_labels),
        "tour_occ_arm": jsonstat("Arrivals", accom_dims, lambda c: (nim(c) or 0) / (3 + foreign_share[c["geo"]] * 2)
                                 if nim(c) else None, geo_labels),
        "tour_occ_mnor": jsonstat(
            "Net occupancy", {"freq": ["M"], "accomunit": ["BEDPL", "BEDRM"], "unit": ["PC"], "geo": geos, "time": ms},
            lambda c: min(95, 55 * level(*map(int, c["time"].split("-")))
                          * season(int(c["time"][5:]), SEASONAL_PEAK.get(c["geo"], 0.4) * 0.6)
                          * (1.15 if c["accomunit"] == "BEDRM" else 1)), geo_labels),
    }
    years = [str(y) for y in range(2015, 2026)]
    docs["tour_cap_nat"] = jsonstat(
        "Capacity", {"freq": ["A"], "accomunit": ["ESTBL", "BEDRM", "BEDPL"], "unit": ["NR"],
                     "nace_r2": list(nace_share), "geo": geos, "time": years},
        lambda c: (COUNTRIES.get(c["geo"]) or AGGREGATES[c["geo"]]) * nace_share[c["nace_r2"]]
        * {"ESTBL": 8000, "BEDRM": 180000, "BEDPL": 420000}[c["accomunit"]] * (1 + 0.01 * (int(c["time"]) - 2015)),
        geo_labels)

    def annual(geo, year, nace="I551-I553"):
        return sum(nights_cache[(geo, f"{year}-{m:02d}")] for m in range(1, 13)) * nace_share[nace]

    partner_weight = {p: RNG.uniform(0.02, 0.25) for p in PARTNERS}

    def ninraw(c):
        g, p, y = c["geo"], c["c_resid"], int(c["time"])
        if y > 2025:
            return None
        tot = annual(g, y)
        if p == "TOTAL":
            return tot
        if p == "FOR":
            return tot * foreign_share[g]
        if p == g:
            return tot * (1 - foreign_share[g])
        return tot * foreign_share[g] * partner_weight[p] / sum(partner_weight.values()) * 0.8

    docs["tour_occ_ninraw"] = jsonstat(
        "Nights by residence", {"freq": ["A"], "c_resid": ["TOTAL", "FOR", *PARTNERS], "unit": ["NR"],
                                "nace_r2": ["I551-I553"], "geo": list(COUNTRIES), "time": years},
        ninraw, {"UK": "United Kingdom", "US": "United States", "FOR": "Foreign country", "TOTAL": "Total"})

    def region_month(r, ym):
        country, share = REGIONS[r]
        return nights_cache[(country, ym)] * share * season(int(ym[5:]), 0.2 if r in ("FR10", "ES30") else 0.6)

    docs["tour_occ_nin2"] = jsonstat(
        "Regional nights", {"freq": ["A"], "c_resid": ["TOTAL", "DOM", "FOR"], "unit": ["NR"],
                            "nace_r2": ["I551-I553"], "geo": list(REGIONS), "time": years},
        lambda c: sum(region_month(c["geo"], f"{c['time']}-{m:02d}") for m in range(1, 13))
        * resid_share(REGIONS[c["geo"]][0], c["c_resid"]), geo_labels)
    mcodes = ["TOTAL"] + [f"M{m:02d}" for m in range(1, 13)]
    docs["tour_occ_nin2m"] = jsonstat(
        "Regional nights monthly", {"c_resid": ["TOTAL"], "unit": ["NR"], "month": mcodes,
                                    "geo": list(REGIONS), "time": [str(y) for y in range(2020, 2026)]},
        lambda c: (sum(region_month(c["geo"], f"{c['time']}-{m:02d}") for m in range(1, 13))
                   if c["month"] == "TOTAL" else region_month(c["geo"], f"{c['time']}-{c['month'][1:]}")),
        geo_labels)
    plat_geo = ["EU27_2020", *COUNTRIES, *REGIONS]

    def platform(c):
        y, m = int(c["time"]), c["month"]
        if y == 2026 and m not in ("M01", "M02", "M03"):
            return None
        if m == "TOTAL":
            return None
        g = c["geo"]
        base = nights_cache[(g, f"{y}-{m[1:]}")] if g not in REGIONS else region_month(g, f"{y}-{m[1:]}")
        return base * 0.22

    docs["tour_ce_omn12"] = jsonstat(
        "Platform nights", {"indic_to": ["NGT_SP"], "c_resid": ["TOTAL"], "month": mcodes, "geo": plat_geo,
                            "time": [str(y) for y in range(2018, 2027)]}, platform, geo_labels)

    def air(c):
        if c["time"] > "2026-06":
            return None
        tot = nights_cache[(c["geo"], c["time"])] * 0.9
        return {"TOTAL": tot, "NAT": tot * 0.3, "INTL": tot * 0.7}[c["tra_cov"]]

    docs["avia_paoc"] = jsonstat(
        "Air passengers", {"freq": ["M"], "unit": ["PAS"], "tra_meas": ["PAS_CRD"], "schedule": ["TOTAL"],
                           "tra_cov": ["TOTAL", "NAT", "INTL"], "geo": geos, "time": ms}, air, geo_labels)
    airports = [a for a in config.AIRPORTS if a[:2] in COUNTRIES]
    docs["avia_paoa"] = [jsonstat(
        "Airport passengers", {"freq": ["M"], "unit": ["PAS"], "tra_meas": ["PAS_CRD"], "rep_airp": [a],
                               "schedule": ["TOTAL"], "tra_cov": ["TOTAL"], "time": ms},
        lambda c: None if c["time"] > "2026-06" else nights_cache[(c["rep_airp"][:2], c["time"])] * RNG.uniform(.05, .3))
        for a in airports]

    def hicp(c):
        y, m = map(int, c["time"].split("-"))
        base = {"TOTAL": 2.0, "CP111": 3.5, "CP112": 5.0}[c["coicop18"]]
        shock = 6 if (y == 2022 or (y == 2023 and m < 6)) else 0
        return base + shock * (0.5 if c["coicop18"] == "TOTAL" else 1) + RNG.uniform(-1, 1)

    docs["hicp"] = jsonstat("HICP", {"freq": ["M"], "unit": ["RCH_A"], "coicop18": ["TOTAL", "CP111", "CP112"],
                                     "geo": geos, "time": ms}, hicp, geo_labels)
    docs["sts_setu_m"] = jsonstat(
        "Services turnover", {"freq": ["M"], "indic_bt": ["VOL_SLS"], "nace_r2": ["I55", "I56"], "s_adj": ["SCA"],
                              "unit": ["I21"], "geo": geos, "time": ms},
        lambda c: 100 * level(*map(int, c["time"].split("-"))) / level(2021, 6), geo_labels)
    docs["une_rt_m"] = jsonstat(
        "Unemployment", {"freq": ["M"], "s_adj": ["SA"], "age": ["TOTAL"], "sex": ["T"], "unit": ["PC_ACT"],
                         "geo": geos, "time": ms},
        lambda c: max(2.5, 12 - 0.6 * (int(c["time"][:4]) - 2015) + (3 if c["geo"] in ("ES", "EL") else 0)),
        geo_labels)
    docs["ei_bsco_m"] = jsonstat(
        "Consumer confidence", {"freq": ["M"], "indic": ["BS-CSMCI"], "s_adj": ["SA"], "unit": ["BAL"],
                                "geo": geos, "time": ms},
        lambda c: -10 + 8 * math.sin(int(c["time"][:4]) + int(c["time"][5:]) / 6), geo_labels)
    quarters = [f"{y}-Q{q}" for y in range(2015, 2027) for q in range(1, 5) if (y, q) <= (2026, 2)]
    docs["namq_10_gdp"] = jsonstat(
        "GDP", {"freq": ["Q"], "unit": ["CLV_PCH_SM"], "s_adj": ["SCA"], "na_item": ["B1GQ"], "geo": geos,
                "time": quarters}, lambda c: 1.5 + RNG.uniform(-1, 1) + (-12 if c["time"] == "2020-Q2" else 0),
        geo_labels)
    docs["irt_lt_mcby_m"] = jsonstat(
        "Bond yields", {"freq": ["M"], "int_rt": ["MCBY"], "geo": list(COUNTRIES), "time": ms},
        lambda c: max(-0.5, 1 + (2 if c["time"] >= "2022-06" else 0) + (1 if c["geo"] in ("IT", "EL") else 0)),
        geo_labels)
    currencies = ["USD", "GBP", "CHF", "SEK", "PLN"]
    fx_base = {"USD": 1.1, "GBP": 0.86, "CHF": 1.0, "SEK": 11, "PLN": 4.3}
    docs["ert_bil_eur_m"] = jsonstat(
        "FX", {"freq": ["M"], "statinfo": ["AVG"], "unit": ["NAC"], "currency": currencies, "time": ms},
        lambda c: fx_base[c["currency"]] * (1 + RNG.uniform(-0.04, 0.04)))
    docs["demo_gind"] = jsonstat(
        "Population", {"freq": ["A"], "indic_de": ["JAN"], "geo": geos, "time": years},
        lambda c: 1e7 * (COUNTRIES.get(c["geo"]) or AGGREGATES[c["geo"]]) * 1.3, geo_labels)
    return docs


def ecb_csvs() -> dict[str, str]:
    start = date(2023, 1, 2)
    days = [start + timedelta(days=i) for i in range((date(2026, 11, 7) - start).days) if
            (start + timedelta(days=i)).weekday() < 5]
    rows = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"]
    for cur, base in {"USD": 1.1, "GBP": 0.86, "CHF": 0.95, "SEK": 11.2, "PLN": 4.3, "JPY": 160.0}.items():
        v = base
        for d in days:
            v *= 1 + RNG.gauss(0, 0.003)
            rows.append(f"EXR.D.{cur}.EUR.SP00.A,D,{cur},EUR,SP00,A,{d.isoformat()},{v:.4f}")
    out = {"fx_daily": "\n".join(rows) + "\n"}

    def series(key: str, fn, monthly: bool = False) -> str:
        lines = ["KEY,FREQ,TIME_PERIOD,OBS_VALUE"]
        if monthly:
            for ym in months("2015-01", "2026-10"):
                lines.append(f"{key},M,{ym},{fn(int(ym[:4])):.3f}")
        else:
            for d in days:
                lines.append(f"{key},D,{d.isoformat()},{fn(d.year):.3f}")
        return "\n".join(lines) + "\n"

    out["deposit_rate"] = series("FM.D.U2.EUR.4F.KR.DFR.LEV", lambda y: {2023: 3.75, 2024: 3.25}.get(y, 2.0))
    out["estr"] = series("EST.B.EU000A2X2A25.WT", lambda y: {2023: 3.65, 2024: 3.15}.get(y, 1.92))
    out["euribor_3m"] = series("FM.M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA", lambda y: max(-0.5, (y - 2021) * 1.2), True)
    out["yield_10y"] = series("YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", lambda y: 2.4 + RNG.uniform(-0.2, 0.2))
    return out


def ine_tables() -> dict[str, list]:
    zones = {"Baleares (Illes): Isla De Mallorca": 160, "Andalucía: Costa Del Sol (Málaga)": 140,
             "Canarias: Isla De Tenerife": 130, "Cataluña: Barcelona": 170, "Pirineo Aragonés": 90}
    out = {}
    for name, (concept, factor) in {"irsh_zone_adr": ("Tarifa media diaria (ADR)", 1.0),
                                    "irsh_zone_revpar": ("Ingresos por habitación disponible (RevPAR)", 0.7)}.items():
        series = []
        for zone, adr in zones.items():
            for tipo in ("Dato", "Tasa de variación interanual"):
                data = []
                for ym in months("2021-01", "2026-09"):
                    y, m = int(ym[:4]), int(ym[5:])
                    val = adr * (1 + 0.06 * (y - 2021)) * season(m, 0.35) * factor * (season(m, 0.3) if factor < 1 else 1)
                    data.append({"Fecha": f"{ym}-01T00:00:00.000+02:00", "T3_TipoDato": "Provisional" if y == 2026
                                 else "Definitivo", "T3_Periodo": f"M{m:02d}", "Anyo": y,
                                 "Valor": round(val if tipo == "Dato" else 5.0, 2)})
                series.append({"COD": f"SYN{len(series)}", "Nombre": f"{zone}. {concept}. Total categorías. {tipo}. ",
                               "T3_Unidad": "Euros", "MetaData": [
                                   {"T3_Variable": "ZONAS TURÍSTICAS", "Nombre": zone},
                                   {"T3_Variable": "Concepto turístico", "Nombre": concept},
                                   {"T3_Variable": "TIPO DE CATEGORIA", "Nombre": "Total categorías"},
                                   {"T3_Variable": "Tipo de dato", "Nombre": tipo}], "Data": data})
        out[name] = series
    return out


def square(code: str, name: str, x: float, y: float, size: float) -> dict:
    ring = [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
    return {"type": "Feature", "properties": {"NUTS_ID": code, "NAME_LATN": name, "CNTR_CODE": code[:2]},
            "geometry": {"type": "Polygon", "coordinates": [ring]}}


def geojson() -> dict[str, dict]:
    pos = {"ES": (-8, 37), "PT": (-10, 38), "FR": (-2, 44), "IT": (9, 40), "DE": (7, 49), "AT": (11, 46.5),
           "NL": (4, 51.5), "PL": (16, 50), "SE": (12, 58), "EL": (21, 37), "HR": (14, 44.5)}
    countries = [square(c, c, x, y, 3) for c, (x, y) in pos.items()]
    regions = []
    for i, (code, (country, _)) in enumerate(REGIONS.items()):
        x, y = pos[country]
        regions.append(square(code, REGION_NAMES[code], x + (i % 3), y + (i % 2), 1))
    fc = lambda feats: {"type": "FeatureCollection", "features": feats}
    return {"countries": fc(countries), "regions_2024": fc(regions), "regions_2021": fc(regions)}


def main(out_dir: str) -> None:
    root = Path(out_dir)
    manifest = {}
    for name, doc in eurostat_docs().items():
        path = root / "eurostat" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc), encoding="utf-8")
        manifest[f"eurostat.{name}"] = {"status": "ok", "code": name, "description": "SYNTHETIC fixture",
                                         "updated": "2026-10-01T23:00:00+0200", "fetched_at": "2026-11-01T06:00:00Z",
                                         "url": "synthetic"}
    for name, text in ecb_csvs().items():
        path = root / "ecb" / f"{name}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        manifest[f"ecb.{name}"] = {"status": "ok", "code": name, "description": "SYNTHETIC fixture", "url": "synthetic"}
    for name, series in ine_tables().items():
        path = root / "ine" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(series, ensure_ascii=False), encoding="utf-8")
        manifest[f"ine.{name}"] = {"status": "ok", "code": name, "description": "SYNTHETIC fixture", "url": "synthetic"}
    for name, fc in geojson().items():
        path = root / "gisco" / f"{name}.geojson"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(fc), encoding="utf-8")
        manifest[f"gisco.{name}"] = {"status": "ok", "code": name, "description": "SYNTHETIC fixture"}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Synthetic fixtures written to {root}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/raw")
