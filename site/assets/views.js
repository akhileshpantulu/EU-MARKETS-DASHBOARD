// One render function per tab. Each receives the shared context and fills
// ctx.filters (one filter row scoping every chart below it) and ctx.view.
import {
  loadTable, loadJSON, groupBy, isNum, h, select, segmented, dataTable, fmtMonth, fmtNum, fmtInt, fmtPct,
  fmtRate, fmtDec, fmtEur, fmtChange, deltaHTML, dateKeyToYm, monthName, downloadCSV,
} from "./util.js";
import { card, timeChart, rankBars, heatmap, choropleth, bubbleMap, palette, empty } from "./charts.js";
import { liveFx, liveRates, liveEuNights, mergeRows } from "./live.js";

const MONTH_KEYS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

// --------------------------------------------------------------------- helpers
function grid(...cards) {
  return h("div", { class: "grid" }, cards.map((c) => c.el || c));
}

function tile(label, value, sub, badge) {
  return h("div", { class: "tile" },
    h("div", { class: "label", html: `${label}${badge ? ` <span class="badge ${badge.cls}">${badge.text}</span>` : ""}` }),
    h("div", { class: "value" }, value),
    h("div", { class: "sub", html: sub || "&nbsp;" }));
}

function geoSelect(ctx, { countriesOnly = false, label = "Market" } = {}) {
  const opts = ctx.geoOptions(countriesOnly);
  let value = ctx.state.geo;
  if (countriesOnly && !ctx.isCountry(value)) value = "ES";
  return select(label, opts, value, (v) => ctx.setState({ geo: v }));
}

async function geo(ctx, which) {
  const path = ctx.meta.geo?.[which];
  if (!path) return null;
  try { return await loadJSON(path); } catch { return null; }
}

function latestComplete(rows, key = "year") {
  const years = rows.filter((r) => r.is_complete_year).map((r) => r[key]);
  return years.length ? Math.max(...years) : null;
}

// -------------------------------------------------------------------- overview
export async function overview(ctx) {
  const [score, monthly, annual] = await Promise.all([loadTable("scorecard"), loadTable("country_monthly"), loadTable("country_annual")]);
  const g = ctx.state.geo;
  ctx.filters.append(geoSelect(ctx));
  const s = score.find((r) => r.geo_code === g) || {};
  const ym = (k) => fmtMonth(dateKeyToYm(k));
  const base = ctx.meta.baseline_year;

  const tiles = h("div", { class: "tiles" },
    tile(`Nights, ${ym(s.nights_date_key)}`, fmtNum(s.latest_nights), `${deltaHTML(s.latest_nights_yoy)} vs a year earlier`),
    tile("Nights, year to date", fmtNum(s.nights_ytd), `${deltaHTML(s.nights_ytd_yoy)} vs last year · ${deltaHTML(s.nights_ytd_vs_baseline)} vs ${base}`),
    tile("Foreign guests' share", fmtPct(s.latest_foreign_share), `of nights in ${ym(s.nights_date_key)}`),
    tile(`Hotel bed occupancy, ${ym(s.occupancy_date_key)}`, fmtPct(s.latest_bed_place_occupancy_rate), `${deltaHTML(s.latest_bed_place_occupancy_change, { pts: true })} vs a year earlier`),
    tile(`Platform rental nights, ${ym(s.platform_date_key)}`, fmtNum(s.latest_platform_nights), `${deltaHTML(s.latest_platform_nights_yoy)} vs a year earlier`),
    tile(`Air passengers, ${ym(s.air_date_key)}`, fmtNum(s.latest_air_passengers), `${deltaHTML(s.latest_air_passengers_yoy)} vs a year earlier`),
    tile(`Accommodation inflation, ${ym(s.hicp_date_key)}`, fmtRate(s.latest_hicp_accommodation_pct), `HICP, all items ${fmtRate(s.latest_hicp_all_items_pct)}`),
    tile(`Unemployment, ${ym(s.unemployment_date_key)}`, fmtRate(s.latest_unemployment_rate_pct), "seasonally adjusted"),
  );

  const liveNote = h("p", { class: "notice", hidden: true });
  if (g === "EU27_2020") {
    liveEuNights().then(({ month, nights }) => {
      const snap = dateKeyToYm(s.nights_date_key);
      if (snap && month > snap) {
        liveNote.hidden = false;
        liveNote.innerHTML = `<span class="badge live">live</span> Eurostat has published ${fmtMonth(month)}: ${fmtNum(nights)} nights in the EU. The dashboard picks it up on the next daily refresh.`;
      }
    }).catch(() => {});
  }

  // Calendar-month comparison: this year, last year, baseline.
  const rows = monthly.filter((r) => r.geo_code === g && isNum(r.nights));
  const lastYear = rows.length ? Number(rows[rows.length - 1].month.slice(0, 4)) : null;
  const p = palette();
  const seriesFor = (y, name, color, width) => ({
    name, color, width,
    data: rows.filter((r) => r.month.startsWith(String(y))).map((r) => [r.month.slice(5), r.nights]),
  });
  const seasonCard = card({
    title: "Nights by calendar month", span: 7, height: "map",
    note: "Nights at all tourist accommodation (hotels, holiday homes, campsites).",
    legend: [{ label: String(lastYear), color: p.series[0] }, { label: String(lastYear - 1), color: p.series[1] }, { label: String(base), color: p.context }],
    table: () => ({ columns: ["Month", String(lastYear), String(lastYear - 1), String(base)],
      rows: MONTH_KEYS.map((m) => [monthName(+m), ...[lastYear, lastYear - 1, base].map((y) => rows.find((r) => r.month === `${y}-${m}`)?.nights ?? null)]) }),
  });

  // Map of countries.
  const metric = ctx.state.ovMetric || "ytd_yoy";
  const metrics = {
    ytd_yoy: { label: "YTD vs last year", get: (r) => r.nights_ytd_yoy, scale: "div", fmt: (v) => fmtChange(v), src: "score" },
    ytd_base: { label: `YTD vs ${base}`, get: (r) => r.nights_ytd_vs_baseline, scale: "div", fmt: (v) => fmtChange(v), src: "score" },
    foreign: { label: "Foreign share", get: (r) => r.latest_foreign_share, scale: "seq", fmt: (v) => fmtPct(v, 0), src: "score" },
    intensity: { label: "Nights per resident", get: (r) => r.nights_per_resident, scale: "seq", fmt: (v) => fmtDec(v, 1), src: "annual" },
    occupancy: { label: "Hotel bed occupancy", get: (r) => r.latest_bed_place_occupancy_rate, scale: "seq", fmt: (v) => fmtPct(v, 0), src: "score" },
  };
  const m = metrics[metric];
  const annualYear = latestComplete(annual.filter((r) => ctx.isCountry(r.geo_code)));
  const mapData = m.src === "score"
    ? score.filter((r) => ctx.isCountry(r.geo_code) && r.is_current).map((r) => ({ code: r.geo_code, value: m.get(r) }))
    : annual.filter((r) => r.year === annualYear && ctx.isCountry(r.geo_code)).map((r) => ({ code: r.geo_code, value: m.get(r) }));
  const mapCard = card({
    title: `Countries: ${m.label}`, span: 5, height: "map",
    note: m.src === "annual" ? `${annualYear}, nights at tourist accommodation per inhabitant.` : "Latest month each country has published. Click a country to select it.",
    table: () => ({ columns: ["Country", m.label], rows: mapData.map((d) => [ctx.geoName(d.code), d.value]) }),
  });

  const movers = score.filter((r) => ctx.isCountry(r.geo_code) && r.is_current && isNum(r.nights_ytd_yoy));
  const stale = score.filter((r) => ctx.isCountry(r.geo_code) && !r.is_current).map((r) => `${ctx.geoName(r.geo_code)} (to ${fmtMonth(dateKeyToYm(r.nights_date_key))})`);
  const moversCard = card({ title: "Year-to-date growth by country", span: 12,
    note: `Nights year to date versus the same months last year. The selected market is highlighted.${stale.length ? ` Not shown, no recent data: ${stale.join(", ")}.` : ""}` });

  ctx.view.append(
    liveNote,
    tiles,
    h("div", { style: "height:16px" }),
    grid(seasonCard, mapCard, moversCard),
  );
  ctx.filters.append(segmented("Map metric", Object.entries(metrics).map(([value, x]) => ({ value, label: x.label })), metric,
    (v) => ctx.setState({ ovMetric: v })));

  timeChart(seasonCard.chartEl, {
    categories: MONTH_KEYS, xFormat: (v) => monthName(+v),
    series: [seriesFor(lastYear, String(lastYear), p.series[0], 2.5), seriesFor(lastYear - 1, String(lastYear - 1), p.series[1]),
      seriesFor(base, String(base), p.context)],
    yFormat: (v) => fmtNum(v, 0),
  });
  choropleth(mapCard.chartEl, {
    name: "countries", geojson: await geo(ctx, "countries"), data: mapData, scale: m.scale, format: m.fmt,
    selected: g, labelFor: ctx.geoName, onClick: (code) => ctx.isCountry(code) && ctx.setState({ geo: code }),
  });
  rankBars(moversCard.chartEl, {
    items: movers.sort((a, b) => b.nights_ytd_yoy - a.nights_ytd_yoy).map((r) => ({ label: ctx.geoName(r.geo_code), value: r.nights_ytd_yoy, code: r.geo_code })),
    format: (v) => fmtChange(v),
    colorFn: (d, pal) => (d.code === g ? pal.series[1] : d.value >= 0 ? pal.div[4] : pal.div[0]),
    onClick: (d) => ctx.setState({ geo: d.code }),
  });
}

// --------------------------------------------------------------------- markets
export async function markets(ctx) {
  const score = await loadTable("scorecard");
  const group = ctx.state.group || "all";
  ctx.filters.append(segmented("Countries", [
    { value: "all", label: "All" }, { value: "eu", label: "EU27" }, { value: "euro", label: "Euro area" },
    { value: "south", label: "Southern Europe" }, { value: "aggregates", label: "EU totals" },
  ], group, (v) => ctx.setState({ group: v })));
  const gm = ctx.geoMeta;
  const keep = (r) => {
    const g = gm(r.geo_code);
    if (!g) return false;
    if (group === "aggregates") return g.geo_level === "aggregate";
    if (g.geo_level !== "country") return false;
    if (!r.is_current && group !== "all") return false;
    if (group === "eu") return g.is_eu27;
    if (group === "euro") return g.is_euro_area;
    if (group === "south") return g.region_group === "Southern Europe";
    return true;
  };
  const rows = score.filter(keep).map((r) => ({ ...r, name: ctx.geoName(r.geo_code) }));
  const base = ctx.meta.baseline_year;
  const cols = [
    { key: "name", label: "Market", text: true },
    { key: "nights_date_key", label: "Latest", fmt: (v, r) => `${fmtMonth(dateKeyToYm(v))}${r.is_current ? "" : " (stale)"}` },
    { key: "latest_nights", label: "Nights", fmt: (v) => fmtNum(v) },
    { key: "latest_nights_yoy", label: "YoY", fmt: (v) => deltaHTML(v) },
    { key: "nights_ytd_yoy", label: "YTD YoY", fmt: (v) => deltaHTML(v) },
    { key: "nights_ytd_vs_baseline", label: `YTD vs ${base}`, fmt: (v) => deltaHTML(v) },
    { key: "latest_bed_place_occupancy_rate", label: "Hotel occ.", fmt: (v) => fmtPct(v, 0) },
    { key: "latest_bed_place_occupancy_change", label: "Occ. Δ", fmt: (v) => deltaHTML(v, { pts: true }) },
    { key: "latest_foreign_share", label: "Foreign", fmt: (v) => fmtPct(v, 0) },
    { key: "latest_avg_length_of_stay", label: "Avg stay", fmt: (v) => (isNum(v) ? `${v.toFixed(1)} n` : "n/a") },
    { key: "latest_platform_nights_yoy", label: "Platform YoY", fmt: (v) => deltaHTML(v) },
    { key: "latest_air_passengers_yoy", label: "Air pax YoY", fmt: (v) => deltaHTML(v) },
    { key: "latest_hicp_accommodation_pct", label: "Accom. CPI", fmt: (v) => fmtRate(v) },
    { key: "latest_unemployment_rate_pct", label: "Unemp.", fmt: (v) => fmtRate(v) },
  ];
  const c = card({ title: "Market scorecard", span: 12,
    note: "Each country's latest published month. YTD compares the same months of the previous year. Avg stay = nights per arrival. Click a row to open the country.",
    table: () => ({ columns: cols.map((x) => x.label), rows: rows.map((r) => cols.map((x) => r[x.key])) }), csvName: "market-scorecard" });
  c.chartEl.replaceWith(dataTable(cols, rows, {
    initialSort: { key: "latest_nights", dir: "desc" }, highlight: (r) => r.geo_code === ctx.state.geo,
    onRowClick: (r) => ctx.setState({ geo: r.geo_code, tab: "country" }),
  }));
  ctx.view.append(h("p", { class: "view-intro" }, "Demand, occupancy, rentals, air traffic and prices for every European market Eurostat covers, on one screen. Green and red arrows show the direction of change."), grid(c));
}

// --------------------------------------------------------------------- country
export async function country(ctx) {
  const [monthly, annual] = await Promise.all([loadTable("country_monthly"), loadTable("country_annual")]);
  const g = ctx.state.geo;
  ctx.filters.append(geoSelect(ctx));
  const rows = monthly.filter((r) => r.geo_code === g);
  const ann = annual.filter((r) => r.geo_code === g);
  const p = palette();
  const pick = (k) => rows.map((r) => [r.month, r[k]]);
  const recent = rows.filter((r) => r.month >= `${Number((rows.at(-1)?.month || "2025").slice(0, 4)) - 3}-01`);
  const base = ctx.meta.baseline_year;

  const c1 = card({ title: "Nights by guest origin", span: 12, height: "tall",
    note: "Monthly nights at tourist accommodation, domestic and foreign guests stacked. Drag the slider to zoom.",
    legend: [{ label: "Domestic guests", color: p.series[0] }, { label: "Foreign guests", color: p.series[1] }],
    table: () => ({ columns: ["Month", "Domestic", "Foreign", "Total", "Hotels"], rows: rows.map((r) => [r.month, r.nights_domestic, r.nights_foreign, r.nights, r.hotel_nights]) }) });
  const c2 = card({ title: "Nights: change on a year earlier", span: 6,
    note: "Last four years.", table: () => ({ columns: ["Month", "YoY"], rows: recent.map((r) => [r.month, r.nights_yoy]) }) });
  const c3 = card({ title: "Hotel occupancy", span: 6, note: "Net occupancy of bed-places and bedrooms in hotels.",
    legend: [{ label: "Bed-places", color: p.series[0] }, { label: "Bedrooms", color: p.series[1] }],
    table: () => ({ columns: ["Month", "Bed-places", "Bedrooms"], rows: rows.map((r) => [r.month, r.bed_place_occupancy_rate, r.room_occupancy_rate]) }) });
  const c4 = card({ title: "Average length of stay", span: 6, note: "Nights per arrival, all tourist accommodation.",
    table: () => ({ columns: ["Month", "Nights per arrival"], rows: rows.map((r) => [r.month, r.avg_length_of_stay]) }) });
  const c5 = card({ title: "Accommodation turnover index", span: 6, note: "Eurostat services turnover, NACE I55 (2021 = 100 where available).",
    table: () => ({ columns: ["Month", "Index"], rows: rows.map((r) => [r.month, r.accommodation_turnover_index]) }) });
  const annCols = [
    { key: "year", label: "Year" },
    { key: "nights", label: "Nights", fmt: (v) => fmtNum(v) },
    { key: "nights_yoy", label: "YoY", fmt: (v) => deltaHTML(v) },
    { key: "nights_vs_baseline", label: `vs ${base}`, fmt: (v) => deltaHTML(v) },
    { key: "foreign_share", label: "Foreign", fmt: (v) => fmtPct(v, 0) },
    { key: "high_season_share", label: "Jun-Sep share", fmt: (v) => fmtPct(v, 0) },
    { key: "avg_length_of_stay", label: "Avg stay", fmt: (v) => fmtDec(v, 1) },
    { key: "avg_bed_place_occupancy_rate", label: "Hotel occ.", fmt: (v) => fmtPct(v, 0) },
    { key: "establishments", label: "Establishments", fmt: fmtInt },
    { key: "bed_places", label: "Bed-places", fmt: (v) => fmtNum(v) },
    { key: "nights_per_resident", label: "Nights / resident", fmt: (v) => fmtDec(v, 1) },
    { key: "platform_share", label: "Platform share", fmt: (v) => fmtPct(v, 0) },
  ];
  const c6 = card({ title: "Annual summary", span: 12, note: "Growth rates only for years with all twelve months published.",
    table: () => ({ columns: annCols.map((x) => x.label), rows: ann.map((r) => annCols.map((x) => r[x.key])) }), csvName: `annual-${g}` });
  c6.chartEl.replaceWith(dataTable(annCols, ann.slice().reverse(), { initialSort: { key: "year", dir: "desc" } }));

  ctx.view.append(grid(c1, c2, c3, c4, c5, c6));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtNum(v, 0), series: [
    { name: "Domestic guests", data: pick("nights_domestic"), stack: "n", area: true, color: p.series[0] },
    { name: "Foreign guests", data: pick("nights_foreign"), stack: "n", area: true, color: p.series[1] }] });
  timeChart(c2.chartEl, { markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }), series: [
    { name: "Nights YoY", type: "bar", data: recent.map((r) => [r.month, r.nights_yoy]) }] });
  timeChart(c3.chartEl, { yFormat: (v) => fmtPct(v, 0), series: [
    { name: "Bed-places", data: pick("bed_place_occupancy_rate") }, { name: "Bedrooms", data: pick("room_occupancy_rate") }] });
  timeChart(c4.chartEl, { yFormat: (v) => fmtDec(v, 1), series: [{ name: "Nights per arrival", data: pick("avg_length_of_stay") }] });
  timeChart(c5.chartEl, { yFormat: (v) => fmtDec(v, 0), series: [{ name: "Turnover index", data: pick("accommodation_turnover_index") }] });
}

// ----------------------------------------------------------------- seasonality
export async function seasonality(ctx) {
  const [monthly, annual, regions, regionMonthly] = await Promise.all([
    loadTable("country_monthly"), loadTable("country_annual"), loadTable("region_annual"), loadTable("region_monthly")]);
  const years = [...new Set(annual.filter((r) => r.is_complete_year).map((r) => r.year))].sort((a, b) => b - a);
  const year = Number(ctx.state.year) || years[0];
  ctx.filters.append(select("Year", years.map(String), String(year), (v) => ctx.setState({ year: v })));

  const countries = annual.filter((r) => r.year === year && r.is_complete_year && ctx.isCountry(r.geo_code) && isNum(r.peak_two_month_share))
    .sort((a, b) => b.peak_two_month_share - a.peak_two_month_share);
  const order = countries.map((r) => r.geo_code);
  const byGeo = groupBy(monthly.filter((r) => r.month.startsWith(String(year))), "geo_code");
  const values = [];
  order.forEach((code, yi) => {
    const ms = byGeo.get(code) || [];
    const total = ms.reduce((s, r) => s + (r.nights || 0), 0);
    ms.forEach((r) => values.push([Number(r.month.slice(5)) - 1, yi, total ? r.nights / total : null]));
  });
  const hm = card({ title: `Share of the year's nights by month, ${year}`, span: 7,
    note: "Countries sorted from most to least seasonal (share of nights in the two busiest months).",
    table: () => ({ columns: ["Country", ...MONTH_KEYS.map((m) => monthName(+m))],
      rows: order.map((code, yi) => [ctx.geoName(code), ...MONTH_KEYS.map((_, xi) => values.find((v) => v[0] === xi && v[1] === yi)?.[2] ?? null)]) }) });
  const peak = card({ title: "Two busiest months' share of annual nights", span: 5,
    table: () => ({ columns: ["Country", "Peak two-month share", "June-September share"], rows: countries.map((r) => [ctx.geoName(r.geo_code), r.peak_two_month_share, r.high_season_share]) }) });

  const regYears = [...new Set(regions.filter((r) => isNum(r.peak_two_month_share)).map((r) => r.year))].sort((a, b) => b - a);
  const regYear = regYears.includes(year) ? year : regYears[0];
  const regData = regions.filter((r) => r.year === regYear).map((r) => ({ code: r.geo_code, value: r.peak_two_month_share }));
  const sel = ctx.state.region;
  const regMap = card({ title: `Regional seasonality, ${regYear ?? "n/a"}`, span: 7, height: "map",
    note: "NUTS 2 regions: share of nights in the two busiest months. Eurostat publishes monthly regional data once a year. Click a region for its profile.",
    table: () => ({ columns: ["Region", "Peak two-month share"], rows: regData.map((d) => [ctx.geoName(d.code), d.value]) }) });
  const profileRows = regionMonthly.filter((r) => r.geo_code === sel);
  const prof = card({ title: sel ? `Monthly nights: ${ctx.geoName(sel)}` : "Regional profile", span: 5,
    note: sel ? "Tourist accommodation nights by calendar month, one line per year." : "Select a region on the map.",
    table: () => ({ columns: ["Month", "Nights", "Platform nights"], rows: profileRows.map((r) => [r.month, r.nights, r.platform_nights]) }) });

  ctx.view.append(grid(hm, peak, regMap, prof));
  heatmap(hm.chartEl, { rows: order.map(ctx.geoName), cols: MONTH_KEYS.map((m) => monthName(+m)), values, format: (v) => fmtPct(v, 1) });
  rankBars(peak.chartEl, { items: countries.map((r) => ({ label: ctx.geoName(r.geo_code), value: r.peak_two_month_share, code: r.geo_code })),
    format: (v) => fmtPct(v, 0), colorFn: (d, pal) => (d.code === ctx.state.geo ? pal.series[1] : pal.series[0]) });
  choropleth(regMap.chartEl, { name: "regions", geojson: await geo(ctx, "regions"), data: regData, format: (v) => fmtPct(v, 0),
    selected: sel, labelFor: ctx.geoName, onClick: (code) => ctx.setState({ region: code }) });
  if (sel) {
    const p = palette();
    const ys = [...new Set(profileRows.filter((r) => isNum(r.nights)).map((r) => r.month.slice(0, 4)))].sort().slice(-3);
    timeChart(prof.chartEl, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: (v) => fmtNum(v, 0),
      series: ys.map((y, i) => ({ name: y, color: i === ys.length - 1 ? p.series[0] : i === ys.length - 2 ? p.series[1] : p.context,
        data: profileRows.filter((r) => r.month.startsWith(y)).map((r) => [r.month.slice(5), r.nights]) })) });
    prof.el.querySelector(".card-head").after(h("div", { class: "legend" },
      ys.map((y, i) => h("span", {}, h("i", { style: `background:${i === ys.length - 1 ? p.series[0] : i === ys.length - 2 ? p.series[1] : p.context}` }), y))));
  } else {
    empty(prof.chartEl, "Click a region on the map.");
  }
}

// --------------------------------------------------------------------- regions
export async function regions(ctx) {
  const rows = await loadTable("region_annual");
  const years = [...new Set(rows.filter((r) => isNum(r.nights)).map((r) => r.year))].sort((a, b) => b - a);
  const year = years.includes(Number(ctx.state.year)) ? Number(ctx.state.year) : years[0];
  const base = ctx.meta.baseline_year;
  const metrics = {
    nights: { label: "Nights", scale: "seq", fmt: (v) => fmtNum(v) },
    nights_yoy: { label: "Change on a year earlier", scale: "div", fmt: (v) => fmtChange(v) },
    nights_vs_baseline: { label: `Change vs ${base}`, scale: "div", fmt: (v) => fmtChange(v) },
    foreign_share: { label: "Foreign share", scale: "seq", fmt: (v) => fmtPct(v, 0) },
    platform_share: { label: "Platform rental share", scale: "seq", fmt: (v) => fmtPct(v, 0) },
    peak_two_month_share: { label: "Peak two-month share", scale: "seq", fmt: (v) => fmtPct(v, 0) },
  };
  const metric = metrics[ctx.state.regMetric] ? ctx.state.regMetric : "nights";
  const m = metrics[metric];
  const countryFilter = ctx.state.regCountry || "all";
  const countries = [...new Set(rows.map((r) => r.geo_code.slice(0, 2)))].sort((a, b) => ctx.geoName(a).localeCompare(ctx.geoName(b)));
  ctx.filters.append(
    select("Year", years.map(String), String(year), (v) => ctx.setState({ year: v })),
    select("Country", [{ value: "all", label: "All countries" }, ...countries.map((c) => ({ value: c, label: ctx.geoName(c) }))], countryFilter,
      (v) => ctx.setState({ regCountry: v })),
    segmented("Metric", Object.entries(metrics).map(([value, x]) => ({ value, label: x.label })), metric, (v) => ctx.setState({ regMetric: v })),
  );
  const yr = rows.filter((r) => r.year === year && (countryFilter === "all" || r.geo_code.startsWith(countryFilter)));
  const data = yr.map((r) => ({ code: r.geo_code, value: r[metric] }));
  const mapCard = card({ title: `${m.label} by region, ${year}`, span: 7, height: "map",
    note: "NUTS 2 regions. Scroll to zoom, drag to pan.", table: () => ({ columns: ["Region", m.label], rows: data.map((d) => [ctx.geoName(d.code), d.value]) }) });
  const top = yr.filter((r) => isNum(r[metric])).sort((a, b) => b[metric] - a[metric]).slice(0, 20);
  const barCard = card({ title: `Top 20 regions: ${m.label.toLowerCase()}`, span: 5 });
  const cols = [
    { key: "name", label: "Region", text: true },
    { key: "country", label: "Country", text: true },
    { key: "nights", label: "Nights", fmt: (v) => fmtNum(v) },
    { key: "nights_yoy", label: "YoY", fmt: (v) => deltaHTML(v) },
    { key: "nights_vs_baseline", label: `vs ${base}`, fmt: (v) => deltaHTML(v) },
    { key: "foreign_share", label: "Foreign", fmt: (v) => fmtPct(v, 0) },
    { key: "peak_two_month_share", label: "Peak 2 months", fmt: (v) => fmtPct(v, 0) },
    { key: "platform_nights", label: "Platform nights", fmt: (v) => fmtNum(v) },
    { key: "platform_share", label: "Platform share", fmt: (v) => fmtPct(v, 0) },
    { key: "share_of_country_nights", label: "Share of country", fmt: (v) => fmtPct(v, 0) },
  ];
  const tableRows = yr.map((r) => ({ ...r, name: ctx.geoName(r.geo_code), country: ctx.geoName(r.geo_code.slice(0, 2)) }));
  const tCard = card({ title: "All regions", span: 12, csvName: `regions-${year}`,
    table: () => ({ columns: cols.map((c) => c.label), rows: tableRows.map((r) => cols.map((c) => r[c.key])) }) });
  tCard.chartEl.replaceWith(dataTable(cols, tableRows, { initialSort: { key: "nights", dir: "desc" } }));
  ctx.view.append(grid(mapCard, barCard, tCard));
  choropleth(mapCard.chartEl, { name: "regions", geojson: await geo(ctx, "regions"), data, scale: m.scale, format: m.fmt, labelFor: ctx.geoName });
  rankBars(barCard.chartEl, { items: top.map((r) => ({ label: ctx.geoName(r.geo_code), value: r[metric] })), format: m.fmt });
}

// -------------------------------------------------------------- source markets
export async function sources(ctx) {
  const rows = await loadTable("source_markets");
  const partners = new Map(ctx.meta.partners.map((p) => [p.partner_code, p.partner_name]));
  const pname = (c) => partners.get(c) || ctx.geoName(c);
  const dests = [...new Set(rows.map((r) => r.geo_code))];
  const g = dests.includes(ctx.state.geo) ? ctx.state.geo : dests.includes("ES") ? "ES" : dests[0];
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  const year = years.includes(Number(ctx.state.year)) ? Number(ctx.state.year) : years[0];
  const origins = [...new Set(rows.map((r) => r.partner_code))].sort((a, b) => pname(a).localeCompare(pname(b)));
  const origin = origins.includes(ctx.state.origin) ? ctx.state.origin : origins.includes("DE") ? "DE" : origins[0];
  const base = ctx.meta.baseline_year;
  ctx.filters.append(
    select("Destination", dests.map((c) => ({ value: c, label: ctx.geoName(c) })).sort((a, b) => a.label.localeCompare(b.label)), g, (v) => ctx.setState({ geo: v })),
    select("Year", years.map(String), String(year), (v) => ctx.setState({ year: v })),
    select("Origin market", origins.map((c) => ({ value: c, label: pname(c) })), origin, (v) => ctx.setState({ origin: v })),
  );
  const mk = rows.filter((r) => r.geo_code === g && r.year === year).sort((a, b) => b.nights - a.nights);
  const top = mk.slice(0, 15);
  const c1 = card({ title: `Where ${ctx.geoName(g)}'s foreign guests come from, ${year}`, span: 6,
    note: "Share of nights by foreign guests at all tourist accommodation. Eurostat publishes this split once a year.",
    table: () => ({ columns: ["Market", "Nights", "Share of foreign nights", "YoY", `vs ${base}`], rows: mk.map((r) => [pname(r.partner_code), r.nights, r.share_of_foreign_nights, r.nights_yoy, r.nights_vs_baseline]) }) });
  const c2 = card({ title: `Growth by market vs ${base}`, span: 6, note: `Top 15 markets by nights in ${year}. Change in nights against ${base}.` });
  const dest = rows.filter((r) => r.partner_code === origin && r.year === year && r.geo_code !== origin).sort((a, b) => b.nights - a.nights).slice(0, 15);
  const c3 = card({ title: `Where guests from ${pname(origin)} stay, ${year}`, span: 6, note: "Nights in each destination country.",
    table: () => ({ columns: ["Destination", "Nights", "YoY"], rows: dest.map((r) => [ctx.geoName(r.geo_code), r.nights, r.nights_yoy]) }) });
  const trend = rows.filter((r) => r.geo_code === g && r.partner_code === origin).sort((a, b) => a.year - b.year);
  const c4 = card({ title: `Nights in ${ctx.geoName(g)} by guests from ${pname(origin)}`, span: 6,
    table: () => ({ columns: ["Year", "Nights", "Share of foreign nights"], rows: trend.map((r) => [r.year, r.nights, r.share_of_foreign_nights]) }) });
  ctx.view.append(grid(c1, c2, c3, c4));
  rankBars(c1.chartEl, { items: top.map((r) => ({ label: pname(r.partner_code), value: r.share_of_foreign_nights ?? null, code: r.partner_code })),
    format: (v) => fmtPct(v, 1), colorFn: (d, p) => (d.code === origin ? p.series[1] : p.series[0]) });
  rankBars(c2.chartEl, { items: top.filter((r) => isNum(r.nights_vs_baseline)).map((r) => ({ label: pname(r.partner_code), value: r.nights_vs_baseline })),
    format: (v) => fmtChange(v), colorFn: (d, p) => (d.value >= 0 ? p.div[4] : p.div[0]) });
  rankBars(c3.chartEl, { items: dest.map((r) => ({ label: ctx.geoName(r.geo_code), value: r.nights, code: r.geo_code })),
    format: (v) => fmtNum(v), colorFn: (d, p) => (d.code === g ? p.series[1] : p.series[0]) });
  timeChart(c4.chartEl, { yFormat: (v) => fmtNum(v, 0), series: [{ name: "Nights", type: "bar", data: trend.map((r) => [String(r.year), r.nights]) }] });
}

// ----------------------------------------------------------------- rentals
export async function rentals(ctx) {
  const [monthly, annual, regions] = await Promise.all([loadTable("country_monthly"), loadTable("country_annual"), loadTable("region_annual")]);
  const g = ctx.state.geo;
  ctx.filters.append(geoSelect(ctx));
  const rows = monthly.filter((r) => r.geo_code === g && r.month >= "2018-01");
  const p = palette();
  const c1 = card({ title: "Platform rental nights and nights at tourist accommodation", span: 12, height: "tall",
    note: "Short-stay rentals booked through Airbnb, Booking and Expedia (Tripadvisor until 2024), Eurostat experimental statistics, published quarterly. Same unit, one axis.",
    legend: [{ label: "Platform rental nights", color: p.series[2] }, { label: "Tourist accommodation nights", color: p.series[0] }],
    table: () => ({ columns: ["Month", "Platform nights", "Accommodation nights", "Platform YoY"], rows: rows.map((r) => [r.month, r.platform_nights, r.nights, r.platform_nights_yoy]) }) });
  const yrs = [...new Set(annual.filter((r) => isNum(r.platform_share)).map((r) => r.year))].sort((a, b) => b - a);
  const year = yrs[0];
  const shares = annual.filter((r) => r.year === year && ctx.isCountry(r.geo_code) && isNum(r.platform_share)).sort((a, b) => b.platform_share - a.platform_share);
  const c2 = card({ title: `Platform rentals' share of all nights, ${year ?? "n/a"}`, span: 5,
    note: "Platform nights ÷ (platform nights + tourist accommodation nights). The two sources can overlap where rentals also report as holiday homes.",
    table: () => ({ columns: ["Country", "Platform share", "Platform nights"], rows: shares.map((r) => [ctx.geoName(r.geo_code), r.platform_share, r.platform_nights]) }) });
  const ryears = [...new Set(regions.filter((r) => isNum(r.platform_nights)).map((r) => r.year))].sort((a, b) => b - a);
  const ry = ryears[0];
  const rdata = regions.filter((r) => r.year === ry && isNum(r.platform_nights));
  const c3 = card({ title: `Platform rental nights by region, ${ry ?? "n/a"}`, span: 7, height: "map",
    table: () => ({ columns: ["Region", "Platform nights", "Platform share", "YoY"], rows: rdata.map((r) => [ctx.geoName(r.geo_code), r.platform_nights, r.platform_share, r.platform_nights_yoy]) }) });
  const topR = rdata.slice().sort((a, b) => b.platform_nights - a.platform_nights).slice(0, 20);
  const c4 = card({ title: `Top 20 regions for platform rentals, ${ry ?? "n/a"}`, span: 12 });
  ctx.view.append(grid(c1, c2, c3, c4));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtNum(v, 0), series: [
    { name: "Platform rental nights", data: rows.map((r) => [r.month, r.platform_nights]), color: p.series[2] },
    { name: "Tourist accommodation nights", data: rows.map((r) => [r.month, r.nights]), color: p.series[0] }] });
  rankBars(c2.chartEl, { items: shares.map((r) => ({ label: ctx.geoName(r.geo_code), value: r.platform_share, code: r.geo_code })),
    format: (v) => fmtPct(v, 0), colorFn: (d, pal) => (d.code === g ? pal.series[1] : pal.series[0]) });
  choropleth(c3.chartEl, { name: "regions", geojson: await geo(ctx, "regions"), data: rdata.map((r) => ({ code: r.geo_code, value: r.platform_nights })),
    format: (v) => fmtNum(v), labelFor: ctx.geoName });
  rankBars(c4.chartEl, { items: topR.map((r) => ({ label: `${ctx.geoName(r.geo_code)} (${r.geo_code.slice(0, 2)})`, value: r.platform_nights })), format: (v) => fmtNum(v) });
}

// ------------------------------------------------------------------------- air
export async function air(ctx) {
  const [monthly, airports] = await Promise.all([loadTable("country_monthly"), loadTable("airports_monthly")]);
  const g = ctx.state.geo;
  ctx.filters.append(geoSelect(ctx));
  const rows = monthly.filter((r) => r.geo_code === g && isNum(r.air_passengers));
  const p = palette();
  const c1 = card({ title: "Air passengers", span: 7, note: "Passengers carried (arrivals plus departures), all flights and international flights.",
    legend: [{ label: "All flights", color: p.series[0] }, { label: "International", color: p.series[1] }],
    table: () => ({ columns: ["Month", "Passengers", "International", "YoY"], rows: rows.map((r) => [r.month, r.air_passengers, r.air_passengers_international, r.air_passengers_yoy]) }) });
  const recent = rows.slice(-36);
  const c2 = card({ title: "Passengers: change on a year earlier", span: 5, table: () => ({ columns: ["Month", "YoY"], rows: recent.map((r) => [r.month, r.air_passengers_yoy]) }) });

  const ap = new Map(ctx.meta.airports.map((a) => [a.airport_code, a]));
  const byAp = groupBy(airports, "airport_code");
  const latestAll = airports.reduce((m, r) => (r.month > m ? r.month : m), "");
  const summary = [];
  for (const [code, list] of byAp) {
    const meta = ap.get(code);
    if (!meta) continue;
    const last = list.at(-1);
    const idx = new Map(list.map((r) => [r.month, r.passengers]));
    const prevMonth = `${Number(last.month.slice(0, 4)) - 1}${last.month.slice(4)}`;
    const t12 = list.slice(-12);
    const t12prev = list.filter((r) => r.month <= prevMonth).slice(-12);
    const sum = (a) => (a.length === 12 ? a.reduce((s, r) => s + r.passengers, 0) : null);
    summary.push({
      airport_code: code, name: `${meta.city} (${meta.iata_code})`, country: meta.country_name, lat: meta.latitude, lon: meta.longitude,
      month: last.month, passengers: last.passengers,
      yoy: idx.has(prevMonth) ? last.passengers / idx.get(prevMonth) - 1 : null,
      t12: sum(t12), t12_yoy: sum(t12) && sum(t12prev) ? sum(t12) / sum(t12prev) - 1 : null,
    });
  }
  const c3 = card({ title: "Main airports, trailing twelve months", span: 7, height: "map",
    note: `Bubble area is proportional to passengers in the twelve months to each airport's latest month (most recent: ${fmtMonth(latestAll)}).`,
    table: () => ({ columns: ["Airport", "Country", "Trailing 12m", "12m YoY"], rows: summary.map((r) => [r.name, r.country, r.t12, r.t12_yoy]) }) });
  const cols = [
    { key: "name", label: "Airport", text: true }, { key: "country", label: "Country", text: true },
    { key: "month", label: "Latest", fmt: fmtMonth }, { key: "passengers", label: "Passengers", fmt: (v) => fmtNum(v) },
    { key: "yoy", label: "YoY", fmt: (v) => deltaHTML(v) }, { key: "t12", label: "Trailing 12m", fmt: (v) => fmtNum(v) },
    { key: "t12_yoy", label: "12m YoY", fmt: (v) => deltaHTML(v) },
  ];
  const c4 = card({ title: "Airports", span: 5, csvName: "airports",
    table: () => ({ columns: cols.map((c) => c.label), rows: summary.map((r) => cols.map((c) => r[c.key])) }) });
  c4.chartEl.replaceWith(dataTable(cols, summary, { initialSort: { key: "t12", dir: "desc" } }));
  ctx.view.append(grid(c1, c2, c3, c4));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtNum(v, 0), series: [
    { name: "All flights", data: rows.map((r) => [r.month, r.air_passengers]) },
    { name: "International", data: rows.map((r) => [r.month, r.air_passengers_international]) }] });
  timeChart(c2.chartEl, { markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }), series: [{ name: "YoY", type: "bar", data: recent.map((r) => [r.month, r.air_passengers_yoy]) }] });
  bubbleMap(c3.chartEl, { geojson: await geo(ctx, "countries"), points: summary.filter((r) => r.t12).map((r) => ({ name: r.name, lon: r.lon, lat: r.lat, value: r.t12 })), format: (v) => fmtNum(v) });
}

// ----------------------------------------------------------------------- macro
export async function macro(ctx) {
  const [monthly, gdp, score] = await Promise.all([loadTable("country_monthly"), loadTable("gdp_quarterly"), loadTable("scorecard")]);
  const g = ctx.state.geo;
  ctx.filters.append(geoSelect(ctx));
  const rows = monthly.filter((r) => r.geo_code === g && r.month >= "2018-01");
  const p = palette();
  const pick = (k) => rows.map((r) => [r.month, r[k]]);
  const c1 = card({ title: "Consumer prices: annual rate of change", span: 7, note: "HICP. Accommodation services and restaurants against all items.",
    legend: [{ label: "Accommodation services", color: p.series[0] }, { label: "Restaurants and cafés", color: p.series[1] }, { label: "All items", color: p.context }],
    table: () => ({ columns: ["Month", "Accommodation", "Restaurants", "All items"], rows: rows.map((r) => [r.month, r.hicp_accommodation_pct, r.hicp_restaurants_pct, r.hicp_all_items_pct]) }) });
  const cross = score.filter((r) => ctx.isCountry(r.geo_code) && isNum(r.latest_hicp_accommodation_pct)).sort((a, b) => b.latest_hicp_accommodation_pct - a.latest_hicp_accommodation_pct);
  const c2 = card({ title: "Accommodation inflation by country", span: 5, note: "Latest month published.",
    table: () => ({ columns: ["Country", "Accommodation", "All items"], rows: cross.map((r) => [ctx.geoName(r.geo_code), r.latest_hicp_accommodation_pct, r.latest_hicp_all_items_pct]) }) });
  const q = gdp.filter((r) => r.geo_code === g && r.quarter_start >= "2018-01");
  const c3 = card({ title: "Real GDP growth", span: 6, note: "Same quarter of the previous year, seasonally and calendar adjusted.",
    table: () => ({ columns: ["Quarter", "Growth %"], rows: q.map((r) => [r.quarter_start, r.gdp_growth_yoy_pct]) }) });
  const c4 = card({ title: "Unemployment rate", span: 6, note: "Seasonally adjusted, % of labour force.", table: () => ({ columns: ["Month", "%"], rows: pick("unemployment_rate_pct") }) });
  const c5 = card({ title: "Consumer confidence", span: 6, note: "European Commission survey, balance of positive minus negative answers.", table: () => ({ columns: ["Month", "Balance"], rows: pick("consumer_confidence_balance") }) });
  const c6 = card({ title: "10-year government bond yield", span: 6, note: "Maastricht convergence criterion yield.", table: () => ({ columns: ["Month", "%"], rows: pick("bond_yield_10y_pct") }) });
  ctx.view.append(grid(c1, c2, c3, c4, c5, c6));
  timeChart(c1.chartEl, { markZero: true, yFormat: (v) => fmtRate(v, 0), series: [
    { name: "Accommodation services", data: pick("hicp_accommodation_pct"), color: p.series[0] },
    { name: "Restaurants and cafés", data: pick("hicp_restaurants_pct"), color: p.series[1] },
    { name: "All items", data: pick("hicp_all_items_pct"), color: p.context }] });
  rankBars(c2.chartEl, { items: cross.map((r) => ({ label: ctx.geoName(r.geo_code), value: r.latest_hicp_accommodation_pct, code: r.geo_code })),
    format: (v) => fmtRate(v), colorFn: (d, pal) => (d.code === g ? pal.series[1] : pal.series[0]) });
  timeChart(c3.chartEl, { markZero: true, yFormat: (v) => fmtRate(v, 0), series: [{ name: "GDP growth", type: "bar", data: q.map((r) => [r.quarter_start, r.gdp_growth_yoy_pct]) }] });
  timeChart(c4.chartEl, { yFormat: (v) => fmtRate(v, 1), series: [{ name: "Unemployment", data: pick("unemployment_rate_pct") }] });
  timeChart(c5.chartEl, { markZero: true, yFormat: (v) => fmtDec(v, 0), series: [{ name: "Confidence", data: pick("consumer_confidence_balance") }] });
  timeChart(c6.chartEl, { yFormat: (v) => fmtRate(v, 1), series: [{ name: "10y yield", data: pick("bond_yield_10y_pct") }] });
}

// ----------------------------------------------------------------------- rates
export async function rates(ctx) {
  const [fxSnap, ratesSnap, fxMonthly] = await Promise.all([loadTable("fx_daily"), loadTable("rates"), loadTable("fx_monthly")]);
  const currencies = ctx.meta.currencies.map((c) => c.currency_code);
  const names = new Map(ctx.meta.currencies.map((c) => [c.currency_code, c.currency_name]));
  const cur = currencies.includes(ctx.state.ccy) ? ctx.state.ccy : "USD";
  const range = ctx.state.range || "1y";
  ctx.filters.append(
    select("Currency", currencies.map((c) => ({ value: c, label: `EUR/${c} · ${names.get(c)}` })), cur, (v) => ctx.setState({ ccy: v })),
    segmented("Range", [{ value: "3m", label: "3M" }, { value: "1y", label: "1Y" }, { value: "3y", label: "3Y" }, { value: "max", label: "Since 2015" }], range,
      (v) => ctx.setState({ range: v })),
  );
  const status = h("p", { class: "notice" });
  const tilesEl = h("div", { class: "tiles" });
  const p = palette();
  const c1 = card({ title: `EUR/${cur}`, span: 7, note: `Units of ${names.get(cur)} per euro, ECB reference rate (daily) or monthly average.` });
  const c2 = card({ title: "Euro area interest rates", span: 5, note: "ECB deposit facility rate, €STR, Euribor 3-month and the AAA 10-year spot yield.",
    legend: [{ label: "Deposit rate", color: p.series[0] }, { label: "€STR", color: p.series[1] }, { label: "Euribor 3M", color: p.series[2] }, { label: "10-year AAA", color: p.series[3] }] });
  const c3 = card({ title: "Euro reference rates", span: 12, note: "ECB daily reference rates. Click a row to chart it.", csvName: "fx-latest",
    table: () => ({ columns: ["Pair", "Units per euro", "As of"], rows: [] }) });
  c3.el.querySelector(".card-actions").remove();
  ctx.view.append(status, tilesEl, h("div", { style: "height:16px" }), grid(c1, c2, c3));

  const draw = (fx, rt, live) => {
    const lastFx = fx.reduce((m, r) => (r.date > m ? r.date : m), "");
    status.innerHTML = live
      ? `<span class="badge live">live</span> Rates loaded directly from the ECB Data Portal, latest ${lastFx}.`
      : `<span class="badge">snapshot</span> Daily snapshot, latest ${lastFx || "n/a"}. Checking the ECB for newer rates…`;
    tilesEl.replaceChildren();
    const byCur = groupBy(fx, "currency_code");
    const ago = (list, days) => {
      const last = new Date(list.at(-1).date);
      last.setDate(last.getDate() - days);
      const target = last.toISOString().slice(0, 10);
      return list.filter((r) => r.date <= target).at(-1);
    };
    const fxRows = [];
    for (const c of currencies) {
      const list = byCur.get(c);
      if (!list?.length) continue;
      const last = list.at(-1), m1 = ago(list, 30), y1 = ago(list, 365);
      fxRows.push({ currency: `EUR/${c}`, name: names.get(c), date: last.date, rate: last.units_per_eur,
        m1: m1 ? last.units_per_eur / m1.units_per_eur - 1 : null, y1: y1 ? last.units_per_eur / y1.units_per_eur - 1 : null });
    }
    const fxCols = [
      { key: "currency", label: "Pair", text: true }, { key: "name", label: "Currency", text: true },
      { key: "rate", label: "Units per euro", fmt: (v) => fmtDec(v, v > 50 ? 2 : 4) },
      { key: "m1", label: "1 month", fmt: (v) => deltaHTML(v) }, { key: "y1", label: "1 year", fmt: (v) => deltaHTML(v) },
      { key: "date", label: "As of" },
    ];
    c3.body.replaceChildren(dataTable(fxCols, fxRows, { initialSort: { key: "currency", dir: "asc" },
      highlight: (r) => r.currency === `EUR/${cur}`, onRowClick: (r) => ctx.setState({ ccy: r.currency.slice(4) }) }));
    const series = byCur.get(cur) || [];
    const days = { "3m": 92, "1y": 366, "3y": 1100 }[range];
    let fxData;
    if (range === "max") fxData = fxMonthly.filter((r) => r.currency_code === cur).map((r) => [r.month, r.units_per_eur]);
    else {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cut = cutoff.toISOString().slice(0, 10);
      fxData = series.filter((r) => r.date >= cut).map((r) => [r.date, r.units_per_eur]);
    }
    timeChart(c1.chartEl, { yFormat: (v) => fmtDec(v, v > 50 ? 1 : 3), series: [{ name: `EUR/${cur}`, data: fxData }] });
    const ratesByS = groupBy(rt, "series_code");
    const order = ["deposit_rate", "estr", "euribor_3m", "yield_10y"];
    const labels = { deposit_rate: "Deposit rate", estr: "€STR", euribor_3m: "Euribor 3M", yield_10y: "10-year AAA" };
    const since = range === "max" ? "2015-01-01" : new Date(Date.now() - (days || 366) * 864e5).toISOString().slice(0, 10);
    timeChart(c2.chartEl, { xType: "time", yFormat: (v) => fmtRate(v, 2), series: order.map((s, i) => ({
      name: labels[s], color: p.series[i], data: (ratesByS.get(s) || []).filter((r) => r.date >= since).map((r) => [r.date, r.rate_pct]) })) });
    for (const s of order) {
      const list = ratesByS.get(s);
      if (list?.length) tilesEl.append(tile(labels[s], fmtRate(list.at(-1).rate_pct, 2), `as of ${list.at(-1).date}`, live && s !== "euribor_3m" ? { cls: "live", text: "live" } : null));
    }
    for (const r of fxRows.filter((x) => ["EUR/USD", "EUR/GBP", "EUR/CHF"].includes(x.currency))) {
      tilesEl.append(tile(r.currency, fmtDec(r.rate, 4), `1m ${deltaHTML(r.m1)} · 1y ${deltaHTML(r.y1)}`, live ? { cls: "live", text: "live" } : null));
    }
  };

  draw(fxSnap, ratesSnap, false);
  const [lf, lr] = await Promise.allSettled([liveFx(currencies), liveRates()]);
  if (!c1.el.isConnected) return; // the viewer moved on
  const fxOk = lf.status === "fulfilled" && lf.value.length;
  const rtOk = lr.status === "fulfilled" && lr.value.length;
  if (fxOk || rtOk) {
    draw(fxOk ? mergeRows(fxSnap, lf.value, "currency_code") : fxSnap, rtOk ? mergeRows(ratesSnap, lr.value, "series_code") : ratesSnap, true);
  } else {
    status.innerHTML = status.innerHTML.replace("Checking the ECB for newer rates…", "The ECB API was not reachable from this browser.");
  }
}

// ------------------------------------------------------------------- spain
export async function spain(ctx) {
  const rows = await loadTable("spain_zones_monthly");
  const zones = new Map(ctx.meta.zones.map((z) => [z.zone_key, z]));
  const zname = (k) => { const z = zones.get(k); return z ? `${z.zone_name} (${z.region_name})` : k; };
  const byZone = groupBy(rows, "zone_key");
  const keys = [...byZone.keys()].sort((a, b) => zname(a).localeCompare(zname(b)));
  const zone = keys.includes(ctx.state.zone) ? ctx.state.zone : keys.find((k) => /mallorca/i.test(zname(k))) || keys[0];
  ctx.filters.append(select("Tourist zone", keys.map((k) => ({ value: k, label: zname(k) })), zone, (v) => ctx.setState({ zone: v })));
  const latest = rows.reduce((m, r) => (r.month > m ? r.month : m), "");
  const summary = keys.map((k) => {
    const list = byZone.get(k);
    const last = list.at(-1);
    const y = last.month.slice(0, 4);
    const ytd = list.filter((r) => r.month.startsWith(y));
    const avg = (a, f) => (a.length ? a.reduce((s, r) => s + (r[f] || 0), 0) / a.length : null);
    return { zone_key: k, name: zones.get(k)?.zone_name || k, region: zones.get(k)?.region_name || "", month: last.month,
      adr: last.adr_eur, revpar: last.revpar_eur, occ: last.implied_room_occupancy_rate, adr_yoy: last.adr_yoy, revpar_yoy: last.revpar_yoy,
      ytd_adr: avg(ytd, "adr_eur"), provisional: last.is_provisional };
  });
  const cols = [
    { key: "name", label: "Zone", text: true }, { key: "region", label: "Region", text: true },
    { key: "month", label: "Latest", fmt: fmtMonth }, { key: "adr", label: "ADR", fmt: fmtEur },
    { key: "adr_yoy", label: "ADR YoY", fmt: (v) => deltaHTML(v) }, { key: "revpar", label: "RevPAR", fmt: fmtEur },
    { key: "revpar_yoy", label: "RevPAR YoY", fmt: (v) => deltaHTML(v) }, { key: "occ", label: "Occupancy", fmt: (v) => fmtPct(v, 0) },
    { key: "ytd_adr", label: "ADR, avg YTD", fmt: fmtEur },
  ];
  const list = byZone.get(zone) || [];
  const p = palette();
  const c1 = card({ title: `ADR and RevPAR: ${zname(zone)}`, span: 7, height: "tall", note: "Euros per room-night. RevPAR ÷ ADR gives room occupancy.",
    legend: [{ label: "ADR", color: p.series[0] }, { label: "RevPAR", color: p.series[1] }],
    table: () => ({ columns: ["Month", "ADR", "RevPAR", "Occupancy"], rows: list.map((r) => [r.month, r.adr_eur, r.revpar_eur, r.implied_room_occupancy_rate]) }) });
  const allRanked = summary.filter((r) => r.month === latest && isNum(r.adr_yoy)).sort((a, b) => b.adr_yoy - a.adr_yoy);
  const ranked = allRanked.length > 20 ? [...allRanked.slice(0, 12), ...allRanked.slice(-6)] : allRanked;
  const c2 = card({ title: `ADR change on a year earlier, ${fmtMonth(latest)}`, span: 5,
    note: allRanked.length > 20 ? `Top 12 and bottom 6 of ${allRanked.length} zones; all zones in the table below.` : "Zones with data for the latest month." });
  const c3 = card({ title: "Hotel prices by Spanish tourist zone", span: 12, csvName: "spain-zones",
    note: "INE Hotel Sector Profitability Indicators (IRSH). Eurostat publishes no hotel prices, so Spain is the price layer. Latest months are provisional.",
    table: () => ({ columns: cols.map((c) => c.label), rows: summary.map((r) => cols.map((c) => r[c.key])) }) });
  c3.chartEl.replaceWith(dataTable(cols, summary, { initialSort: { key: "adr", dir: "desc" }, highlight: (r) => r.zone_key === zone,
    onRowClick: (r) => ctx.setState({ zone: r.zone_key }) }));
  ctx.view.append(grid(c1, c2, c3));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtEur(v), series: [
    { name: "ADR", data: list.map((r) => [r.month, r.adr_eur]) }, { name: "RevPAR", data: list.map((r) => [r.month, r.revpar_eur]) }] });
  rankBars(c2.chartEl, { items: ranked.map((r) => ({ label: r.name, value: r.adr_yoy, code: r.zone_key })), format: (v) => fmtChange(v),
    colorFn: (d, pal) => (d.code === zone ? pal.series[1] : d.value >= 0 ? pal.div[4] : pal.div[0]) });
}

// ------------------------------------------------------------------------ data
export async function data(ctx) {
  const srcs = ctx.meta.sources;
  const cols = [
    { key: "source_key", label: "Source", text: true },
    { key: "description", label: "Content", text: true },
    { key: "status", label: "Status", fmt: (v) => `<span class="badge ${v}">${v}</span>` },
    { key: "latest_period", label: "Latest period" },
    { key: "source_updated", label: "Publisher update", fmt: (v) => (v ? String(v).slice(0, 10) : "") },
    { key: "fetched_at", label: "Downloaded", fmt: (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "") },
    { key: "url", label: "Request", fmt: (v) => (v && v.startsWith("http") ? `<a href="${v.replace(/"/g, "&quot;")}" rel="noopener">API</a>` : "") },
  ];
  const c1 = card({ title: "Sources and freshness", span: 12,
    note: "Refreshed daily by GitHub Actions. <b>stale</b> means the last download failed and the previous file was kept; <b>missing</b> means nothing has been downloaded yet.",
    table: () => ({ columns: cols.map((c) => c.label), rows: srcs.map((r) => cols.map((c) => r[c.key])) }), csvName: "sources" });
  c1.chartEl.replaceWith(dataTable(cols, srcs, { initialSort: { key: "source_key", dir: "asc" } }));
  const dl = h("div", { class: "card span-12" }, h("h2", {}, "Download the marts"), h("p", { class: "note" }, "Each file is a table from the warehouse's analytics layer, as CSV."),
    h("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px" }, Object.keys(ctx.meta.files).map((name) =>
      h("button", { class: "link-button", type: "button", onclick: async () => {
        const t = await loadJSON(`${name}.json`);
        downloadCSV(`${name}.csv`, t.columns, t.rows);
      } }, `${name}.csv`))));
  const method = h("div", { class: "card span-12 prose", html: `
    <h2>How the numbers are built</h2>
    <h3>Pipeline</h3>
    <p>Python downloads each source untouched (Eurostat JSON-stat, ECB CSV, INE JSON), DuckDB holds the raw tables, and dbt
    models them into a star schema: staging views, conformed dimensions (date, geography, residence, accommodation type,
    source market, airport, currency) and monthly or annual facts, then analytics marts that this site reads.
    Data tests check keys, ranges and that published parts add up to their totals.</p>
    <h3>Definitions</h3>
    <ul>
      <li><b>Nights</b>: nights spent at tourist accommodation (NACE I55.1-I55.3: hotels, holiday and short-stay accommodation, campsites). <b>Hotels</b> are I55.1 only.</li>
      <li><b>Average stay</b>: nights ÷ arrivals for the same month and market.</li>
      <li><b>Hotel occupancy</b>: Eurostat net occupancy of bed-places and bedrooms in hotels.</li>
      <li><b>Peak two-month share</b>: nights in the two busiest months ÷ annual nights; higher means more seasonal.</li>
      <li><b>Platform rentals</b>: nights booked through Airbnb, Booking and Expedia (Tripadvisor until 2024), Eurostat experimental statistics. Platform share = platform ÷ (platform + tourist accommodation nights).</li>
      <li><b>Year to date</b>: months of the latest year up to each market's latest published month, against the same months a year earlier and in ${ctx.meta.baseline_year}.</li>
      <li><b>Source markets</b>: the guest's country of residence; shares exclude domestic guests.</li>
      <li><b>Spain hotel prices</b>: INE IRSH ADR and RevPAR by tourist zone; occupancy = RevPAR ÷ ADR.</li>
    </ul>
    <h3>Live data</h3>
    <p>The warehouse is rebuilt every day from the APIs. On top of that snapshot, the Rates &amp; FX tab and the EU overview call
    the ECB and Eurostat APIs directly from your browser to show anything published since the last build.</p>
    <p class="muted small">Built ${ctx.meta.generated_at}${ctx.meta.geo?.regions_version ? ` · region boundaries ${ctx.meta.geo.regions_version}` : ""}.</p>` });
  ctx.view.append(grid(c1, dl, method));
}
