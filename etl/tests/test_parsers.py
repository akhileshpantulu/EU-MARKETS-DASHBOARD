"""Parser tests. avia_paoa_sample.json is a real Eurostat response (Balearic airports)."""
import itertools
import json
from pathlib import Path

from etl import jsonstat
from etl.load_raw import snake

SAMPLE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "avia_paoa_sample.json"


def test_jsonstat_matches_dense_expansion():
    doc = json.loads(SAMPLE.read_text())
    obs, labels = jsonstat.load(SAMPLE)
    cats = []
    for dim in doc["id"]:
        index = doc["dimension"][dim]["category"]["index"]
        cats.append(sorted(index, key=index.get))
    expected = sorted(
        (*combo, float(doc["value"][str(i)]))
        for i, combo in enumerate(itertools.product(*cats))
        if str(i) in doc["value"]
    )
    got = sorted(map(tuple, obs.drop(columns="flag").itertuples(index=False)))
    assert got == expected
    assert set(labels["dimension"]) == set(doc["id"])


def test_jsonstat_split_documents_are_merged():
    doc = json.loads(SAMPLE.read_text())
    obs_one, _ = jsonstat.load(SAMPLE)
    tmp = SAMPLE.parent / "_split_tmp.json"
    try:
        tmp.write_text(json.dumps([doc, doc]))
        obs_two, labels = jsonstat.load(tmp)
    finally:
        tmp.unlink()
    assert len(obs_two) == 2 * len(obs_one)
    assert not labels.duplicated(["dimension", "code"]).any()


def test_jsonstat_status_flags():
    doc = {"id": ["geo", "time"], "size": [1, 2], "value": {"0": 1, "1": 2}, "status": {"1": "p"},
           "dimension": {"geo": {"category": {"index": {"ES": 0}}},
                         "time": {"category": {"index": {"2024-01": 0, "2024-02": 1}}}}}
    obs = jsonstat.observations(doc)
    flags = obs.set_index("time")["flag"]
    assert flags.isna()["2024-01"]
    assert flags["2024-02"] == "p"


def test_snake():
    assert snake("ZONAS TURÍSTICAS") == "zonas_turisticas"
    assert snake("Tipo de dato") == "tipo_de_dato"
