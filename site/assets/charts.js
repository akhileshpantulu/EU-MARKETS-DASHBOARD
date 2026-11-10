// Chart helpers on top of Apache ECharts. Every chart sits in a card with a
// table view and a CSV download, so no value is reachable only by hovering.
import { h, downloadCSV, isNum, escapeHTML, fmtPrecise } from "./util.js";

const instances = new Set();
let resizeBound = false;

export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette() {
  return {
    signal: css("--signal") || css("--accent"), mapBorder: css("--map-border") || css("--surface"), mapEmpty: css("--map-empty") || css("--grid"),
    text: css("--text"), text2: css("--text-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
    surface: css("--surface"), context: css("--context"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--series-${i}`)),
    seq: ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"].map(css),
    div: ["--div-neg", "--div-neg-2", "--div-mid", "--div-pos-2", "--div-pos"].map(css),
  };
}

export function disposeAll() {
  for (const c of instances) c.dispose();
  instances.clear();
}

function init(el) {
  const prev = echarts.getInstanceByDom(el);
  if (prev) { instances.delete(prev); prev.dispose(); }
  const chart = echarts.init(el, null, { renderer: "canvas" });
  instances.add(chart);
  if (!resizeBound) {
    resizeBound = true;
    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => instances.forEach((c) => c.resize()), 120);
    });
  }
  return chart;
}

/**
 * A card with a title, optional note, chart area and Table / CSV actions.
 * table: () => ({columns: [labels], rows: [[...]]}) built lazily.
 */
export function card({ title, note, span = 12, height = "", table, csvName, legend }) {
  const chartEl = h("div", { class: `chart ${height}`.trim(), role: "img", "aria-label": title });
  const body = h("div", {}, chartEl);
  const actions = h("div", { class: "card-actions" });
  let tableEl = null;
  if (table) {
    const toggle = h("button", { class: "link-button", type: "button", "aria-pressed": "false" }, "Table");
    toggle.addEventListener("click", () => {
      const showing = toggle.getAttribute("aria-pressed") === "true";
      if (!showing) {
        const t = table();
        tableEl = simpleTable(t.columns, t.rows);
        body.append(tableEl);
        chartEl.hidden = true;
      } else {
        tableEl?.remove();
        chartEl.hidden = false;
      }
      toggle.setAttribute("aria-pressed", String(!showing));
      toggle.textContent = showing ? "Table" : "Chart";
    });
    const csv = h("button", { class: "link-button", type: "button" }, "CSV");
    csv.addEventListener("click", () => {
      const t = table();
      downloadCSV(`${csvName || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, t.columns, t.rows);
    });
    actions.append(toggle, csv);
  }
  const legendEl = legend ? legendHTML(legend) : null;
  const el = h("section", { class: `card span-${span}` },
    h("div", { class: "card-head" },
      h("div", {}, h("h2", {}, title), note ? h("p", { class: "note", html: note }) : null),
      actions),
    legendEl,
    body);
  return { el, chartEl, body };
}

export function legendHTML(items) {
  return h("div", { class: "legend" }, items.map((it) =>
    h("span", {}, h("i", { style: `background:${it.color}` }), it.label)));
}

function simpleTable(columns, rows) {
  const t = h("table", { class: "data" });
  t.append(h("thead", {}, h("tr", {}, columns.map((c, i) => h("th", { class: i === 0 ? "text" : null }, c)))));
  t.append(h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v, i) =>
    h("td", { class: i === 0 ? "text" : null }, v == null ? "" : typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 4 }) : v))))));
  return h("div", { class: "table-wrap" }, t);
}

export function empty(el, message = "No data published for this selection yet.") {
  el.replaceChildren(h("div", { class: "empty" }, message));
  el.style.height = "auto";
}

function baseOption(p) {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: css("--font"), color: p.text2 },
    animationDuration: 300,
    tooltip: {
      backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text, fontSize: 12.5 },
      extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;",
    },
  };
}

function axisStyle(p) {
  return {
    axisLine: { lineStyle: { color: p.axis } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 11.5 },
    splitLine: { lineStyle: { color: p.grid, type: "solid" } },
  };
}

/**
 * Time-series line / bar chart on one y-axis.
 * series: [{name, data: [[x, y]], color?, type?, area?, stack?, width?}]
 */
export function timeChart(el, { series, yFormat = (v) => v, yName, zoom = false, xType = "category", yMin, markZero = false,
  categories, xFormat, emptyMessage, capOutliers = false }) {
  if (!series.some((s) => s.data.some((d) => isNum(d[1])))) return empty(el, emptyMessage);
  const p = palette();
  // Optional cap for a single bar series of changes, as in columnChart.
  const cap = capOutliers ? outlierCap(series.flatMap((s) => s.data.map((d) => d[1]))) : null;
  const hasNeg = series.some((s) => s.data.some((d) => isNum(d[1]) && d[1] < 0));
  const chart = init(el);
  const ax = axisStyle(p);
  const xs = xType === "category" ? categories || [...new Set(series.flatMap((s) => s.data.map((d) => d[0])))].sort() : undefined;
  if (xFormat) ax.axisLabel = { ...ax.axisLabel, formatter: xFormat };
  chart.setOption({
    ...baseOption(p),
    grid: { left: 8, right: 16, top: 16, bottom: zoom ? 56 : 8, containLabel: true },
    tooltip: {
      ...baseOption(p).tooltip, trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: p.axis } },
      valueFormatter: (v) => (isNum(v) ? tipFormat(yFormat)(v) : "n/a"),
    },
    xAxis: { type: xType, data: xs, boundaryGap: series.some((s) => s.type === "bar"), ...ax, splitLine: { show: false } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: p.muted, fontSize: 11 }, min: yMin, scale: yMin == null && !series.some((s) => s.type === "bar" || s.area),
             ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v) => yFormat(v) },
             ...(cap ? { min: hasNeg ? -cap : undefined, max: cap } : {}) },
    dataZoom: zoom ? [{ type: "inside" }, { type: "slider", height: 22, bottom: 8, borderColor: p.grid,
      fillerColor: "rgba(42,120,214,0.12)", dataBackground: { lineStyle: { color: p.axis }, areaStyle: { color: p.grid } },
      textStyle: { color: p.muted } }] : [],
    series: series.map((s, i) => {
      const color = s.color || p.series[i % 8];
      const raw = xs ? alignTo(xs, s.data) : s.data;
      const val = (d) => (Array.isArray(d) ? d[1] : d);
      const over = (d) => isNum(val(d)) && Math.abs(val(d)) > cap;
      let run = 0;
      const data = cap ? raw.map((d, j) => {
        const v = val(d);
        run = j > 0 && over(raw[j - 1]) ? run + 1 : 0;
        if (!over(d)) return d;
        const clipped = Math.sign(v) * cap;
        return { value: Array.isArray(d) ? [d[0], clipped] : clipped, label: { show: true, position: v > 0 ? "insideTop" : "insideBottom",
          color: p.text, fontSize: 10, fontWeight: 600, backgroundColor: p.surface, borderColor: p.grid, borderWidth: 1, borderRadius: 3,
          padding: [1, 3], offset: [0, (run % 3) * (v > 0 ? 19 : -19)], formatter: () => yFormat(v) }, rawValue: v };
      }) : raw;
      const base = { name: s.name, type: s.type || "line", data, stack: s.stack,
        itemStyle: { color, borderRadius: s.type === "bar" ? (s.stack ? 0 : [3, 3, 0, 0]) : 0 },
        emphasis: { focus: "series" } };
      if ((s.type || "line") === "line") {
        Object.assign(base, { showSymbol: false, symbolSize: 8, lineStyle: { width: s.width || 2, color }, connectNulls: false,
          areaStyle: s.area ? { color, opacity: 0.18 } : undefined, smooth: false });
      } else {
        Object.assign(base, { barMaxWidth: 18, barGap: "20%" });
      }
      if (markZero && i === 0) base.markLine = { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: p.axis, type: "solid" }, data: [{ yAxis: 0 }] };
      return base;
    }),
  });
  if (cap || xFormat) {
    // Header in the axis format (month names, not "06"); capped bars show their true value.
    chart.setOption({ tooltip: { valueFormatter: undefined, formatter: (xs) => [escapeHTML(String(xFormat && xs[0] ? xFormat(xs[0].axisValue) : xs[0]?.axisValueLabel ?? xs[0]?.name ?? "")),
      ...xs.map((x) => { const v = x.data?.rawValue ?? (Array.isArray(x.value) ? x.value[1] : x.value); return `${x.marker}${escapeHTML(x.seriesName)} <b>${isNum(v) ? tipFormat(yFormat)(v) : "n/a"}</b>`; })].join("<br>") } });
  }
  el.nextElementSibling?.classList.contains("cap-note") && el.nextElementSibling.remove();
  if (cap) el.after(h("p", { class: "cap-note" }, `Axis capped at ±${yFormat(cap).replace(/^[+−-]/, "")}; bars beyond it are labelled with their value.`));
  return chart;
}

/** Hover format: abbreviated counts (k / M / bn) get more digits so close years differ. */
function tipFormat(format) {
  return (v) => { const s = format(v); return isNum(v) && /\d ?(k|M|bn)$/.test(s) ? fmtPrecise(v) : s; };
}

/** A round axis limit when a few values (2020-22) dwarf the rest, else null. */
function outlierCap(values) {
  const abs = values.filter(isNum).map(Math.abs).sort((a, b) => a - b);
  const typical = abs[Math.floor(abs.length * 0.75)] || 0;
  const nice = (x) => { const e = 10 ** Math.floor(Math.log10(x)); const f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  return abs.length >= 6 && typical > 0 && abs.at(-1) > 3 * typical ? nice(typical * 2.2) : null;
}

function alignTo(xs, data) {
  const m = new Map(data.map((d) => [d[0], d[1]]));
  return xs.map((x) => (m.has(x) && isNum(m.get(x)) ? m.get(x) : null));
}

/** Horizontal ranked bars. items: [{label, value, color?, highlight?}] */
export function rankBars(el, { items, format = (v) => v, onClick, colorFn }) {
  items = items.filter((d) => isNum(d.value));
  if (!items.length) return empty(el);
  const p = palette();
  const chart = init(el);
  const ax = axisStyle(p);
  const data = items.slice().reverse();
  el.style.height = `${Math.max(200, data.length * 24 + 40)}px`;
  chart.resize();
  chart.setOption({
    ...baseOption(p),
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...baseOption(p).tooltip, trigger: "item", formatter: (x) => `${escapeHTML(x.name)}<br><b>${tipFormat(format)(x.value)}</b>` },
    xAxis: { type: "value", ...ax, axisLabel: { ...ax.axisLabel, formatter: (v) => format(v) } },
    yAxis: { type: "category", data: data.map((d) => d.label), ...ax, axisLine: { show: false }, axisLabel: { color: p.text2, fontSize: 12 } },
    series: [{
      type: "bar", barMaxWidth: 16,
      data: data.map((d) => ({ value: d.value, itemStyle: {
        color: colorFn ? colorFn(d, p) : d.color || (d.highlight === false ? p.context : p.series[0]),
        borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: p.text2, fontSize: 11.5, formatter: (x) => format(x.value) },
    }],
  });
  if (onClick) chart.on("click", (e) => onClick(data[e.dataIndex]));
  return chart;
}

/** Heatmap: rows x columns of values in 0..max (sequential). */
export function heatmap(el, { rows, cols, values, format = (v) => v, min, max }) {
  if (!values.length) return empty(el);
  const p = palette();
  const chart = init(el);
  el.style.height = `${Math.max(260, rows.length * 22 + 90)}px`;
  chart.resize();
  const vals = values.map((v) => v[2]).filter(isNum);
  chart.setOption({
    ...baseOption(p),
    grid: { left: 8, right: 16, top: 8, bottom: 52, containLabel: true },
    tooltip: { ...baseOption(p).tooltip, formatter: (x) => `${escapeHTML(rows[x.value[1]])}, ${cols[x.value[0]]}<br><b>${tipFormat(format)(x.value[2])}</b>` },
    xAxis: { type: "category", data: cols, axisLabel: { color: p.muted }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: "category", data: rows, inverse: true, axisLabel: { color: p.text2 }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { min: min ?? Math.min(...vals), max: max ?? Math.max(...vals), calculable: false, orient: "horizontal", left: "center", bottom: 0,
      itemWidth: 10, itemHeight: 180, inRange: { color: p.seq }, textStyle: { color: p.muted, fontSize: 11 },
      text: [format(max ?? Math.max(...vals)), format(min ?? Math.min(...vals))], textGap: 8 },
    series: [{ type: "heatmap", data: values, itemStyle: { borderColor: p.surface, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: p.text, borderWidth: 1 } } }],
  });
  return chart;
}

const registered = new Set();
/** Drop far-flung overseas polygons so mainland Europe fills the frame. */
function trimEurope(geojson) {
  const inBox = (ring) => {
    const [lon, lat] = ring[0];
    return lon > -26 && lon < 45 && lat > 27 && lat < 72;
  };
  return {
    ...geojson,
    features: geojson.features.map((f) => {
      const g = f.geometry;
      if (g.type === "Polygon") return inBox(g.coordinates[0]) ? f : null;
      if (g.type === "MultiPolygon") {
        const parts = g.coordinates.filter((poly) => inBox(poly[0]));
        return parts.length ? { ...f, geometry: { type: "MultiPolygon", coordinates: parts } } : null;
      }
      return f;
    }).filter(Boolean),
  };
}

/**
 * Choropleth. data: [{code, value}]; scale: "seq" | "div" (centred on 0).
 */
export function choropleth(el, { name, geojson, data, scale = "seq", format = (v) => v, onClick, selected, labelFor, tooltipHTML,
  legend = true, center = [12, 52], zoom = 1 }) {
  if (!geojson) return empty(el, "Map boundaries not downloaded yet.");
  if (!data.some((d) => isNum(d.value))) return empty(el);
  if (!registered.has(name)) {
    echarts.registerMap(name, trimEurope(geojson));
    registered.add(name);
  }
  const p = palette();
  const chart = init(el);
  const vals = data.map((d) => d.value).filter(isNum).sort((a, b) => a - b);
  // Clip the colour scale at the 5th / 95th percentile so one outlier does not wash out the map.
  const q = (f) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(f * (vals.length - 1))))];
  let min = q(0.05), max = q(0.95);
  if (scale === "div") { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -m; max = m; }
  if (min === max) max = min + 1;
  const names = new Map(geojson.features.map((f) => [f.properties.code, f.properties.name]));
  chart.setOption({
    ...baseOption(p),
    tooltip: { ...baseOption(p).tooltip, trigger: "item", formatter: (x) => {
      if (tooltipHTML) return tooltipHTML(x.name, x.value);
      const label = labelFor ? labelFor(x.name) : names.get(x.name) || x.name;
      return `${escapeHTML(label)}<br><b>${isNum(x.value) ? tipFormat(format)(x.value) : "no data"}</b>`;
    } },
    visualMap: { show: false, type: "continuous", min, max, inRange: { color: scale === "div" ? p.div : p.seq } },
    series: [{
      type: "map", map: name, nameProperty: "code", roam: true, scaleLimit: { min: 1, max: 12 },
      aspectScale: 0.68, layoutCenter: ["50%", "52%"], layoutSize: "118%", center, zoom,
      itemStyle: { areaColor: p.mapEmpty, borderColor: p.mapBorder, borderWidth: 0.7 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: null, borderColor: p.signal, borderWidth: 1.6,
        shadowColor: p.signal, shadowBlur: 8 } },
      select: { label: { show: false }, itemStyle: { borderColor: p.signal, borderWidth: 2, areaColor: null } },
      selectedMode: onClick ? "single" : false,
      data: data.map((d) => ({ name: d.code, value: isNum(d.value) ? d.value : null, selected: d.code === selected })),
    }],
  });
  if (onClick) chart.on("click", (e) => onClick(e.name));
  el.nextElementSibling?.classList.contains("scale-legend") && el.nextElementSibling.remove();
  chart.legendEl = h("div", { class: "scale-legend" },
    h("span", {}, `${vals[0] < min ? "≤ " : ""}${format(min)}`),
    h("span", { class: "bar", style: `background:${scaleGradient(scale)}` }),
    h("span", {}, `${vals[vals.length - 1] > max ? "≥ " : ""}${format(max)}`),
    h("span", { class: "muted" }, "· grey: no data"));
  if (legend) el.after(chart.legendEl);
  return chart;
}

/** Bubble map of points (airports). points: [{name, lon, lat, value}] over a country basemap. */
export function bubbleMap(el, { geojson, points, format = (v) => v }) {
  if (!geojson || !points.length) return empty(el);
  if (!registered.has("countries")) { echarts.registerMap("countries", trimEurope(geojson)); registered.add("countries"); }
  const p = palette();
  const chart = init(el);
  const max = Math.max(...points.map((d) => d.value));
  chart.setOption({
    ...baseOption(p),
    tooltip: { ...baseOption(p).tooltip, trigger: "item", formatter: (x) => `${escapeHTML(x.name)}<br><b>${tipFormat(format)(x.value[2])}</b>` },
    geo: { map: "countries", roam: true, aspectScale: 0.68, layoutCenter: ["50%", "52%"], layoutSize: "118%", center: [12, 50],
      itemStyle: { areaColor: p.mapEmpty, borderColor: p.mapBorder, borderWidth: 0.6 }, emphasis: { disabled: true }, silent: true },
    series: [{ type: "scatter", coordinateSystem: "geo",
      data: points.map((d) => ({ name: d.name, value: [d.lon, d.lat, d.value] })),
      symbolSize: (v) => 6 + 30 * Math.sqrt(v[2] / max),
      itemStyle: { color: p.series[0], opacity: 0.75, borderColor: p.surface, borderWidth: 2 } }],
  });
  return chart;
}

/** Colour of a value on the diverging or sequential scale (for table cells and legends). */
export function scaleGradient(kind) {
  const p = palette();
  const stops = kind === "div" ? p.div : p.seq;
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * Vertical columns on a category axis with a zero baseline, one colour per column
 * (colorFn) so the sign or a highlighted year can carry polarity.
 * items: [{label, value, muted?}]
 */
export function columnChart(el, { items, format = (v) => v, colorFn, emptyMessage, noCap = false, outline = null, changeFormat = null, hoverFormat = null }) {
  if (!items.some((d) => isNum(d.value))) return empty(el, emptyMessage);
  const p = palette();
  const chart = init(el);
  const ax = axisStyle(p);
  // Cap the axis when a few years (2020-22) dwarf the rest; capped bars stop at the edge
  // and carry their true value as a label, so ordinary years stay readable.
  const abs = items.map((d) => Math.abs(d.value)).filter(isNum);
  const cap = noCap ? null : outlierCap(abs);
  const shown = (v) => (cap && isNum(v) ? Math.max(-cap, Math.min(cap, v)) : v);
  const capped = (v) => cap && isNum(v) && Math.abs(v) > cap;
  // Within a run of capped bars, every second one is offset.
  const stagger = (i) => { let n = 0; for (let j = i; j > 0 && capped(items[j - 1].value); j--) n++; return n % 2 === 1; };
  chart.setOption({
    ...baseOption(p),
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: { ...baseOption(p).tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (xs) => {
        const d = items[xs[0].dataIndex];
        // Level charts can carry each year's change (items[].change); the YTD bar's change is on the same months.
        const ch = changeFormat && isNum(d.change)
          ? `<br><span style="color:${d.change >= 0 ? p.div[4] : p.div[0]}">${changeFormat(d.change)}</span> vs ${d.muted ? "same months last year" : "previous year"}` : "";
        return `${escapeHTML(d.label)}<br><b>${isNum(d.value) ? (hoverFormat || tipFormat(format))(d.value) : "n/a"}</b>${ch}`;
      } },
    xAxis: { type: "category", data: items.map((d) => d.label), ...ax, splitLine: { show: false },
      axisLabel: { ...ax.axisLabel, interval: "auto", hideOverlap: true } },
    yAxis: { type: "value", ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v) => format(v) },
      ...(cap ? { min: abs.length && items.some((d) => d.value < 0) ? -cap : undefined, max: cap } : {}) },
    series: [{
      type: "bar", barMaxWidth: 22,
      data: items.map((d, i) => ({
        value: isNum(d.value) ? shown(d.value) : null,
        itemStyle: { color: colorFn ? colorFn(d, p) : p.series[0], opacity: d.muted ? 0.55 : 1,
          ...(outline != null && d.year === outline ? { borderColor: p.text, borderWidth: 1.5 } : {}),
          borderRadius: (d.value ?? 0) >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] },
        label: capped(d.value) ? { show: true, position: d.value >= 0 ? "insideTop" : "insideBottom", color: p.text, fontSize: 10.5,
          fontWeight: 600, backgroundColor: p.surface, borderColor: p.grid, borderWidth: 1, borderRadius: 3, padding: [1, 3],
          // Stagger badges of neighbouring capped bars so they do not overlap.
          offset: [0, i > 0 && capped(items[i - 1].value) && stagger(i) ? (d.value >= 0 ? 20 : -20) : 0],
          formatter: () => format(d.value) } : { show: false },
      })),
      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: p.axis, type: "solid" }, data: [{ yAxis: 0 }] },
    }],
  });
  el.nextElementSibling?.classList.contains("cap-note") && el.nextElementSibling.remove();
  if (cap) el.after(h("p", { class: "cap-note" }, `Axis capped at ±${format(cap).replace(/^[+−-]/, "")}; years beyond it are labelled with their value.`));
  return chart;
}
