// Report builder: choose a level (country, region or airport), one place or up to four to compare,
// the sections and analytics to include, and a window of years. Renders a print-ready document
// (Save as PDF from the browser) and an Excel workbook in HG format (ExcelJS, loaded on demand).
import {
  loadTable, isNum, h, select, segmented, fmtNum, fmtPrecise, fmtPct, fmtRate, fmtDec, fmtChange, monthName, groupBy,
} from "./util.js";
import { timeChart, columnChart, rankBars, setChartScope, palette, legendHTML } from "./charts.js";

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
const DEFAULT_ANALYTICS = ["yoy", "cagr", "index", "base", "monthly", "share", "tables", "commentary"];

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
const signed = (v, d = 1) => {
  if (!isNum(v)) return "n/a";
  const r = Number(v.toFixed(d));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(d)}`;
};

function fmtVal(m, v) {
  if (!isNum(v)) return "n/a";
  switch (m.kind) {
    case "sum": return fmtPrecise(v);
    case "rate01": return fmtPct(v, 1);
    case "pct": return fmtRate(v, m.digits ?? 1);
    case "index": return fmtDec(v, 1);
    case "eur": return `€${v.toFixed(v < 100 ? 1 : 0)}`;
    default: return fmtDec(v, m.digits ?? 1);
  }
}
function fmtAxis(m) {
  if (m.kind === "sum") return (v) => fmtNum(v, Math.abs(v) >= 1e6 ? 1 : 0);
  if (m.kind === "rate01") return (v) => fmtPct(v, 0);
  if (m.kind === "pct") return (v) => fmtRate(v, 0);
  if (m.kind === "eur") return (v) => `€${Math.round(v)}`;
  return (v) => fmtDec(v, m.digits && Math.abs(v) < 10 ? Math.min(m.digits, 1) : 0);
}
function fmtChg(m, c) {
  if (!isNum(c)) return "n/a";
  if (isRatio(m)) return fmtChange(c);
  if (m.kind === "rate01") return `${signed(c * 100, 1)} pts`;
  if (m.kind === "pct") return `${signed(c, 1)} pts`;
  return signed(c, m.digits ?? 1);
}
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
  region: ["region_annual", "annual_history"],
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
    const paper = h("article", { class: "rp-paper", id: "rp-paper" });
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
const airportLabel = (a) => (a.city && a.iata_code ? `${a.city} (${a.iata_code})` : a.airport_name);

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
    if (sec.has("regions")) need.add("region_annual");
    if (sec.has("sources")) need.add("source_markets");
    if (sec.has("air")) need.add("airport_annual");
    if (sec.has("macro")) need.add("gdp_quarterly");
    if (sec.has("weather")) need.add("weather_monthly");
    if (sec.has("hotels")) { need.add("spain_zones_monthly"); need.add("portugal_prices_monthly"); }
    if (sec.has("fx")) need.add("fx_monthly");
  } else if (st.level === "region") {
    if (sec.has("seasonality") || an.has("monthly")) need.add("region_monthly");
    if (sec.has("weather")) need.add("weather_monthly");
  } else {
    if (sec.has("seasonality") || an.has("monthly")) need.add("airports_monthly");
    if (sec.has("origins")) need.add("airport_origins");
    if (sec.has("routes")) need.add("airport_routes");
  }
  const D = await loadData([...need]);
  const ents = st.ids.map((code, i) => ({ code, i, name: entityName(ctx, st.level, code, D), meta: st.level === "airport" ? D.airport_summary.find((a) => a.airport_code === code) : ctx.geoMeta(code) }));
  const years = Array.from({ length: st.span }, (_, i) => st.end - st.span + 1 + i);
  const R = { ctx, st, D, ents, years, an, cmp: st.mode === "cmp", base: ctx.meta.baseline_year, cache: new Map() };
  const sections = [];
  for (const [key, title] of SECTIONS[st.level]) {
    if (!sec.has(key)) continue;
    const s = await SECTION_BUILDERS[st.level][key](R);
    if (s) sections.push({ key, title, ...s });
  }
  const names = ents.map((e) => e.name);
  const title = R.cmp ? names.join(" v ") : names[0];
  const kindLabel = { country: "tourism market", region: "regional tourism", airport: "airport traffic" }[st.level];
  return {
    title, subtitle: R.cmp ? `Comparative ${kindLabel} report` : `${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} report`,
    period: `${years[0]} to ${years.at(-1)} (${st.span} years)`, years, ents, sections, R,
    fileBase: `EU-Markets_${names.join("-v-").replace(/[^A-Za-z0-9-]+/g, "-")}_${years[0]}-${years.at(-1)}`,
  };
}

// Series: [{year, value, change, ytd, months}] ascending, for one entity and metric.
function series(R, key, e) {
  const ck = `${key}|${e.code}`;
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
  const { D, st } = R;
  const m = M[key];
  const ah = (geo, metric) => D.annual_history.filter((r) => r.geo_code === geo && r.metric === metric)
    .map((r) => ({ year: r.year, value: r.value, change: r.change, ytd: !!r.is_ytd, months: r.months }));
  if (st.level === "country") {
    if (AH_METRICS.has(key)) return ah(e.code, key);
    if (["foreign_share", "peak_two_month_share", "platform_share", "nights_per_resident"].includes(key)) {
      return withChanges(m, D.country_annual.filter((r) => r.geo_code === e.code).map((r) => ({ year: r.year, value: r[key], ytd: !r.is_complete_year })));
    }
    if (key === "share_eu") {
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
  if (st.level === "region") {
    const rows = D.region_annual.filter((r) => r.geo_code === e.code);
    const chg = { nights: "nights_yoy", platform_nights: "platform_nights_yoy" }[key];
    return withChanges(m, rows.map((r) => ({ year: r.year, value: r[key], ytd: false, ...(chg ? { change: r[chg] } : {}) })));
  }
  if (st.level === "airport") {
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
  const locs = R.ctx.meta.weather_locations.filter((l) => (R.st.level === "region" ? l.nuts2_code === e.code : l.country_code === e.code)).map((l) => l.location_code);
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
const latestIn = (R, s) => inWindow(R, s).at(-1);
const yLabel = (r) => (r.ytd ? `${r.year} YTD` : String(r.year));
const ytdText = (r) => (r.ytd && r.months ? `${r.year} to ${monthName(r.months)}` : String(r.year));

// ------------------------------------------------------------------ commentary
function metricCommentary(R, key, opts = {}) {
  if (!R.an.has("commentary")) return [];
  const m = M[key];
  const lines = [];
  const data = R.ents.map((e) => ({ e, s: inWindow(R, series(R, key, e)) })).filter((d) => d.s.length);
  if (!data.length) return [];
  const lower = m.label.charAt(0).toLowerCase() + m.label.slice(1);
  if (!R.cmp) {
    const { e, s } = data[0];
    const last = s.at(-1);
    const prevTxt = last.ytd ? `the same months of ${last.year - 1}` : String(last.year - 1);
    let t = m.kind === "sum"
      ? `${e.name} recorded ${fmtVal(m, last.value)} ${lower.replace(/ \(.*\)$/, "")} in ${ytdText(last)}`
      : `${m.label.replace(/ \(.*\)$/, "")} was ${fmtVal(m, last.value)} in ${ytdText(last)}`;
    if (R.an.has("yoy") && isNum(last.change)) t += `, ${fmtChg(m, last.change)} on ${prevTxt}`;
    lines.push(`${t}.`);
    const g = R.an.has("cagr") ? cagr(m, s) : null;
    if (g) lines.push(g.total ? `Between ${g.from} and ${g.to} it moved ${fmtChg(m, g.v)}.`
      : `Between ${g.from} and ${g.to} it grew at a compound ${fmtChange(g.v)} a year.`);
    const lastFull = s.filter((r) => !r.ytd).at(-1);
    const vb = R.an.has("base") && lastFull ? vsBase(R, m, series(R, key, e), lastFull.year) : null;
    if (isNum(vb)) lines.push(`${lastFull.year} was ${fmtChg(m, vb)} against ${R.base}.`);
    const full = s.filter((r) => !r.ytd);
    if (full.length >= 4 && !opts.noExtremes) {
      const hi = full.reduce((a, r) => (r.value > a.value ? r : a)), lo = full.reduce((a, r) => (r.value < a.value ? r : a));
      lines.push(`Highest in the period: ${hi.year} (${fmtVal(m, hi.value)}); lowest: ${lo.year} (${fmtVal(m, lo.value)}).`);
    }
    return lines;
  }
  // Comparison: rank on the latest common year, then on growth.
  const common = [...new Set(data.flatMap((d) => d.s.map((r) => r.year)))].sort((a, b) => b - a)
    .find((y) => data.every((d) => at(d.s, y))) ?? null;
  if (common != null) {
    const ranked = data.map((d) => ({ ...d, r: at(d.s, common) })).sort((a, b) => b.r.value - a.r.value);
    const ytd = ranked.some((d) => d.r.ytd);
    let t = `${m.label.replace(/ \(.*\)$/, "")} in ${common}${ytd ? " to date" : ""}: ${ranked.map((d) => `${d.e.name} ${fmtVal(m, d.r.value)}`).join(", ")}.`;
    if (m.kind === "sum" && ranked.length >= 2 && ranked[1].r.value > 0) t += ` ${ranked[0].e.name} is ${(ranked[0].r.value / ranked[1].r.value).toFixed(2)} times ${ranked[1].e.name}.`;
    lines.push(t);
    if (R.an.has("yoy")) {
      const ch = ranked.filter((d) => isNum(d.r.change)).sort((a, b) => b.r.change - a.r.change);
      if (ch.length >= 2) lines.push(`Change on ${ytd ? "the same months a year earlier" : common - 1}: ${ch.map((d) => `${d.e.name} ${fmtChg(m, d.r.change)}`).join(", ")}.`);
    }
  }
  if (R.an.has("cagr")) {
    const gs = data.map((d) => ({ ...d, g: cagr(m, d.s) })).filter((d) => d.g).sort((a, b) => b.g.v - a.g.v);
    if (gs.length >= 2) {
      const from = Math.max(...gs.map((d) => d.g.from)), to = Math.min(...gs.map((d) => d.g.to));
      lines.push(gs[0].g.total
        ? `Change over the period: ${gs.map((d) => `${d.e.name} ${fmtChg(m, d.g.v)} (${d.g.from}-${d.g.to})`).join(", ")}.`
        : `Compound annual growth${from === to ? "" : ` (${gs[0].g.from}-${gs[0].g.to})`}: ${gs.map((d) => `${d.e.name} ${fmtChange(d.g.v)}`).join(", ")}; ${gs[0].e.name} grew ${gs.length === 2 ? "faster" : "fastest"}.`);
    }
  }
  if (R.an.has("base")) {
    const vb = data.map((d) => { const lf = d.s.filter((r) => !r.ytd).at(-1); return { ...d, lf, v: lf ? vsBase(R, m, series(R, key, d.e), lf.year) : null }; }).filter((d) => isNum(d.v));
    if (vb.length >= 2) lines.push(`Against ${R.base}: ${vb.map((d) => `${d.e.name} ${fmtChg(m, d.v)} (${d.lf.year})`).join(", ")}.`);
  }
  return lines;
}

// ------------------------------------------------------------------ figures and tables
// A figure is {title, note, half, legend, draw(el)}; a table is {title, columns, rows, numFmts, total}.
const yearCats = (R) => R.years.map(String);

function metricBlock(R, key, { chartTitle, primary = false } = {}) {
  const m = M[key];
  const data = R.ents.map((e) => ({ e, s: inWindow(R, series(R, key, e)) }));
  if (!data.some((d) => d.s.length)) return { figs: [], tables: [], xl: [], lines: [], empty: true };
  const p = palette();
  const figs = [];
  const title = chartTitle || m.label;
  const ytdNote = (() => { const y = data.flatMap((d) => d.s).find((r) => r.ytd); return y ? `${y.year} is year to date${y.months ? ` (${y.months} months)` : ""}.` : ""; })();
  if (!R.cmp) {
    const { s } = data[0];
    figs.push({ title, note: ytdNote, half: true, draw: (el) => columnChart(el, {
      items: s.map((r) => ({ label: yLabel(r), value: r.value, change: r.change, muted: r.ytd, year: r.year })), noCap: true,
      format: fmtAxis(m), hoverFormat: (v) => fmtVal(m, v), changeFormat: (c) => fmtChg(m, c), colorFn: (d, pal) => pal.series[0] }) });
    if (R.an.has("yoy") && s.some((r) => isNum(r.change))) {
      figs.push({ title: `${title}: change on the previous year`, note: ytdNote ? `${ytdNote.replace(".", "")}, against the same months a year earlier.` : "", half: true,
        draw: (el) => columnChart(el, { items: s.filter((r) => isNum(r.change)).map((r) => ({ label: yLabel(r), value: isRatio(m) ? r.change : m.kind === "rate01" ? r.change * 100 : r.change, muted: r.ytd })),
          format: (v) => (isRatio(m) ? fmtChange(v, { digits: 0 }) : `${signed(v, 1)}${m.kind === "level" ? "" : " pts"}`), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) }) });
    }
    if (R.an.has("index") && isRatio(m) && primary) {
      figs.push(indexFig(R, m, data, title));
    }
  } else {
    const legend = data.map((d) => ({ label: d.e.name, color: p.series[d.e.i] }));
    const dropYtd = m.kind === "sum";
    figs.push({ title, legend, half: true, note: dropYtd && ytdNote ? `${ytdNote.replace(".", "")} and left out of the chart; see the table.` : ytdNote,
      draw: (el) => timeChart(el, { categories: yearCats(R), yFormat: fmtAxis(m),
        series: data.map((d) => ({ name: d.e.name, color: p.series[d.e.i], data: d.s.filter((r) => !(dropYtd && r.ytd)).map((r) => [String(r.year), r.value]) })) }) });
    if (R.an.has("index") && isRatio(m)) figs.push(indexFig(R, m, data, title));
    if (R.an.has("yoy")) {
      figs.push({ title: `${title}: change on the previous year`, legend, half: true, note: ytdNote ? "The latest year compares the same months a year earlier." : "",
        draw: (el) => timeChart(el, { categories: yearCats(R), markZero: true, capOutliers: true,
          yFormat: (v) => (isRatio(m) ? fmtChange(v, { digits: 0 }) : m.kind === "rate01" ? `${signed(v * 100, 1)}` : signed(v, 1)),
          series: data.map((d) => ({ name: d.e.name, type: "bar", color: p.series[d.e.i], data: d.s.filter((r) => isNum(r.change)).map((r) => [String(r.year), r.change]) })) }) });
    }
  }
  const tables = [];
  const xl = [];
  // PDF table: values (and change) by year. Excel adds index and change vs the baseline.
  const yrs = [...new Set(data.flatMap((d) => d.s.map((r) => r.year)))].sort((a, b) => a - b);
  const withYoy = R.an.has("yoy");
  const pdfCols = ["Year", ...data.flatMap((d) => (withYoy ? [R.cmp ? d.e.name : "Value", R.cmp ? `${d.e.name} chg` : "Change"] : [R.cmp ? d.e.name : "Value"]))];
  const pdfRows = yrs.map((y) => [at(data[0].s, y)?.ytd ? `${y} YTD` : String(y), ...data.flatMap((d) => {
    const r = at(d.s, y); return withYoy ? [fmtVal(m, r?.value), r ? fmtChg(m, r.change) : "n/a"] : [fmtVal(m, r?.value)];
  })]);
  if (R.an.has("tables")) tables.push({ title, columns: pdfCols, rows: pdfRows });
  const xlCols = [{ label: "Year", fmt: "text" }];
  const idxBase = (d) => d.s.find((r) => !r.ytd);
  for (const d of data) {
    const pre = R.cmp ? `${d.e.name}: ` : "";
    xlCols.push({ label: `${pre}${valueHead(m)}`, fmt: xlFmt(m) });
    if (withYoy) xlCols.push({ label: `${pre}change on previous year`, fmt: xlChgFmt(m) });
    if (R.an.has("index") && isRatio(m)) xlCols.push({ label: `${pre}index (${idxBase(d)?.year ?? "first year"} = 100)`, fmt: "0.0" });
    if (R.an.has("base")) xlCols.push({ label: `${pre}change vs ${R.base}`, fmt: xlChgFmt(m) });
  }
  const xlRows = yrs.map((y) => [at(data[0].s, y)?.ytd ? `${y} YTD` : String(y), ...data.flatMap((d) => {
    const r = at(d.s, y); const b = idxBase(d);
    const out = [r?.value ?? null];
    if (withYoy) out.push(xlChg(m, r?.change));
    if (R.an.has("index") && isRatio(m)) out.push(r && b && !r.ytd && b.value ? (r.value / b.value) * 100 : null);
    if (R.an.has("base")) out.push(xlChg(m, r ? vsBase(R, m, series(R, key, d.e), y) : null));
    return out;
  })]);
  xl.push({ title: m.label, columns: xlCols, rows: xlRows });
  if (R.an.has("cagr")) {
    const gRows = data.map((d) => { const g = cagr(m, d.s); return [d.e.name, g ? String(g.from) : null, g ? String(g.to) : null, g ? xlChg(m, g.v) : null]; });
    xl.push({ title: `${m.label}: growth over the period`, columns: [{ label: R.cmp ? "Place" : "Series", fmt: "text" }, { label: "From", fmt: "text" }, { label: "To", fmt: "text" },
      { label: isRatio(m) ? "Compound annual growth" : "Change over the period", fmt: isRatio(m) ? "0.0%" : xlChgFmt(m) }], rows: gRows });
  }
  return { title: m.label, figs, tables, xl, lines: metricCommentary(R, key) };
}

function indexFig(R, m, data, title) {
  const p = palette();
  return { title: `${title}: indexed, first full year = 100`, legend: R.cmp ? data.map((d) => ({ label: d.e.name, color: p.series[d.e.i] })) : null, half: true,
    draw: (el) => timeChart(el, { categories: yearCats(R), yFormat: (v) => fmtDec(v, 0),
      series: data.map((d) => { const b = d.s.find((r) => !r.ytd); return { name: d.e.name, color: p.series[d.e.i], data: b ? d.s.filter((r) => !r.ytd).map((r) => [String(r.year), (r.value / b.value) * 100]) : [] }; }) }) };
}

const valueHead = (m) => m.label;
function xlFmt(m) {
  return { sum: "#,##0", rate01: "0.0%", pct: '0.0"%"', index: "0.0", eur: "€#,##0.0", level: m.digits === 0 ? "#,##0" : m.digits === 3 ? "0.000" : m.digits === 2 ? "0.00" : "0.0" }[m.kind];
}
const xlChgFmt = (m) => (isRatio(m) ? "0.0%" : '+0.0" pts";-0.0" pts";0.0" pts"');
const xlChg = (m, c) => (!isNum(c) ? null : m.kind === "rate01" ? c * 100 : c);

// Monthly detail for the final year: pace (standalone) or monthly change (comparison).
function monthlyRows(R, e) {
  const { D, st } = R;
  if (st.level === "country") return (D.country_monthly || []).filter((r) => r.geo_code === e.code && isNum(r.nights)).map((r) => ({ month: r.month, v: r.nights }));
  if (st.level === "region") return (D.region_monthly || []).filter((r) => r.geo_code === e.code && isNum(r.nights)).map((r) => ({ month: r.month, v: r.nights }));
  return (D.airports_monthly || []).filter((r) => r.airport_code === e.code && isNum(r.passengers)).map((r) => ({ month: r.month, v: r.passengers }));
}
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

function monthlyBlock(R, label) {
  const p = palette();
  const y = R.years.at(-1);
  const data = R.ents.map((e) => ({ e, idx: new Map(monthlyRows(R, e).map((r) => [r.month, r.v])) })).filter((d) => [...d.idx.keys()].some((k) => k.startsWith(String(y))));
  if (!data.length) return null;
  const val = (d, yy, mm) => d.idx.get(`${yy}-${mm}`);
  const lines = [];
  const xlRows = MONTHS.map((mm) => [monthName(+mm), ...data.flatMap((d) => [val(d, y, mm) ?? null, val(d, y - 1, mm) ?? null, ratio(val(d, y, mm), val(d, y - 1, mm))])]);
  const xl = { title: `${label} by month, ${y}`, columns: [{ label: "Month", fmt: "text" }, ...data.flatMap((d) => {
    const pre = R.cmp ? `${d.e.name}: ` : ""; return [{ label: `${pre}${y}`, fmt: "#,##0" }, { label: `${pre}${y - 1}`, fmt: "#,##0" }, { label: `${pre}change`, fmt: "0.0%" }];
  })], rows: xlRows };
  if (R.an.has("commentary")) {
    for (const d of data) {
      const ch = MONTHS.map((mm) => ({ mm, c: ratio(val(d, y, mm), val(d, y - 1, mm)) })).filter((x) => isNum(x.c));
      if (!ch.length) continue;
      const best = ch.reduce((a, x) => (x.c > a.c ? x : a)), worst = ch.reduce((a, x) => (x.c < a.c ? x : a));
      lines.push(`${R.cmp ? `${d.e.name}: ` : ""}${ch.length} months reported for ${y}; strongest month on a year earlier ${monthName(+best.mm)} (${fmtChange(best.c)}), weakest ${monthName(+worst.mm)} (${fmtChange(worst.c)}).`);
    }
  }
  const fig = !R.cmp
    ? { title: `${label} by month: ${y} vs ${y - 1} and ${R.base}`, half: false, legend: [{ label: String(y), color: p.series[0] }, { label: String(y - 1), color: p.series[1] }, { label: String(R.base), color: p.context }],
      draw: (el) => timeChart(el, { categories: MONTHS, xFormat: (v) => monthName(+v), yFormat: (v) => fmtNum(v, 1),
        series: [[y, p.series[0], 2.5], [y - 1, p.series[1], 2], [R.base, p.context, 2]].map(([yy, color, width]) => ({ name: String(yy), color, width, data: MONTHS.map((mm) => [mm, val(data[0], yy, mm) ?? null]) })) }) }
    : { title: `${label}: change on a year earlier by month, ${y}`, half: false, legend: data.map((d) => ({ label: d.e.name, color: p.series[d.e.i] })),
      draw: (el) => timeChart(el, { categories: MONTHS, xFormat: (v) => monthName(+v), markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }),
        series: data.map((d) => ({ name: d.e.name, color: p.series[d.e.i], data: MONTHS.map((mm) => [mm, ratio(val(d, y, mm), val(d, y - 1, mm))]) })) }) };
  return { title: `Monthly detail, ${y}`, figs: [fig], xl: [xl], lines };
}
const ratio = (a, b) => (isNum(a) && isNum(b) && b ? a / b - 1 : null);

function seasonalityBlock(R, label) {
  const p = palette();
  const data = R.ents.map((e) => {
    const idx = new Map(monthlyRows(R, e).map((r) => [r.month, r.v]));
    const full = R.years.slice().reverse().find((y) => MONTHS.every((mm) => isNum(idx.get(`${y}-${mm}`))));
    const prof = (y) => { if (!MONTHS.every((mm) => isNum(idx.get(`${y}-${mm}`)))) return null; const t = MONTHS.reduce((a, mm) => a + idx.get(`${y}-${mm}`), 0); return MONTHS.map((mm) => idx.get(`${y}-${mm}`) / t); };
    const first = R.years.find((y) => prof(y));
    return { e, full, prof: full ? prof(full) : null, firstYear: first !== full ? first : null, firstProf: first !== full && first ? prof(first) : null };
  }).filter((d) => d.prof);
  if (!data.length) return null;
  const lines = [];
  if (R.an.has("commentary")) {
    for (const d of data) {
      const ord = d.prof.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
      const two = ord[0].v + ord[1].v;
      let t = `${R.cmp ? `${d.e.name}: ` : ""}in ${d.full} the busiest month was ${monthName(ord[0].i + 1)} with ${fmtPct(ord[0].v, 1)} of the year's ${label.toLowerCase()}; ${monthName(ord[0].i + 1)} and ${monthName(ord[1].i + 1)} together took ${fmtPct(two, 1)}.`;
      if (d.firstProf) { const o2 = [...d.firstProf].sort((a, b) => b - a); t += ` In ${d.firstYear} the two busiest months took ${fmtPct(o2[0] + o2[1], 1)}.`; }
      lines.push(t);
    }
  }
  const fig = !R.cmp
    ? { title: `Share of annual ${label.toLowerCase()} by month`, half: false,
      legend: [{ label: String(data[0].full), color: p.series[0] }, ...(data[0].firstProf ? [{ label: String(data[0].firstYear), color: p.context }] : [])],
      draw: (el) => timeChart(el, { categories: MONTHS, xFormat: (v) => monthName(+v), yFormat: (v) => fmtPct(v, 0),
        series: [{ name: String(data[0].full), color: p.series[0], width: 2.5, data: MONTHS.map((mm, i) => [mm, data[0].prof[i]]) },
          ...(data[0].firstProf ? [{ name: String(data[0].firstYear), color: p.context, data: MONTHS.map((mm, i) => [mm, data[0].firstProf[i]]) }] : [])] }) }
    : { title: `Share of annual ${label.toLowerCase()} by month (latest full year)`, half: false, legend: data.map((d) => ({ label: `${d.e.name} (${d.full})`, color: p.series[d.e.i] })),
      draw: (el) => timeChart(el, { categories: MONTHS, xFormat: (v) => monthName(+v), yFormat: (v) => fmtPct(v, 0),
        series: data.map((d) => ({ name: d.e.name, color: p.series[d.e.i], data: MONTHS.map((mm, i) => [mm, d.prof[i]]) })) }) };
  const xl = { title: `Share of annual ${label.toLowerCase()} by month`, columns: [{ label: "Month", fmt: "text" },
    ...data.flatMap((d) => [{ label: `${R.cmp ? `${d.e.name}: ` : ""}${d.full}`, fmt: "0.0%" }, ...(d.firstProf ? [{ label: `${R.cmp ? `${d.e.name}: ` : ""}${d.firstYear}`, fmt: "0.0%" }] : [])])],
  rows: MONTHS.map((mm, i) => [monthName(+mm), ...data.flatMap((d) => [d.prof[i], ...(d.firstProf ? [d.firstProf[i]] : [])])]), total: ["Total", ...data.flatMap((d) => [1, ...(d.firstProf ? [1] : [])])] };
  return { title: "Monthly profile", figs: [fig], xl: [xl], lines };
}

// Merge blocks into one section; each block keeps its own heading, commentary, charts and tables.
function combine(...blocks) {
  const bs = blocks.filter((b) => b && !b.empty && ((b.lines?.length) || (b.figs?.length) || (b.tables?.length) || (b.xl?.length)));
  if (!bs.length) return null;
  return { blocks: bs.map((b) => ({ title: b.title, lines: b.lines || [], figs: b.figs || [], tables: b.tables || [] })), xl: bs.flatMap((b) => b.xl || []) };
}
const metrics = (R, keys, opts) => keys.map((k, i) => metricBlock(R, k, { primary: i === 0, ...opts }));

// Ranked list table for one entity (regions, sources, airports, origins, routes).
function rankedBlock(R, { title, nameLabel, items, valueLabel, valueFmt = "#,##0", shareLabel = "Share", extra = [], total, chart = true, chartValue = "share" }) {
  // items: [{name, value, share, ...extra}]
  const p = palette();
  const cols = [{ label: nameLabel, fmt: "text" }, { label: valueLabel, fmt: valueFmt },
    { label: shareLabel, fmt: "0.0%" }, ...extra.map((x) => ({ label: x.label, fmt: x.fmt }))];
  const rows = items.map((it) => [it.name, it.value, it.share, ...extra.map((x) => it[x.key] ?? null)]);
  const pdf = { title, columns: cols.map((c) => c.label), rows: items.map((it) => [it.name, fmtPrecise(it.value), fmtPct(it.share, 1), ...extra.map((x) => x.pdf(it[x.key]))]) };
  const fig = chart ? { title, half: true, draw: (el) => rankBars(el, { items: items.slice(0, 10).map((it) => ({ label: it.name, value: chartValue === "share" ? it.share : it.value })),
    format: chartValue === "share" ? (v) => fmtPct(v, 1) : (v) => fmtNum(v), colorFn: () => p.series[0] }) } : null;
  return { fig, pdf, xl: { title, columns: cols, rows, total: total ? [total.name, total.value, total.share ?? 1, ...extra.map(() => null)] : null } };
}

// ------------------------------------------------------------------ sections
const KPI_KEYS = {
  country: ["nights", "nights_foreign", "arrivals", "bed_place_occupancy_rate", "avg_length_of_stay", "foreign_share", "air_passengers", "platform_nights", "hicp_accommodation_pct", "unemployment_rate_pct"],
  region: ["nights", "nights_foreign", "foreign_share", "share_of_country_nights", "platform_nights", "peak_two_month_share"],
  airport: ["passengers", "share_country_air"],
};

function summarySection(R) {
  const keys = KPI_KEYS[R.st.level].filter((k) => R.ents.some((e) => inWindow(R, series(R, k, e)).length));
  const lines = [];
  const xlCols = [{ label: "Metric", fmt: "text" }];
  const pdfCols = ["Metric"];
  for (const e of R.ents) {
    const pre = R.cmp ? `${e.name}: ` : "";
    pdfCols.push(R.cmp ? e.name : "Latest", ...(R.an.has("yoy") ? [R.cmp ? "chg" : "Change"] : []), ...(!R.cmp && R.an.has("cagr") ? ["Growth a year"] : []), ...(!R.cmp && R.an.has("base") ? [`vs ${R.base}`] : []));
    xlCols.push({ label: `${pre}year`, fmt: "text" }, { label: `${pre}value`, fmt: "General" }, ...(R.an.has("yoy") ? [{ label: `${pre}change`, fmt: "General" }] : []),
      ...(R.an.has("cagr") ? [{ label: `${pre}compound growth`, fmt: "0.0%" }] : []), ...(R.an.has("base") ? [{ label: `${pre}vs ${R.base}`, fmt: "General" }] : []));
  }
  const pdfRows = [], xlRows = [], rowFmts = [];
  for (const k of keys) {
    const m = M[k];
    const pdf = [m.label], xr = [m.label];
    for (const e of R.ents) {
      const s = inWindow(R, series(R, k, e));
      const last = s.at(-1);
      const g = cagr(m, s);
      const lf = s.filter((r) => !r.ytd).at(-1);
      const vb = lf ? vsBase(R, m, series(R, k, e), lf.year) : null;
      pdf.push(last ? `${fmtVal(m, last.value)}${last.year !== R.years.at(-1) || last.ytd ? ` (${yLabel(last)})` : ""}` : "n/a",
        ...(R.an.has("yoy") ? [last ? fmtChg(m, last.change) : "n/a"] : []),
        ...(!R.cmp && R.an.has("cagr") ? [g && !g.total ? fmtChange(g.v) : g ? fmtChg(m, g.v) : "n/a"] : []),
        ...(!R.cmp && R.an.has("base") ? [isNum(vb) ? fmtChg(m, vb) : "n/a"] : []));
      xr.push(last ? yLabel(last) : null, last?.value ?? null, ...(R.an.has("yoy") ? [xlChg(m, last?.change)] : []),
        ...(R.an.has("cagr") ? [g && !g.total ? g.v : null] : []), ...(R.an.has("base") ? [xlChg(m, vb)] : []));
    }
    pdfRows.push(pdf); xlRows.push(xr); rowFmts.push({ value: xlFmt(m), change: xlChgFmt(m) });
  }
  // Headline commentary from the lead metrics.
  const leads = { country: ["nights", "bed_place_occupancy_rate", "foreign_share"], region: ["nights", "share_of_country_nights", "foreign_share"], airport: ["passengers", "share_country_air"] }[R.st.level];
  for (const k of leads) lines.push(...metricCommentary(R, k, { noExtremes: true }).slice(0, 2));
  if (R.an.has("intensity") && R.st.level === "country") {
    const ints = R.ents.map((e) => ({ e, r: inWindow(R, series(R, "nights_per_resident", e)).filter((x) => !x.ytd).at(-1) })).filter((d) => d.r);
    if (ints.length && R.an.has("commentary")) lines.push(`Nights per resident: ${ints.map((d) => `${d.e.name} ${fmtDec(d.r.value, 1)} (${d.r.year})`).join(", ")}.`);
  }
  // Per-cell number formats for the summary table (rows mix metrics).
  const cellFmts = xlRows.map((_, ri) => xlCols.map((c) => (c.label.endsWith("value") ? rowFmts[ri].value : /change$|vs \d{4}$/.test(c.label) ? rowFmts[ri].change : c.fmt)));
  return {
    blocks: [{ title: null, lines, figs: [], tables: [] }], kpi: { columns: pdfCols, rows: pdfRows },
    xl: [{ title: `Key figures, ${R.years.at(-1)}`, columns: xlCols, rows: xlRows, cellFmts }],
  };
}

function regionsSection(R) {
  const { D, ctx } = R;
  const out = { lines: [], figs: [], tables: [], xl: [] };
  for (const e of R.ents) {
    const regs = D.region_annual.filter((r) => ctx.geoMeta(r.geo_code)?.country_code === e.code && ctx.geoMeta(r.geo_code)?.geo_level === "nuts2" && isNum(r.nights));
    const y = Math.min(R.years.at(-1), Math.max(...regs.map((r) => r.year)));
    const cur = regs.filter((r) => r.year === y).sort((a, b) => b.nights - a.nights);
    if (cur.length < 2) continue;
    const first = new Map(regs.filter((r) => r.year === R.years[0]).map((r) => [r.geo_code, r.nights]));
    const tot = cur.reduce((a, r) => a + r.nights, 0);
    const items = cur.slice(0, 10).map((r) => ({ name: ctx.geoName(r.geo_code), value: r.nights, share: r.share_of_country_nights ?? r.nights / tot,
      yoy: r.nights_yoy, growth: first.get(r.geo_code) ? (r.nights / first.get(r.geo_code)) ** (1 / (y - R.years[0])) - 1 : null, foreign: r.foreign_share }));
    const b = rankedBlock(R, { nameLabel: "Region", title: `Top regions by nights, ${R.cmp ? `${e.name}, ` : ""}${y}`, items, valueLabel: "Nights", shareLabel: "Share of national nights", chartValue: "value",
      extra: [{ key: "yoy", label: "Change on previous year", fmt: "0.0%", pdf: (v) => fmtChange(v) },
        ...(R.an.has("cagr") ? [{ key: "growth", label: `Compound growth since ${R.years[0]}`, fmt: "0.0%", pdf: (v) => fmtChange(v) }] : []),
        { key: "foreign", label: "Foreign share", fmt: "0.0%", pdf: (v) => fmtPct(v, 1) }],
      total: { name: "All regions", value: tot, share: 1 }, chart: !R.cmp });
    if (b.fig) out.figs.push({ ...b.fig, half: false });
    out.tables.push(b.pdf); out.xl.push(b.xl);
    if (R.an.has("commentary")) {
      const top3 = items.slice(0, 3).reduce((a, r) => a + r.share, 0);
      const fast = items.filter((r) => isNum(r.growth)).sort((a, b2) => b2.growth - a.growth)[0];
      out.lines.push(`${e.name}: ${items[0].name} is the largest region with ${fmtPct(items[0].share, 1)} of national nights in ${y}; the top three hold ${fmtPct(top3, 1)}.${fast && R.an.has("cagr") ? ` Fastest growing of the top ten since ${R.years[0]}: ${fast.name} (${fmtChange(fast.growth)} a year).` : ""}`);
    }
  }
  return out.xl.length ? combine({ title: "Largest regions", ...out }) : null;
}

function sourcesSection(R) {
  const { D, ctx } = R;
  const isCountry = new Set(ctx.meta.partners.filter((p) => p.is_country).map((p) => p.partner_code));
  const pname = (c) => ctx.meta.partners.find((p) => p.partner_code === c)?.partner_name?.replace(/ \(.*\)$/, "") || c;
  const out = { lines: [], figs: [], tables: [], xl: [] };
  const per = R.ents.map((e) => {
    const rows = D.source_markets.filter((r) => r.geo_code === e.code && isCountry.has(r.partner_code) && isNum(r.nights));
    const y = Math.min(R.years.at(-1), Math.max(...rows.map((r) => r.year)));
    const cur = rows.filter((r) => r.year === y).sort((a, b) => b.nights - a.nights);
    const firstY = R.years.find((yy) => rows.some((r) => r.year === yy));
    const first = new Map(rows.filter((r) => r.year === firstY).map((r) => [r.partner_code, r.nights]));
    return { e, y, cur, firstY, first, rows };
  }).filter((d) => d.cur.length);
  if (!per.length) return null;
  for (const d of per) {
    const items = d.cur.slice(0, 10).map((r) => ({ name: pname(r.partner_code), code: r.partner_code, value: r.nights, share: r.share_of_foreign_nights, yoy: r.nights_yoy,
      growth: d.first.get(r.partner_code) && d.y > d.firstY ? (r.nights / d.first.get(r.partner_code)) ** (1 / (d.y - d.firstY)) - 1 : null, base: r.nights_vs_baseline }));
    const totForeign = d.cur.reduce((a, r) => a + r.nights, 0);
    const b = rankedBlock(R, { nameLabel: "Market", title: `Top source markets, ${R.cmp ? `${d.e.name}, ` : ""}${d.y}`, items, valueLabel: "Nights", shareLabel: "Share of foreign nights",
      extra: [{ key: "yoy", label: "Change on previous year", fmt: "0.0%", pdf: (v) => fmtChange(v) },
        ...(R.an.has("cagr") ? [{ key: "growth", label: `Compound growth since ${d.firstY}`, fmt: "0.0%", pdf: (v) => fmtChange(v) }] : []),
        ...(R.an.has("base") ? [{ key: "base", label: `Change vs ${R.base}`, fmt: "0.0%", pdf: (v) => fmtChange(v) }] : [])],
      total: { name: "All foreign country markets", value: totForeign, share: 1 }, chart: !R.cmp });
    if (b.fig) out.figs.push(b.fig);
    out.tables.push(b.pdf); out.xl.push(b.xl);
    if (R.an.has("commentary")) {
      const top = items[0];
      const fast = items.filter((r) => isNum(r.growth)).sort((a, b2) => b2.growth - a.growth)[0];
      out.lines.push(`${d.e.name}: ${top.name} is the largest foreign market with ${fmtPct(top.share, 1)} of foreign nights in ${d.y}; the top three account for ${fmtPct(items.slice(0, 3).reduce((a, r) => a + (r.share || 0), 0), 1)}.${fast && R.an.has("cagr") ? ` Fastest growing top-ten market since ${d.firstY}: ${fast.name} (${fmtChange(fast.growth)} a year).` : ""}`);
    }
  }
  if (!R.cmp) {
    // Trend of the top five markets over the window.
    const d = per[0]; const p = palette();
    const five = d.cur.slice(0, 5).map((r) => r.partner_code);
    out.figs.push({ title: "Nights by the top five source markets", half: true, legend: five.map((c, i) => ({ label: pname(c), color: p.series[i] })),
      draw: (el) => timeChart(el, { categories: yearCats(R), yFormat: (v) => fmtNum(v, 1),
        series: five.map((c, i) => ({ name: pname(c), color: p.series[i], data: R.years.map((y) => [String(y), d.rows.find((r) => r.year === y && r.partner_code === c)?.nights ?? null]) })) }) });
  } else {
    // Market mix side by side: union of each place's top markets.
    const p = palette();
    const union = [...new Set(per.flatMap((d) => d.cur.slice(0, 6).map((r) => r.partner_code)))].slice(0, 10);
    const share = (d, c) => d.cur.find((r) => r.partner_code === c)?.share_of_foreign_nights ?? null;
    out.figs.unshift({ title: "Share of foreign nights by source market", half: false, legend: per.map((d) => ({ label: `${d.e.name} (${d.y})`, color: p.series[d.e.i] })),
      draw: (el) => timeChart(el, { categories: union.map(pname), yFormat: (v) => fmtPct(v, 0),
        series: per.map((d) => ({ name: d.e.name, type: "bar", color: p.series[d.e.i], data: union.map((c) => [pname(c), share(d, c)]) })) }) });
    out.xl.unshift({ title: "Share of foreign nights by source market", columns: [{ label: "Market", fmt: "text" }, ...per.map((d) => ({ label: `${d.e.name} (${d.y})`, fmt: "0.0%" }))],
      rows: union.map((c) => [pname(c), ...per.map((d) => share(d, c))]) });
    if (R.an.has("commentary")) {
      const shared = union.filter((c) => per.every((d) => share(d, c) > 0.05));
      if (shared.length) out.lines.push(`Markets with over 5% of foreign nights in every place: ${shared.map(pname).join(", ")}.`);
    }
  }
  return combine({ title: "Foreign guests by country of residence", ...out });
}

function airportsInCountry(R) {
  const { D } = R;
  const out = { lines: [], figs: [], tables: [], xl: [] };
  for (const e of R.ents) {
    const aps = D.airport_summary.filter((a) => a.country_code === e.code);
    if (!aps.length) continue;
    const codes = new Set(aps.map((a) => a.airport_code));
    const rows = D.airport_annual.filter((r) => codes.has(r.airport_code) && !r.is_ytd && r.year <= R.years.at(-1));
    if (!rows.length) continue;
    const y = Math.max(...rows.map((r) => r.year));
    const cur = rows.filter((r) => r.year === y).sort((a, b) => b.passengers - a.passengers);
    const nat = series(R, "air_passengers", e).find((r) => r.year === y && !r.ytd)?.value;
    const tot = nat || cur.reduce((a, r) => a + r.passengers, 0);
    const first = new Map(rows.filter((r) => r.year === R.years[0]).map((r) => [r.airport_code, r.passengers]));
    const items = cur.slice(0, 10).map((r) => ({ name: airportLabel(aps.find((a) => a.airport_code === r.airport_code)), value: r.passengers, share: r.passengers / tot, yoy: r.passengers_yoy,
      growth: first.get(r.airport_code) ? (r.passengers / first.get(r.airport_code)) ** (1 / (y - R.years[0])) - 1 : null }));
    const b = rankedBlock(R, { nameLabel: "Airport", title: `Top airports by passengers, ${R.cmp ? `${e.name}, ` : ""}${y}`, items, valueLabel: "Passengers", shareLabel: "Share of national passengers", chartValue: "value",
      extra: [{ key: "yoy", label: "Change on previous year", fmt: "0.0%", pdf: (v) => fmtChange(v) },
        ...(R.an.has("cagr") ? [{ key: "growth", label: `Compound growth since ${R.years[0]}`, fmt: "0.0%", pdf: (v) => fmtChange(v) }] : [])],
      total: { name: "National total", value: tot, share: 1 }, chart: !R.cmp });
    if (b.fig) out.figs.push(b.fig);
    out.tables.push(b.pdf); out.xl.push(b.xl);
    if (R.an.has("commentary")) out.lines.push(`${e.name}: ${items[0].name} handled ${fmtPrecise(items[0].value)} passengers in ${y}, ${fmtPct(items[0].share, 1)} of the national total.`);
  }
  return out.xl.length ? { title: "Airports", ...out } : null;
}

function originsSection(R) {
  const { D } = R;
  const out = { lines: [], figs: [], tables: [], xl: [] };
  for (const e of R.ents) {
    const rows = D.airport_origins.filter((r) => r.airport_code === e.code && r.year <= R.years.at(-1));
    if (!rows.length) continue;
    const y = Math.max(...rows.map((r) => r.year));
    const cur = rows.filter((r) => r.year === y).sort((a, b) => b.passengers - a.passengers);
    const items = cur.slice(0, 12).map((r) => ({ name: r.partner_country_name, value: r.passengers, share: r.share_of_airport, yoy: r.passengers_yoy }));
    const b = rankedBlock(R, { nameLabel: "Country", title: `Origin countries, ${R.cmp ? `${e.name}, ` : ""}${y}`, items, valueLabel: "Passengers", shareLabel: "Share of route passengers",
      extra: [{ key: "yoy", label: "Change on previous year", fmt: "0.0%", pdf: (v) => fmtChange(v) }],
      total: { name: "All origin countries", value: cur.reduce((a, r) => a + r.passengers, 0), share: 1 } });
    if (b.fig) out.figs.push(b.fig);
    out.tables.push(b.pdf); out.xl.push(b.xl);
    if (R.an.has("commentary")) out.lines.push(`${e.name}: ${items[0].name} is the largest origin with ${fmtPct(items[0].share, 1)} of route passengers in ${y}${items[1] ? `, then ${items[1].name} (${fmtPct(items[1].share, 1)})` : ""}. Eurostat publishes route data with a lag, so ${y} is the latest year available.`);
  }
  return out.xl.length ? combine({ title: "Origin countries", ...out }) : null;
}

function routesSection(R) {
  const { D } = R;
  const out = { lines: [], figs: [], tables: [], xl: [] };
  for (const e of R.ents) {
    const rows = D.airport_routes.filter((r) => r.airport_code === e.code && r.year <= R.years.at(-1));
    if (!rows.length) continue;
    const y = Math.max(...rows.map((r) => r.year));
    const cur = rows.filter((r) => r.year === y).sort((a, b) => b.passengers - a.passengers).slice(0, 15);
    const tot = cur.reduce((a, r) => a + r.passengers, 0);
    const items = cur.map((r) => ({ name: r.partner_airport_name, value: r.passengers, share: r.passengers / tot, country: r.partner_country_name, yoy: r.passengers_yoy }));
    const b = rankedBlock(R, { nameLabel: "Route", title: `Top routes, ${R.cmp ? `${e.name}, ` : ""}${y}`, items, valueLabel: "Passengers", shareLabel: "Share of top 15", chartValue: "value",
      extra: [{ key: "country", label: "Country", fmt: "text", pdf: (v) => v ?? "" }, { key: "yoy", label: "Change on previous year", fmt: "0.0%", pdf: (v) => fmtChange(v) }],
      total: { name: "Top 15 routes", value: tot, share: 1 }, chart: !R.cmp });
    if (b.fig) out.figs.push({ ...b.fig, half: false });
    out.tables.push(b.pdf); out.xl.push(b.xl);
    if (R.an.has("commentary")) out.lines.push(`${e.name}: the busiest route in ${y} was ${items[0].name} (${items[0].country}) with ${fmtPrecise(items[0].value)} passengers.`);
  }
  return out.xl.length ? combine({ title: "Top routes", ...out }) : null;
}

const SECTION_BUILDERS = {
  country: {
    summary: summarySection,
    demand: (R) => combine(...metrics(R, ["nights", "arrivals", "nights_foreign", "nights_domestic"]),
      R.an.has("share") ? metricBlock(R, "share_eu") : null, metricBlock(R, "foreign_share"),
      R.an.has("intensity") ? metricBlock(R, "nights_per_resident") : null, R.an.has("monthly") ? monthlyBlock(R, "Nights") : null),
    occupancy: (R) => combine(...metrics(R, ["bed_place_occupancy_rate", "room_occupancy_rate", "avg_length_of_stay"])),
    seasonality: (R) => combine(seasonalityBlock(R, "Nights"), metricBlock(R, "peak_two_month_share")),
    regions: regionsSection,
    sources: sourcesSection,
    rentals: (R) => combine(...metrics(R, ["platform_nights", "platform_share"])),
    air: (R) => combine(...metrics(R, ["air_passengers", "air_passengers_international"]), airportsInCountry(R)),
    prices: (R) => combine(...metrics(R, ["hicp_accommodation_pct", "hicp_restaurants_pct", "hicp_all_items_pct", "accommodation_turnover_index"])),
    macro: (R) => combine(...metrics(R, ["gdp_growth", "unemployment_rate_pct", "consumer_confidence_balance", "bond_yield_10y_pct"])),
    weather: (R) => combine(...metrics(R, ["w_temp", "w_anom", "w_sun", "w_rain"])),
    hotels: (R) => combine(...metrics(R, ["adr_es", "revpar_es", "rev_night_pt"])),
    fx: (R) => {
      const euro = R.ents.filter((e) => !e.meta?.currency_code || e.meta.currency_code === "EUR");
      const note = euro.length ? { title: null, lines: [`${euro.map((e) => e.name).join(", ")} ${euro.length > 1 ? "use" : "uses"} the euro.`] } : null;
      return combine(note, metricBlock(R, "fx"));
    },
  },
  region: {
    summary: summarySection,
    demand: (R) => combine(...metrics(R, ["nights", "nights_foreign", "foreign_share"]), R.an.has("monthly") ? monthlyBlock(R, "Nights") : null),
    share: (R) => combine(metricBlock(R, "share_of_country_nights")),
    seasonality: (R) => combine(seasonalityBlock(R, "Nights"), metricBlock(R, "peak_two_month_share")),
    rentals: (R) => combine(...metrics(R, ["platform_nights", "platform_share"])),
    weather: (R) => combine(...metrics(R, ["w_temp", "w_anom", "w_sun", "w_rain"])),
  },
  airport: {
    summary: summarySection,
    traffic: (R) => combine(metricBlock(R, "passengers", { primary: true }), R.an.has("share") ? metricBlock(R, "share_country_air") : null,
      R.an.has("monthly") ? monthlyBlock(R, "Passengers") : null),
    seasonality: (R) => combine(seasonalityBlock(R, "Passengers")),
    origins: originsSection,
    routes: routesSection,
  },
};

// ------------------------------------------------------------------ document
function renderDocument(ctx, host, doc, paper, scroll) {
  const { R } = doc;
  const generated = new Date().toISOString().slice(0, 10);
  const draws = [];
  const contents = doc.sections.map((s, i) => h("li", {}, h("span", { class: "rp-num" }, String(i + 1).padStart(2, "0")), s.title));
  paper.append(h("header", { class: "rp-cover" },
    h("div", { class: "rp-kicker" }, "EU Markets · " + doc.subtitle),
    h("h1", {}, doc.title),
    h("p", { class: "rp-period" }, doc.period),
    R.cmp ? h("div", { class: "rp-ents" }, legendHTML(doc.ents.map((e) => ({ label: e.name, color: palette().series[e.i] })))) : null,
    h("dl", { class: "rp-facts" },
      h("dt", {}, "Generated"), h("dd", {}, generated),
      h("dt", {}, "Data refreshed"), h("dd", {}, ctx.meta.generated_at.slice(0, 10)),
      h("dt", {}, "Baseline year"), h("dd", {}, String(R.base)),
      h("dt", {}, "Analytics"), h("dd", {}, ANALYTICS.filter(([k]) => R.an.has(k)).map(([, l]) => l).join(", ") || "none")),
    h("h2", { class: "rp-contents-h" }, "Contents"), h("ol", { class: "rp-contents" }, contents),
    h("p", { class: "rp-sources" }, "Sources: Eurostat, ECB Data Portal, OECD, Open-Meteo, INE, Statistics Portugal. Figures for the latest year may be year to date and are marked YTD; year-to-date changes compare the same months a year earlier.")));
  doc.sections.forEach((s, i) => {
    const sec = h("section", { class: "rp-section" }, h("h2", {}, h("span", { class: "rp-num" }, String(i + 1).padStart(2, "0")), s.title));
    const blocks = s.blocks || [];
    blocks.forEach((b, bi) => {
      const wrap = h("div", { class: "rp-block" });
      if (b.title && blocks.length > 1) wrap.append(h("h3", { class: "rp-block-h" }, b.title));
      if (b.lines?.length) wrap.append(h("ul", { class: "rp-comment" }, b.lines.map((l) => h("li", {}, l))));
      if (bi === 0 && s.kpi) wrap.append(pdfTable(s.kpi.columns, s.kpi.rows, "rp-kpis"));
      const figWrap = h("div", { class: "rp-figs" });
      for (const f of b.figs || []) {
        const el = h("div", { class: "rp-chart" });
        figWrap.append(h("figure", { class: `rp-fig${f.half ? " half" : ""}` },
          h("figcaption", {}, f.title), f.note ? h("p", { class: "rp-note" }, f.note) : null, f.legend ? legendHTML(f.legend) : null, el));
        draws.push(() => f.draw(el));
      }
      if (figWrap.childElementCount) wrap.append(figWrap);
      for (const t of b.tables || []) wrap.append(h("div", { class: "rp-table-block" }, h("h4", {}, t.title), pdfTable(t.columns, t.rows)));
      sec.append(wrap);
    });
    if (!blocks.some((b) => b.lines?.length || b.figs?.length || b.tables?.length) && !s.kpi) sec.append(h("p", { class: "rp-note" }, "No data published for this selection."));
    paper.append(sec);
  });

  const printBtn = h("button", { type: "button", class: "rp-go", onclick: () => {
    const prev = document.title; document.title = doc.fileBase; window.print(); setTimeout(() => { document.title = prev; }, 500);
  } }, "Save as PDF");
  const xlBtn = h("button", { type: "button", class: "rp-go secondary", onclick: async () => {
    xlBtn.disabled = true; xlBtn.textContent = "Preparing Excel…";
    try { await exportExcel(doc); } catch (e) { console.error(e); alert(`Excel export failed: ${e.message}`); }
    xlBtn.disabled = false; xlBtn.textContent = "Download Excel";
  } }, "Download Excel");
  host.prepend(h("div", { class: "rp-toolbar" }, printBtn, xlBtn, h("span", { class: "rp-hint" }, "In the print dialog choose “Save as PDF”. Excel holds every table in HG format.")));
  scroll.hidden = false;
  draws.forEach((d) => d());
}

function pdfTable(columns, rows, cls = "") {
  return h("table", { class: `rp-table ${cls}`.trim() },
    h("thead", {}, h("tr", {}, columns.map((c, i) => h("th", { class: i === 0 ? "text" : null }, c)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v, i) => h("td", { class: i === 0 ? "text" : null }, v ?? ""))))));
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
