// One render function per tab. Each receives the shared context and fills
// ctx.filters (one filter row scoping every chart below it) and ctx.view.
import {
  loadTable, loadJSON, groupBy, isNum, h, select, segmented, dataTable, fmtMonth, fmtNum, fmtInt, fmtPct,
  fmtRate, fmtDec, fmtEur, fmtChange, deltaHTML, dateKeyToYm, monthName, downloadCSV,
} from "./util.js";
import { card, timeChart, rankBars, heatmap, choropleth, bubbleMap, palette, empty, columnChart, legendHTML } from "./charts.js";
import { liveFx, liveRates, liveEuNights, mergeRows } from "./live.js";

const MONTH_KEYS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

// --------------------------------------------------------------------- helpers
function grid(...cards) {
  return h("div", { class: "grid" }, cards.map((c) => c.el || c));
}

function tile(label, value, sub, badge) {
  const html = typeof value === "string" && value.startsWith("<");
  return h("div", { class: "tile" },
    h("div", { class: "label", html: `${label}${badge ? ` <span class="badge ${badge.cls}">${badge.text}</span>` : ""}` }),
    html ? h("div", { class: "value", html: value }) : h("div", { class: "value" }, value),
    h("div", { class: "sub", html: sub || "&nbsp;" }));
}

/** +1.2°C / −0.4°C / 0.0°C (no negative zero). */
function signed(v, digits, unit = "") {
  if (!isNum(v)) return "n/a";
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(digits)}${unit}`;
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
/** Country map and year-to-date ranking (Markets tab). Clicking a country opens it in the control center. */
async function marketsMap(ctx, score) {
  const annual = await loadTable("country_annual");
  const g = ctx.state.geo;
  const base = ctx.meta.baseline_year;

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
    title: `Countries: ${m.label}`, span: 7, height: "tall",
    note: m.src === "annual" ? `${annualYear}, nights at tourist accommodation per inhabitant.` : "Latest month each country has published. Click a country to open it in the control center.",
    table: () => ({ columns: ["Country", m.label], rows: mapData.map((d) => [ctx.geoName(d.code), d.value]) }),
  });

  const movers = score.filter((r) => ctx.isCountry(r.geo_code) && r.is_current && isNum(r.nights_ytd_yoy));
  const stale = score.filter((r) => ctx.isCountry(r.geo_code) && !r.is_current).map((r) => `${ctx.geoName(r.geo_code)} (to ${fmtMonth(dateKeyToYm(r.nights_date_key))})`);
  const moversCard = card({ title: "Year-to-date growth by country", span: 5,
    note: `Nights year to date versus the same months last year. Click a bar to open the country.${stale.length ? ` Not shown, no recent data: ${stale.join(", ")}.` : ""}` });

  const out = grid(mapCard, moversCard);
  ctx.filters.append(segmented("Map metric", Object.entries(metrics).map(([value, x]) => ({ value, label: x.label })), metric,
    (v) => ctx.setState({ ovMetric: v })));

  return { el: out, draw: async () => {
  choropleth(mapCard.chartEl, {
    name: "countries", geojson: await geo(ctx, "countries"), data: mapData, scale: m.scale, format: m.fmt,
    selected: g, labelFor: ctx.geoName, onClick: (code) => ctx.isCountry(code) && ctx.setState({ geo: code, tab: "center" }),
  });
  rankBars(moversCard.chartEl, {
    items: movers.sort((a, b) => b.nights_ytd_yoy - a.nights_ytd_yoy).map((r) => ({ label: ctx.geoName(r.geo_code), value: r.nights_ytd_yoy, code: r.geo_code })),
    format: (v) => fmtChange(v),
    colorFn: (d, pal) => (d.code === g ? pal.series[1] : d.value >= 0 ? pal.div[4] : pal.div[0]),
    onClick: (d) => ctx.setState({ geo: d.code, tab: "center" }),
  });
  } };
}

// --------------------------------------------------------------------- markets
export async function markets(ctx) {
  const score = await loadTable("scorecard");
  const map = await marketsMap(ctx, score);
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
    note: "Each country's latest published month. YTD compares the same months of the previous year. Avg stay = nights per arrival. Click a row to open the country in the control center.",
    table: () => ({ columns: cols.map((x) => x.label), rows: rows.map((r) => cols.map((x) => r[x.key])) }), csvName: "market-scorecard" });
  c.chartEl.replaceWith(dataTable(cols, rows, {
    initialSort: { key: "latest_nights", dir: "desc" }, highlight: (r) => r.geo_code === ctx.state.geo,
    onRowClick: (r) => ctx.setState({ geo: r.geo_code, tab: "center" }),
  }));
  ctx.view.append(h("p", { class: "view-intro" }, "Every European market Eurostat covers, side by side. Click a country on the map, the ranking or the table to open its full breakdown in the control center."),
    map.el, h("div", { style: "height:16px" }), grid(c));
  await map.draw();
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
  const [monthly, airportsMonthly, summary] = await Promise.all([
    loadTable("country_monthly"), loadTable("airports_monthly"), loadTable("airport_summary")]);
  const g = ctx.state.geo;
  const inScope = (a) => (ctx.isCountry(g) ? a.country_code === g : true);
  const scoped = summary.filter(inScope);
  const airport = summary.find((a) => a.airport_code === ctx.state.airport && inScope(a)) ? ctx.state.airport : "";
  const label = (a) => `${a.city && a.iata_code ? `${a.city} (${a.iata_code})` : a.airport_name}${ctx.isCountry(g) ? "" : `, ${a.country_name}`}`;
  ctx.filters.append(
    geoSelect(ctx),
    select("Airport", [{ value: "", label: ctx.isCountry(g) ? `All airports in ${ctx.geoName(g)}` : "All airports" },
      ...scoped.map((a) => ({ value: a.airport_code, label: label(a) }))], airport,
    (v) => ctx.setState({ airport: v || null })),
  );
  if (airport) return airportView(ctx, summary.find((a) => a.airport_code === airport), airportsMonthly);

  const rows = monthly.filter((r) => r.geo_code === g && isNum(r.air_passengers));
  const p = palette();
  const c1 = card({ title: "Air passengers", span: 7, note: "Passengers carried (arrivals plus departures), all flights and international flights.",
    legend: [{ label: "All flights", color: p.series[0] }, { label: "International", color: p.series[1] }],
    table: () => ({ columns: ["Month", "Passengers", "International", "YoY"], rows: rows.map((r) => [r.month, r.air_passengers, r.air_passengers_international, r.air_passengers_yoy]) }) });
  const recent = rows.slice(-36);
  const c2 = card({ title: "Passengers: change on a year earlier", span: 5, table: () => ({ columns: ["Month", "YoY"], rows: recent.map((r) => [r.month, r.air_passengers_yoy]) }) });
  const mapped = scoped.filter((a) => isNum(a.latitude) && isNum(a.passengers_12m));
  const c3 = card({ title: "Main airports, trailing twelve months", span: 7, height: "map",
    note: "Bubble area is proportional to passengers in the twelve months to each airport's latest month. Map shows the airports with coordinates; the table lists every airport with 100k+ passengers.",
    table: () => ({ columns: ["Airport", "Country", "Trailing 12m", "12m YoY"], rows: mapped.map((r) => [label(r), r.country_name, r.passengers_12m, r.passengers_12m_yoy]) }) });
  const base = ctx.meta.baseline_year;
  const cols = [
    { key: "name", label: "Airport", text: true }, { key: "country_name", label: "Country", text: true },
    { key: "last_month", label: "Latest", fmt: fmtMonth }, { key: "passengers_last_month", label: "Passengers", fmt: (v) => fmtNum(v) },
    { key: "last_month_yoy", label: "YoY", fmt: (v) => deltaHTML(v) }, { key: "passengers_12m", label: "Trailing 12m", fmt: (v) => fmtNum(v) },
    { key: "passengers_12m_yoy", label: "12m YoY", fmt: (v) => deltaHTML(v) },
    { key: "passengers_12m_vs_baseline", label: `vs ${base}`, fmt: (v) => deltaHTML(v) },
  ];
  const tableRows = scoped.map((a) => ({ ...a, name: label(a) }));
  const c4 = card({ title: `Airports (${tableRows.length})`, span: 5, csvName: "airports", note: "Click an airport for its traffic and routes.",
    table: () => ({ columns: cols.map((c) => c.label), rows: tableRows.map((r) => cols.map((c) => r[c.key])) }) });
  c4.chartEl.replaceWith(dataTable(cols, tableRows, { initialSort: { key: "passengers_12m", dir: "desc" },
    onRowClick: (r) => ctx.setState({ airport: r.airport_code }) }));
  ctx.view.append(grid(c1, c2, c3, c4));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtNum(v, 0), series: [
    { name: "All flights", data: rows.map((r) => [r.month, r.air_passengers]) },
    { name: "International", data: rows.map((r) => [r.month, r.air_passengers_international]) }] });
  timeChart(c2.chartEl, { markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }), series: [{ name: "YoY", type: "bar", data: recent.map((r) => [r.month, r.air_passengers_yoy]) }] });
  bubbleMap(c3.chartEl, { geojson: await geo(ctx, "countries"), points: mapped.map((r) => ({ name: label(r), lon: r.longitude, lat: r.latitude, value: r.passengers_12m })), format: (v) => fmtNum(v) });
}

async function airportView(ctx, a, airportsMonthly) {
  const [origins, routes] = await Promise.all([loadTable("airport_origins"), loadTable("airport_routes")]);
  const p = palette();
  const base = ctx.meta.baseline_year;
  const name = a.city && a.iata_code ? `${a.city} (${a.iata_code})` : a.airport_name;
  const series = airportsMonthly.filter((r) => r.airport_code === a.airport_code);
  const idx = new Map(series.map((r) => [r.month, r.passengers]));
  const withYoy = series.map((r) => {
    const prev = idx.get(`${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`);
    return { ...r, yoy: isNum(prev) && prev ? r.passengers / prev - 1 : null };
  });
  const lastYear = series.length ? Number(series.at(-1).month.slice(0, 4)) : null;
  const tiles = h("div", { class: "tiles" },
    tile(`Passengers, ${fmtMonth(a.last_month)}`, fmtNum(a.passengers_last_month), `${deltaHTML(a.last_month_yoy)} vs a year earlier`),
    tile("Trailing twelve months", fmtNum(a.passengers_12m), `${deltaHTML(a.passengers_12m_yoy)} vs prior 12 months`),
    tile(`Versus ${base}`, deltaHTML(a.passengers_12m_vs_baseline), `trailing 12 months vs calendar ${base}`),
    tile("Routes reported", isNum(a.route_count) ? fmtInt(a.route_count) : "n/a", "partner airports in Eurostat route data"),
  );
  const c1 = card({ title: `Monthly passengers: ${name}`, span: 7, note: "Passengers carried (arrivals plus departures), Eurostat avia_paoa.",
    legend: [{ label: String(lastYear), color: p.series[0] }, { label: String(lastYear - 1), color: p.series[1] }, { label: String(base), color: p.context }],
    table: () => ({ columns: ["Month", "Passengers", "YoY"], rows: withYoy.map((r) => [r.month, r.passengers, r.yoy]) }) });
  const recent = withYoy.slice(-36);
  const c2 = card({ title: "Change on a year earlier", span: 5, table: () => ({ columns: ["Month", "YoY"], rows: recent.map((r) => [r.month, r.yoy]) }) });

  const og = origins.filter((r) => r.airport_code === a.airport_code);
  const years = [...new Set(og.map((r) => r.year))].sort((x, y) => y - x);
  const ry = years[0];
  const latestOrigins = og.filter((r) => r.year === ry).slice(0, 15);
  const routeNote = ry ? `Eurostat route data (airport pairs), full year ${ry}, the latest year Eurostat has published for this airport. Passengers flying between ${name} and each country, both directions.`
    : "Eurostat has not published route data for this airport.";
  const c3 = card({ title: `Where passengers fly from: countries, ${ry ?? "n/a"}`, span: 6, note: routeNote,
    table: () => ({ columns: ["Country", "Passengers", "Share", "YoY"], rows: og.filter((r) => r.year === ry).map((r) => [r.partner_country_name, r.passengers, r.share_of_airport, r.passengers_yoy]) }) });
  const c4 = card({ title: `Growth by origin country, ${ry ? `${ry} vs ${ry - 1}` : "n/a"}`, span: 6, note: "Top 15 origin countries by passengers." });
  const rt = routes.filter((r) => r.airport_code === a.airport_code && r.year === ry);
  const rcols = [
    { key: "route_rank", label: "#" }, { key: "partner_airport_name", label: "Airport", text: true },
    { key: "partner_country_name", label: "Country", text: true }, { key: "passengers", label: "Passengers", fmt: (v) => fmtNum(v) },
    { key: "passengers_yoy", label: "YoY", fmt: (v) => deltaHTML(v) },
  ];
  const c5 = card({ title: `Top routes, ${ry ?? "n/a"}`, span: 12, csvName: `routes-${a.airport_code}`,
    table: () => ({ columns: rcols.map((c) => c.label), rows: rt.map((r) => rcols.map((c) => r[c.key])) }) });
  if (rt.length) c5.chartEl.replaceWith(dataTable(rcols, rt, { initialSort: { key: "passengers", dir: "desc" } }));
  else empty(c5.chartEl, "No route data for this airport.");

  ctx.view.append(tiles, h("div", { style: "height:16px" }), grid(c1, c2, c3, c4, c5));
  const yearSeries = (y, color, width) => ({ name: String(y), color, width,
    data: series.filter((r) => r.month.startsWith(String(y))).map((r) => [r.month.slice(5), r.passengers]) });
  timeChart(c1.chartEl, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: (v) => fmtNum(v, 0),
    series: [yearSeries(lastYear, p.series[0], 2.5), yearSeries(lastYear - 1, p.series[1]), yearSeries(base, p.context)] });
  timeChart(c2.chartEl, { markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }), series: [{ name: "YoY", type: "bar", data: recent.map((r) => [r.month, r.yoy]) }] });
  rankBars(c3.chartEl, { items: latestOrigins.map((r) => ({ label: r.partner_country_name, value: r.share_of_airport })), format: (v) => fmtPct(v, 1) });
  rankBars(c4.chartEl, { items: latestOrigins.filter((r) => isNum(r.passengers_yoy)).map((r) => ({ label: r.partner_country_name, value: r.passengers_yoy })),
    format: (v) => fmtChange(v), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) });
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
  const pc = ctx.state.pc === "PT" ? "PT" : "ES";
  ctx.filters.append(segmented("Country", [{ value: "ES", label: "Spain: ADR & RevPAR" }, { value: "PT", label: "Portugal: revenue per night" }],
    pc, (v) => ctx.setState({ pc: v })));
  if (pc === "PT") return portugal(ctx);
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

async function portugal(ctx) {
  const rows = await loadTable("portugal_prices_monthly");
  const types = { T: "All tourist accommodation", "01": "Hotels and similar", "0101": "Hotels" };
  const type = types[ctx.state.ptype] ? ctx.state.ptype : "01";
  const regions = [...new Map(rows.map((r) => [r.region_code, r.region_name])).entries()]
    .sort((a, b) => (a[0] === "PT" ? -1 : b[0] === "PT" ? 1 : a[1].localeCompare(b[1])));
  const region = regions.some(([c]) => c === ctx.state.pregion) ? ctx.state.pregion : "PT";
  ctx.filters.append(
    select("Region", regions.map(([value, label]) => ({ value, label })), region, (v) => ctx.setState({ pregion: v })),
    segmented("Type", Object.entries(types).map(([value, label]) => ({ value, label })), type, (v) => ctx.setState({ ptype: v })),
  );
  const t = rows.filter((r) => r.accommodation_type_code === type);
  const series = t.filter((r) => r.region_code === region);
  const latest = t.reduce((m, r) => (isNum(r.revenue_per_night_eur) && r.month > m ? r.month : m), "");
  const latestRows = t.filter((r) => r.month === latest && r.region_code !== "PT").map((r) => ({ ...r }));
  const p = palette();
  const c1 = card({ title: `Revenue per guest night: ${regions.find(([c]) => c === region)?.[1]}`, span: 7, height: "tall",
    note: `${types[type]}. Lodging income ÷ nights, euros. Statistics Portugal publishes no RevPAR or ADR series; this is a per-guest price proxy, so it is not comparable with Spain's per-room ADR.`,
    legend: [{ label: "Revenue per night", color: p.series[0] }],
    table: () => ({ columns: ["Month", "Revenue per night", "YoY", "Nights", "Lodging income"],
      rows: series.map((r) => [r.month, r.revenue_per_night_eur, r.revenue_per_night_yoy, r.nights, r.lodging_income_eur]) }) });
  const c2 = card({ title: `Change on a year earlier, ${fmtMonth(latest)}`, span: 5, note: "Revenue per guest night by region." });
  const cols = [
    { key: "region_name", label: "Region", text: true }, { key: "month", label: "Month", fmt: fmtMonth },
    { key: "revenue_per_night_eur", label: "Revenue / night", fmt: fmtEur },
    { key: "revenue_per_night_yoy", label: "YoY", fmt: (v) => deltaHTML(v) },
    { key: "nights", label: "Nights", fmt: (v) => fmtNum(v) }, { key: "nights_yoy", label: "Nights YoY", fmt: (v) => deltaHTML(v) },
  ];
  const c3 = card({ title: `Portuguese regions, ${fmtMonth(latest)}`, span: 12, csvName: "portugal-regions",
    note: "Statistics Portugal indicators 0012091 (lodging income) and 0012092 (nights), NUTS 2024 regions. Recent months are provisional.",
    table: () => ({ columns: cols.map((c) => c.label), rows: latestRows.map((r) => cols.map((c) => r[c.key])) }) });
  c3.chartEl.replaceWith(dataTable(cols, latestRows, { initialSort: { key: "revenue_per_night_eur", dir: "desc" },
    highlight: (r) => r.region_code === region, onRowClick: (r) => ctx.setState({ pregion: r.region_code }) }));
  ctx.view.append(grid(c1, c2, c3));
  timeChart(c1.chartEl, { zoom: true, yFormat: (v) => fmtEur(v), series: [{ name: "Revenue per night", data: series.map((r) => [r.month, r.revenue_per_night_eur]) }] });
  rankBars(c2.chartEl, { items: latestRows.filter((r) => isNum(r.revenue_per_night_yoy)).sort((a, b) => b.revenue_per_night_yoy - a.revenue_per_night_yoy)
    .map((r) => ({ label: r.region_name, value: r.revenue_per_night_yoy, code: r.region_code })), format: (v) => fmtChange(v),
    colorFn: (d, pal) => (d.code === region ? pal.series[1] : d.value >= 0 ? pal.div[4] : pal.div[0]) });
}

/** Demand-health table of a destination's top source markets (Market demand tab and control center). */
function healthCard(ctx, { dest, market, score, sourceMarkets, fxMonthly, smYear, top, onRowClick, span = 12 }) {
  const marketName = (c) => score.find((m) => m.market_code === c)?.market_name || ctx.geoName(c);
  // FX: change in the market's currency against the euro over 12 months (positive = euro stronger, travel to the euro area dearer).
  const fx12 = (cur) => {
    const l = fxMonthly.filter((r) => r.currency_code === cur);
    if (l.length < 13) return null;
    return l.at(-1).units_per_eur / l.at(-13).units_per_eur - 1;
  };
  const rows = top.map((r) => {
    const s = score.find((m) => m.market_code === r.partner_code) || {};
    return { code: r.partner_code, name: marketName(r.partner_code), share: r.share_of_foreign_nights, nights_yoy: r.nights_yoy, ...s,
      fx_12m: s.currency_code && s.currency_code !== "EUR" ? fx12(s.currency_code) : null };
  });
  const arrow = (v) => {
    if (!isNum(v)) return "n/a";
    const r = Number(v.toFixed(1));
    const dir = r > 0 ? "up" : r < 0 ? "down" : "flat";
    return `<span class="delta ${dir}">${{ up: "▲", down: "▼", flat: "■" }[dir]} ${signed(r, 1)}</span>`;
  };
  const cols = [
    { key: "name", label: "Market", text: true },
    { key: "share", label: `Share ${smYear}`, fmt: (v) => fmtPct(v, 1) },
    { key: "nights_yoy", label: "Nights YoY", fmt: (v) => deltaHTML(v) },
    { key: "oecd_cli", label: "Leading ind.", fmt: (v) => fmtDec(v, 1) },
    { key: "oecd_cli_change_3m", label: "LI 3m Δ", fmt: (v) => arrow(v) },
    { key: "oecd_consumer_confidence_change_yoy", label: "Confidence Δ 1y", fmt: (v) => arrow(v) },
    { key: "retail_volume_yoy", label: "Retail YoY", fmt: (v) => deltaHTML(v) },
    { key: "unemployment_rate_pct", label: "Unemp.", fmt: (v) => fmtRate(v) },
    { key: "house_prices_yoy_pct", label: "House prices", fmt: (v) => (isNum(v) ? deltaHTML(v / 100) : "n/a") },
    { key: "trips_abroad_yoy", label: "Trips abroad YoY", fmt: (v) => deltaHTML(v) },
    { key: "spend_abroad_yoy", label: "Spend abroad YoY", fmt: (v) => deltaHTML(v) },
    { key: "fx_12m", label: "€ vs currency 1y", fmt: (v) => deltaHTML(v, { invert: true }) },
  ];
  const c0 = card({ title: `Demand health of ${ctx.geoName(dest)}'s top source markets`, span, csvName: `market-health-${dest}`,
    note: "Ranked by share of foreign nights. Leading indicator and consumer confidence: OECD, long-term average = 100, Δ in points. Retail volume, house prices, unemployment, trips and spending abroad: Eurostat (European markets only). € vs currency: a stronger euro (red) makes the destination dearer for that market. Click a row for its trends.",
    table: () => ({ columns: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => r[c.key])) }) });
  c0.chartEl.replaceWith(dataTable(cols, rows, { initialSort: { key: "share", dir: "desc" }, highlight: (r) => r.code === market,
    onRowClick }));
  return c0;
}

// -------------------------------------------------------------- market demand
export async function demand(ctx) {
  const [score, monthly, hpi, travel, sourceMarkets, fxMonthly] = await Promise.all([
    loadTable("market_scorecard"), loadTable("market_demand_monthly"), loadTable("house_prices_quarterly"),
    loadTable("resident_travel_annual"), loadTable("source_markets"), loadTable("fx_monthly")]);
  const marketName = (c) => score.find((m) => m.market_code === c)?.market_name || ctx.geoName(c);
  const dests = [...new Set(sourceMarkets.map((r) => r.geo_code))];
  const dest = dests.includes(ctx.state.geo) ? ctx.state.geo : dests.includes("ES") ? "ES" : dests[0];
  const smYear = Math.max(...sourceMarkets.filter((r) => r.geo_code === dest).map((r) => r.year));
  const top = sourceMarkets.filter((r) => r.geo_code === dest && r.year === smYear).sort((a, b) => b.nights - a.nights).slice(0, 15);
  const markets = score.map((m) => m.market_code);
  const market = markets.includes(ctx.state.market) ? ctx.state.market : top.find((r) => markets.includes(r.partner_code))?.partner_code || "DE";
  ctx.filters.append(
    select("Destination", dests.map((c) => ({ value: c, label: ctx.geoName(c) })).sort((a, b) => a.label.localeCompare(b.label)), dest, (v) => ctx.setState({ geo: v })),
    select("Source market", score.map((m) => ({ value: m.market_code, label: m.market_name })).sort((a, b) => a.label.localeCompare(b.label)),
      market, (v) => ctx.setState({ market: v })),
  );
  const c0 = healthCard(ctx, { dest, market, score, sourceMarkets, fxMonthly, smYear, top,
    onRowClick: (r) => ctx.setState({ market: r.code }) });

  const m = monthly.filter((r) => r.market_code === market);
  const p = palette();
  const c1 = card({ title: `${marketName(market)}: leading indicator and consumer confidence`, span: 6,
    note: "OECD, amplitude adjusted, long-term average = 100. Below 100 and falling signals weaker demand ahead.",
    legend: [{ label: "Leading indicator", color: p.series[0] }, { label: "Consumer confidence", color: p.series[1] }],
    table: () => ({ columns: ["Month", "Leading indicator", "Consumer confidence"], rows: m.map((r) => [r.month, r.oecd_cli, r.oecd_consumer_confidence]) }) });
  const c2 = card({ title: `${marketName(market)}: retail sales volume`, span: 6, note: "Change on a year earlier, seasonally and calendar adjusted (Eurostat).",
    table: () => ({ columns: ["Month", "Retail volume YoY"], rows: m.map((r) => [r.month, r.retail_volume_yoy]) }) });
  const hp = hpi.filter((r) => r.market_code === market);
  const c3 = card({ title: `${marketName(market)}: house prices`, span: 6, note: "Annual rate of change, all dwellings (Eurostat). A wealth signal for discretionary travel.",
    table: () => ({ columns: ["Quarter", "House prices YoY %"], rows: hp.map((r) => [r.quarter_start, r.house_prices_yoy_pct]) }) });
  const tr = travel.filter((r) => r.market_code === market && isNum(r.trips_abroad));
  const c4 = card({ title: `${marketName(market)}: trips abroad by residents`, span: 6, note: "Trips of one night or more, all purposes (Eurostat, annual).",
    table: () => ({ columns: ["Year", "Trips abroad", "Trips at home", "Spend abroad €", "Spend per night abroad €"],
      rows: tr.map((r) => [r.year, r.trips_abroad, r.trips_domestic, r.spend_abroad_eur, r.spend_per_night_abroad_eur]) }) });
  ctx.view.append(grid(c0, c1, c2, c3, c4));
  timeChart(c1.chartEl, { emptyMessage: `The OECD does not publish these indicators for ${marketName(market)}.`, yFormat: (v) => fmtDec(v, 1), series: [
    { name: "Leading indicator", data: m.map((r) => [r.month, r.oecd_cli]) },
    { name: "Consumer confidence", data: m.map((r) => [r.month, r.oecd_consumer_confidence]) }] });
  timeChart(c2.chartEl, { emptyMessage: `Eurostat publishes this for European countries only; no series for ${marketName(market)}.`, markZero: true, yFormat: (v) => fmtChange(v, { digits: 0 }), series: [{ name: "Retail YoY", type: "bar", data: m.map((r) => [r.month, r.retail_volume_yoy]) }] });
  timeChart(c3.chartEl, { emptyMessage: `Eurostat publishes this for European countries only; no series for ${marketName(market)}.`, markZero: true, yFormat: (v) => fmtRate(v, 0), series: [{ name: "House prices", type: "bar", data: hp.map((r) => [r.quarter_start, r.house_prices_yoy_pct]) }] });
  timeChart(c4.chartEl, { emptyMessage: `Eurostat publishes this for European countries only; no series for ${marketName(market)}.`, yFormat: (v) => fmtNum(v, 0), series: [{ name: "Trips abroad", type: "bar", data: tr.map((r) => [String(r.year), r.trips_abroad]) }] });
}

// --------------------------------------------------------------------- weather
export async function weather(ctx) {
  const rows = await loadTable("weather_monthly");
  const locs = ctx.meta.weather_locations;
  const withData = new Set(rows.map((r) => r.location_code));
  const avail = locs.filter((l) => withData.has(l.location_code));
  if (!avail.length) {
    ctx.view.append(h("div", { class: "empty" }, "Weather history is still being backfilled from Open-Meteo; it appears after the next daily refresh."));
    return;
  }
  const loc = avail.some((l) => l.location_code === ctx.state.loc) ? ctx.state.loc : (avail.find((l) => l.location_code === "PMI") || avail[0]).location_code;
  const lname = (c) => { const l = locs.find((x) => x.location_code === c); return l ? `${l.location_name}` : c; };
  ctx.filters.append(select("Destination", avail.map((l) => ({ value: l.location_code, label: `${l.location_name} (${ctx.geoName(l.country_code)})` })), loc,
    (v) => ctx.setState({ loc: v })));
  const series = rows.filter((r) => r.location_code === loc);
  const last = series.at(-1);
  const year = Number(last.month.slice(0, 4));
  const normalYears = Math.max(...series.map((r) => r.normal_years || 0));
  const p = palette();
  const tiles = h("div", { class: "tiles" },
    tile(`Average high, ${fmtMonth(last.month)}`, isNum(last.avg_max_temp_c) ? `${last.avg_max_temp_c.toFixed(1)}°C` : "n/a",
      isNum(last.temp_anomaly_c) ? `${signed(last.temp_anomaly_c, 1, "°C")} vs normal` : "normal not yet available"),
    tile("Sunshine", isNum(last.sunshine_hours) ? `${Math.round(last.sunshine_hours)} h` : "n/a",
      isNum(last.sunshine_anomaly_hours) ? `${signed(last.sunshine_anomaly_hours, 0, " h")} vs normal` : "&nbsp;"),
    tile("Rainfall", isNum(last.precipitation_mm) ? `${Math.round(last.precipitation_mm)} mm` : "n/a",
      isNum(last.precipitation_vs_normal) ? `${Math.round(last.precipitation_vs_normal * 100)}% of normal · ${last.rainy_days} rainy days` : "&nbsp;"),
  );
  const yearData = (y, key) => series.filter((r) => r.month.startsWith(String(y))).map((r) => [r.month.slice(5), r[key]]);
  const normalData = (key) => MONTH_KEYS.map((m) => [m, series.find((r) => r.month.slice(5) === m && isNum(r[key]))?.[key] ?? null]);
  const legend = [{ label: String(year), color: p.series[0] }, { label: String(year - 1), color: p.series[1] }, { label: `Normal (${normalYears} yrs)`, color: p.context }];
  const mk = (title, key, normKey, note) => card({ title: `${title}: ${lname(loc)}`, span: 4, note, legend,
    table: () => ({ columns: ["Month", String(year), String(year - 1), "Normal"],
      rows: MONTH_KEYS.map((m) => [monthName(+m), yearData(year, key).find((d) => d[0] === m)?.[1] ?? null,
        yearData(year - 1, key).find((d) => d[0] === m)?.[1] ?? null, normalData(normKey).find((d) => d[0] === m)?.[1] ?? null]) }) });
  const c1 = mk("Average daily high", "avg_max_temp_c", "normal_max_temp_c", "Monthly mean of daily maximum temperature, °C (ERA5 reanalysis via Open-Meteo).");
  const c2 = mk("Sunshine hours", "sunshine_hours", "normal_sunshine_hours", "Total hours of sunshine per month.");
  const c3 = mk("Rainfall", "precipitation_mm", "normal_precipitation_mm", "Total precipitation per month, mm.");
  const latestMonth = rows.reduce((m, r) => (r.month > m ? r.month : m), "");
  const prevMonth = (() => { const d = new Date(`${latestMonth}-01`); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const tableMonth = rows.filter((r) => r.month === latestMonth).length >= avail.length / 2 ? latestMonth : prevMonth;
  const all = rows.filter((r) => r.month === tableMonth).map((r) => ({ ...r, name: lname(r.location_code),
    country: ctx.geoName(locs.find((l) => l.location_code === r.location_code)?.country_code) }));
  const cols = [
    { key: "name", label: "Destination", text: true }, { key: "country", label: "Country", text: true },
    { key: "avg_max_temp_c", label: "Avg high °C", fmt: (v) => fmtDec(v, 1) },
    { key: "temp_anomaly_c", label: "vs normal", fmt: (v) => signed(v, 1, "°C") },
    { key: "sunshine_hours", label: "Sunshine h", fmt: (v) => fmtDec(v, 0) },
    { key: "sunshine_anomaly_hours", label: "vs normal", fmt: (v) => signed(v, 0, " h") },
    { key: "precipitation_mm", label: "Rain mm", fmt: (v) => fmtDec(v, 0) },
    { key: "precipitation_vs_normal", label: "% of normal", fmt: (v) => fmtPct(v, 0) },
    { key: "rainy_days", label: "Rainy days", fmt: (v) => v ?? "n/a" },
  ];
  const c4 = card({ title: `All destinations, ${fmtMonth(tableMonth)}`, span: 12, csvName: `weather-${tableMonth}`,
    note: "Normal = average of the same month over every complete year downloaded since 2016 (history backfills over the first daily runs).",
    table: () => ({ columns: cols.map((c) => c.label), rows: all.map((r) => cols.map((c) => r[c.key])) }) });
  c4.chartEl.replaceWith(dataTable(cols, all, { initialSort: { key: "avg_max_temp_c", dir: "desc" }, highlight: (r) => r.location_code === loc,
    onRowClick: (r) => ctx.setState({ loc: r.location_code }) }));
  ctx.view.append(tiles, h("div", { style: "height:16px" }), grid(c1, c2, c3, c4));
  for (const [c, key, normKey, fmt] of [[c1, "avg_max_temp_c", "normal_max_temp_c", (v) => `${v.toFixed(0)}°`],
    [c2, "sunshine_hours", "normal_sunshine_hours", (v) => `${v.toFixed(0)} h`], [c3, "precipitation_mm", "normal_precipitation_mm", (v) => `${v.toFixed(0)} mm`]]) {
    timeChart(c.chartEl, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: fmt, series: [
      { name: String(year), data: yearData(year, key), color: p.series[0], width: 2.5 },
      { name: String(year - 1), data: yearData(year - 1, key), color: p.series[1] },
      { name: "Normal", data: normalData(normKey), color: p.context }] });
  }
}

// -------------------------------------------------------------- control center
const QUICK_PICKS = ["EU27_2020", "ES", "IT", "FR", "DE", "EL", "PT", "HR", "AT", "NL", "CY", "MT"];

const SECTIONS = [
  ["demand", "Demand"], ["stay", "Occupancy & stay"], ["season", "Seasonality"], ["regions", "Regions"],
  ["origins", "Source markets"], ["rentals", "Short-stay rentals"], ["air", "Air traffic"], ["prices", "Prices"],
  ["macro", "Macro"], ["health", "Source-market health"], ["weather", "Weather"], ["hotels", "Hotel prices"], ["fx", "FX & rates"],
];

/** Formats for the annual "change" of each metric kind. */
const CHANGE_FMT = {
  sum: (v) => fmtChange(v),
  index: (v) => fmtChange(v),
  rate01: (v) => signed(v * 100, 1, " pts"),
  pct: (v) => signed(v, 1, " pts"),
  level: (v) => signed(v, Math.abs(v) < 1 ? 2 : 1),
};

function section(id, title, note, ...children) {
  return h("section", { class: "cc-section", id: `cc-${id}` },
    h("div", { class: "cc-section-head" }, h("h2", {}, title), note ? h("p", { class: "note", html: note }) : null),
    h("div", { class: "grid" }, children.flat().map((c) => c.el || c)));
}

function exploreLink(ctx, tab, label, patch = {}) {
  return h("button", { class: "link-button", type: "button", onclick: () => ctx.setState({ tab, ...patch }) }, `${label} →`);
}

/** Pace view: one line per year by calendar month (latest, two before, baseline). */
function paceChart(el, rows, key, { fmt, base, emptyMessage }) {
  const withData = rows.filter((r) => isNum(r[key]));
  if (!withData.length) return empty(el, emptyMessage);
  const p = palette();
  const last = Number(withData.at(-1).month.slice(0, 4));
  const years = [last, last - 1, last - 2].filter((y) => y !== base);
  const colors = [p.series[0], p.series[1], p.series[2]];
  const series = years.map((y, i) => ({ name: String(y), color: colors[i], width: i === 0 ? 2.5 : 2,
    data: withData.filter((r) => r.month.startsWith(String(y))).map((r) => [r.month.slice(5), r[key]]) }));
  if (base) series.push({ name: String(base), color: p.context, data: withData.filter((r) => r.month.startsWith(String(base))).map((r) => [r.month.slice(5), r[key]]) });
  return { series: series.filter((s) => s.data.length), chart: timeChart(el, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: fmt, series: series.filter((s) => s.data.length) }) };
}

/**
 * One metric in the current view mode: pace (calendar months, this year vs prior years)
 * or annual history (change on the previous year, latest year to date).
 */
function metricCard(ctx, { title, note, rows, hist, key, metric, fmt, span = 4, emptyMessage, polarity = "up" }) {
  const mode = ctx.state.view === "annual" ? "annual" : "pace";
  const base = ctx.meta.baseline_year;
  const h_ = hist.filter((r) => r.metric === (metric || key)).sort((a, b) => a.year - b.year);
  const kind = h_[0]?.kind || "sum";
  const changeFmt = CHANGE_FMT[kind];
  if (mode === "annual") {
    const items = h_.filter((r) => isNum(r.change)).map((r) => ({
      label: r.is_ytd ? `${r.year} YTD` : String(r.year), value: kind === "rate01" ? r.change : r.change, muted: r.is_ytd, raw: r }));
    const ytd = h_.find((r) => r.is_ytd);
    const c = card({ title, span,
      note: `${kind === "sum" || kind === "index" ? "Change on the previous year" : "Change in the annual average"}${ytd ? `; ${ytd.year} compares ${ytd.months} months with the same months of ${ytd.year - 1}` : ""}.${note ? ` ${note}` : ""}`,
      table: () => ({ columns: ["Year", "Months", kind === "sum" ? "Total" : "Average", "Change"],
        rows: h_.map((r) => [r.is_ytd ? `${r.year} YTD` : r.year, r.months, r.value, r.change]) }) });
    return { card: c, draw: () => columnChart(c.chartEl, { items, emptyMessage,
      format: kind === "rate01" ? (v) => signed(v * 100, 1, "") : kind === "sum" || kind === "index" ? (v) => fmtChange(v, { digits: 0 })
        : (v) => signed(v, Math.abs(v) < 1 ? 2 : 1),
      // polarity: "up" = rise is good (blue), "down" = fall is good, "neutral" = direction carries no judgement.
      colorFn: (d, pal) => (polarity === "neutral" ? pal.series[0]
        : (d.value >= 0) === (polarity === "up") ? pal.div[4] : pal.div[0]) }) };
  }
  const p = palette();
  const latest = rows.filter((r) => isNum(r[key])).at(-1);
  const last = latest ? Number(latest.month.slice(0, 4)) : null;
  const legendYears = last ? [last, last - 1, last - 2].filter((y) => y !== base) : [];
  const legend = [...legendYears.map((y, i) => ({ label: String(y), color: [p.series[0], p.series[1], p.series[2]][i] })), { label: String(base), color: p.context }];
  const c = card({ title, span, legend: latest ? legend : null,
    note: `${latest ? `Latest ${fmtMonth(latest.month)}: <b>${fmt(latest[key])}</b>. ` : ""}${note || ""}`,
    table: () => ({ columns: ["Month", ...legendYears.map(String), String(base)],
      rows: MONTH_KEYS.map((m) => [monthName(+m), ...[...legendYears, base].map((y) => rows.find((r) => r.month === `${y}-${m}`)?.[key] ?? null)]) }) });
  return { card: c, draw: () => paceChart(c.chartEl, rows, key, { fmt, base, emptyMessage }) };
}

export async function center(ctx) {
  const g = ctx.state.geo;
  const mode = ctx.state.view === "annual" ? "annual" : "pace";
  const base = ctx.meta.baseline_year;
  const [score, monthly, hist] = await Promise.all([loadTable("scorecard"), loadTable("country_monthly"), loadTable("annual_history")]);
  ctx.filters.append(
    geoSelect(ctx, { label: "Country" }),
    segmented("View", [{ value: "pace", label: `Pace vs prior years` }, { value: "annual", label: "Annual history (YoY)" }], mode,
      (v) => ctx.setState({ view: v === "pace" ? null : v })),
  );
  const s = score.find((r) => r.geo_code === g) || {};
  const rows = monthly.filter((r) => r.geo_code === g);
  const hg = hist.filter((r) => r.geo_code === g);
  const isCountry = ctx.isCountry(g);
  const ym = (k) => fmtMonth(dateKeyToYm(k));
  const firstYear = hg.length ? Math.min(...hg.map((r) => r.year)) : null;

  const picks = h("div", { class: "cc-picks" }, QUICK_PICKS.filter((c) => ctx.geoMeta(c)).map((c) =>
    h("button", { type: "button", class: "chip", "aria-pressed": String(c === g), onclick: () => ctx.setState({ geo: c }) }, ctx.geoName(c).replace("European Union - 27 countries (from 2020)", "EU 27"))));
  const nav = h("nav", { class: "cc-nav", "aria-label": "Sections" }, SECTIONS.map(([id, label]) =>
    h("a", { href: `#cc-${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`cc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, label)));
  const head = h("div", { class: "cc-head" },
    h("div", {}, h("h2", { class: "cc-title" }, ctx.geoName(g)),
      h("p", { class: "note", html: `${mode === "pace"
        ? `Pace: each month of the latest year against the two years before and ${base}.`
        : `Annual history since ${firstYear ?? "n/a"}: change on the previous year; the latest year is year to date against the same months a year earlier.`}${s.is_current === false ? " <b>This market has no recent Eurostat tourism data.</b>" : ""}` })),
    picks);
  const tiles = h("div", { class: "tiles" },
    tile(`Nights, ${ym(s.nights_date_key)}`, fmtNum(s.latest_nights), `${deltaHTML(s.latest_nights_yoy)} vs a year earlier`),
    tile("Nights, year to date", fmtNum(s.nights_ytd), `${deltaHTML(s.nights_ytd_yoy)} vs last year · ${deltaHTML(s.nights_ytd_vs_baseline)} vs ${base}`),
    tile(`Hotel bed occupancy, ${ym(s.occupancy_date_key)}`, fmtPct(s.latest_bed_place_occupancy_rate), `${deltaHTML(s.latest_bed_place_occupancy_change, { pts: true })} vs a year earlier`),
    tile(`Air passengers, ${ym(s.air_date_key)}`, fmtNum(s.latest_air_passengers), `${deltaHTML(s.latest_air_passengers_yoy)} vs a year earlier`),
    tile(`Platform rental nights, ${ym(s.platform_date_key)}`, fmtNum(s.latest_platform_nights), `${deltaHTML(s.latest_platform_nights_yoy)} vs a year earlier`),
    tile(`Accommodation inflation, ${ym(s.hicp_date_key)}`, fmtRate(s.latest_hicp_accommodation_pct), `HICP all items ${fmtRate(s.latest_hicp_all_items_pct)}`),
  );
  const slots = Object.fromEntries(SECTIONS.map(([id]) => [id, h("div", { class: "cc-slot" }, h("div", { class: "loading" }, "Loading…"))]));
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
  ctx.view.append(head, liveNote, tiles, nav, ...Object.values(slots));

  const mc = (def) => metricCard(ctx, { rows, hist: hg, ...def });
  const put = (id, title, note, defs, extra = []) => {
    const made = defs.map((d) => (d.card ? d : mc(d)));
    slots[id].replaceWith(section(id, title, note, made.map((m) => m.card), extra));
    made.forEach((m) => m.draw?.());
  };
  const pctFmt = (d) => (v) => fmtPct(v, d);

  // Each section renders independently so a slow file does not hold up the page.
  const tasks = {
    demand: async () => put("demand", "Demand", "Nights spent at tourist accommodation (hotels, holiday homes, campsites).", [
      { title: "Nights, all guests", key: "nights", fmt: (v) => fmtNum(v, 1) },
      { title: "Nights, foreign guests", key: "nights_foreign", fmt: (v) => fmtNum(v, 1) },
      { title: "Nights, domestic guests", key: "nights_domestic", fmt: (v) => fmtNum(v, 1) }]),

    stay: async () => put("stay", "Occupancy & length of stay", "Hotel occupancy is Eurostat's net bed-place occupancy; length of stay is nights per arrival.", [
      { title: "Hotel bed-place occupancy", key: "bed_place_occupancy_rate", fmt: pctFmt(0) },
      { title: "Average length of stay (nights)", key: "avg_length_of_stay", fmt: (v) => fmtDec(v, 2) },
      { title: "Arrivals", key: "arrivals", fmt: (v) => fmtNum(v, 1) }]),

    season: async () => {
      const [annual, regions] = await Promise.all([loadTable("country_annual"), loadTable("region_annual")]);
      const ann = annual.filter((r) => r.geo_code === g && r.is_complete_year);
      const p = palette();
      let c1;
      if (mode === "annual") {
        c1 = card({ title: "Two busiest months' share of annual nights", span: 6, note: "Higher means more seasonal.",
          table: () => ({ columns: ["Year", "Peak two-month share", "June-September share"], rows: ann.map((r) => [r.year, r.peak_two_month_share, r.high_season_share]) }) });
        c1.draw = () => timeChart(c1.chartEl, { yFormat: pctFmt(0), series: [
          { name: "Peak two months", data: ann.map((r) => [String(r.year), r.peak_two_month_share]) },
          { name: "June-September", data: ann.map((r) => [String(r.year), r.high_season_share]), color: p.series[1] }] });
        c1.el.querySelector(".card-head").after(legendHTML([{ label: "Peak two months", color: p.series[0] }, { label: "June-September", color: p.series[1] }]));
      } else {
        const lastFull = ann.at(-1)?.year;
        const share = (y) => {
          const ms = rows.filter((r) => r.month.startsWith(String(y)) && isNum(r.nights));
          const tot = ms.reduce((a, r) => a + r.nights, 0);
          return ms.map((r) => [r.month.slice(5), tot ? r.nights / tot : null]);
        };
        c1 = card({ title: `Share of the year's nights by month`, span: 6, note: `${lastFull ?? "n/a"} against ${base}.`,
          legend: [{ label: String(lastFull), color: p.series[0] }, { label: String(base), color: p.context }],
          table: () => ({ columns: ["Month", String(lastFull), String(base)], rows: MONTH_KEYS.map((m, i) => [monthName(+m), share(lastFull)[i]?.[1] ?? null, share(base)[i]?.[1] ?? null]) }) });
        c1.draw = () => timeChart(c1.chartEl, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: pctFmt(0), series: [
          { name: String(lastFull), data: share(lastFull), color: p.series[0], width: 2.5 }, { name: String(base), data: share(base), color: p.context }] });
      }
      const ry = Math.max(...regions.filter((r) => r.geo_code.startsWith(g) && isNum(r.peak_two_month_share)).map((r) => r.year), 0);
      const reg = regions.filter((r) => isCountry && r.geo_code.startsWith(g) && r.year === ry && isNum(r.peak_two_month_share))
        .sort((a, b) => b.peak_two_month_share - a.peak_two_month_share);
      const c2 = card({ title: `Most seasonal regions${ry ? `, ${ry}` : ""}`, span: 6, note: isCountry ? "Share of nights in the two busiest months, NUTS 2 regions." : "Select a country to see its regions.",
        table: () => ({ columns: ["Region", "Peak two-month share", "Peak month"], rows: reg.map((r) => [ctx.geoName(r.geo_code), r.peak_two_month_share, r.peak_month]) }) });
      c2.draw = () => rankBars(c2.chartEl, { items: reg.slice(0, 12).map((r) => ({ label: ctx.geoName(r.geo_code), value: r.peak_two_month_share })), format: pctFmt(0) });
      put("season", "Seasonality", null, [{ card: c1, draw: c1.draw }, { card: c2, draw: c2.draw }]);
    },

    regions: async () => {
      if (!isCountry) return put("regions", "Regions", "Regional data is shown for individual countries.", []);
      const regions = await loadTable("region_annual");
      const yrs = regions.filter((r) => r.geo_code.startsWith(g) && isNum(r.nights)).map((r) => r.year);
      const ry = yrs.length ? Math.max(...yrs) : null;
      const reg = regions.filter((r) => r.geo_code.startsWith(g) && r.year === ry).map((r) => ({ ...r, name: ctx.geoName(r.geo_code) }));
      const c1 = card({ title: `Nights by region, ${ry ?? "n/a"}`, span: 5 });
      const draw1 = () => rankBars(c1.chartEl, { items: reg.filter((r) => isNum(r.nights)).sort((a, b) => b.nights - a.nights).slice(0, 15).map((r) => ({ label: r.name, value: r.nights })), format: (v) => fmtNum(v) });
      const cols = [
        { key: "name", label: "Region", text: true }, { key: "nights", label: "Nights", fmt: (v) => fmtNum(v) },
        { key: "nights_yoy", label: "YoY", fmt: (v) => deltaHTML(v) }, { key: "nights_vs_baseline", label: `vs ${base}`, fmt: (v) => deltaHTML(v) },
        { key: "foreign_share", label: "Foreign", fmt: pctFmt(0) }, { key: "platform_share", label: "Platform share", fmt: pctFmt(0) },
        { key: "share_of_country_nights", label: "Share", fmt: pctFmt(0) }];
      const c2 = card({ title: "Regional scorecard", span: 7, csvName: `regions-${g}`,
        table: () => ({ columns: cols.map((c) => c.label), rows: reg.map((r) => cols.map((c) => r[c.key])) }) });
      c2.chartEl.replaceWith(dataTable(cols, reg, { initialSort: { key: "nights", dir: "desc" } }));
      put("regions", "Regions", "NUTS 2 regions, annual nights at tourist accommodation.", [{ card: c1, draw: draw1 }, { card: c2 }],
        [h("div", { class: "span-12 cc-more" }, exploreLink(ctx, "regions", "Regional map", { regCountry: g }))]);
    },

    origins: async () => {
      const sm = await loadTable("source_markets");
      const partners = new Map(ctx.meta.partners.map((p) => [p.partner_code, p.partner_name]));
      const pname = (c) => partners.get(c) || ctx.geoName(c);
      const mine = sm.filter((r) => r.geo_code === g);
      if (!mine.length) return put("origins", "Source markets", "Eurostat publishes guests' country of residence for individual countries only.", []);
      const year = Math.max(...mine.map((r) => r.year));
      const top = mine.filter((r) => r.year === year).sort((a, b) => b.nights - a.nights).slice(0, 12);
      const p = palette();
      let c1;
      if (mode === "annual") {
        const five = top.slice(0, 5).map((r) => r.partner_code);
        const years = [...new Set(mine.map((r) => r.year))].sort();
        c1 = card({ title: "Nights by top five source markets", span: 7, note: "Annual nights at all tourist accommodation.",
          legend: five.map((c, i) => ({ label: pname(c), color: p.series[i] })),
          table: () => ({ columns: ["Year", ...five.map(pname)], rows: years.map((y) => [y, ...five.map((c) => mine.find((r) => r.year === y && r.partner_code === c)?.nights ?? null)]) }) });
        c1.draw = () => timeChart(c1.chartEl, { yFormat: (v) => fmtNum(v, 0), series: five.map((c, i) => ({ name: pname(c), color: p.series[i],
          data: years.map((y) => [String(y), mine.find((r) => r.year === y && r.partner_code === c)?.nights ?? null]) })) });
      } else {
        c1 = card({ title: `Share of foreign nights, ${year}`, span: 7,
          table: () => ({ columns: ["Market", "Nights", "Share", "YoY"], rows: top.map((r) => [pname(r.partner_code), r.nights, r.share_of_foreign_nights, r.nights_yoy]) }) });
        c1.draw = () => rankBars(c1.chartEl, { items: top.map((r) => ({ label: pname(r.partner_code), value: r.share_of_foreign_nights })), format: pctFmt(1) });
      }
      const c2 = card({ title: `Growth vs ${base}, ${year}`, span: 5, note: "Top 12 markets by nights." });
      const draw2 = () => rankBars(c2.chartEl, { items: top.filter((r) => isNum(r.nights_vs_baseline)).map((r) => ({ label: pname(r.partner_code), value: r.nights_vs_baseline })),
        format: (v) => fmtChange(v), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) });
      put("origins", "Source markets", "Guests' country of residence (Eurostat, annual).", [{ card: c1, draw: c1.draw }, { card: c2, draw: draw2 }]);
    },

    rentals: async () => put("rentals", "Short-stay rentals", "Nights booked through Airbnb, Booking and Expedia (Eurostat experimental statistics, published quarterly).", [
      { title: "Platform rental nights", key: "platform_nights", fmt: (v) => fmtNum(v, 1), span: 6 },
      { title: "Hotel nights (for comparison)", key: "hotel_nights", fmt: (v) => fmtNum(v, 1), span: 6 }]),

    air: async () => {
      const airports = await loadTable("airport_summary");
      const mine = airports.filter((a) => (isCountry ? a.country_code === g : true) && isNum(a.passengers_12m)).slice(0, 10);
      const label = (a) => (a.city && a.iata_code ? `${a.city} (${a.iata_code})` : a.airport_name);
      const cols = [{ key: "name", label: "Airport", text: true }, { key: "passengers_12m", label: "Trailing 12m", fmt: (v) => fmtNum(v) },
        { key: "passengers_12m_yoy", label: "YoY", fmt: (v) => deltaHTML(v) }, { key: "passengers_12m_vs_baseline", label: `vs ${base}`, fmt: (v) => deltaHTML(v) }];
      const t = mine.map((a) => ({ ...a, name: label(a) }));
      const c3 = card({ title: "Top airports", span: 4, note: "Click an airport for its routes and origin countries.",
        table: () => ({ columns: cols.map((c) => c.label), rows: t.map((r) => cols.map((c) => r[c.key])) }) });
      c3.chartEl.replaceWith(dataTable(cols, t, { initialSort: { key: "passengers_12m", dir: "desc" },
        onRowClick: (r) => ctx.setState({ tab: "air", airport: r.airport_code, geo: isCountry ? g : r.country_code }) }));
      put("air", "Air traffic", "Passengers carried (arrivals plus departures).", [
        { title: "Air passengers, all flights", key: "air_passengers", fmt: (v) => fmtNum(v, 1) },
        { title: "International passengers", key: "air_passengers_international", fmt: (v) => fmtNum(v, 1) },
        { card: c3 }]);
    },

    prices: async () => put("prices", "Prices", "HICP annual rate of change and Eurostat's accommodation turnover index.", [
      { title: "Accommodation services inflation", key: "hicp_accommodation_pct", fmt: (v) => fmtRate(v), polarity: "neutral" },
      { title: "Restaurant and café inflation", key: "hicp_restaurants_pct", fmt: (v) => fmtRate(v), polarity: "neutral" },
      { title: "Accommodation turnover index", key: "accommodation_turnover_index", fmt: (v) => fmtDec(v, 0) }]),

    macro: async () => {
      const gdp = await loadTable("gdp_quarterly");
      const q = gdp.filter((r) => r.geo_code === g);
      let c4;
      if (mode === "annual") {
        const byYear = [...groupBy(q, (r) => r.quarter_start.slice(0, 4)).entries()].filter(([, l]) => l.length === 4)
          .map(([y, l]) => ({ label: y, value: l.reduce((a, r) => a + r.gdp_growth_yoy_pct, 0) / 4 }));
        c4 = card({ title: "Real GDP growth", span: 6, note: "Annual average of quarterly growth on a year earlier, %.",
          table: () => ({ columns: ["Year", "Growth %"], rows: byYear.map((r) => [r.label, r.value]) }) });
        c4.draw = () => columnChart(c4.chartEl, { items: byYear, format: (v) => fmtRate(v, 1), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) });
      } else {
        const recent = q.slice(-16);
        c4 = card({ title: "Real GDP growth", span: 6, note: "Same quarter of the previous year, last four years.",
          table: () => ({ columns: ["Quarter", "Growth %"], rows: recent.map((r) => [r.quarter_start, r.gdp_growth_yoy_pct]) }) });
        c4.draw = () => columnChart(c4.chartEl, { items: recent.map((r) => ({ label: r.quarter_start, value: r.gdp_growth_yoy_pct })), format: (v) => fmtRate(v, 1),
          colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) });
      }
      put("macro", "Macro", "The domestic backdrop. Unemployment and confidence are seasonally adjusted.", [
        { title: "Unemployment rate", key: "unemployment_rate_pct", fmt: (v) => fmtRate(v), span: 6, polarity: "down" },
        { title: "Consumer confidence (balance)", key: "consumer_confidence_balance", fmt: (v) => fmtDec(v, 1), span: 6 },
        { title: "10-year government bond yield", key: "bond_yield_10y_pct", fmt: (v) => fmtRate(v, 2), span: 6, polarity: "neutral" },
        { card: c4, draw: c4.draw }]);
    },

    health: async () => {
      const [mscore, sm, fxMonthly] = await Promise.all([loadTable("market_scorecard"), loadTable("source_markets"), loadTable("fx_monthly")]);
      const mine = sm.filter((r) => r.geo_code === g);
      if (!mine.length) return put("health", "Source-market health", "Shown for countries with Eurostat source-market data.", []);
      const smYear = Math.max(...mine.map((r) => r.year));
      const top = mine.filter((r) => r.year === smYear).sort((a, b) => b.nights - a.nights).slice(0, 12);
      const c = healthCard(ctx, { dest: g, market: null, score: mscore, sourceMarkets: sm, fxMonthly, smYear, top,
        onRowClick: (r) => ctx.setState({ tab: "demand", market: r.code }) });
      put("health", "Source-market health", "Is demand in the countries guests come from strengthening or weakening?", [{ card: c }]);
    },

    weather: async () => {
      const w = await loadTable("weather_monthly");
      const locs = ctx.meta.weather_locations.filter((l) => (isCountry ? l.country_code === g : true));
      const codes = new Set(locs.map((l) => l.location_code));
      const mine = w.filter((r) => codes.has(r.location_code));
      if (!mine.length) return put("weather", "Weather", "No destinations with weather data in this country yet.", []);
      const loc = locs.find((l) => mine.some((r) => r.location_code === l.location_code));
      const series = mine.filter((r) => r.location_code === loc.location_code);
      const p = palette();
      let c1;
      if (mode === "annual") {
        const byYear = [...groupBy(series.filter((r) => isNum(r.temp_anomaly_c)), (r) => r.month.slice(0, 4)).entries()]
          .map(([y, l]) => ({ label: l.length < 12 ? `${y} YTD` : y, value: l.reduce((a, r) => a + r.temp_anomaly_c, 0) / l.length, muted: l.length < 12 }));
        c1 = card({ title: `Temperature against normal: ${loc.location_name}`, span: 6, note: "Average monthly anomaly of the mean temperature, °C. History backfills over the first daily runs.",
          table: () => ({ columns: ["Year", "Anomaly °C"], rows: byYear.map((r) => [r.label, r.value]) }) });
        c1.draw = () => columnChart(c1.chartEl, { items: byYear, format: (v) => signed(v, 1, "°"), colorFn: (d, pal) => (d.value >= 0 ? pal.div[0] : pal.div[4]),
          emptyMessage: "The weather normal needs a few more days of history backfill." });
      } else {
        const last = Number(series.at(-1).month.slice(0, 4));
        const norm = MONTH_KEYS.map((m) => [m, series.find((r) => r.month.slice(5) === m && isNum(r.normal_max_temp_c))?.normal_max_temp_c ?? null]);
        c1 = card({ title: `Average daily high: ${loc.location_name}`, span: 6,
          legend: [{ label: String(last), color: p.series[0] }, { label: String(last - 1), color: p.series[1] }, { label: "Normal", color: p.context }],
          table: () => ({ columns: ["Month", String(last), String(last - 1), "Normal"], rows: MONTH_KEYS.map((m, i) => [monthName(+m),
            series.find((r) => r.month === `${last}-${m}`)?.avg_max_temp_c ?? null, series.find((r) => r.month === `${last - 1}-${m}`)?.avg_max_temp_c ?? null, norm[i][1]]) }) });
        c1.draw = () => timeChart(c1.chartEl, { categories: MONTH_KEYS, xFormat: (v) => monthName(+v), yFormat: (v) => `${v.toFixed(0)}°`, series: [
          { name: String(last), color: p.series[0], width: 2.5, data: series.filter((r) => r.month.startsWith(String(last))).map((r) => [r.month.slice(5), r.avg_max_temp_c]) },
          { name: String(last - 1), color: p.series[1], data: series.filter((r) => r.month.startsWith(String(last - 1))).map((r) => [r.month.slice(5), r.avg_max_temp_c]) },
          { name: "Normal", color: p.context, data: norm }] });
      }
      const latest = mine.reduce((m, r) => (r.month > m ? r.month : m), "");
      const t = mine.filter((r) => r.month === latest).map((r) => ({ ...r, name: locs.find((l) => l.location_code === r.location_code)?.location_name }));
      const cols = [{ key: "name", label: "Destination", text: true }, { key: "avg_max_temp_c", label: "Avg high °C", fmt: (v) => fmtDec(v, 1) },
        { key: "temp_anomaly_c", label: "vs normal", fmt: (v) => signed(v, 1, "°C") }, { key: "sunshine_hours", label: "Sun h", fmt: (v) => fmtDec(v, 0) },
        { key: "precipitation_vs_normal", label: "Rain vs normal", fmt: pctFmt(0) }];
      const c2 = card({ title: `Destinations, ${fmtMonth(latest)}`, span: 6, table: () => ({ columns: cols.map((c) => c.label), rows: t.map((r) => cols.map((c) => r[c.key])) }) });
      c2.chartEl.replaceWith(dataTable(cols, t, { initialSort: { key: "avg_max_temp_c", dir: "desc" }, onRowClick: (r) => ctx.setState({ tab: "weather", loc: r.location_code }) }));
      put("weather", "Weather", "Open-Meteo ERA5 reanalysis.", [{ card: c1, draw: c1.draw }, { card: c2 }]);
    },

    hotels: async () => {
      if (g === "PT") {
        const pt = (await loadTable("portugal_prices_monthly")).filter((r) => r.region_code === "PT" && r.accommodation_type_code === "01");
        const histPt = [...groupBy(pt.filter((r) => isNum(r.revenue_per_night_eur)), (r) => r.month.slice(0, 4)).entries()].map(([y, l]) => ({ year: Number(y), months: l.length, l }));
        const items = histPt.map(({ year, months, l }) => {
          const prev = pt.filter((r) => r.month.startsWith(String(year - 1)) && l.some((x) => x.month.slice(5) === r.month.slice(5)));
          const avg = (a) => a.reduce((s2, r) => s2 + r.lodging_income_eur, 0) / a.reduce((s2, r) => s2 + r.nights, 0);
          return { label: months < 12 ? `${year} YTD` : String(year), value: prev.length === months ? avg(l) / avg(prev) - 1 : null, muted: months < 12 };
        });
        let c1;
        if (mode === "annual") {
          c1 = card({ title: "Hotel revenue per guest night", span: 12, note: "Change on the previous year (Statistics Portugal, hotels and similar).",
            table: () => ({ columns: ["Year", "Change"], rows: items.map((r) => [r.label, r.value]) }) });
          c1.draw = () => columnChart(c1.chartEl, { items, format: (v) => fmtChange(v, { digits: 0 }), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) });
        } else {
          const m = metricCard(ctx, { title: "Hotel revenue per guest night", rows: pt, hist: [], key: "revenue_per_night_eur", fmt: fmtEur, span: 12,
            note: "Lodging income ÷ nights, hotels and similar (Statistics Portugal)." });
          c1 = m.card; c1.draw = m.draw;
        }
        return put("hotels", "Hotel prices", null, [{ card: c1, draw: c1.draw }], [h("div", { class: "span-12 cc-more" }, exploreLink(ctx, "spain", "Portuguese regions", { pc: "PT" }))]);
      }
      if (g === "ES") {
        const es = await loadTable("spain_zones_monthly");
        const zones = new Map(ctx.meta.zones.map((z) => [z.zone_key, z]));
        const latest = es.reduce((m, r) => (r.month > m ? r.month : m), "");
        const t = es.filter((r) => r.month === latest).map((r) => ({ ...r, name: zones.get(r.zone_key)?.zone_name, region: zones.get(r.zone_key)?.region_name }));
        const cols = [{ key: "name", label: "Zone", text: true }, { key: "region", label: "Region", text: true }, { key: "adr_eur", label: "ADR", fmt: fmtEur },
          { key: "adr_yoy", label: "ADR YoY", fmt: (v) => deltaHTML(v) }, { key: "revpar_eur", label: "RevPAR", fmt: fmtEur },
          { key: "revpar_yoy", label: "RevPAR YoY", fmt: (v) => deltaHTML(v) }, { key: "implied_room_occupancy_rate", label: "Occupancy", fmt: pctFmt(0) }];
        const c1 = card({ title: `Hotel prices by tourist zone, ${fmtMonth(latest)}`, span: 12, csvName: "spain-zones",
          table: () => ({ columns: cols.map((c) => c.label), rows: t.map((r) => cols.map((c) => r[c.key])) }) });
        c1.chartEl.replaceWith(dataTable(cols, t, { initialSort: { key: "adr_eur", dir: "desc" }, maxRows: 15,
          onRowClick: (r) => ctx.setState({ tab: "spain", zone: r.zone_key, pc: null }) }));
        return put("hotels", "Hotel prices", "INE hotel profitability indicators (ADR, RevPAR). Top 15 zones by ADR; click a zone for its history.", [{ card: c1 }]);
      }
      put("hotels", "Hotel prices", "Eurostat publishes no hotel prices. National ADR / RevPAR series are wired in for Spain (INE) and Portugal (revenue per night); other national offices can be added.", []);
    },

    fx: async () => {
      const cur = ctx.geoMeta(g)?.currency_code;
      if (cur && cur !== "EUR") {
        const fx = (await loadTable("fx_monthly")).filter((r) => r.currency_code === cur);
        const rowsFx = fx.map((r) => ({ month: r.month, rate: r.units_per_eur }));
        let made;
        if (mode === "annual") {
          const byYear = [...groupBy(rowsFx, (r) => r.month.slice(0, 4)).entries()].map(([y, l]) => ({ y, avg: l.reduce((a, r) => a + r.rate, 0) / l.length, n: l.length }));
          const items = byYear.map((r, i) => ({ label: r.n < 12 ? `${r.y} YTD` : r.y, value: i ? r.avg / byYear[i - 1].avg - 1 : null, muted: r.n < 12 }));
          const c = card({ title: `EUR/${cur}: change in the annual average`, span: 12, note: "Positive = the euro bought more " + cur + " (the destination is cheaper for euro-area visitors).",
            table: () => ({ columns: ["Year", "Average", "Change"], rows: byYear.map((r, i) => [r.y, r.avg, items[i].value]) }) });
          made = { card: c, draw: () => columnChart(c.chartEl, { items: items.slice(1), format: (v) => fmtChange(v, { digits: 0 }), colorFn: (d, pal) => (d.value >= 0 ? pal.div[4] : pal.div[0]) }) };
        } else {
          made = metricCard(ctx, { title: `EUR/${cur}, monthly average`, rows: rowsFx, hist: [], key: "rate", fmt: (v) => fmtDec(v, v > 50 ? 1 : 3), span: 12 });
        }
        return put("fx", "FX & rates", `${cur} per euro (Eurostat monthly averages).`, [made], [h("div", { class: "span-12 cc-more" }, exploreLink(ctx, "rates", "Live ECB rates", { ccy: cur }))]);
      }
      const rates = await loadTable("rates");
      const p = palette();
      const order = ["deposit_rate", "euribor_3m", "yield_10y"];
      const labels = { deposit_rate: "ECB deposit rate", euribor_3m: "Euribor 3M", yield_10y: "10-year AAA yield" };
      const c = card({ title: "Euro area interest rates", span: 12, note: "The euro area's policy and market rates (ECB).",
        legend: order.map((s2, i) => ({ label: labels[s2], color: p.series[i] })) });
      put("fx", "FX & rates", "Euro-area country: no exchange-rate exposure to the euro.", [{ card: c, draw: () => timeChart(c.chartEl, { xType: "time", yFormat: (v) => fmtRate(v, 1),
        series: order.map((s2, i) => ({ name: labels[s2], color: p.series[i], data: rates.filter((r) => r.series_code === s2).map((r) => [r.date, r.rate_pct]) })) }) }],
      [h("div", { class: "span-12 cc-more" }, exploreLink(ctx, "rates", "Live ECB rates and FX"))]);
    },
  };

  await Promise.all(Object.entries(tasks).map(async ([id, fn]) => {
    try { await fn(); } catch (e) {
      console.error(id, e);
      slots[id].replaceChildren(h("div", { class: "empty" }, `Could not load this section: ${e.message}`));
    }
  }));
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
      <li><b>Portugal revenue per night</b>: Statistics Portugal lodging income ÷ nights by NUTS 2 region and type. A per-guest price proxy, not ADR.</li>
      <li><b>Airports and routes</b>: every airport Eurostat reports (avia_paoa); routes are passengers per airport pair (avia_par_&lt;country&gt;), both directions, which Eurostat publishes with a long lag.</li>
      <li><b>Market demand</b>: OECD composite leading indicator and consumer confidence (long-term average = 100) for European and major non-European markets; Eurostat retail volume, house prices, unemployment and residents' trips and spending abroad for European markets.</li>
      <li><b>Weather</b>: Open-Meteo ERA5 reanalysis, daily values aggregated to months; normal = same-month average over complete years since 2016.</li>
    </ul>
    <h3>Live data</h3>
    <p>The warehouse is rebuilt every day from the APIs. On top of that snapshot, the Rates &amp; FX tab and the EU overview call
    the ECB and Eurostat APIs directly from your browser to show anything published since the last build.</p>
    <p class="muted small">Built ${ctx.meta.generated_at}${ctx.meta.geo?.regions_version ? ` · region boundaries ${ctx.meta.geo.regions_version}` : ""}.</p>` });
  ctx.view.append(grid(c1, dl, method));
}
