// Report builder: choose a level (country, region or airport), one place or up to four to compare,
// the sections and analytics to include, and a window of years. Renders a print-ready document
// (Save as PDF from the browser) and an Excel workbook in HG format (ExcelJS, loaded on demand).
import { loadTable, isNum, h, select, segmented, fmtDec, monthName, groupBy } from "./util.js";
import { setChartScope, palette, legendHTML, css, empty, initChart } from "./charts.js";

const EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const JSZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const MAX_CMP = 4;
const YEAR_SPANS = [3, 5, 10, 15, 20];
const LEVELS = [{ value: "country", label: "Country" }, { value: "region", label: "Region" }, { value: "airport", label: "Airport" }];

const SECTIONS = {
  country: [
    ["summary", "Executive summary"], ["demand", "Demand: nights and arrivals"], ["occupancy", "Occupancy and length of stay"],
    ["seasonality", "Seasonality"], ["regions", "Regions"], ["sources", "Source markets"], ["rentals", "Short-stay rentals"],
    ["air", "Air traffic"], ["prices", "Prices"], ["macro", "Macro backdrop"], ["weather", "Weather"],
    ["hotels", "Hotel prices (Spain, Portugal)"], ["fx", "Exchange rate"],
  ],
  region: [
    ["summary", "Executive summary"], ["demand", "Demand: nights"], ["share", "Share of national nights"],
    ["seasonality", "Seasonality"], ["rentals", "Short-stay rentals"], ["weather", "Weather"],
  ],
  airport: [
    ["summary", "Executive summary"], ["traffic", "Passenger traffic"], ["seasonality", "Seasonality"],
    ["origins", "Origin countries"], ["routes", "Top routes"],
  ],
};
const ANALYTICS = [
  ["yoy", "Year-on-year change"], ["cagr", "Compound annual growth"], ["index", "Indexed growth (first year = 100)"],
  ["base", "Change vs 2019"], ["monthly", "Monthly detail for the final year"], ["share", "Share of the wider total"],
  ["intensity", "Nights per resident (countries)"], ["tables", "Data tables"], ["commentary", "Written commentary"],
];
const DEFAULT_ANALYTICS = ["yoy", "cagr", "index", "base", "monthly", "share", "commentary"];

// ------------------------------------------------------------------ metrics
// kind: sum (flows), rate01 (0-1 share), pct (percent), level, index, eur. Changes are ratios for
// sum / index / eur (and ratio: true), differences otherwise.
const M = {
  nights: { label: "Nights spent", kind: "sum" },
  nights_foreign: { label: "Nights by foreign guests", kind: "sum" },
  nights_domestic: { label: "Nights by domestic guests", kind: "sum" },
  arrivals: { label: "Arrivals", kind: "sum" },
  hotel_nights: { label: "Hotel nights", kind: "sum" },
  bed_place_occupancy_rate: { label: "Bed-place occupancy", kind: "rate01" },
  room_occupancy_rate: { label: "Hotel room occupancy", kind: "rate01" },
  avg_length_of_stay: { label: "Average length of stay (nights)", kind: "level", digits: 2 },
  foreign_share: { label: "Foreign share of nights", kind: "rate01" },
  peak_two_month_share: { label: "Share of nights in the two busiest months", kind: "rate01" },
  platform_nights: { label: "Short-stay platform nights", kind: "sum" },
  platform_share: { label: "Platform nights as a share of all nights", kind: "rate01" },
  air_passengers: { label: "Air passengers", kind: "sum" },
  air_passengers_international: { label: "International air passengers", kind: "sum" },
  hicp_accommodation_pct: { label: "Accommodation services inflation (%)", kind: "pct" },
  hicp_restaurants_pct: { label: "Restaurant and café inflation (%)", kind: "pct" },
  hicp_all_items_pct: { label: "Headline inflation (%)", kind: "pct" },
  accommodation_turnover_index: { label: "Accommodation turnover index", kind: "index" },
  unemployment_rate_pct: { label: "Unemployment rate (%)", kind: "pct" },
  consumer_confidence_balance: { label: "Consumer confidence (balance)", kind: "level", digits: 1 },
  bond_yield_10y_pct: { label: "10-year government bond yield (%)", kind: "pct", digits: 2 },
  gdp_growth: { label: "Real GDP growth (%)", kind: "pct" },
  nights_per_resident: { label: "Nights per resident", kind: "level", digits: 1 },
  share_eu: { label: "Share of EU-27 nights", kind: "rate01" },
  share_of_country_nights: { label: "Share of national nights", kind: "rate01" },
  passengers: { label: "Passengers", kind: "sum" },
  share_country_air: { label: "Share of national air passengers", kind: "rate01" },
  fx: { label: "Units per euro (annual average)", kind: "level", digits: 3, ratio: true },
  adr_es: { label: "Average daily rate, mean of tourist zones (€)", kind: "eur" },
  revpar_es: { label: "RevPAR, mean of tourist zones (€)", kind: "eur" },
  rev_night_pt: { label: "Hotel revenue per guest night (€)", kind: "eur" },
  w_temp: { label: "Average daily maximum temperature (°C)", kind: "level", digits: 1 },
  w_sun: { label: "Sunshine hours", kind: "level", digits: 0 },
  w_rain: { label: "Precipitation (mm)", kind: "level", digits: 0 },
  w_anom: { label: "Temperature vs 1991-2020 normal (°C)", kind: "level", digits: 1 },
};
const AH_METRICS = new Set(["nights", "nights_foreign", "nights_domestic", "arrivals", "hotel_nights", "bed_place_occupancy_rate",
  "room_occupancy_rate", "avg_length_of_stay", "platform_nights", "air_passengers", "air_passengers_international",
  "hicp_accommodation_pct", "hicp_restaurants_pct", "hicp_all_items_pct", "accommodation_turnover_index", "unemployment_rate_pct",
  "consumer_confidence_balance", "bond_yield_10y_pct"]);

const isRatio = (m) => m.kind === "sum" || m.kind === "index" || m.kind === "eur" || m.ratio;

const chgOf = (m, v, prev) => (!isNum(v) || !isNum(prev) ? null : isRatio(m) ? (prev ? v / prev - 1 : null) : v - prev);

// ------------------------------------------------------------------ state
function readState(ctx) {
  const s = ctx.state;
  const level = LEVELS.some((l) => l.value === s.rl) ? s.rl : "country";
  const mode = s.rm === "cmp" ? "cmp" : "one";
  const ids = (s.ids || "").split(",").filter(Boolean);
  const secs = s.rs != null ? s.rs.split(",").filter(Boolean) : SECTIONS[level].map(([k]) => k);
  const an = s.ra != null ? s.ra.split(",").filter(Boolean) : DEFAULT_ANALYTICS;
  return { level, mode, ids, end: Number(s.ry) || null, span: YEAR_SPANS.includes(Number(s.rn)) ? Number(s.rn) : 10, secs, an, go: s.go === "1" };
}

const TABLES_BY_LEVEL = {
  country: ["annual_history", "country_annual", "airport_summary"],
  region: ["region_annual", "annual_history", "country_annual"],
  airport: ["airport_annual", "airport_summary", "annual_history"],
};

// ------------------------------------------------------------------ entry
export async function report(ctx) {
  const st = readState(ctx);
  const D = await loadData(TABLES_BY_LEVEL[st.level]);
  const draft = { ...st, ids: st.ids.length ? st.ids : defaultIds(ctx, st.level, D) };
  const builderHost = h("div", { class: "rp-builder-host" });
  const docHost = h("div", { class: "rp-doc-host" });
  ctx.view.append(builderHost, docHost);

  const rebuild = async () => {
    const D2 = await loadData(TABLES_BY_LEVEL[draft.level]);
    builderHost.replaceChildren(builder(ctx, draft, D2, rebuild));
  };
  builderHost.append(builder(ctx, draft, D, rebuild));

  if (st.go && st.ids.length) {
    // The paper exists (hidden) while the report is assembled so colours resolve to its light theme.
    const paper = h("article", { class: "rp-paper rp-deck", id: "rp-paper" });
    const scroll = h("div", { class: "rp-scroll", hidden: true }, paper);
    const loading = h("div", { class: "loading" }, "Building report…");
    docHost.append(loading, scroll);
    setChartScope(paper);
    try {
      const doc = await buildReport(ctx, { ...st, ids: st.ids.slice(0, st.mode === "cmp" ? MAX_CMP : 1) });
      if (!paper.isConnected) return;
      setChartScope(paper);
      renderDocument(ctx, docHost, doc, paper, scroll);
      loading.remove();
    } catch (e) {
      console.error(e);
      docHost.replaceChildren(h("div", { class: "empty" }, `Could not build the report: ${e.message}`));
    } finally {
      setChartScope(null);
    }
  }
}

async function loadData(names) {
  const out = {};
  await Promise.all(names.map(async (n) => { out[n] = await loadTable(n); }));
  return out;
}

function defaultIds(ctx, level, D) {
  if (level === "country") return [ctx.isCountry(ctx.state.geo) || ctx.geoMeta(ctx.state.geo)?.geo_level === "aggregate" ? ctx.state.geo : "ES"];
  if (level === "region") return [D.region_annual.some((r) => r.geo_code === "ES53") ? "ES53" : D.region_annual[0]?.geo_code];
  return [D.airport_summary.find((a) => a.airport_code === "ES_LEPA")?.airport_code || D.airport_summary[0]?.airport_code];
}

// ------------------------------------------------------------------ builder UI
function entityOptions(ctx, level, D) {
  if (level === "country") return ctx.geoOptions();
  if (level === "region") {
    const have = new Set(D.region_annual.map((r) => r.geo_code));
    const regs = ctx.meta.geos.filter((g) => g.geo_level === "nuts2" && have.has(g.geo_code));
    return [...groupBy(regs, (g) => ctx.geoName(g.country_code)).entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([group, l]) => ({ group, options: l.sort((a, b) => a.geo_name.localeCompare(b.geo_name)).map((g) => ({ value: g.geo_code, label: g.geo_name })) }));
  }
  const have = new Set(D.airport_annual.map((r) => r.airport_code));
  const aps = D.airport_summary.filter((a) => have.has(a.airport_code));
  return [...groupBy(aps, "country_name").entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([group, l]) => ({ group, options: l.sort((a, b) => (b.passengers_12m || 0) - (a.passengers_12m || 0)).map((a) => ({ value: a.airport_code, label: airportLabel(a) })) }));
}
const airportLabel = (a) => { const city = String(a.city || a.airport_name || a.airport_code).split("/")[0].trim(); return a.iata_code ? `${city} (${a.iata_code})` : city; };

function entityName(ctx, level, code, D) {
  if (level === "airport") { const a = D.airport_summary.find((x) => x.airport_code === code); return a ? airportLabel(a) : code; }
  const n = ctx.geoName(code);
  return code === "EU27_2020" ? "EU-27" : n.replace(/ \(.*\)$/, "");
}

function availableYears(level, ids, D) {
  const rows = level === "country" ? D.annual_history.filter((r) => r.metric === "nights" && ids.includes(r.geo_code))
    : level === "region" ? D.region_annual.filter((r) => ids.includes(r.geo_code) && isNum(r.nights))
      : D.airport_annual.filter((r) => ids.includes(r.airport_code));
  const ytd = new Set(rows.filter((r) => r.is_ytd).map((r) => r.year));
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  return years.map((y) => ({ year: y, ytd: ytd.has(y) && !rows.some((r) => r.year === y && !r.is_ytd) }));
}

function builder(ctx, draft, D, rebuild) {
  const opts = entityOptions(ctx, draft.level, D);
  const flat = opts.flatMap((o) => o.options || [o]);
  const valid = new Set(flat.map((o) => o.value));
  draft.ids = draft.ids.filter((id) => valid.has(id));
  if (!draft.ids.length) draft.ids = draft.mode === "cmp" ? flat.slice(0, 2).map((o) => o.value) : [flat[0]?.value].filter(Boolean);
  const years = availableYears(draft.level, draft.ids, D);
  const fullYears = years.filter((y) => !y.ytd);
  if (!years.some((y) => y.year === draft.end)) draft.end = fullYears[0]?.year ?? years[0]?.year;
  const secKeys = SECTIONS[draft.level].map(([k]) => k);
  draft.secs = draft.secs.filter((k) => secKeys.includes(k));

  const typeSeg = segmented("Report", [{ value: "one", label: "Standalone" }, { value: "cmp", label: "Comparison" }], draft.mode, (v) => {
    draft.mode = v; if (v === "cmp" && draft.ids.length < 2) draft.ids = [draft.ids[0], flat.find((o) => o.value !== draft.ids[0])?.value].filter(Boolean);
    if (v === "one") draft.ids = draft.ids.slice(0, 1);
    rebuild();
  });
  const levelSeg = segmented("Level", LEVELS, draft.level, (v) => {
    if (v === draft.level) return;
    draft.level = v; draft.ids = []; draft.secs = SECTIONS[v].map(([k]) => k); draft.end = null; rebuild();
  });

  const slots = draft.mode === "cmp" ? MAX_CMP : 1;
  const pickers = Array.from({ length: slots }, (_, i) => {
    const optional = draft.mode === "cmp" && i >= 2;
    const options = optional ? [{ value: "", label: "(none)" }, ...opts] : opts;
    return select(draft.mode === "cmp" ? `Place ${i + 1}` : "Place", options, draft.ids[i] || "", (v) => {
      const next = [...draft.ids]; next[i] = v; draft.ids = next.filter(Boolean); rebuild();
    });
  });

  const yearSel = select("Final year", years.map((y) => ({ value: String(y.year), label: y.ytd ? `${y.year} (year to date)` : String(y.year) })),
    String(draft.end ?? ""), (v) => { draft.end = Number(v); });
  const spanSeg = segmented("Number of years", YEAR_SPANS.map((n) => ({ value: n, label: String(n) })), draft.span, (n) => { draft.span = n; rebuild(); });

  const checks = (items, chosen, onToggle) => h("div", { class: "rp-checks" }, items.map(([k, label]) => {
    const box = h("input", { type: "checkbox", value: k });
    box.checked = chosen.includes(k);
    box.addEventListener("change", () => onToggle(k, box.checked));
    return h("label", { class: "rp-check" }, box, h("span", {}, label));
  }));
  const toggle = (key) => (k, on) => { draft[key] = on ? [...new Set([...draft[key], k])] : draft[key].filter((x) => x !== k); };
  const allNone = (key, keys) => h("span", { class: "rp-allnone" },
    h("button", { type: "button", class: "link-button", onclick: () => { draft[key] = [...keys]; rebuild(); } }, "All"),
    h("button", { type: "button", class: "link-button", onclick: () => { draft[key] = []; rebuild(); } }, "None"));

  const anItems = ANALYTICS.filter(([k]) => k !== "intensity" || draft.level === "country");
  const go = h("button", { type: "button", class: "rp-go", onclick: () => {
    if (draft.mode === "cmp" && draft.ids.length < 2) { alert("Choose at least two places to compare."); return; }
    ctx.setState({ rl: draft.level, rm: draft.mode, ids: draft.ids.join(","), ry: draft.end, rn: draft.span,
      rs: draft.secs.join(","), ra: draft.an.join(","), go: "1" });
  } }, "Generate report");

  return h("section", { class: "panel rp-builder" },
    h("div", { class: "panel-head" }, h("span", { class: "panel-title" }, "Report builder"),
      h("span", { class: "panel-sub" }, "PDF via your browser's print dialog · Excel in HG format")),
    h("div", { class: "rp-grid" },
      h("div", { class: "rp-row" }, typeSeg, levelSeg),
      h("div", { class: "rp-row" }, ...pickers),
      h("div", { class: "rp-row" }, yearSel, spanSeg),
      h("fieldset", { class: "rp-set" }, h("legend", {}, "Sections ", allNone("secs", secKeys)),
        checks(SECTIONS[draft.level], draft.secs, toggle("secs"))),
      h("fieldset", { class: "rp-set" }, h("legend", {}, "Analytics ", allNone("an", anItems.map(([k]) => k))),
        checks(anItems, draft.an, toggle("an"))),
      h("div", { class: "rp-row rp-actions" }, go)));
}

// ------------------------------------------------------------------ report model
async function buildReport(ctx, st) {
  const need = new Set(TABLES_BY_LEVEL[st.level]);
  const sec = new Set(st.secs);
  const an = new Set(st.an);
  if (st.level === "country") {
    if (sec.has("seasonality") || an.has("monthly")) need.add("country_monthly");
    if (sec.has("regions") || sec.has("summary")) need.add("region_annual");
    if (sec.has("summary")) { need.add("country_monthly"); need.add("source_markets"); }
    if (sec.has("sources")) need.add("source_markets");
    if (sec.has("air")) need.add("airport_annual");
    if (sec.has("macro")) need.add("gdp_quarterly");
    if (sec.has("weather")) need.add("weather_monthly");
    if (sec.has("hotels")) { need.add("spain_zones_monthly"); need.add("portugal_prices_monthly"); }
    if (sec.has("fx")) need.add("fx_monthly");
  } else if (st.level === "region") {
    if (sec.has("seasonality") || an.has("monthly") || sec.has("summary")) { need.add("region_monthly"); need.add("country_monthly"); }
    if (sec.has("weather")) need.add("weather_monthly");
  } else {
    if (sec.has("seasonality") || an.has("monthly") || sec.has("summary")) { need.add("airports_monthly"); need.add("country_monthly"); }
    if (sec.has("origins")) need.add("airport_origins");
    if (sec.has("routes")) need.add("airport_routes");
  }
  const D = await loadData([...need]);
  const ents = st.ids.map((code, i) => ({ code, i, level: st.level, name: entityName(ctx, st.level, code, D), meta: st.level === "airport" ? D.airport_summary.find((a) => a.airport_code === code) : ctx.geoMeta(code) }));
  // Short names for table headers and legends.
  for (const e of ents) e.short = e.name.length > 20 ? `${e.name.slice(0, 19).trim()}…` : e.name;
  const years = Array.from({ length: st.span }, (_, i) => st.end - st.span + 1 + i);
  const R = { ctx, st, D, ents, years, an, cmp: st.mode === "cmp", base: ctx.meta.baseline_year, cache: new Map() };
  // Standalone reports are measured against a benchmark: EU-27 for a country, its country for a
  // region, national air traffic for an airport.
  if (!R.cmp) R.bench = benchmarkFor(ctx, ents[0]);
  const sections = [];
  for (const [key, title] of SECTIONS[st.level]) {
    if (!sec.has(key) || key === "summary") continue;
    const s = SECTION_DEFS[st.level][key]?.(R);
    if (s) sections.push({ key, title, ...s });
  }
  if (sec.has("summary")) sections.unshift({ key: "summary", title: "Executive summary", ...summarySlide(R, sections) });
  const names = ents.map((e) => e.name);
  const title = R.cmp ? names.join(" v ") : names[0];
  const kindLabel = { country: "tourism market", region: "regional tourism", airport: "airport traffic" }[st.level];
  return {
    title, subtitle: R.cmp ? `Comparative ${kindLabel} report` : `${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} report`,
    period: `${years[0]} to ${years.at(-1)} (${st.span} years)`, years, ents, sections, R,
    fileBase: `EU-Markets_${names.join("-v-").replace(/[^A-Za-z0-9-]+/g, "-")}_${years[0]}-${years.at(-1)}`,
  };
}

function benchmarkFor(ctx, e) {
  if (e.level === "country") return e.code === "EU27_2020" ? null : { code: "EU27_2020", level: "country", name: "EU-27", bench: true, meta: ctx.geoMeta("EU27_2020") };
  const cc = e.meta?.country_code;
  if (!cc) return null;
  return { code: cc, level: "country", name: e.level === "airport" ? `${ctx.geoName(cc)} (all airports)` : ctx.geoName(cc), bench: true, meta: ctx.geoMeta(cc), viaAir: e.level === "airport" };
}
// A benchmark country stands in for an airport's passengers with national air passengers.
const BENCH_KEY = { passengers: "air_passengers" };

// Series: [{year, value, change, ytd, months}] ascending, for one entity and metric.
function series(R, key, e) {
  if (e.bench && e.viaAir) key = BENCH_KEY[key] || (key.startsWith("w_") ? key : `__none_${key}`);
  const ck = `${key}|${e.level}|${e.code}`;
  if (R.cache.has(ck)) return R.cache.get(ck);
  const out = computeSeries(R, key, e).filter((r) => isNum(r.value)).sort((a, b) => a.year - b.year);
  R.cache.set(ck, out);
  return out;
}

function withChanges(m, rows) {
  const byYear = new Map(rows.map((r) => [r.year, r]));
  return rows.map((r) => ({ ...r, change: r.change !== undefined ? r.change : r.ytd ? null : chgOf(m, r.value, byYear.get(r.year - 1)?.ytd ? null : byYear.get(r.year - 1)?.value) }));
}

function computeSeries(R, key, e) {
  const { D } = R;
  const m = M[key];
  if (!m) return [];
  const ah = (geo, metric) => D.annual_history.filter((r) => r.geo_code === geo && r.metric === metric)
    .map((r) => ({ year: r.year, value: r.value, change: r.change, ytd: !!r.is_ytd, months: r.months }));
  if (e.level === "country") {
    if (AH_METRICS.has(key)) return ah(e.code, key);
    if (["foreign_share", "peak_two_month_share", "platform_share", "nights_per_resident"].includes(key)) {
      return withChanges(m, D.country_annual.filter((r) => r.geo_code === e.code).map((r) => ({ year: r.year, value: r[key], ytd: !r.is_complete_year })));
    }
    if (key === "share_eu") {
      if (e.code === "EU27_2020") return [];
      const eu = new Map(ah("EU27_2020", "nights").map((r) => [r.year, r]));
      return withChanges(m, ah(e.code, "nights").map((r) => { const t = eu.get(r.year); return { year: r.year, value: t && t.months === r.months ? r.value / t.value : null, ytd: r.ytd }; }));
    }
    if (key === "gdp_growth") {
      const g = groupBy(D.gdp_quarterly.filter((r) => r.geo_code === e.code && isNum(r.gdp_growth_yoy_pct)), (r) => Number(r.quarter_start.slice(0, 4)));
      return withChanges(m, [...g.entries()].map(([y, l]) => ({ year: y, value: l.reduce((a, r) => a + r.gdp_growth_yoy_pct, 0) / l.length, ytd: l.length < 4, months: l.length * 3 })));
    }
    if (key === "fx") {
      const cur = e.meta?.currency_code;
      const g = groupBy(D.fx_monthly.filter((r) => r.currency_code === cur), (r) => Number(r.month.slice(0, 4)));
      return withChanges(m, [...g.entries()].map(([y, l]) => ({ year: y, value: l.reduce((a, r) => a + r.units_per_eur, 0) / l.length, ytd: l.length < 12, months: l.length })));
    }
    if (key === "adr_es" || key === "revpar_es") {
      if (e.code !== "ES") return [];
      const f = key === "adr_es" ? "adr_eur" : "revpar_eur";
      const g = groupBy(D.spain_zones_monthly.filter((r) => isNum(r[f])), (r) => Number(r.month.slice(0, 4)));
      return withChanges(m, [...g.entries()].map(([y, l]) => {
        const months = new Set(l.map((r) => r.month)).size;
        return { year: y, value: l.reduce((a, r) => a + r[f], 0) / l.length, ytd: months < 12, months };
      }));
    }
    if (key === "rev_night_pt") {
      if (e.code !== "PT") return [];
      const g = groupBy(D.portugal_prices_monthly.filter((r) => r.region_code === "PT" && r.accommodation_type_code === "01" && isNum(r.lodging_income_eur) && isNum(r.nights)), (r) => Number(r.month.slice(0, 4)));
      return withChanges(m, [...g.entries()].map(([y, l]) => ({ year: y, value: l.reduce((a, r) => a + r.lodging_income_eur, 0) / l.reduce((a, r) => a + r.nights, 0), ytd: l.length < 12, months: l.length })));
    }
  }
  if (e.level === "region") {
    const rows = D.region_annual.filter((r) => r.geo_code === e.code);
    const chg = { nights: "nights_yoy", platform_nights: "platform_nights_yoy" }[key];
    return withChanges(m, rows.map((r) => ({ year: r.year, value: r[key], ytd: false, ...(chg ? { change: r[chg] } : {}) })));
  }
  if (e.level === "airport") {
    const rows = D.airport_annual.filter((r) => r.airport_code === e.code);
    if (key === "passengers") return rows.map((r) => ({ year: r.year, value: r.passengers, change: r.passengers_yoy, ytd: !!r.is_ytd, months: r.months }));
    if (key === "share_country_air") {
      const nat = new Map(ah(e.meta?.country_code, "air_passengers").map((r) => [r.year, r]));
      return withChanges(m, rows.map((r) => { const t = nat.get(r.year); return { year: r.year, value: t && !t.ytd && !r.is_ytd ? r.passengers / t.value : null, ytd: !!r.is_ytd }; }));
    }
  }
  if (key.startsWith("w_")) return weatherSeries(R, key, e);
  return [];
}

function weatherSeries(R, key, e) {
  const locs = R.ctx.meta.weather_locations.filter((l) => (e.level === "region" ? l.nuts2_code === e.code : l.country_code === e.code)).map((l) => l.location_code);
  if (!locs.length) return [];
  const field = { w_temp: "avg_max_temp_c", w_sun: "sunshine_hours", w_rain: "precipitation_mm", w_anom: "temp_anomaly_c" }[key];
  const summed = key === "w_sun" || key === "w_rain";
  const perLoc = [];
  for (const loc of locs) {
    const g = groupBy(R.D.weather_monthly.filter((r) => r.location_code === loc && isNum(r[field])), (r) => Number(r.month.slice(0, 4)));
    for (const [y, l] of g) if (l.length === 12) perLoc.push({ year: y, v: summed ? l.reduce((a, r) => a + r[field], 0) : l.reduce((a, r) => a + r[field], 0) / 12 });
  }
  const g = groupBy(perLoc, "year");
  return withChanges(M[key], [...g.entries()].map(([y, l]) => ({ year: y, value: l.reduce((a, r) => a + r.v, 0) / l.length, ytd: false })));
}

// ------------------------------------------------------------------ analytics
const inWindow = (R, s) => s.filter((r) => r.year >= R.years[0] && r.year <= R.years.at(-1));
const at = (s, y) => s.find((r) => r.year === y);
function cagr(m, s) {
  const full = s.filter((r) => !r.ytd);
  if (full.length < 2) return null;
  const a = full[0], b = full.at(-1);
  if (isRatio(m)) return a.value > 0 && b.value > 0 ? { v: (b.value / a.value) ** (1 / (b.year - a.year)) - 1, from: a.year, to: b.year } : null;
  return { v: b.value - a.value, from: a.year, to: b.year, total: true };
}
function vsBase(R, m, s, y) {
  const b = at(s, R.base), r = at(s, y);
  return b && r && !r.ytd && y !== R.base ? chgOf(m, r.value, b.value) : null;
}

// Excel number formats.
function xlFmt(m) {
  return { sum: "#,##0", rate01: "0.0%", pct: '0.0"%"', index: "0.0", eur: "€#,##0.0", level: m.digits === 0 ? "#,##0" : m.digits === 3 ? "0.000" : m.digits === 2 ? "0.00" : "0.0" }[m.kind];
}
const xlChgFmt = (m) => (isRatio(m) ? "0.0%" : '+0.0" pts";-0.0" pts";0.0" pts"');
const xlChg = (m, c) => (!isNum(c) ? null : m.kind === "rate01" ? c * 100 : c);

// ------------------------------------------------------------------ IB number style
// Negatives in brackets, percentage-point changes as "pp", counts in k / m / bn, multiples as "x".
const neg = (v, s) => (v < 0 ? `(${s})` : s);
function ibPct(v, d = 1) {
  if (!isNum(v)) return "n/a";
  const r = Number((v * 100).toFixed(d));
  return neg(r, `${Math.abs(r).toFixed(d)}%`);
}
function ibPp(x, d = 1) {
  if (!isNum(x)) return "n/a";
  const r = Number(x.toFixed(d));
  return neg(r, `${Math.abs(r).toFixed(d)}pp`);
}
function ibVal(m, v) {
  if (!isNum(v)) return "n/a";
  const a = Math.abs(v);
  switch (m.kind) {
    case "sum": return a >= 1e9 ? `${(v / 1e9).toFixed(2)}bn` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : a >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;
    case "rate01": return `${(v * 100).toFixed(1)}%`;
    case "pct": return neg(v, `${Math.abs(v).toFixed(m.digits ?? 1)}%`);
    case "eur": return `€${v.toFixed(v < 100 ? 1 : 0)}`;
    case "index": return v.toFixed(1);
    default: return neg(v, Math.abs(v).toFixed(m.digits ?? 1));
  }
}
function ibChg(m, c) {
  if (!isNum(c)) return "n/a";
  if (isRatio(m)) return ibPct(c);
  if (m.kind === "rate01") return ibPp(c * 100);
  if (m.kind === "pct") return ibPp(c);
  const r = Number(c.toFixed(m.digits ?? 1));
  return neg(r, Math.abs(r).toFixed(m.digits ?? 1));
}
const ibGrowth = (m, g) => (!g ? "n/a" : g.total ? ibChg(m, g.v) : ibPct(g.v));
const short = (label) => label.replace(/ \(.*\)$/, "");
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const mult = (a, b) => (isNum(a) && isNum(b) && b ? `${(a / b).toFixed(2)}x` : "n/a");
// Prose uses signs, tables use brackets: sg() "+6.8pp" / "−0.6pp"; mn() only rewrites negatives.
const sg = (t) => (t === "n/a" ? t : /^\(.*\)$/.test(t) ? `−${t.slice(1, -1)}` : `+${t}`);
const mn = (t) => (/^\(.*\)$/.test(t) ? `−${t.slice(1, -1)}` : t);
// "the EU-27" but "Spain".
const theB = (e) => (e?.code === "EU27_2020" ? `the ${e.name}` : e?.name);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th"}`;
const listJoin = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

// Which direction is "better" for ranking and bold leaders; null = no judgement.
const BETTER = {
  nights: "high", arrivals: "high", nights_foreign: "high", nights_domestic: "high", hotel_nights: "high", bed_place_occupancy_rate: "high",
  room_occupancy_rate: "high", avg_length_of_stay: "high", peak_two_month_share: "low", platform_nights: "high", air_passengers: "high",
  air_passengers_international: "high", unemployment_rate_pct: "low", consumer_confidence_balance: "high", bond_yield_10y_pct: "low",
  gdp_growth: "high", share_eu: "high", share_of_country_nights: "high", passengers: "high", share_country_air: "high",
  adr_es: "high", revpar_es: "high", rev_night_pt: "high", nights_per_resident: "high", accommodation_turnover_index: "high",
};

// ------------------------------------------------------------------ participants and figures
// Participants: the chosen places plus, for a standalone report, the benchmark (shown in grey).
const parts = (R) => (R.bench ? [...R.ents, R.bench] : R.ents);
const colorOf = (p, e) => (e.bench ? p.context : p.series[e.i]);
const endYear = (R) => R.years.at(-1);
function lastOf(R, key, e) { return inWindow(R, series(R, key, e)).at(-1) || null; }
function facts(R, key, e) {
  const m = M[key];
  const s = inWindow(R, series(R, key, e));
  const last = s.at(-1) || null;
  const lf = s.filter((r) => !r.ytd).at(-1) || null;
  return { m, s, last, lf, g: cagr(m, s), vb: lf ? vsBase(R, m, series(R, key, e), lf.year) : null };
}
const hasData = (R, key, list = R.ents) => list.some((e) => inWindow(R, series(R, key, e)).length);
const yearTag = (R, r) => (!r ? "" : r.ytd ? ` (${r.year} YTD)` : r.year !== endYear(R) ? ` (${r.year})` : "");

// Comparative table: metrics as rows, a column group per participant.
function compTable(R, keys) {
  const P = parts(R).filter((e) => keys.some((k) => inWindow(R, series(R, k, e)).length));
  const subs = [["value", "Value"], ...(R.an.has("yoy") ? [["yoy", "YoY"]] : []), ...(R.an.has("cagr") ? [["cagr", "CAGR"]] : []),
    ...(R.an.has("base") && P.length <= 2 ? [["base", `vs ${R.base}`]] : [])];
  const rows = [];
  const notes = new Set();
  for (const k of keys) {
    const m = M[k];
    const cells = P.map((e) => {
      const f = facts(R, k, e);
      if (f.last && f.last.year !== endYear(R)) notes.add(`${short(m.label)}: latest year ${f.last.year}`);
      return {
        value: { v: f.last?.value, t: ibVal(m, f.last?.value) }, yoy: { v: f.last?.change, t: ibChg(m, f.last?.change) },
        cagr: { v: f.g?.v, t: ibGrowth(m, f.g) }, base: { v: f.vb, t: ibChg(m, f.vb) },
      };
    });
    // Bold the leader in each column among the chosen places (comparisons only).
    const lead = {};
    if (R.cmp && BETTER[k]) {
      for (const [sk] of subs) {
        const vals = cells.map((c, i) => ({ i, v: c[sk].v })).filter((x) => isNum(x.v) && !P[x.i].bench);
        if (vals.length >= 2) lead[sk] = vals.reduce((a, x) => ((BETTER[k] === "high" ? x.v > a.v : x.v < a.v) ? x : a)).i;
      }
    }
    rows.push({ key: k, label: m.label, cells: cells.map((c, i) => subs.map(([sk]) => ({ t: c[sk].t, v: c[sk].v, bold: lead[sk] === i }))) });
  }
  const ytd = P.map((e) => lastOf(R, keys[0], e)).find((r) => r?.ytd);
  if (ytd) notes.add(`YTD = ${ytd.year} to ${monthName(ytd.months)}; YoY compares the same months`);
  return { groups: P.map((e) => ({ label: e.short || e.name, span: subs.length, bench: !!e.bench })), subs: subs.map(([, l]) => l), rows, notes: [...notes] };
}
function compTableXl(R, title, keys) {
  const P = parts(R);
  const subs = [["value", "value"], ...(R.an.has("yoy") ? [["yoy", "change"]] : []), ...(R.an.has("cagr") ? [["cagr", "compound growth"]] : []), ...(R.an.has("base") ? [["base", `vs ${R.base}`]] : [])];
  const columns = [{ label: "Metric", fmt: "text" }, ...P.flatMap((e) => subs.map(([, l]) => ({ label: `${e.name}: ${l}`, fmt: "General" })))];
  const rows = [], cellFmts = [];
  for (const k of keys) {
    const m = M[k];
    const r = [m.label], f = ["text"];
    for (const e of P) {
      const x = facts(R, k, e);
      for (const [sk] of subs) {
        if (sk === "value") { r.push(x.last?.value ?? null); f.push(xlFmt(m)); }
        if (sk === "yoy") { r.push(xlChg(m, x.last?.change)); f.push(xlChgFmt(m)); }
        if (sk === "cagr") { r.push(x.g ? (x.g.total ? xlChg(m, x.g.v) : x.g.v) : null); f.push(x.g && !x.g.total ? "0.0%" : xlChgFmt(m)); }
        if (sk === "base") { r.push(xlChg(m, x.vb)); f.push(xlChgFmt(m)); }
      }
    }
    rows.push(r); cellFmts.push(f);
  }
  return { title, columns, rows, cellFmts };
}
// Year-by-year table for one metric across participants (appendix and Excel).
function yearTable(R, key) {
  const m = M[key];
  const P = parts(R).filter((e) => inWindow(R, series(R, key, e)).length);
  const yrs = [...new Set(P.flatMap((e) => inWindow(R, series(R, key, e)).map((r) => r.year)))].sort((a, b) => a - b);
  const withYoy = R.an.has("yoy");
  const pdf = {
    title: m.label,
    columns: ["Year", ...P.flatMap((e) => (withYoy ? [e.name, "YoY"] : [e.name]))],
    rows: yrs.map((y) => {
      const ytd = P.some((e) => at(series(R, key, e), y)?.ytd);
      return [ytd ? `${y} YTD` : String(y), ...P.flatMap((e) => { const r = at(inWindow(R, series(R, key, e)), y); return withYoy ? [ibVal(m, r?.value), ibChg(m, r?.change)] : [ibVal(m, r?.value)]; })];
    }),
  };
  const xl = {
    title: m.label,
    columns: [{ label: "Year", fmt: "text" }, ...P.flatMap((e) => [{ label: `${e.name}: value`, fmt: xlFmt(m) }, ...(withYoy ? [{ label: `${e.name}: change`, fmt: xlChgFmt(m) }] : [])])],
    rows: pdf.rows.map((r, i) => [r[0], ...P.flatMap((e) => { const rr = at(inWindow(R, series(R, key, e)), yrs[i]); return withYoy ? [rr?.value ?? null, xlChg(m, rr?.change)] : [rr?.value ?? null]; })]),
  };
  return { pdf, xl };
}

// ------------------------------------------------------------------ IB-style charts
// Data labels instead of dense axes, light rules, legend above, benchmark in grey (dashed).
function ibBase(p) {
  return { backgroundColor: "transparent", animation: false, textStyle: { fontFamily: css("--font"), color: p.text2, fontSize: 9 },
    tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: p.grid, textStyle: { color: p.text, fontSize: 10 } } };
}
// Bar labels are sized to the space they have: flat when they fit, vertical when the bars are
// narrow, none (with an axis) when even vertical labels would collide. The value axis gets
// headroom for the labels so nothing is clipped at the top or bottom of the plot.
function ibColumns(el, { cats, series: ss, fmt, labels = true, markZero = true, colors }) {
  const p = palette();
  if (!ss.some((s) => s.values.some(isNum))) return empty(el);
  const W = el.clientWidth || 300, H = el.clientHeight || 200;
  const n = ss.length;
  const slot = ((W - 12) / Math.max(1, cats.length)) * 0.82 / n;
  const fs = 8;
  const vals = ss.flatMap((s) => s.values).filter(isNum);
  const maxChars = Math.max(1, ...vals.map((v) => fmt(v).length));
  const textW = maxChars * fs * 0.56 + 3;
  const mode = !labels ? "none" : slot >= textW ? "flat" : slot >= fs + 2 ? "vertical" : "none";
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const range = hi - lo || Math.abs(hi) || 1;
  const plotH = Math.max(60, H - 26);
  const need = mode === "vertical" ? textW : mode === "flat" ? fs + 6 : 0;
  const pad = need ? (need / Math.max(20, plotH - 2 * need)) * range : range * 0.04;
  const chart = initChart(el);
  const label = (v) => {
    if (mode === "none" || !isNum(v)) return { show: false };
    const negv = v < 0;
    return mode === "flat"
      ? { show: true, position: negv ? "bottom" : "top", fontSize: fs, color: p.text, distance: 2, formatter: () => fmt(v) }
      : { show: true, position: negv ? "bottom" : "top", rotate: 90, align: negv ? "right" : "left", verticalAlign: "middle", fontSize: fs, color: p.text, distance: 3, formatter: () => fmt(v) };
  };
  chart.setOption({
    ...ibBase(p),
    grid: { left: mode === "none" ? 40 : 4, right: 6, top: 8, bottom: 18, containLabel: mode === "none" },
    xAxis: { type: "category", data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { color: p.text2, fontSize: 9, hideOverlap: true } },
    yAxis: { type: "value", show: mode === "none", min: lo < 0 ? lo - pad : 0, max: hi > 0 ? hi + pad : pad,
      splitLine: { lineStyle: { color: p.grid, type: "dashed" } }, axisLabel: { color: p.muted, fontSize: 8.5, formatter: fmt } },
    series: ss.map((s, si) => ({
      name: s.name, type: "bar", barGap: "8%", barMaxWidth: 28,
      data: s.values.map((v, i) => (isNum(v) ? { value: v, label: label(v), itemStyle: { color: colors ? colors[i] : s.color } } : null)),
      itemStyle: { color: s.color },
      ...(markZero && si === 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: p.text2, width: 0.8, type: "solid" }, data: [{ yAxis: 0 }] } } : {}),
    })),
  });
  return chart;
}
// End labels shift apart when lines finish close together.
function ibLines(el, { cats, series: ss, fmt, endLabels = true }) {
  const p = palette();
  if (!ss.some((s) => s.values.some(isNum))) return empty(el);
  const chart = initChart(el);
  const widest = Math.max(1, ...ss.flatMap((s) => s.values).filter(isNum).map((v) => fmt(v).length));
  chart.setOption({
    ...ibBase(p),
    grid: { left: 6, right: endLabels ? Math.max(30, widest * 5 + 10) : 8, top: 12, bottom: 4, containLabel: true },
    xAxis: { type: "category", data: cats, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { color: p.text2, fontSize: 9, hideOverlap: true } },
    yAxis: { type: "value", scale: true, splitNumber: 4, splitLine: { lineStyle: { color: p.grid, type: "dashed" } }, axisLabel: { color: p.muted, fontSize: 8.5, formatter: fmt } },
    series: ss.map((s) => ({
      name: s.name, type: "line", data: s.values.map((v) => (isNum(v) ? v : null)), showSymbol: false, connectNulls: false,
      lineStyle: { color: s.color, width: s.bench ? 1.5 : 2.2, type: s.bench ? "dashed" : "solid" }, itemStyle: { color: s.color },
      endLabel: { show: endLabels, formatter: (x) => fmt(Array.isArray(x.value) ? x.value[1] : x.value), color: s.color, fontSize: 8.5, fontWeight: 700, distance: 4 },
      labelLayout: { moveOverlap: "shiftY" },
    })),
  });
  return chart;
}
// Horizontal bars: label size follows bar thickness; overlapping labels are dropped, never drawn on top of each other.
function ibHBars(el, { cats, series: ss, fmt }) {
  const p = palette();
  if (!ss.some((s) => s.values.some(isNum))) return empty(el);
  const H = el.clientHeight || 240;
  const n = ss.length;
  const maxCats = Math.max(4, Math.floor((H - 8) / Math.max(10, n * 7)));
  const keep = cats.map((c, i) => i).filter((i) => ss.some((s) => isNum(s.values[i]))).slice(0, maxCats);
  const thick = ((H - 8) / Math.max(1, keep.length)) * 0.8 / n;
  const fs = Math.max(6.5, Math.min(8.5, thick + 1));
  const chart = initChart(el);
  const widest = Math.max(1, ...ss.flatMap((s) => s.values).filter(isNum).map((v) => fmt(v).length));
  // One place per category (ranked lists across places): stack so each bar is centred and full width.
  const single = keep.every((i) => ss.filter((s) => isNum(s.values[i])).length <= 1);
  const thickness = single ? ((H - 8) / Math.max(1, keep.length)) * 0.7 : thick;
  chart.setOption({
    ...ibBase(p), tooltip: { ...ibBase(p).tooltip, axisPointer: { type: "shadow" } },
    grid: { left: 4, right: widest * fs * 0.6 + 8, top: 2, bottom: 2, containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: keep.map((i) => cats[i]), inverse: true, axisTick: { show: false }, axisLine: { lineStyle: { color: p.axis } },
      axisLabel: { color: p.text, fontSize: 8.5, width: 120, overflow: "truncate" } },
    series: ss.map((s) => ({
      name: s.name, type: "bar", barGap: "10%", barMaxWidth: 14, ...(single ? { stack: "one" } : {}),
      data: keep.map((i) => (isNum(s.values[i]) ? s.values[i] : null)), itemStyle: { color: s.color },
      label: { show: thickness >= 5, position: "right", fontSize: single ? Math.min(8.5, Math.max(7, thickness)) : fs, color: p.text, formatter: (x) => (isNum(x.value) ? fmt(x.value) : ""), distance: 2 },
      labelLayout: { hideOverlap: true },
    })),
  });
  return chart;
}
const legendOf = (R, list = parts(R)) => { const p = palette(); return list.map((e) => ({ label: e.short || e.name, color: colorOf(p, e) })); };

// Standard charts for one metric across participants.
function trendChart(R, key, { forceIndex = false } = {}) {
  const m = M[key];
  const P = parts(R).filter((e) => inWindow(R, series(R, key, e)).length);
  if (!P.length) return null;
  const p = palette();
  const cats = R.years.map(String);
  const useIndex = isRatio(m) && (forceIndex || (R.an.has("index") && P.length > 1));
  if (useIndex) {
    const base0 = Math.max(...P.map((e) => inWindow(R, series(R, key, e)).find((r) => !r.ytd)?.year ?? R.years[0]));
    return { title: `${short(m.label)}: indexed (${base0} = 100)`, legend: legendOf(R, P),
      note: "Full years only.",
      draw: (el) => ibLines(el, { cats, fmt: (v) => fmtDec(v, 0),
        series: P.map((e) => { const s = series(R, key, e); const b = at(s, base0); return { name: e.name, bench: e.bench, color: colorOf(p, e),
          values: R.years.map((y) => { const r = at(s, y); return r && b && !r.ytd ? (r.value / b.value) * 100 : null; }) }; }) }) };
  }
  if (m.kind === "sum" || m.kind === "eur" || P.length === 1) {
    const list = m.kind === "sum" ? P.filter((e) => !e.bench) : P;
    return { title: m.label, legend: list.length > 1 ? legendOf(R, list) : null,
      draw: (el) => ibColumns(el, { cats: R.years.map((y) => (at(series(R, key, list[0]), y)?.ytd ? `${y}*` : String(y))), fmt: (v) => ibVal(m, v),
        series: list.map((e) => ({ name: e.name, color: colorOf(p, e), values: R.years.map((y) => at(series(R, key, e), y)?.value) })) }),
      note: list.some((e) => at(series(R, key, e), endYear(R))?.ytd) ? "* Year to date." : "" };
  }
  return { title: m.label, legend: legendOf(R, P),
    draw: (el) => ibLines(el, { cats, fmt: (v) => ibVal(m, v), series: P.map((e) => ({ name: e.name, bench: e.bench, color: colorOf(p, e), values: R.years.map((y) => at(series(R, key, e), y)?.value) })) }) };
}
function yoyChart(R, key) {
  const m = M[key];
  const P = parts(R).filter((e) => inWindow(R, series(R, key, e)).some((r) => isNum(r.change)));
  if (!P.length) return null;
  const p = palette();
  const yrs = R.years.slice(-Math.min(R.years.length, P.length > 2 ? 5 : 8));
  const val = (e, y) => { const c = at(series(R, key, e), y)?.change; return isNum(c) ? (m.kind === "rate01" ? c * 100 : isRatio(m) ? c * 100 : c) : null; };
  const fmt = (v) => (isRatio(m) ? neg(v, `${Math.abs(v).toFixed(0)}%`) : neg(v, `${Math.abs(v).toFixed(1)}`));
  return { title: `${short(m.label)}: ${isRatio(m) ? "change" : "change (pp)"} on prior year`, legend: legendOf(R, P),
    note: P.some((e) => at(series(R, key, e), endYear(R))?.ytd) ? "Latest year compares the same months a year earlier." : "",
    draw: (el) => ibColumns(el, { cats: yrs.map(String), fmt, series: P.map((e) => ({ name: e.name, color: colorOf(p, e), values: yrs.map((y) => val(e, y)) })) }) };
}

// Monthly series for an entity (nights, or passengers for airports; national air passengers for an airport benchmark).
function monthlyRows(R, e) {
  const { D } = R;
  if (e.level === "country") {
    const f = e.viaAir ? "air_passengers" : "nights";
    return (D.country_monthly || []).filter((r) => r.geo_code === e.code && isNum(r[f])).map((r) => ({ month: r.month, v: r[f] }));
  }
  if (e.level === "region") return (D.region_monthly || []).filter((r) => r.geo_code === e.code && isNum(r.nights)).map((r) => ({ month: r.month, v: r.nights }));
  return (D.airports_monthly || []).filter((r) => r.airport_code === e.code && isNum(r.passengers)).map((r) => ({ month: r.month, v: r.passengers }));
}
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const ratio = (a, b) => (isNum(a) && isNum(b) && b ? a / b - 1 : null);
function profiles(R, e) {
  const idx = new Map(monthlyRows(R, e).map((r) => [r.month, r.v]));
  const out = new Map();
  for (const y of R.years) {
    const vals = MONTHS.map((mm) => idx.get(`${y}-${mm}`));
    if (vals.every(isNum)) { const t = vals.reduce((a, v) => a + v, 0); out.set(y, vals.map((v) => v / t)); }
  }
  return { idx, out };
}
function seasonStats(prof) {
  const ord = prof.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  return { peak: ord[0].i, peakShare: ord[0].v, two: ord[0].v + ord[1].v, off: [0, 1, 2, 10, 11].reduce((a, i) => a + prof[i], 0) };
}
function monthlyChart(R, label) {
  const y = endYear(R);
  const p = palette();
  const P = parts(R).map((e) => ({ e, idx: profiles(R, e).idx })).filter((d) => MONTHS.some((mm) => isNum(ratio(d.idx.get(`${y}-${mm}`), d.idx.get(`${y - 1}-${mm}`)))));
  if (!P.length) return null;
  return { title: `${label}: change on a year earlier by month, ${y}`, legend: legendOf(R, P.map((d) => d.e)),
    draw: (el) => ibLines(el, { cats: MONTHS.map((mm) => monthName(+mm)), fmt: (v) => neg(v, `${Math.abs(v).toFixed(0)}%`), endLabels: false,
      series: P.map((d) => ({ name: d.e.name, bench: d.e.bench, color: colorOf(p, d.e), values: MONTHS.map((mm) => { const r = ratio(d.idx.get(`${y}-${mm}`), d.idx.get(`${y - 1}-${mm}`)); return isNum(r) ? r * 100 : null; }) })) }) };
}

// ------------------------------------------------------------------ conclusions
// Rule-based statements of size, growth and change against the comparison places or benchmark.
function metricConclusions(R, keys) {
  if (!R.an.has("commentary")) return { headline: null, bullets: [] };
  const k0 = keys.find((k) => hasData(R, k));
  if (!k0) return { headline: null, bullets: [] };
  const m0 = M[k0];
  const F = (k, list = R.ents) => list.map((e) => ({ e, ...facts(R, k, e) })).filter((d) => d.last);
  const yr = (d) => (d.last.ytd ? `${d.last.year} YTD` : String(d.last.year));
  let headline = null;
  const bullets = [];
  if (R.cmp) {
    const d = F(k0);
    if (d.length >= 2) {
      const byVal = [...d].sort((a, b) => (BETTER[k0] === "low" ? a.last.value - b.last.value : b.last.value - a.last.value));
      const byG = d.filter((x) => x.g && !x.g.total).sort((a, b) => b.g.v - a.g.v);
      if (m0.kind === "sum") {
        const lead = byVal[0], next = byVal[1];
        headline = `${lead.e.name} is the largest at ${ibVal(m0, lead.last.value)} ${lc(short(m0.label))} in ${yr(lead)}, ${mult(lead.last.value, next.last.value)} ${next.e.name}.`;
        if (byG.length >= 2) headline += byG[0].e === lead.e ? ` It also grew fastest, ${mn(ibPct(byG[0].g.v))} a year since ${byG[0].g.from}.` : ` ${byG[0].e.name} grew fastest, ${mn(ibPct(byG[0].g.v))} a year since ${byG[0].g.from}.`;
      } else {
        headline = `${short(m0.label)}, ${yr(byVal[0])}: ${byVal.map((x) => `${x.e.name} ${mn(ibVal(m0, x.last.value))}`).join(", ")}.`;
      }
    }
    for (const k of keys.filter((k) => hasData(R, k)).slice(1, 5)) {
      const m = M[k];
      const dd = F(k);
      if (!dd.length) continue;
      bullets.push(`${short(m.label)}: ${dd.map((x) => `${x.e.name} ${mn(ibVal(m, x.last.value))}${R.an.has("cagr") && x.g ? `, ${x.g.total ? `${sg(ibChg(m, x.g.v))} since ${x.g.from}` : `CAGR ${mn(ibPct(x.g.v))}`}` : ""}`).join("; ")}.`);
    }
    if (R.an.has("cagr") && m0.kind !== "sum") {
      const g = F(k0).filter((x) => x.g);
      if (g.length >= 2) bullets.unshift(`Change since ${g[0].g.from}: ${g.map((x) => `${x.e.name} ${sg(ibGrowth(m0, x.g))}`).join(", ")}.`);
    }
    if (R.an.has("base")) {
      const vb = F(k0).filter((x) => isNum(x.vb));
      if (vb.length >= 2) bullets.push(`${short(m0.label)} against ${R.base}: ${vb.map((x) => `${x.e.name} ${sg(ibChg(m0, x.vb))}`).join(", ")}.`);
    }
  } else {
    const [me] = F(k0, [R.ents[0]]);
    const [bm] = R.bench ? F(k0, [R.bench]) : [];
    if (me) {
      if (m0.kind === "sum") {
        headline = `${me.e.name} recorded ${mn(ibVal(m0, me.last.value))} ${lc(short(m0.label))} in ${yr(me)}${isNum(me.last.change) ? `, ${sg(ibChg(m0, me.last.change))} on the prior year` : ""}.`;
        if (me.g) headline += ` Growth since ${me.g.from} was ${mn(ibPct(me.g.v))} a year${bm?.g ? `, against ${mn(ibPct(bm.g.v))} for ${theB(bm.e)}` : ""}.`;
      } else {
        headline = `${short(m0.label)} was ${mn(ibVal(m0, me.last.value))} in ${yr(me)}`;
        if (bm && isNum(bm.last.value)) { const dlt = chgOf(m0, me.last.value, bm.last.value); headline += `, ${ibChg(m0, Math.abs(dlt))} ${dlt >= 0 ? "above" : "below"} ${theB(bm.e)} (${mn(ibVal(m0, bm.last.value))})`; }
        headline += ".";
      }
    }
    for (const k of keys.filter((k) => hasData(R, k)).slice(1, 5)) {
      const m = M[k];
      const [a] = F(k, [R.ents[0]]);
      if (!a) continue;
      const [b] = R.bench ? F(k, [R.bench]) : [];
      let t = `${short(m.label)}: ${mn(ibVal(m, a.last.value))}${yearTag(R, a.last)}`;
      if (R.an.has("cagr") && a.g) t += `, ${a.g.total ? `${sg(ibChg(m, a.g.v))} since ${a.g.from}` : `CAGR ${mn(ibPct(a.g.v))}`}`;
      if (b) t += `. ${b.e.name}: ${mn(ibVal(m, b.last.value))}${R.an.has("cagr") && b.g ? `, ${b.g.total ? `${sg(ibChg(m, b.g.v))} since ${b.g.from}` : `CAGR ${mn(ibPct(b.g.v))}`}` : ""}`;
      bullets.push(`${t}.`);
    }
    if (R.an.has("base") && me && isNum(me.vb)) bullets.push(`${short(m0.label)} in ${me.lf.year} against ${R.base}: ${sg(ibChg(m0, me.vb))}.`);
  }
  return { headline, bullets };
}

// ------------------------------------------------------------------ sections
// Each returns one slide: {headline, bullets, table (comparative), charts, appendix, xl}.
function metricSection(R, keys, { extraCharts = [], appendixKeys } = {}) {
  const ks = keys.filter((k) => hasData(R, k));
  if (!ks.length) return null;
  const { headline, bullets } = metricConclusions(R, ks);
  const k0 = ks[0];
  const charts = [trendChart(R, k0), R.an.has("yoy") ? yoyChart(R, k0) : trendChart(R, ks[1] || k0, { forceIndex: false }), ...extraCharts].filter(Boolean).slice(0, 3);
  const app = (appendixKeys || ks.slice(0, 2)).filter((k) => hasData(R, k, parts(R)));
  return {
    headline, bullets, table: compTable(R, ks), charts,
    appendix: R.an.has("tables") ? app.map((k) => yearTable(R, k).pdf) : [],
    xl: [compTableXl(R, "Comparison", ks), ...ks.map((k) => yearTable(R, k).xl)],
  };
}

function seasonalitySection(R, label) {
  const P = parts(R).map((e) => ({ e, ...profiles(R, e) })).filter((d) => d.out.size);
  if (!P.length) return null;
  const p = palette();
  const rows = P.map((d) => {
    const yl = Math.max(...d.out.keys()), yf = Math.min(...d.out.keys());
    const st = seasonStats(d.out.get(yl)), st0 = seasonStats(d.out.get(yf));
    return { d, yl, yf, st, st0 };
  });
  const table = {
    groups: null, subs: null,
    head: ["", "Year", "Busiest month", "Share", "Two busiest", `Change since ${rows[0].yf}`, "Nov-Mar share"],
    body: rows.map((r) => [r.d.e.name, String(r.yl), monthName(r.st.peak + 1), ibPct(r.st.peakShare), ibPct(r.st.two), r.yf !== r.yl ? ibPp((r.st.two - r.st0.two) * 100) : "n/a", ibPct(r.st.off)]),
    benchRow: rows.findIndex((r) => r.d.e.bench),
  };
  let headline = null; const bullets = [];
  if (R.an.has("commentary")) {
    const own = rows.filter((r) => !r.d.e.bench);
    const b = rows.find((r) => r.d.e.bench);
    const list = [...own, ...(b ? [b] : [])];
    headline = `Share of ${label.toLowerCase()} in the two busiest months: ${list.map((r) => `${r.d.e.name} ${ibPct(r.st.two)}`).join(", ")} (${list[0].yl}).`;
    for (const r of rows) {
      const parts2 = [`peak month ${monthName(r.st.peak + 1)} (${ibPct(r.st.peakShare)})`];
      if (r.yf !== r.yl) parts2.push(`two busiest months ${ibPct(r.st0.two)} in ${r.yf}, ${ibPct(r.st.two)} in ${r.yl}`);
      parts2.push(`November to March ${ibPct(r.st.off)}`);
      bullets.push(`${r.d.e.name}: ${parts2.join("; ")}.`);
    }
  }
  const yrs = R.years.filter((y) => rows.some((r) => r.d.out.has(y)));
  const charts = [
    { title: `Share of annual ${label.toLowerCase()} by month (latest full year)`, legend: legendOf(R, rows.map((r) => r.d.e)),
      draw: (el) => ibLines(el, { cats: MONTHS.map((mm) => monthName(+mm)), fmt: (v) => `${(v * 100).toFixed(0)}%`, endLabels: false,
        series: rows.map((r) => ({ name: r.d.e.name, bench: r.d.e.bench, color: colorOf(p, r.d.e), values: r.d.out.get(r.yl) })) }) },
    yrs.length > 1 ? { title: "Share of the two busiest months, by year", legend: legendOf(R, rows.map((r) => r.d.e)),
      draw: (el) => ibLines(el, { cats: yrs.map(String), fmt: (v) => `${(v * 100).toFixed(0)}%`,
        series: rows.map((r) => ({ name: r.d.e.name, bench: r.d.e.bench, color: colorOf(p, r.d.e), values: yrs.map((y) => (r.d.out.has(y) ? seasonStats(r.d.out.get(y)).two : null)) })) }) } : null,
  ].filter(Boolean);
  const xl = [
    { title: "Seasonality", columns: [{ label: "Place", fmt: "text" }, { label: "Year", fmt: "text" }, { label: "Busiest month", fmt: "text" }, { label: "Busiest month share", fmt: "0.0%" }, { label: "Two busiest months share", fmt: "0.0%" }, { label: "Nov-Mar share", fmt: "0.0%" }],
      rows: rows.map((r) => [r.d.e.name, String(r.yl), monthName(r.st.peak + 1), r.st.peakShare, r.st.two, r.st.off]) },
    { title: "Share of annual total by month", columns: [{ label: "Month", fmt: "text" }, ...rows.map((r) => ({ label: `${r.d.e.name} (${r.yl})`, fmt: "0.0%" }))],
      rows: MONTHS.map((mm, i) => [monthName(+mm), ...rows.map((r) => r.d.out.get(r.yl)[i])]), total: ["Total", ...rows.map(() => 1)] },
  ];
  return { headline, bullets, table, charts, appendix: [], xl };
}

// Mix tables (source markets, origin countries): rows = markets, columns = places' shares.
function mixSection(R, { rowsFor, nameOf, label, unit = "nights" }) {
  const P = parts(R).map((e) => ({ e, ...rowsFor(e) })).filter((d) => d.cur.length);
  if (!P.length) return null;
  const p = palette();
  const union = [...new Set(P.flatMap((d) => d.cur.slice(0, 6).map((r) => r.code)))].slice(0, 10);
  const share = (d, c) => d.cur.find((r) => r.code === c)?.share ?? null;
  const share0 = (d, c) => d.first?.find((r) => r.code === c)?.share ?? null;
  const top3 = (rows) => rows.slice(0, 3).reduce((a, r) => a + (r.share || 0), 0);
  const showChg = R.an.has("cagr") || R.an.has("yoy");
  const groupSubs = (d) => [String(d.y), ...(showChg && d.first ? [`Δ v ${d.y0}`] : [])];
  const cellsFor = (d, sh, sh0) => [{ t: ibPct(sh) }, ...(showChg && d.first ? [{ t: isNum(sh) && isNum(sh0) ? ibPp((sh - sh0) * 100) : "n/a" }] : [])];
  const table = {
    rowHead: label,
    groups: P.map((d) => ({ label: d.e.short || d.e.name, span: groupSubs(d).length, subs: groupSubs(d), bench: !!d.e.bench })),
    rows: union.map((c) => ({ label: nameOf(c), cells: P.map((d) => cellsFor(d, share(d, c), share0(d, c))) })),
    foot: { label: "Top-3 concentration", cells: P.map((d) => cellsFor(d, top3(d.cur), d.first ? top3(d.first) : null)) },
  };
  let headline = null; const bullets = [];
  if (R.an.has("commentary")) {
    const own = P.filter((d) => !d.e.bench);
    headline = `Largest ${label.toLowerCase()}: ${own.map((d) => `${d.e.name}, ${nameOf(d.cur[0].code)} (${ibPct(d.cur[0].share)})`).join("; ")}. Top three: ${P.map((d) => `${d.e.name} ${ibPct(top3(d.cur))}`).join(", ")}.`;
    for (const d of own) {
      if (!d.first) continue;
      const moves = d.cur.slice(0, 10).map((r) => ({ r, s0: share0(d, r.code) })).filter((x) => isNum(x.s0)).map((x) => ({ ...x, dlt: x.r.share - x.s0 })).sort((a, b) => b.dlt - a.dlt);
      if (moves.length) bullets.push(`${d.e.name}, change in share since ${d.y0}: ${nameOf(moves[0].r.code)} ${sg(ibPp(moves[0].dlt * 100))}, ${nameOf(moves.at(-1).r.code)} ${sg(ibPp(moves.at(-1).dlt * 100))}.`);
    }
    const ukDep = own.filter((d) => (share(d, "UK") || 0) > 0.2);
    if (ukDep.length) bullets.push(`United Kingdom above 20% of ${unit}: ${ukDep.map((d) => `${d.e.name} (${ibPct(share(d, "UK"))})`).join(", ")}.`);
  }
  const charts = [
    { title: `Share of ${unit} by ${label.toLowerCase()}`, legend: legendOf(R, P.map((d) => d.e)),
      draw: (el) => ibHBars(el, { cats: union.map(nameOf), fmt: (v) => `${(v * 100).toFixed(0)}%`, series: P.map((d) => ({ name: d.e.name, color: colorOf(p, d.e), values: union.map((c) => share(d, c)) })) }) },
  ];
  const xl = [{ title: `Share of ${unit} by ${label.toLowerCase()}`, columns: [{ label, fmt: "text" }, ...P.map((d) => ({ label: `${d.e.name} (${d.y})`, fmt: "0.0%" }))],
    rows: union.map((c) => [nameOf(c), ...P.map((d) => share(d, c))]), total: ["Top-3 concentration", ...P.map((d) => top3(d.cur))] }];
  return { headline, bullets, table, charts, chartsWide: true, appendix: [], xl };
}

function sourcesSection(R) {
  const { D, ctx } = R;
  const isCountry = new Set(ctx.meta.partners.filter((p) => p.is_country).map((p) => p.partner_code));
  const pname = (c) => ctx.meta.partners.find((p) => p.partner_code === c)?.partner_name?.replace(/ \(.*\)$/, "") || c;
  // The EU-27 aggregate counts only non-EU residents as foreign, so its shares are not comparable.
  const own = new Set(R.ents.map((e) => e.code));
  return mixSection(R, { label: "Source market", unit: "foreign nights", nameOf: pname, rowsFor: (e) => {
    if (e.code === "EU27_2020") return { cur: [] };
    const rows = D.source_markets.filter((r) => r.geo_code === e.code && isCountry.has(r.partner_code) && !own.has(r.partner_code) && isNum(r.nights));
    if (!rows.length) return { cur: [] };
    const y = Math.min(endYear(R), Math.max(...rows.map((r) => r.year)));
    const y0 = R.years.find((yy) => yy < y && rows.some((r) => r.year === yy));
    const pick = (yy) => rows.filter((r) => r.year === yy).sort((a, b) => b.nights - a.nights).map((r) => ({ code: r.partner_code, share: r.share_of_foreign_nights, v: r.nights }));
    return { y, y0, cur: pick(y), first: y0 ? pick(y0) : null };
  } });
}
function originsSection(R) {
  const { D } = R;
  const names = new Map(D.airport_origins.map((r) => [r.partner_country_code, r.partner_country_name]));
  return mixSection(R, { label: "Origin country", unit: "route passengers", nameOf: (c) => names.get(c) || c, rowsFor: (e) => {
    if (e.bench) return { cur: [] };
    const rows = D.airport_origins.filter((r) => r.airport_code === e.code && r.year <= endYear(R));
    if (!rows.length) return { cur: [] };
    const y = Math.max(...rows.map((r) => r.year));
    const y0 = R.years.find((yy) => yy < y && rows.some((r) => r.year === yy));
    const pick = (yy) => rows.filter((r) => r.year === yy).sort((a, b) => b.passengers - a.passengers).map((r) => ({ code: r.partner_country_code, share: r.share_of_airport, v: r.passengers }));
    return { y, y0, cur: pick(y), first: y0 ? pick(y0) : null };
  } });
}

function regionsSection(R) {
  const { D, ctx } = R;
  const p = palette();
  const per = R.ents.map((e) => {
    const regs = D.region_annual.filter((r) => ctx.geoMeta(r.geo_code)?.country_code === e.code && ctx.geoMeta(r.geo_code)?.geo_level === "nuts2" && isNum(r.nights));
    if (!regs.length) return null;
    const y = Math.min(endYear(R), Math.max(...regs.map((r) => r.year)));
    const y0 = R.years.find((yy) => yy < y && regs.some((r) => r.year === yy));
    const first = new Map(regs.filter((r) => r.year === y0).map((r) => [r.geo_code, r.nights]));
    const cur = regs.filter((r) => r.year === y).sort((a, b) => b.nights - a.nights);
    const tot = cur.reduce((a, r) => a + r.nights, 0);
    const tot0 = [...first.values()].reduce((a, v) => a + v, 0);
    const items = cur.map((r) => ({ name: ctx.geoName(r.geo_code), v: r.nights, share: r.nights / tot,
      g: first.get(r.geo_code) && y > y0 ? (r.nights / first.get(r.geo_code)) ** (1 / (y - y0)) - 1 : null, foreign: r.foreign_share }));
    return { e, y, y0, items, n: cur.length, natG: tot0 && y > y0 ? (tot / tot0) ** (1 / (y - y0)) - 1 : null };
  }).filter(Boolean);
  if (!per.length) return null;
  const top3 = (d) => d.items.slice(0, 3).reduce((a, r) => a + r.share, 0);
  let table, charts;
  if (R.cmp) {
    table = { head: ["", "Regions", "Largest region", "Share", "Top-3 share", "Fastest-growing (top 10)", "CAGR", "National CAGR"],
      body: per.map((d) => { const f = d.items.slice(0, 10).filter((x) => isNum(x.g)).sort((a, b) => b.g - a.g)[0];
        return [d.e.name, String(d.n), d.items[0].name, ibPct(d.items[0].share), ibPct(top3(d)), f?.name ?? "n/a", ibPct(f?.g), ibPct(d.natG)]; }) };
    const all = per.flatMap((d) => d.items.slice(0, 6).map((x) => ({ ...x, e: d.e }))).sort((a, b) => b.v - a.v).slice(0, 12);
    charts = [{ title: "Largest regions by nights", legend: legendOf(R, per.map((d) => d.e)),
      draw: (el) => ibHBars(el, { cats: all.map((x) => x.name), fmt: (v) => ibVal(M.nights, v), series: per.map((d) => ({ name: d.e.name, color: colorOf(p, d.e), values: all.map((x) => (x.e === d.e ? x.v : null)) })) }) }];
  } else {
    const d = per[0];
    table = { head: ["Region", `Nights ${d.y}`, "Share", `CAGR ${d.y0}-${d.y}`, "Foreign share"],
      body: d.items.slice(0, 10).map((x) => [x.name, ibVal(M.nights, x.v), ibPct(x.share), ibPct(x.g), ibPct(x.foreign)]),
      foot: [`${d.e.name} (all regions)`, ibVal(M.nights, d.items.reduce((a, r) => a + r.v, 0)), "100.0%", ibPct(d.natG), ""] };
    const top = d.items.slice(0, 8);
    charts = [
      { title: `Nights by region, ${d.y}`, draw: (el) => ibHBars(el, { cats: top.map((x) => x.name), fmt: (v) => ibVal(M.nights, v), series: [{ name: d.e.name, color: p.series[0], values: top.map((x) => x.v) }] }) },
      { title: `Growth by region v national (${d.y0}-${d.y} CAGR)`, legend: [{ label: "Region", color: p.series[0] }, { label: `${d.e.name}`, color: p.context }],
        draw: (el) => ibHBars(el, { cats: [...top.map((x) => x.name), `${d.e.name} total`], fmt: (v) => ibPct(v), series: [{ name: "CAGR", color: p.series[0], values: [...top.map((x) => x.g), null] }, { name: "National", color: p.context, values: [...top.map(() => null), d.natG] }] }) },
    ];
  }
  let headline = null; const bullets = [];
  if (R.an.has("commentary")) {
    headline = R.cmp ? `Top three regions' share of nights: ${per.map((d) => `${d.e.name} ${ibPct(top3(d))}`).join(", ")} (${per[0].y}).`
      : `${per[0].items[0].name} is the largest region with ${ibPct(per[0].items[0].share)} of nights in ${per[0].y}; the top three hold ${ibPct(top3(per[0]))}.`;
    for (const d of per) {
      const out = d.items.slice(0, 10).filter((x) => isNum(x.g) && isNum(d.natG) && x.g > d.natG).map((x) => x.name);
      if (out.length) bullets.push(`${d.e.name}: ${out.length} of the top ten regions grew faster than the national ${mn(ibPct(d.natG))} a year (${listJoin(out.slice(0, 3))}${out.length > 3 ? " and others" : ""}).`);
    }
  }
  const xl = per.map((d) => ({ title: `Regions, ${d.e.name}, ${d.y}`, columns: [{ label: "Region", fmt: "text" }, { label: "Nights", fmt: "#,##0" }, { label: "Share of national nights", fmt: "0.0%" },
    { label: `Compound growth since ${d.y0}`, fmt: "0.0%" }, { label: "Foreign share", fmt: "0.0%" }], rows: d.items.map((x) => [x.name, x.v, x.share, x.g, x.foreign]),
  total: ["All regions", d.items.reduce((a, r) => a + r.v, 0), 1, d.natG, null] }));
  return { headline, bullets, table, charts, chartsWide: R.cmp, appendix: [], xl };
}

function routesSection(R) {
  const { D } = R;
  const p = palette();
  const per = R.ents.map((e) => {
    const rows = D.airport_routes.filter((r) => r.airport_code === e.code && r.year <= endYear(R));
    if (!rows.length) return null;
    const y = Math.max(...rows.map((r) => r.year));
    return { e, y, top: rows.filter((r) => r.year === y).sort((a, b) => b.passengers - a.passengers).slice(0, 10) };
  }).filter(Boolean);
  if (!per.length) return null;
  const table = { rowHead: "#",
    groups: per.map((d) => ({ label: `${d.e.short || d.e.name} ${d.y}`, span: 3, subs: ["Route", "Pax", "YoY"] })),
    rows: Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), cells: per.map((d) => { const r = d.top[i]; return r ? [{ t: r.partner_airport_name, text: true }, { t: ibVal(M.passengers, r.passengers) }, { t: ibPct(r.passengers_yoy) }] : [{ t: "" }, { t: "" }, { t: "" }]; }) })) };
  const all = per.flatMap((d) => d.top.slice(0, 6).map((r) => ({ name: `${r.partner_airport_name}`, v: r.passengers, e: d.e }))).sort((a, b) => b.v - a.v).slice(0, 12);
  const charts = [{ title: "Busiest routes by passengers", legend: legendOf(R, per.map((d) => d.e)),
    draw: (el) => ibHBars(el, { cats: all.map((x) => (R.cmp ? `${x.name} (${x.e.name.split(" ")[0]})` : x.name)), fmt: (v) => ibVal(M.passengers, v), series: per.map((d) => ({ name: d.e.name, color: colorOf(p, d.e), values: all.map((x) => (x.e === d.e ? x.v : null)) })) }) }];
  let headline = null; const bullets = [];
  if (R.an.has("commentary")) {
    headline = `Busiest route: ${per.map((d) => `${d.e.name} to ${d.top[0].partner_airport_name}, ${ibVal(M.passengers, d.top[0].passengers)} passengers (${d.y})`).join("; ")}.`;
    for (const d of per) {
      const t = d.top.reduce((a, r) => a + r.passengers, 0);
      const fast = d.top.filter((r) => isNum(r.passengers_yoy)).sort((a, b) => b.passengers_yoy - a.passengers_yoy)[0];
      bullets.push(`${d.e.name}: top ten routes ${ibVal(M.passengers, t)} passengers${fast ? `; largest increase ${fast.partner_airport_name} (${sg(ibPct(fast.passengers_yoy))})` : ""}.`);
    }
  }
  const xl = per.map((d) => ({ title: `Top routes, ${d.e.name}, ${d.y}`, columns: [{ label: "Route", fmt: "text" }, { label: "Country", fmt: "text" }, { label: "Passengers", fmt: "#,##0" }, { label: "Change on previous year", fmt: "0.0%" }],
    rows: d.top.map((r) => [r.partner_airport_name, r.partner_country_name, r.passengers, r.passengers_yoy]), total: ["Top ten", null, d.top.reduce((a, r) => a + r.passengers, 0), null] }));
  return { headline, bullets, table, charts, chartsWide: true, appendix: [], xl };
}

const SECTION_DEFS = {
  country: {
    demand: (R) => metricSection(R, ["nights", "arrivals", "nights_foreign", "foreign_share", ...(R.an.has("share") ? ["share_eu"] : []), ...(R.an.has("intensity") ? ["nights_per_resident"] : [])],
      { extraCharts: R.an.has("monthly") ? [monthlyChart(R, "Nights")] : [] }),
    occupancy: (R) => metricSection(R, ["bed_place_occupancy_rate", "room_occupancy_rate", "avg_length_of_stay"]),
    seasonality: (R) => seasonalitySection(R, "Nights"),
    regions: regionsSection,
    sources: sourcesSection,
    rentals: (R) => metricSection(R, ["platform_nights", "platform_share"]),
    air: (R) => metricSection(R, ["air_passengers", "air_passengers_international"]),
    prices: (R) => metricSection(R, ["hicp_accommodation_pct", "hicp_restaurants_pct", "hicp_all_items_pct", "accommodation_turnover_index"]),
    macro: (R) => metricSection(R, ["gdp_growth", "unemployment_rate_pct", "consumer_confidence_balance", "bond_yield_10y_pct"]),
    weather: (R) => metricSection(R, ["w_anom", "w_temp", "w_sun", "w_rain"]),
    hotels: (R) => (R.ents.some((e) => ["ES", "PT"].includes(e.code)) ? metricSection(R, ["adr_es", "revpar_es", "rev_night_pt"]) : null),
    fx: (R) => (R.ents.some((e) => e.meta?.currency_code && e.meta.currency_code !== "EUR") ? metricSection(R, ["fx"]) : null),
  },
  region: {
    demand: (R) => metricSection(R, ["nights", "nights_foreign", "foreign_share"], { extraCharts: R.an.has("monthly") ? [monthlyChart(R, "Nights")] : [] }),
    share: (R) => metricSection(R, ["share_of_country_nights"]),
    seasonality: (R) => seasonalitySection(R, "Nights"),
    rentals: (R) => metricSection(R, ["platform_nights", "platform_share"]),
    weather: (R) => metricSection(R, ["w_anom", "w_temp", "w_sun", "w_rain"]),
  },
  airport: {
    traffic: (R) => metricSection(R, ["passengers", ...(R.an.has("share") ? ["share_country_air"] : [])], { extraCharts: R.an.has("monthly") ? [monthlyChart(R, "Passengers")] : [] }),
    seasonality: (R) => seasonalitySection(R, "Passengers"),
    origins: originsSection,
    routes: routesSection,
  },
};

// ------------------------------------------------------------------ executive summary
// Scorecard: each criterion ranks the places (comparison) or sets the place against its benchmark.
const SCORE = {
  country: [["Size (nights)", "nights", "value"], ["Growth (CAGR)", "nights", "cagr"], ["Change v 2019", "nights", "base"], ["Latest year change", "nights", "yoy"],
    ["Bed-place occupancy", "bed_place_occupancy_rate", "value"], ["Two busiest months' share", "season", "two"], ["Foreign share of nights", "foreign_share", "value"],
    ["Air passenger growth (CAGR)", "air_passengers", "cagr"], ["Accommodation inflation", "hicp_accommodation_pct", "value"]],
  region: [["Size (nights)", "nights", "value"], ["Growth (CAGR)", "nights", "cagr"], ["Change v 2019", "nights", "base"], ["Latest year change", "nights", "yoy"],
    ["Two busiest months' share", "season", "two"], ["Foreign share of nights", "foreign_share", "value"], ["Share of national nights", "share_of_country_nights", "value"]],
  airport: [["Size (passengers)", "passengers", "value"], ["Growth (CAGR)", "passengers", "cagr"], ["Change v 2019", "passengers", "base"], ["Latest year change", "passengers", "yoy"],
    ["Two busiest months' share", "season", "two"], ["Share of national passengers", "share_country_air", "value"]],
};
function scoreValue(R, e, key, what) {
  if (key === "season") {
    const pr = profiles(R, e).out;
    if (!pr.size) return null;
    const v = seasonStats(pr.get(Math.max(...pr.keys()))).two;
    return { v, t: ibPct(v), better: "low" };
  }
  const m = M[key];
  const f = facts(R, key, e);
  const v = what === "value" ? f.last?.value : what === "yoy" ? f.last?.change : what === "cagr" ? f.g?.v : f.vb;
  if (!isNum(v)) return null;
  const t = what === "value" ? ibVal(m, v) : what === "cagr" ? ibGrowth(m, f.g) : ibChg(m, v);
  return { v, t, better: "high" };
}
// One bar per place: change against the baseline year, or compound growth over the window.
function placeBars(R, key, what) {
  const m = M[key];
  const p = palette();
  const P = parts(R).map((e) => ({ e, f: facts(R, key, e) })).filter((d) => isNum(what === "base" ? d.f.vb : d.f.g?.v));
  if (!P.length) return null;
  const v = (d) => (what === "base" ? d.f.vb : d.f.g.v) * 100;
  const lf = P[0].f.lf?.year;
  return { title: what === "base" ? `${short(m.label)}: ${lf} v ${R.base}` : `${short(m.label)}: compound annual growth`,
    draw: (el) => ibColumns(el, { cats: P.map((d) => d.e.short || d.e.name), fmt: (x) => neg(x, `${Math.abs(x).toFixed(1)}%`),
      series: [{ name: short(m.label), color: p.series[0], values: P.map(v) }], colors: P.map((d) => colorOf(p, d.e)) }) };
}

function summarySlide(R, sections) {
  const P = parts(R);
  const crit = SCORE[R.st.level].filter(([label]) => R.cmp || !label.startsWith("Size")).map(([label, key, what]) => ({ label, key, what, vals: P.map((e) => scoreValue(R, e, key, what)) }))
    .filter((c) => c.vals.filter(Boolean).length >= (R.cmp ? 2 : 1));
  const own = R.ents;
  const ranks = own.map(() => []);
  for (const c of crit) {
    const xs = own.map((e, i) => ({ i, s: c.vals[i] })).filter((x) => x.s);
    xs.sort((a, b) => (a.s.better === "high" ? b.s.v - a.s.v : a.s.v - b.s.v));
    c.rank = new Map(xs.map((x, r) => [x.i, r + 1]));
    xs.forEach((x, r) => ranks[x.i].push(r + 1));
    if (!R.cmp && R.bench) {
      const me = c.vals[0], b = c.vals[1];
      c.vsBench = me && b ? ((me.better === "high" ? me.v >= b.v : me.v <= b.v) ? "above" : "below") : null;
    }
  }
  const avg = ranks.map((r) => (r.length ? r.reduce((a, x) => a + x, 0) / r.length : null));
  const table = R.cmp
    ? { head: ["Criterion", ...own.map((e) => e.short || e.name)], score: true,
      body: crit.map((c) => [c.label, ...own.map((e, i) => ({ t: c.vals[i]?.t ?? "n/a", rank: c.rank.get(i), n: c.rank.size }))]),
      foot: ["Average rank (overall)", ...own.map((e, i) => (isNum(avg[i]) ? `${avg[i].toFixed(1)} (${ordinal([...avg].filter(isNum).sort((a, b) => a - b).indexOf(avg[i]) + 1)})` : "n/a"))] }
    : { head: ["Criterion", R.ents[0].short || R.ents[0].name, ...(R.bench ? [R.bench.name, "Position"] : [])], score: true,
      body: crit.map((c) => [c.label, { t: c.vals[0]?.t ?? "n/a" }, ...(R.bench ? [{ t: c.vals[1]?.t ?? "n/a", bench: true }, { t: c.vsBench === "above" ? "▲ Ahead" : c.vsBench === "below" ? "▼ Behind" : "n/a", pos: c.vsBench }] : [])]),
      foot: R.bench ? ["Criteria ahead of benchmark", `${crit.filter((c) => c.vsBench === "above").length} of ${crit.filter((c) => c.vsBench).length}`, "", ""] : null };
  // Conclusions: the overall verdict, then each section's headline.
  const items = [];
  if (R.an.has("commentary")) {
    if (R.cmp) {
      const order = own.map((e, i) => ({ e, i, a: avg[i] })).filter((x) => isNum(x.a)).sort((a, b) => a.a - b.a);
      if (order.length) {
        const firsts = (i) => crit.filter((c) => c.rank.get(i) === 1).map((c) => lc(c.label));
        items.push({ lead: `${order[0].e.name} has the best average rank across ${crit.length} measures (${order[0].a.toFixed(1)}).`,
          text: `Ranked first: ${order.map((x) => `${x.e.name} – ${firsts(x.i).length ? listJoin(firsts(x.i)) : "none"}`).join("; ")}.` });
      }
    } else if (R.bench) {
      const ahead = crit.filter((c) => c.vsBench === "above").map((c) => lc(c.label));
      const behind = crit.filter((c) => c.vsBench === "below").map((c) => lc(c.label));
      items.push({ lead: `${R.ents[0].name} is ahead of ${theB(R.bench)} on ${ahead.length} of ${ahead.length + behind.length} measures.`,
        text: `Ahead: ${listJoin(ahead) || "none"}. Behind: ${listJoin(behind) || "none"}.` });
    }
    for (const s of sections) if (s.headline) items.push({ lead: `${s.title.replace(/:.*$/, "")}:`, text: s.headline });
  }
  const xl = [{ title: "Scorecard", columns: [{ label: "Criterion", fmt: "text" }, ...P.map((e) => ({ label: e.name, fmt: "General" }))],
    rows: crit.map((c) => [c.label, ...P.map((e, i) => c.vals[i]?.v ?? null)]),
    cellFmts: crit.map((c) => ["text", ...P.map(() => (c.key === "season" ? "0.0%" : c.what === "value" ? xlFmt(M[c.key]) : c.what === "cagr" ? (isRatio(M[c.key]) ? "0.0%" : xlChgFmt(M[c.key])) : xlChgFmt(M[c.key])))]),
  }];
  // Excel values for change criteria need the same scaling as elsewhere.
  xl[0].rows = crit.map((c) => [c.label, ...P.map((e, i) => { const v = c.vals[i]?.v; if (!isNum(v)) return null; return c.key === "season" || c.what === "value" || (c.what === "cagr" && isRatio(M[c.key])) ? v : xlChg(M[c.key], v); })]);
  const headline = items[0]?.lead || null;
  // Charts under the conclusions: the lead metric indexed, and each place against 2019 (or its CAGR).
  const lead = { country: "nights", region: "nights", airport: "passengers" }[R.st.level];
  const charts = [trendChart(R, lead, { forceIndex: true }), placeBars(R, lead, R.an.has("base") ? "base" : "cagr")].filter(Boolean);
  return { headline, items: items.slice(0, 7), table, scorecard: true, charts, bullets: [], appendix: [], xl };
}

// ------------------------------------------------------------------ document (4:3 slide deck)
// Follows the house market-overview deck: #DCDAC8 title band, ivory page, bold upper-case
// titles, Arial text, navy-headed tables, Highgate accent series (bronze, teal, ochre, khaki), and the
// emblem, "Strictly Private & Confidential" and page number along the foot. 10 x 7.5 in slides.
const BRAND = { logo: "assets/brand/logo.png", emblem: "assets/brand/emblem.png" };
const SECTION_SOURCES = {
  summary: "Eurostat, ECB, OECD", demand: "Eurostat", occupancy: "Eurostat", seasonality: "Eurostat", regions: "Eurostat (NUTS 2)",
  sources: "Eurostat", rentals: "Eurostat (experimental statistics)", air: "Eurostat", prices: "Eurostat (HICP, short-term business statistics)",
  macro: "Eurostat, ECB", weather: "Open-Meteo (ERA5)", hotels: "INE, Statistics Portugal", fx: "ECB", share: "Eurostat",
  traffic: "Eurostat", origins: "Eurostat (route data)", routes: "Eurostat (route data)",
};
const brandImg = (src, cls) => h("img", { src, class: cls, alt: "", onerror: (e) => e.target.remove() });

function slideShell(title, { cover = false } = {}) {
  const body = h("div", { class: "sl-body" });
  const pg = h("span", { class: "sl-pg" });
  const src = h("div", { class: "sl-src" });
  const el = h("section", { class: `sl${cover ? " sl-cover" : ""}` },
    cover ? null : h("header", { class: "sl-band" }, h("h2", {}, title.toUpperCase())),
    body, cover ? null : src,
    h("footer", { class: "sl-foot" }, brandImg(BRAND.emblem, "sl-emblem"), h("span", { class: "sl-conf" }, "Strictly Private", h("br"), "& Confidential"), pg));
  return { el, body, pg, src };
}

function renderCompTable(t, groupIdx) {
  const gi = groupIdx || t.groups.map((_, i) => i);
  const G = gi.map((i) => ({ ...t.groups[i], subs: t.groups[i].subs || t.subs, i }));
  const cls = (g, j, c = {}) => `${j === 0 ? "gstart" : ""}${g.bench ? " bench" : ""}${c.bold ? " lead" : ""}${c.text ? " text trunc" : ""}${/^\(/.test(c.t || "") ? " negv" : ""}`;
  const head1 = h("tr", {}, h("th", { class: "text" }, ""), ...G.map((g) => h("th", { colspan: String(g.subs.length), class: `grp${g.bench ? " bench" : ""}` }, g.label)));
  const isText = (g, j) => t.rows.some((r) => r.cells[g.i]?.[j]?.text);
  const head2 = h("tr", { class: "sub" }, h("th", { class: "text" }, t.rowHead || "Metric"), ...G.flatMap((g) => g.subs.map((sub, j) => h("th", { class: `${cls(g, j)}${isText(g, j) ? " text" : ""}` }, sub))));
  const row = (r, tag = "td") => h("tr", {}, h(tag, { class: "text" }, r.label), ...G.flatMap((g) => r.cells[g.i].map((c, j) => h(tag, { class: cls(g, j, c), title: c.text ? c.t : null }, c.t))));
  return h("table", { class: "sl-table comp" }, h("thead", {}, head1, head2), h("tbody", {}, t.rows.map((r) => row(r))), t.foot ? h("tfoot", {}, row(t.foot)) : null);
}
function renderSimpleTable(t, { highlight } = {}) {
  const cell = (c, i, tag) => {
    if (c && typeof c === "object") {
      const shade = c.rank && c.n > 1 ? (c.rank === 1 ? " best" : c.rank === c.n ? " worst" : " mid") : "";
      return h(tag, { class: `${i === 0 ? "text" : ""}${shade}${c.bench ? " bench" : ""}${c.pos ? ` pos-${c.pos}` : ""}${/^\(/.test(c.t) ? " negv" : ""}` }, c.t);
    }
    return h(tag, { class: `${i === 0 ? "text" : ""}${/^\(/.test(String(c)) ? " negv" : ""}` }, c ?? "");
  };
  return h("table", { class: `sl-table${t.score ? " score" : ""}` },
    h("thead", {}, h("tr", {}, t.head.map((c, i) => h("th", { class: `${i === 0 ? "text" : ""}${t.benchCols?.[i - 1] ? " bench" : ""}` }, c)))),
    h("tbody", {}, t.body.map((r, ri) => h("tr", { class: `${highlight && highlight(r) ? "hl" : ""}${t.benchRow === ri ? " benchrow" : ""}` }, r.map((c, i) => cell(c, i, "td"))))),
    t.foot ? h("tfoot", {}, h("tr", {}, t.foot.map((c, i) => cell(c, i, "td")))) : null);
}
function deckTable(columns, rows, { highlight } = {}) { return renderSimpleTable({ head: columns, body: rows }, { highlight }); }

// Prose keeps one level of brackets: "(x (0.6pp))" reads as "(x −0.6pp)".
const tidy = (t) => (t ? String(t).replace(/\(\(([^()]+)\)\)/g, "(−$1)").replace(/ \(([^()]*)\(([^()]+)\)([^()]*)\)/g, " ($1−$2$3)") : t);

function renderDocument(ctx, host, doc, paper, scroll) {
  const { R } = doc;
  for (const s of doc.sections) {
    s.headline = tidy(s.headline);
    if (s.bullets) s.bullets = s.bullets.map(tidy);
    if (s.items) s.items = s.items.map((it) => ({ lead: tidy(it.lead), text: tidy(it.text) }));
  }
  const generated = new Date().toISOString().slice(0, 10);
  const draws = [];
  const slides = [];
  const add = (s, section) => { slides.push({ ...s, section }); paper.append(s.el); return s; };
  const lastYear = String(endYear(R));
  const isFinal = (r) => typeof r[0] === "string" && r[0].startsWith(lastYear);
  const figure = (f) => {
    const el = h("div", { class: "sl-chart" });
    draws.push(() => f.draw(el));
    return h("figure", { class: "sl-fig" }, h("figcaption", {}, f.title), f.legend ? legendHTML(f.legend) : null, el, f.note ? h("p", { class: "sl-note" }, f.note) : null);
  };

  const cover = slideShell("", { cover: true });
  cover.body.append(h("div", { class: "cv-oval" }, brandImg(BRAND.logo, "cv-logo"),
    h("div", { class: "cv-title" }, `${doc.title}: ${doc.subtitle}`.toUpperCase()),
    h("div", { class: "cv-sub" }, R.bench ? `${doc.period} · benchmarked against ${theB(R.bench)}` : doc.period)));
  add(cover, null);

  const toc = slideShell("Table of contents");
  const tocList = h("div", { class: "toc-list" });
  toc.body.classList.add("toc");
  toc.body.append(h("div", { class: "toc-card" },
    h("dl", {},
      h("dt", {}, R.cmp ? "Places" : "Place"), h("dd", {}, R.ents.map((e) => e.name).join(", ")),
      ...(R.bench ? [h("dt", {}, "Benchmark"), h("dd", {}, R.bench.name)] : []),
      h("dt", {}, "Period"), h("dd", {}, doc.period),
      h("dt", {}, "Baseline year"), h("dd", {}, String(R.base)),
      h("dt", {}, "Analytics"), h("dd", {}, ANALYTICS.filter(([k]) => R.an.has(k)).map(([, l]) => l).join(", ") || "None"),
      h("dt", {}, "Data refreshed"), h("dd", {}, ctx.meta.generated_at.slice(0, 10)),
      h("dt", {}, "Generated"), h("dd", {}, generated)),
    legendHTML(legendOf(R))), tocList);
  toc.src.textContent = "Sources: Eurostat, ECB Data Portal, OECD, Open-Meteo, INE, Statistics Portugal. CAGR = compound annual growth rate; pp = percentage points; (x) = negative.";
  add(toc, null);

  const appendix = [];
  for (const s of doc.sections) {
    const sl = add(slideShell(s.title.replace(/:.*$/, "")), s.key);
    sl.src.textContent = `Sources: ${SECTION_SOURCES[s.key] || "Eurostat"}${s.table?.notes?.length ? `. Notes: ${s.table.notes.join("; ")}.` : ""}`;
    if (s.scorecard) {
      sl.body.classList.add("exec");
      const list = h("ol", { class: "sl-concl" }, (s.items || []).map((it) => h("li", {}, h("b", {}, it.lead), it.text ? ` ${it.text}` : "")));
      sl.body.append(h("div", { class: "sl-row" },
        h("div", { class: "sl-text" }, list),
        h("div", { class: "sl-tablewrap" }, h("div", { class: "sl-table-title" }, R.cmp ? "Scorecard (bold = ranked first)" : `Scorecard v ${R.bench?.name || "benchmark"}`), renderSimpleTable(s.table))));
      if (s.charts?.length) sl.body.append(h("div", { class: `sl-figs n${s.charts.length}` }, s.charts.map(figure)));
      continue;
    }
    const tableEl = s.table?.groups ? renderCompTable(s.table) : s.table ? renderSimpleTable(s.table) : null;
    // The conclusion is the first bullet, in bold (one heading per slide: the title band).
    const lines = [...(s.headline ? [s.headline] : []), ...(s.bullets || [])];
    const top = h("div", { class: "sl-row top" },
      lines.length ? h("div", { class: "sl-text" }, h("ul", { class: "sl-bullets" }, lines.map((b, i) => h("li", { class: i === 0 && s.headline ? "lead" : null }, b)))) : null,
      tableEl ? Object.assign(h("div", { class: "sl-tablewrap" }, tableEl), { _t: s.table }) : null);
    if (!lines.length) top.classList.add("solo");
    sl.body.append(top);
    if (s.charts?.length) sl.body.append(h("div", { class: `sl-figs n${s.charts.length}${s.chartsWide ? " wide" : ""}` }, s.charts.map(figure)));
    for (const t of s.appendix || []) appendix.push({ section: s, t });
  }
  // Appendix: year-by-year tables, two per slide.
  for (let i = 0; i < appendix.length; i += 2) {
    const pair = appendix.slice(i, i + 2);
    const sl = add(slideShell(`Appendix – ${listJoin([...new Set(pair.map((x) => x.section.title.replace(/:.*$/, "")))])} data`), "appendix");
    sl.body.classList.add(pair.length === 2 ? "tables2" : "tables1");
    sl.body.append(...pair.map((x) => h("div", { class: "sl-tablewrap" }, h("div", { class: "sl-table-title" }, x.t.title), deckTable(x.t.columns, x.t.rows, { highlight: isFinal }))));
    sl.src.textContent = `Sources: ${listJoin([...new Set(pair.map((x) => SECTION_SOURCES[x.section.key] || "Eurostat"))])}. Final year boxed.`;
  }

  slides.forEach((s, i) => { s.pg.textContent = i ? String(i + 1) : ""; });
  const tocEntries = [...doc.sections.map((s) => [s.key, s.title]), ...(appendix.length ? [["appendix", "Appendix: data tables"]] : [])];
  for (const [key, title] of tocEntries) {
    const pages = slides.map((x, i) => (x.section === key ? i + 1 : null)).filter(Boolean);
    if (!pages.length) continue;
    tocList.append(h("div", { class: "toc-row" }, h("span", { class: "toc-pg" }, pages.length > 1 ? `Pg ${pages[0]} – ${pages.at(-1)}` : `Pg ${pages[0]}`), h("span", {}, title)));
  }

  const printBtn = h("button", { type: "button", class: "rp-go", onclick: () => {
    const prev = document.title; document.title = doc.fileBase; window.print(); setTimeout(() => { document.title = prev; }, 500);
  } }, "Save as PDF");
  const xlBtn = h("button", { type: "button", class: "rp-go secondary", onclick: async () => {
    xlBtn.disabled = true; xlBtn.textContent = "Preparing Excel…";
    try { await exportExcel(doc); } catch (e) { console.error(e); alert(`Excel export failed: ${e.message}`); }
    xlBtn.disabled = false; xlBtn.textContent = "Download Excel";
  } }, "Download Excel");
  host.prepend(h("div", { class: "rp-toolbar" }, printBtn, xlBtn,
    h("span", { class: "rp-hint" }, `${slides.length} slides, 4:3. In the print dialog choose “Save as PDF”; Excel holds every table in HG format.`)));
  scroll.hidden = false;
  // Layout is settled from measurements before any chart is drawn: tables first, then text.
  for (const s of slides) arrange(s);
  for (const s of slides) {
    for (const el of s.el.querySelectorAll(".sl-tablewrap")) fitText(el, 7, 10.5);
    for (const el of s.el.querySelectorAll(".sl-text")) fitText(el, 7.5, s.el.querySelector(".exec") ? 12.5 : 12);
  }
  draws.forEach((d) => d());
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

// A table that does not fit beside the bullets at 8px takes the full width (bullets move next to
// the charts); one that still does not fit at 7px is split into two stacked tables by place.
function arrange(sl) {
  const top = sl.el.querySelector(".sl-row.top");
  const wrap = top?.querySelector(".sl-tablewrap");
  if (!wrap) return;
  const fits = (px) => { wrap.style.fontSize = `${px}px`; const ok = wrap.scrollWidth <= wrap.clientWidth + 1; wrap.style.fontSize = ""; return ok; };
  const text = top.querySelector(".sl-text");
  if (text && !fits(8)) {
    const figs = sl.el.querySelector(".sl-figs");
    top.classList.add("solo");
    top.after(h("div", { class: "sl-row bottom" }, text, figs));
  }
  const t = wrap._t;
  if (!fits(7) && t?.groups?.length > 1) {
    const k = Math.ceil(t.groups.length / 2);
    const idx = t.groups.map((_, i) => i);
    wrap.replaceChildren(renderCompTable(t, idx.slice(0, k)), renderCompTable(t, idx.slice(k)));
    wrap.classList.add("split");
  }
  if (!fits(7)) wrap.classList.add("wrap-cells");
}

// Shrinks text that overflows its box; with max, first grows it to use spare room.
function fitText(el, min, max = null) {
  let fs = parseFloat(getComputedStyle(el).fontSize);
  const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  if (max) while (!over() && fs < max) { fs += 0.5; el.style.fontSize = `${fs}px`; }
  while (over() && fs > min) { fs -= 0.5; el.style.fontSize = `${fs}px`; }
}

// ------------------------------------------------------------------ Excel (HG format)
// Header #16365C / white, subheader #D9D9D9 / black, totals #DDEBF7 / black; Arial 14; zoom 55%;
// no wrap, borders, merges or frozen panes; tables start at D3; A = 8, B = C = 1 and two spacer
// columns of 1 after the last table column; table columns fit their text.
const MDW = 12;
const xlWidth = (chars) => Math.trunc(((chars * MDW + 5) / MDW) * 256) / 256;
const FONT = (color = "FF000000") => ({ name: "Arial", size: 14, color: { argb: color } });
const FILL = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } });

function loadScript(src, global) {
  if (window[global]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("could not load the Excel library"));
    document.head.append(s);
  });
}

// The workbook's Normal style sets Excel's width unit (its maximum digit width). HG widths are
// calibrated for Arial 14 (12 px digits), so the default font (the first <font>) becomes Arial 14.
async function normalArial14(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const path = "xl/styles.xml";
  const xml = await zip.file(path).async("string");
  const next = xml.replace(/(<fonts[^>]*>)\s*<font>[\s\S]*?<\/font>/, '$1<font><sz val="14"/><color theme="1"/><name val="Arial"/><family val="2"/></font>');
  if (next === xml) throw new Error("could not set the workbook font");
  zip.file(path, next);
  return zip.generateAsync({ type: "arraybuffer" });
}

// Approximate the displayed text of a cell under its number format, for column widths.
function shownText(v, fmt) {
  if (v == null) return "";
  if (typeof v !== "number") return String(v);
  if (fmt === "#,##0") return Math.round(v).toLocaleString("en-GB");
  if (fmt === "0.0%") return `${(v * 100).toFixed(1)}%`;
  if (fmt?.includes("pts")) return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)} pts`;
  if (fmt === '0.0"%"') return `${v.toFixed(1)}%`;
  if (fmt === "€#,##0.0") return `€${v.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  const m = /0\.(0+)/.exec(fmt || ""); return v.toFixed(m ? m[1].length : 2);
}

function sheetName(s, used) {
  let n = s.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  let k = 2; const b = n;
  while (used.has(n)) n = `${b.slice(0, 28)} ${k++}`;
  used.add(n); return n;
}

async function exportExcel(doc) {
  await Promise.all([loadScript(EXCELJS, "ExcelJS"), loadScript(JSZIP, "JSZip")]);
  const wb = new window.ExcelJS.Workbook();
  wb.creator = "EU Markets";
  const used = new Set();
  for (const s of doc.sections) {
    if (!s.xl?.length) continue;
    const ws = wb.addWorksheet(sheetName(s.title.replace(/:.*$/, ""), used), { views: [{ state: "normal", zoomScale: 55, zoomScaleNormal: 55 }] });
    const widths = new Map();
    const fit = (c, text) => widths.set(c, Math.max(widths.get(c) || 0, String(text).length));
    let row = 3;
    let lastCol = 4;
    for (const t of s.xl) {
      const n = t.columns.length;
      lastCol = Math.max(lastCol, 3 + n);
      // Header: theme title, centred across the table (no merge).
      for (let j = 0; j < n; j++) {
        const cell = ws.getCell(row, 4 + j);
        if (j === 0) cell.value = t.title;
        cell.fill = FILL("16365C"); cell.font = FONT("FFFFFFFF");
        cell.alignment = { horizontal: n > 1 ? "centerContinuous" : "left", vertical: "middle", wrapText: false };
      }
      row++;
      // Subheader: column labels.
      t.columns.forEach((c, j) => {
        const cell = ws.getCell(row, 4 + j);
        cell.value = c.label; cell.fill = FILL("D9D9D9"); cell.font = FONT();
        cell.alignment = { horizontal: j === 0 ? "left" : "right", wrapText: false };
        fit(4 + j, c.label);
      });
      row++;
      t.rows.forEach((r, ri) => {
        r.forEach((v, j) => {
          const cell = ws.getCell(row, 4 + j);
          const fmt = t.cellFmts?.[ri]?.[j] ?? t.columns[j].fmt;
          cell.value = v ?? null;
          cell.font = FONT();
          cell.alignment = { horizontal: j === 0 ? "left" : "right", wrapText: false };
          if (typeof v === "number" && fmt && fmt !== "text" && fmt !== "General") cell.numFmt = fmt;
          fit(4 + j, shownText(v, fmt === "General" ? "0.0" : fmt));
        });
        row++;
      });
      if (t.total) {
        t.columns.forEach((c, j) => {
          const cell = ws.getCell(row, 4 + j);
          const v = t.total[j];
          cell.value = v ?? null; cell.fill = FILL("DDEBF7"); cell.font = FONT();
          cell.alignment = { horizontal: j === 0 ? "left" : "right", wrapText: false };
          if (typeof v === "number" && c.fmt !== "text") cell.numFmt = c.fmt;
          fit(4 + j, shownText(v, c.fmt));
        });
        row++;
      }
      row++; // one blank row between tables
    }
    for (const [c, chars] of widths) ws.getColumn(c).width = xlWidth(Math.max(6, chars + 2));
    // Spacers. ExcelJS folds adjacent identical columns into one range, so B and the second
    // trailing spacer carry a font style to keep every spacer a separate column entry.
    ws.getColumn(1).width = xlWidth(8);
    ws.getColumn(2).width = xlWidth(1); ws.getColumn(2).font = FONT();
    ws.getColumn(3).width = xlWidth(1);
    ws.getColumn(lastCol + 1).width = xlWidth(1);
    ws.getColumn(lastCol + 2).width = xlWidth(1); ws.getColumn(lastCol + 2).font = FONT();
  }
  if (!wb.worksheets.length) throw new Error("the selected sections have no tables");
  const buf = await normalArial14(await wb.xlsx.writeBuffer());
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${doc.fileBase}.xlsx` });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
