// App shell: loads metadata, keeps the state in the URL hash and renders the active tab.
import { loadJSON, loadTable, fmtMonth, fmtNum, fmtChange, escapeHTML, groupBy } from "./util.js";
import { liveFx, liveRates, mergeRows } from "./live.js";
import { disposeAll } from "./charts.js";
import * as views from "./views.js";

const TABS = ["home", "center", "markets", "seasonality", "regions", "sources", "rentals", "air", "macro", "demand",
  "weather", "rates", "spain", "data"];
// Old links (#overview, #country) open the control center.
const ALIASES = { overview: "home", country: "center" };
const DEFAULT_GEO = "EU27_2020";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function readHash() {
  const [tab, query] = location.hash.replace(/^#/, "").split("?");
  const state = Object.fromEntries(new URLSearchParams(query || ""));
  const t = ALIASES[tab] || tab;
  state.tab = TABS.includes(t) ? t : "home";
  return state;
}

function writeHash(state) {
  const { tab, ...rest } = state;
  const q = new URLSearchParams(Object.entries(rest).filter(([, v]) => v != null && v !== ""));
  const next = `#${tab}${[...q].length ? `?${q}` : ""}`;
  if (location.hash !== next) history.pushState(null, "", next);
}

async function main() {
  const viewEl = document.getElementById("view");
  const filtersEl = document.getElementById("filters");
  let meta;
  try {
    meta = await loadJSON("meta.json");
  } catch (e) {
    viewEl.innerHTML = `<div class="empty">No data yet. Run the refresh workflow, or locally:<br><code>make refresh</code> then <code>make serve</code>.<br><span class="muted small">${e.message}</span></div>`;
    document.getElementById("freshness").textContent = "";
    return;
  }
  const score = await loadTable("scorecard");
  const withData = new Set(score.map((r) => r.geo_code));
  const geoIndex = new Map(meta.geos.map((g) => [g.geo_code, g]));

  document.getElementById("synthetic-banner").hidden = !meta.synthetic;
  const latest = score.find((r) => r.geo_code === "EU27_2020")?.nights_date_key || Math.max(0, ...score.map((r) => r.nights_date_key || 0));
  const problems = meta.sources.filter((s) => s.status !== "ok").length;
  document.getElementById("freshness").innerHTML =
    `BUILD ${meta.generated_at.slice(0, 16).replace("T", " ")}Z · EU NIGHTS → ${fmtMonth(String(latest)).toUpperCase()}` +
    (problems ? ` · <a href="#data">${problems} SOURCE${problems > 1 ? "S" : ""} DEGRADED</a>` : "");
  document.getElementById("status-lights").replaceChildren(...meta.sources.map((src) => {
    const i = document.createElement("i");
    i.className = src.status;
    i.title = `${src.source_key}: ${src.status}${src.latest_period ? ` · data to ${src.latest_period}` : ""}`;
    return i;
  }));
  startClock();
  startTicker(meta, score);

  const ctx = {
    meta,
    state: {},
    filters: filtersEl,
    view: viewEl,
    geoMeta: (code) => geoIndex.get(code),
    geoName: (code) => geoIndex.get(code)?.geo_name || code,
    isCountry: (code) => geoIndex.get(code)?.geo_level === "country",
    geoOptions(countriesOnly = false) {
      const byName = (a, b) => a.geo_name.localeCompare(b.geo_name);
      const countries = meta.geos.filter((g) => g.geo_level === "country" && withData.has(g.geo_code)).sort(byName)
        .map((g) => ({ value: g.geo_code, label: g.geo_name }));
      if (countriesOnly) return countries;
      const aggregates = meta.geos.filter((g) => g.geo_level === "aggregate" && withData.has(g.geo_code))
        .map((g) => ({ value: g.geo_code, label: g.geo_name }));
      return [{ group: "Totals", options: aggregates }, { group: "Countries", options: countries }];
    },
    setState(patch) {
      Object.assign(ctx.state, patch);
      if (patch.geo) store.set("geo", patch.geo);
      if ("geo" in patch && !("region" in patch)) delete ctx.state.region;
      if ("geo" in patch && !("airport" in patch)) delete ctx.state.airport;
      writeHash(ctx.state);
      render();
    },
  };

  let renderId = 0;
  let prevTab = null, prevGeo = null;
  async function render() {
    const id = ++renderId;
    const s = readHash();
    if (!s.geo) s.geo = store.get("geo") || DEFAULT_GEO;
    if (!geoIndex.has(s.geo)) s.geo = DEFAULT_GEO;
    ctx.state = s;
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.tab === s.tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.body.dataset.tab = s.tab;
    disposeAll();
    // Fresh containers per render: a slower, superseded render writes into detached nodes.
    ctx.filters = document.createElement("div");
    ctx.filters.style.display = "contents";
    ctx.view = document.createElement("div");
    filtersEl.replaceChildren(ctx.filters);
    viewEl.replaceChildren(ctx.view);
    if (prevTab !== s.tab || prevGeo !== s.geo) window.scrollTo({ top: 0 });
    prevTab = s.tab; prevGeo = s.geo;
    try {
      await views[s.tab](ctx);
    } catch (e) {
      console.error(e);
      if (id === renderId) viewEl.innerHTML = `<div class="empty">Could not render this view: ${e.message}</div>`;
    }
  }

  document.querySelectorAll(".tabs a, a.cmd-brand").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const keep = { geo: ctx.state.geo, view: ctx.state.view };
    ctx.state = { tab: a.dataset.tab, ...keep };
    writeHash(ctx.state);
    render();
    a.scrollIntoView({ block: "nearest", inline: "nearest" });
  }));
  window.addEventListener("hashchange", render);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    render();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (!document.documentElement.dataset.theme) render();
  });

  render();
}

function startClock() {
  const el = document.getElementById("utc-clock");
  const tick = () => { el.textContent = `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`; };
  tick();
  setInterval(tick, 1000);
}

/** Bottom ticker: ECB rates and FX (live when the ECB answers), EU headline numbers. */
async function startTicker(meta, score) {
  const bar = document.getElementById("ticker");
  const track = bar.querySelector(".ticker-track");
  const [ratesSnap, fxSnap] = await Promise.all([loadTable("rates"), loadTable("fx_daily")]);
  const eu = score.find((r) => r.geo_code === "EU27_2020") || {};
  const cls = (v) => (v > 0.0005 ? "up" : v < -0.0005 ? "down" : "");
  const draw = (rates, fx, live) => {
    const items = [];
    const rs = groupBy(rates, "series_code");
    const label = { deposit_rate: "ECB DFR", estr: "€STR", euribor_3m: "EURIBOR 3M", yield_10y: "AAA 10Y" };
    for (const k of ["deposit_rate", "estr", "euribor_3m", "yield_10y"]) {
      const l = rs.get(k);
      if (l?.length) items.push(`<span class="ticker-item"><span class="k">${label[k]}</span><b>${l.at(-1).rate_pct.toFixed(2)}%</b></span>`);
    }
    const fxs = groupBy(fx, "currency_code");
    for (const c of ["USD", "GBP", "CHF", "SEK", "NOK", "PLN", "JPY", "TRY"]) {
      const l = fxs.get(c);
      if (!l || l.length < 2) continue;
      const a = l.at(-1).units_per_eur, b = l.at(-2).units_per_eur, ch = a / b - 1;
      items.push(`<span class="ticker-item"><span class="k">EUR/${c}</span><b>${a.toFixed(a > 50 ? 2 : 4)}</b><span class="${cls(ch)}">${fmtChange(ch, { digits: 2 })}</span></span>`);
    }
    if (eu.latest_nights) items.push(`<span class="ticker-item"><span class="k">EU NIGHTS ${fmtMonth(String(eu.nights_date_key)).toUpperCase()}</span><b>${fmtNum(eu.latest_nights)}</b><span class="${cls(eu.latest_nights_yoy)}">${fmtChange(eu.latest_nights_yoy)}</span></span>`);
    if (eu.latest_air_passengers) items.push(`<span class="ticker-item"><span class="k">EU AIR PAX</span><b>${fmtNum(eu.latest_air_passengers)}</b><span class="${cls(eu.latest_air_passengers_yoy)}">${fmtChange(eu.latest_air_passengers_yoy)}</span></span>`);
    if (eu.latest_hicp_accommodation_pct != null) items.push(`<span class="ticker-item"><span class="k">EU ACCOM CPI</span><b>${eu.latest_hicp_accommodation_pct.toFixed(1)}%</b></span>`);
    const html = items.join("");
    track.innerHTML = html + html;   // duplicated for a seamless loop
    bar.querySelector(".ticker-label").innerHTML = live ? "● LIVE" : "SNAPSHOT";
    bar.hidden = false;
  };
  draw(ratesSnap, fxSnap, false);
  const currencies = meta.currencies.map((c) => c.currency_code);
  const [lf, lr] = await Promise.allSettled([liveFx(currencies), liveRates()]);
  const fxOk = lf.status === "fulfilled" && lf.value.length, rtOk = lr.status === "fulfilled" && lr.value.length;
  if (fxOk || rtOk) draw(rtOk ? mergeRows(ratesSnap, lr.value, "series_code") : ratesSnap, fxOk ? mergeRows(fxSnap, lf.value, "currency_code") : fxSnap, true);
}

function start() {
  const go = () => {
    if (window.echarts) return main();
    document.getElementById("view").innerHTML =
      '<div class="empty">The chart library (ECharts, from cdn.jsdelivr.net) did not load. Check your connection or content blocker and reload.</div>';
  };
  if (window.echarts) go();
  else window.addEventListener("load", go, { once: true });
}
start();
