// Data loading, formatting and small DOM helpers.

const cache = new Map();

/** Fetch a JSON file from data/ once. */
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`data/${path}`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

const tableCache = new Map();
/** Load a {columns, rows} table and return an array of row objects. */
export async function loadTable(name) {
  if (!tableCache.has(name)) {
    tableCache.set(name, loadJSON(`${name}.json`).then(({ columns, rows }) =>
      rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))));
  }
  return tableCache.get(name);
}

export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// ------------------------------------------------------------------ formatting
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtMonth(ym) {
  if (!ym) return "n/a";
  const s = String(ym);
  const y = s.slice(0, 4);
  const m = Number(s.length === 6 ? s.slice(4, 6) : s.slice(5, 7));
  return m ? `${MONTHS[m - 1]} ${y}` : y;
}
export const monthName = (m) => MONTHS[m - 1];
export const dateKeyToYm = (k) => (k ? `${String(k).slice(0, 4)}-${String(k).slice(4, 6)}` : null);

export function fmtNum(v, digits = 1) {
  if (!isNum(v)) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(digits)} bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(digits)} M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}
export const fmtInt = (v) => (isNum(v) ? Math.round(v).toLocaleString("en-GB") : "n/a");
export const fmtPct = (v, digits = 1) => (isNum(v) ? `${(v * 100).toFixed(digits)}%` : "n/a");
export const fmtRate = (v, digits = 1) => (isNum(v) ? `${v.toFixed(digits)}%` : "n/a");
export const fmtDec = (v, digits = 2) => (isNum(v) ? v.toFixed(digits) : "n/a");
export const fmtEur = (v) => (isNum(v) ? `€${v.toFixed(0)}` : "n/a");

/** Signed change: share (0.052 -> +5.2%) or points (pts=true: 0.021 -> +2.1 pts). */
export function fmtChange(v, { pts = false, digits = 1 } = {}) {
  if (!isNum(v)) return "n/a";
  const x = v * 100;
  const sign = x > 0.05 ? "+" : x < -0.05 ? "−" : "";
  return `${sign}${Math.abs(x).toFixed(digits)}${pts ? " pts" : "%"}`;
}

/** <span class="delta up">▲ +5.2%</span>; the arrow keeps meaning off colour alone. */
export function deltaHTML(v, opts = {}) {
  if (!isNum(v)) return `<span class="delta flat">n/a</span>`;
  const dir = v > 0.0005 ? "up" : v < -0.0005 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  const cls = opts.invert ? { up: "down", down: "up", flat: "flat" }[dir] : dir;
  return `<span class="delta ${cls}">${arrow} ${fmtChange(v, opts)}</span>`;
}

// ------------------------------------------------------------------------ DOM
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Select control. options: [{value, label}] or [value]. */
export function select(label, options, value, onChange, { id } = {}) {
  const sel = h("select", { id, "aria-label": label });
  for (const o of options) {
    const opt = typeof o === "object" ? o : { value: o, label: o };
    if (opt.group) {
      const g = h("optgroup", { label: opt.group });
      for (const x of opt.options) g.append(h("option", { value: x.value }, x.label));
      sel.append(g);
    } else {
      sel.append(h("option", { value: opt.value }, opt.label));
    }
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return h("label", { class: "field" }, label, sel);
}

/** Segmented buttons. options: [{value, label}] */
export function segmented(label, options, value, onChange) {
  const wrap = h("div", { class: "segmented", role: "group", "aria-label": label });
  for (const o of options) {
    wrap.append(h("button", {
      type: "button", "aria-pressed": String(o.value === value),
      onclick: () => onChange(o.value),
    }, o.label));
  }
  return h("div", { class: "field" }, label, wrap);
}

export function toCSV(columns, rows) {
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCSV(filename, columns, rows) {
  const blob = new Blob([toCSV(columns, rows)], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/**
 * Sortable HTML table.
 * cols: [{key, label, fmt?, text?, sortValue?}]; rows: objects.
 */
export function dataTable(cols, rows, { onRowClick, highlight, initialSort, maxRows } = {}) {
  let sortKey = initialSort?.key;
  let dir = initialSort?.dir || "desc";
  const table = h("table", { class: "data" });
  const thead = h("thead");
  const tbody = h("tbody");
  table.append(thead, tbody);

  const headRow = h("tr");
  for (const c of cols) {
    const th = h("th", { class: c.text ? "text" : null, scope: "col", tabindex: "0" }, c.label);
    const sort = () => {
      if (sortKey === c.key) dir = dir === "desc" ? "asc" : "desc";
      else { sortKey = c.key; dir = c.text ? "asc" : "desc"; }
      render();
    };
    th.addEventListener("click", sort);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter") sort(); });
    headRow.append(th);
  }
  thead.append(headRow);

  function render() {
    [...headRow.children].forEach((th, i) => {
      th.setAttribute("aria-sort", cols[i].key === sortKey ? (dir === "asc" ? "ascending" : "descending") : "none");
    });
    let sorted = rows.slice();
    if (sortKey) {
      const col = cols.find((c) => c.key === sortKey);
      const val = col.sortValue || ((r) => r[sortKey]);
      sorted.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
        return dir === "asc" ? cmp : -cmp;
      });
    }
    if (maxRows) sorted = sorted.slice(0, maxRows);
    tbody.replaceChildren(...sorted.map((r) => {
      const tr = h("tr", { class: [onRowClick ? "clickable" : "", highlight && highlight(r) ? "highlight" : ""].join(" ").trim() || null });
      for (const c of cols) {
        const td = h("td", { class: c.text ? "text" : null });
        const out = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
        if (typeof out === "string" && out.startsWith("<")) td.innerHTML = out;
        else td.textContent = out ?? "";
        tr.append(td);
      }
      if (onRowClick) tr.addEventListener("click", () => onRowClick(r));
      return tr;
    }));
  }
  render();
  return h("div", { class: "table-wrap" }, table);
}
