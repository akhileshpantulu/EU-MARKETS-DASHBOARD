// Browser-side live layer. The site is built from a daily snapshot; these calls go
// straight to the ECB Data Portal and Eurostat APIs from the viewer's browser to
// show anything published since. Every call falls back silently to the snapshot.

const ECB = "https://data-api.ecb.europa.eu/service/data";
const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const TIMEOUT_MS = 8000;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "text/csv, application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const split = (line) => {
    const out = []; let cur = ""; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

let fxPromise = null;
/** Latest ~60 business days of ECB reference rates: [{currency_code, date, units_per_eur}]. */
export function liveFx(currencies) {
  if (!fxPromise) {
    const url = `${ECB}/EXR/D.${currencies.join("+")}.EUR.SP00.A?format=csvdata&detail=dataonly&lastNObservations=60`;
    fxPromise = fetchText(url).then((t) => parseCSV(t).map((r) => ({
      currency_code: r.CURRENCY || r.KEY?.split(".")[2],
      date: r.TIME_PERIOD,
      units_per_eur: Number(r.OBS_VALUE),
    })).filter((r) => r.currency_code && Number.isFinite(r.units_per_eur)));
  }
  return fxPromise;
}

const RATE_KEYS = {
  deposit_rate: "FM/D.U2.EUR.4F.KR.DFR.LEV",
  estr: "EST/B.EU000A2X2A25.WT",
  yield_10y: "YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y",
};
let ratesPromise = null;
/** Latest observations of the daily ECB rates: [{series_code, date, rate_pct}]. */
export function liveRates() {
  if (!ratesPromise) {
    ratesPromise = Promise.allSettled(Object.entries(RATE_KEYS).map(async ([code, key]) => {
      const t = await fetchText(`${ECB}/${key}?format=csvdata&detail=dataonly&lastNObservations=30`);
      return parseCSV(t).map((r) => ({ series_code: code, date: r.TIME_PERIOD, rate_pct: Number(r.OBS_VALUE) }));
    })).then((res) => {
      const ok = res.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
      if (!ok.length) throw new Error("no live rates");
      return ok;
    });
  }
  return ratesPromise;
}

/** Newest EU27 month of nights in Eurostat right now: {month, nights} or throws. */
export async function liveEuNights() {
  // The EU aggregate appears only once enough countries report, so the newest
  // period can be empty: ask for six and keep the latest one with a value.
  const url = `${EUROSTAT}/tour_occ_nim?format=JSON&lang=EN&geo=EU27_2020&unit=NR&c_resid=TOTAL&nace_r2=I551-I553&lastTimePeriod=6`;
  const doc = JSON.parse(await fetchText(url));
  const idx = doc.dimension.time.category.index;
  const months = Object.keys(idx).sort().reverse();
  for (const month of months) {
    const value = doc.value?.[String(idx[month])];
    if (Number.isFinite(value)) return { month, nights: value };
  }
  throw new Error("no EU value in the last six months");
}

/** Merge live rows into snapshot rows on (key, date); live wins. */
export function mergeRows(snapshot, live, key, dateKey = "date") {
  const m = new Map(snapshot.map((r) => [`${r[key]}|${r[dateKey]}`, r]));
  for (const r of live) m.set(`${r[key]}|${r[dateKey]}`, r);
  return [...m.values()].sort((a, b) => (a[key] === b[key] ? (a[dateKey] < b[dateKey] ? -1 : 1) : a[key] < b[key] ? -1 : 1));
}
