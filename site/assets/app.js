// App shell: loads metadata, keeps the state in the URL hash and renders the active tab.
import { loadJSON, loadTable, fmtMonth } from "./util.js";
import { disposeAll } from "./charts.js";
import * as views from "./views.js";

const TABS = ["overview", "markets", "country", "seasonality", "regions", "sources", "rentals", "air", "macro", "rates", "spain", "data"];
const DEFAULT_GEO = "EU27_2020";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function readHash() {
  const [tab, query] = location.hash.replace(/^#/, "").split("?");
  const state = Object.fromEntries(new URLSearchParams(query || ""));
  state.tab = TABS.includes(tab) ? tab : "overview";
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
    `Updated ${meta.generated_at.slice(0, 10)} · EU nights to ${fmtMonth(String(latest))}` +
    (problems ? ` · <a href="#data">${problems} source${problems > 1 ? "s" : ""} need attention</a>` : "");

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
      writeHash(ctx.state);
      render();
    },
  };

  let renderId = 0;
  async function render() {
    const id = ++renderId;
    const s = readHash();
    if (!s.geo) s.geo = store.get("geo") || DEFAULT_GEO;
    if (!geoIndex.has(s.geo)) s.geo = DEFAULT_GEO;
    ctx.state = s;
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.tab === s.tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    disposeAll();
    // Fresh containers per render: a slower, superseded render writes into detached nodes.
    ctx.filters = document.createElement("div");
    ctx.filters.style.display = "contents";
    ctx.view = document.createElement("div");
    filtersEl.replaceChildren(ctx.filters);
    viewEl.replaceChildren(ctx.view);
    try {
      await views[s.tab](ctx);
    } catch (e) {
      console.error(e);
      if (id === renderId) viewEl.innerHTML = `<div class="empty">Could not render this view: ${e.message}</div>`;
    }
  }

  document.querySelectorAll(".tabs a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const keep = { geo: ctx.state.geo };
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
