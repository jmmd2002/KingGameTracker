"use strict";

/* =========================================================================
   State
   ========================================================================= */

const state = {
  roundTypes: [],
  players: [], // all players, including removed
  summary: null,
  roundAverages: {}, // round key -> group win rate
  filter: "active",
  search: "",
  sortKey: "win_rate",
  sortDir: "desc",
  drawerId: null,
  drawerDetail: null,
  renaming: false,
  loading: true,
};

const SHORT_ROUND = { rei_de_copas: "Rei", ultimos_dois: "Últimos" };
// Mini playing-card glyph per round: [text, red ink?]
const ROUND_GLYPH = {
  vazas: ["♠", false],
  copas: ["♥", true],
  homens: ["KJ", false],
  damas: ["Q", false],
  rei_de_copas: ["K♥", true],
  ultimos_dois: ["2", false],
};
const SUITS = [["♠", false], ["♥", true], ["♦", true], ["♣", false]];
// "Better" sorts where the top row earns a crown (only in their natural direction).
const CROWN_SORTS = new Set(["win_rate", "wins", "avg_place", "avg_points", "best", "all_rounds"]);
const PREFS_KEY = "king-tracker:prefs";
const THEME_KEY = "king-tracker:theme";

/* =========================================================================
   Formatting
   ========================================================================= */

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const fmtPct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const fmtPts = (v) => (v == null ? "—" : nf.format(Math.round(v)).replace("-", "−"));
const fmtPlace = (v) => (v == null ? "—" : v.toFixed(2));
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? "th"}`;
const parseDate = (s) => (s ? new Date(s.replace(" ", "T") + "Z") : null);
const fmtDate = (s) =>
  s ? parseDate(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtMonth = (s) => (s ? parseDate(s).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");

function fmtAgo(s) {
  if (!s) return "Never";
  const diff = (parseDate(s) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "Just now";
}

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const roundName = (key) => state.roundTypes.find((r) => r.key === key)?.name ?? key;
const heatClass = (rate) => (rate == null ? "none" : `h${Math.min(6, Math.floor(rate * 7))}`);

/* =========================================================================
   DOM helpers
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

// SVG icons are static strings (no user data), so innerHTML is safe here.
function icon(markup, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = markup;
  const svg = span.firstElementChild;
  if (cls) svg.setAttribute("class", cls);
  return svg;
}

const ICONS = {
  caret: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>',
  dots: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16h3l8.5-8.5-3-3L4 13z"/></svg>',
  trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>',
  restore: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 4v3h3"/></svg>',
  arrowDown: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M5 11l5 5 5-5"/></svg>',
  arrowUp: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5"/></svg>',
  sun: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z"/></svg>',
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 17h6"/></svg>',
};

// Each player is a playing card: their initials, with a suit that follows their id.
function avatar(p, size = "") {
  const [suit, red] = SUITS[p.id % SUITS.length];
  return h("span", { class: ["pcard", size, red && "red"].filter(Boolean).join(" "), "aria-hidden": "true" },
    h("span", { class: "pip tl" }, suit), initials(p.name), h("span", { class: "pip br" }, suit));
}

function roundCard(key) {
  const [text, red] = ROUND_GLYPH[key] ?? ["?", false];
  return h("span", { class: `rcard${red ? " red" : ""}`, "aria-hidden": "true" }, text);
}

function crown() {
  return icon('<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 25h22l-2-14-5.6 5L16 6l-3.4 10L7 11z"/><circle cx="16" cy="5" r="1.8"/><circle cx="6.5" cy="10" r="1.6"/><circle cx="25.5" cy="10" r="1.6"/></svg>', "crown-sm");
}

function wearsCrown(p, index) {
  if (index !== 0) return false;
  const sort = SORTS[state.sortKey];
  const crownable = CROWN_SORTS.has(state.sortKey) || state.sortKey.startsWith("r:");
  return crownable && state.sortDir === sort.dir && sort.get(p) != null;
}

/* =========================================================================
   API
   ========================================================================= */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  const [players, summary] = await Promise.all([api("/api/players?archived=1"), api("/api/summary")]);
  state.players = players;
  state.summary = summary;
  state.roundAverages = {};
  for (const rt of state.roundTypes) {
    let won = 0, played = 0;
    for (const p of players) { won += p.rounds[rt.key].won; played += p.rounds[rt.key].played; }
    state.roundAverages[rt.key] = played ? won / played : null;
  }
  state.loading = false;
  render();
  if (state.drawerId != null) await loadDrawer(state.drawerId);
}

/* =========================================================================
   Columns & sorting
   ========================================================================= */

function buildColumns() {
  const cols = [
    { key: "rank", label: "#", cls: "rank-col sticky-1" },
    { key: "name", label: "Player", cls: "sticky-2", sort: { get: (p) => p.name.toLocaleLowerCase(), text: true, dir: "asc" } },
    { key: "games", label: "Games", cls: "num", sort: { get: (p) => p.games.played, dir: "desc" } },
    { key: "wins", label: "Wins", cls: "num", sort: { get: (p) => p.games.won, dir: "desc" } },
    { key: "win_rate", label: "Win rate", sort: { get: (p) => p.games.win_rate, dir: "desc" } },
    { key: "avg_place", label: "Avg place", cls: "num", sort: { get: (p) => p.games.avg_place, dir: "asc" } },
    { key: "avg_points", label: "Avg pts", cls: "num", sort: { get: (p) => p.games.avg_points, dir: "desc" } },
    { key: "best", label: "Best game", cls: "num", sort: { get: (p) => p.games.best_total, dir: "desc" } },
  ];
  state.roundTypes.forEach((rt, i) => {
    cols.push({
      key: `r:${rt.key}`,
      label: SHORT_ROUND[rt.key] ?? rt.name,
      title: `${rt.name}: ${rt.rule.toLowerCase()}`,
      cls: "heat-col" + (i === 0 ? " heat-first" : "") + (i === state.roundTypes.length - 1 ? " heat-last" : ""),
      round: rt.key,
      sort: { get: (p) => p.rounds[rt.key].win_rate, dir: "desc", label: `${rt.name} win rate` },
    });
  });
  cols.push(
    { key: "last_played", label: "Last played", sort: { get: (p) => p.last_played_at, text: true, dir: "desc" } },
    { key: "actions", label: "", cls: "actions-col" },
  );
  return cols;
}

let COLUMNS = [];
let SORTS = {};

function buildSorts() {
  SORTS = {};
  for (const c of COLUMNS) if (c.sort) SORTS[c.key] = { label: c.sort.label ?? c.label, ...c.sort };
  SORTS.all_rounds = { label: "Win rate, all rounds", get: (p) => p.rounds_overall.win_rate, dir: "desc" };
  SORTS.created = { label: "Recently joined", get: (p) => p.created_at, text: true, dir: "desc" };
  SORTS.name.label = "Name";
  SORTS.win_rate.label = "Game win rate";
}

function compare(a, b) {
  const sort = SORTS[state.sortKey];
  const va = sort.get(a);
  const vb = sort.get(b);
  if (va == null && vb != null) return 1; // no data always last
  if (vb == null && va != null) return -1;
  let diff = 0;
  if (va != null && vb != null) {
    diff = sort.text ? String(va).localeCompare(String(vb)) : va - vb;
    if (state.sortDir === "desc") diff = -diff;
  }
  return diff || b.games.played - a.games.played || a.name.localeCompare(b.name);
}

function visiblePlayers() {
  const q = state.search.trim().toLocaleLowerCase();
  return state.players
    .filter((p) => (state.filter === "all" ? true : state.filter === "archived" ? p.archived : !p.archived))
    .filter((p) => !q || p.name.toLocaleLowerCase().includes(q))
    .sort(compare);
}

function setSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  else { state.sortKey = key; state.sortDir = SORTS[key].dir; }
  savePrefs();
  render();
}

/* =========================================================================
   Rendering: KPIs
   ========================================================================= */

function kpi(label, value, sub, valueCls = "") {
  return h("div", { class: "kpi" },
    h("div", { class: "kpi-label" }, label),
    h("div", { class: `kpi-value ${valueCls}`.trim(), title: typeof value === "string" ? value : null }, value),
    h("div", { class: "kpi-sub" }, sub));
}

const leaderValue = (p) => (p ? [crown(), h("span", {}, p.name)] : "—");

function renderKpis() {
  const root = $("#kpis");
  if (!state.summary) {
    root.replaceChildren(...Array.from({ length: 5 }, () =>
      h("div", { class: "kpi" }, h("span", { class: "skeleton", style: { width: "40%" } }),
        h("span", { class: "skeleton", style: { width: "60%", height: "24px", marginTop: "10px" } }))));
    return;
  }
  const s = state.summary;
  const active = state.players.filter((p) => !p.archived);
  const leader = [...active].filter((p) => p.games.won > 0)
    .sort((a, b) => b.games.won - a.games.won || (b.games.win_rate ?? 0) - (a.games.win_rate ?? 0))[0];
  const qualified = active.filter((p) => p.games.played >= 5);
  const bestRate = [...qualified].sort((a, b) => b.games.win_rate - a.games.win_rate)[0];
  const removed = state.players.length - active.length;

  root.replaceChildren(
    kpi("Players", nf.format(s.players), removed ? `${removed} removed` : "All active"),
    kpi("Games played", nf.format(s.games),
      s.games_in_progress ? h("span", { class: "badge live" }, `${s.games_in_progress} in progress`) : `Last ${fmtAgo(s.last_game_at).toLowerCase()}`),
    kpi("Most wins", leaderValue(leader), leader ? `${leader.games.won} wins in ${leader.games.played} games` : "No games yet", "name"),
    kpi("Best win rate", bestRate ? h("span", {}, bestRate.name) : "—", bestRate ? `${fmtPct(bestRate.games.win_rate)} · min. 5 games` : "Needs 5+ games", "name"),
    kpi("Rounds played", nf.format(s.rounds), `${state.roundTypes.length} round types`),
  );
}

/* =========================================================================
   Rendering: table
   ========================================================================= */

function renderHead() {
  const thead = $("#grid thead");
  const firstRound = COLUMNS.findIndex((c) => c.round);
  const roundCount = COLUMNS.filter((c) => c.round).length;
  const group = h("tr", { class: "group" },
    h("th", { class: "sticky-1" }),
    h("th", { colspan: firstRound - 1 }),
    h("th", { colspan: roundCount, class: "group-label" }, h("span", {}, "Round win rate")),
    h("th", { colspan: COLUMNS.length - firstRound - roundCount }));

  const row = h("tr", {}, COLUMNS.map((c) => {
    const active = state.sortKey === c.key;
    const th = h("th", {
      class: [c.cls, c.sort && "sortable"].filter(Boolean).join(" ") || null,
      scope: "col",
      title: c.title ?? null,
      "aria-sort": active ? (state.sortDir === "asc" ? "ascending" : "descending") : null,
      tabindex: c.sort ? "0" : null,
      onclick: c.sort ? () => setSort(c.key) : null,
      onkeydown: c.sort ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort(c.key); } } : null,
    }, h("span", { class: "th-inner" }, c.round ? roundCard(c.round) : null, c.label, c.sort ? icon(ICONS.caret, "caret") : null));
    return th;
  }));
  thead.replaceChildren(group, row);
}

function cell(p, c, index) {
  const g = p.games;
  switch (c.key) {
    case "rank": {
      const ranked = !["name", "created"].includes(state.sortKey) && SORTS[state.sortKey].get(p) != null;
      return h("td", { class: "rank-col sticky-1 num", "aria-label": ranked ? `Rank ${index + 1}` : null },
        wearsCrown(p, index) ? crown() : ranked ? index + 1 : "");
    }
    case "name":
      return h("td", { class: "sticky-2" }, h("div", { class: "player-cell" }, avatar(p),
        h("div", { class: "who" },
          h("div", { class: "name" }, p.name),
          h("div", { class: "meta" }, p.archived ? h("span", { class: "badge" }, "Removed") : `Joined ${fmtMonth(p.created_at)}`))));
    case "games": return h("td", { class: "num" }, g.played || h("span", { class: "muted" }, "0"));
    case "wins": return h("td", { class: "num" }, g.won);
    case "win_rate":
      return h("td", {}, g.played
        ? h("div", { class: "rate" },
            h("div", { class: "rate-track" }, h("div", { class: "rate-fill", style: { width: `${g.win_rate * 100}%` } })),
            h("span", { class: "rate-val" }, fmtPct(g.win_rate)))
        : h("span", { class: "muted" }, "—"));
    case "avg_place": return h("td", { class: "num" }, fmtPlace(g.avg_place));
    case "avg_points": return h("td", { class: "num" }, fmtPts(g.avg_points));
    case "best": return h("td", { class: "num" }, fmtPts(g.best_total));
    case "last_played":
      return h("td", { class: "muted-cell", title: p.last_played_at ? fmtDate(p.last_played_at) : null }, fmtAgo(p.last_played_at));
    case "actions":
      return h("td", { class: "actions-col" }, h("button", {
        class: "btn ghost icon-btn row-menu-btn", type: "button",
        "aria-label": `Actions for ${p.name}`, "aria-haspopup": "menu", "aria-expanded": "false",
        onclick: (e) => { e.stopPropagation(); openMenu(e.currentTarget, p); },
      }, icon(ICONS.dots)));
    default: {
      const r = p.rounds[c.round];
      const td = h("td", { class: c.cls },
        h("span", { class: `heat ${heatClass(r.win_rate)}` }, r.played ? fmtPct(r.win_rate) : "—"));
      td.addEventListener("pointerenter", (e) => showTooltip(e, roundTooltip(p, c.round)));
      td.addEventListener("pointerleave", hideTooltip);
      return td;
    }
  }
}

function roundTooltip(p, key) {
  const r = p.rounds[key];
  const avg = state.roundAverages[key];
  return [
    h("div", { class: "t-title" }, roundCard(key), `${p.name} · ${roundName(key)}`),
    h("div", { class: "t-row" }, "Win rate", h("b", {}, fmtPct(r.win_rate))),
    h("div", { class: "t-row" }, "Won", h("b", {}, `${r.won} of ${r.played}`)),
    h("div", { class: "t-row" }, "Avg points", h("b", {}, fmtPts(r.avg_points))),
    h("div", { class: "t-row" }, "Group average", h("b", {}, fmtPct(avg))),
  ];
}

function renderTable(players) {
  const tbody = $("#grid tbody");
  if (state.loading) {
    tbody.replaceChildren(...Array.from({ length: 6 }, () => h("tr", {}, COLUMNS.map(() =>
      h("td", {}, h("span", { class: "skeleton", style: { width: `${40 + Math.random() * 40}%` } }))))));
    return;
  }
  if (!players.length) {
    tbody.replaceChildren(h("tr", {}, h("td", { colspan: COLUMNS.length }, emptyState())));
    return;
  }
  tbody.replaceChildren(...players.map((p, i) => h("tr", {
    class: [p.archived && "archived", state.drawerId === p.id && "selected"].filter(Boolean).join(" ") || null,
    tabindex: "0",
    "aria-label": `${p.name}, open details`,
    onclick: () => openDrawer(p.id),
    onkeydown: (e) => { if (e.key === "Enter") openDrawer(p.id); },
  }, COLUMNS.map((c) => cell(p, c, i)))));
}

const suitsRow = () => h("div", { class: "suits", "aria-hidden": "true" },
  "♠", h("span", { class: "red" }, "♥"), h("span", { class: "red" }, "♦"), "♣");

function emptyState() {
  if (state.search) {
    return h("div", { class: "empty" }, suitsRow(), h("strong", {}, "No matches"), `Nobody called “${state.search}”.`);
  }
  if (state.filter === "archived") {
    return h("div", { class: "empty" }, suitsRow(), h("strong", {}, "No removed players"), "Players you remove after they've played show up here.");
  }
  return h("div", { class: "empty" }, suitsRow(), h("strong", {}, "No players yet"), "Add everyone who plays at your table.",
    h("div", {}, h("button", { class: "btn primary", type: "button", onclick: openNewDialog }, "Add the first player")));
}

/* =========================================================================
   Rendering: mobile cards
   ========================================================================= */

function cardStat(p) {
  const sort = SORTS[state.sortKey];
  const key = state.sortKey;
  if (key.startsWith("r:")) {
    const r = p.rounds[key.slice(2)];
    return [fmtPct(r.win_rate), `${roundName(key.slice(2))}`];
  }
  const map = {
    games: [String(p.games.played), "games"],
    wins: [String(p.games.won), "wins"],
    avg_place: [fmtPlace(p.games.avg_place), "avg place"],
    avg_points: [fmtPts(p.games.avg_points), "avg pts"],
    best: [fmtPts(p.games.best_total), "best game"],
    last_played: [fmtAgo(p.last_played_at), "last played"],
    all_rounds: [fmtPct(p.rounds_overall.win_rate), "all rounds"],
  };
  return map[key] ?? (sort ? [fmtPct(p.games.win_rate), "win rate"] : ["", ""]);
}

function renderCards(players) {
  const list = $("#cards");
  if (state.loading) { list.replaceChildren(); return; }
  if (!players.length) { list.replaceChildren(h("li", {}, emptyState())); return; }
  list.replaceChildren(...players.map((p, i) => {
    const [value, label] = cardStat(p);
    const ranked = !["name", "created"].includes(state.sortKey) && SORTS[state.sortKey].get(p) != null;
    return h("li", {
      class: `card${p.archived ? " archived" : ""}`, tabindex: "0",
      onclick: () => openDrawer(p.id),
      onkeydown: (e) => { if (e.key === "Enter") openDrawer(p.id); },
    },
      h("div", { class: "card-head" },
        h("span", { class: "rank" }, wearsCrown(p, i) ? crown() : ranked ? i + 1 : ""),
        avatar(p),
        h("div", { class: "who" },
          h("div", { class: "name" }, h("span", {}, p.name), p.archived ? h("span", { class: "badge" }, "Removed") : null),
          h("div", { class: "meta" }, p.games.played
            ? `${p.games.played} games · avg place ${fmtPlace(p.games.avg_place)}`
            : "No games yet")),
        h("div", { class: "card-stat" }, h("strong", {}, value), h("span", {}, label))),
      h("div", { class: "strip" }, state.roundTypes.map((rt) => {
        const r = p.rounds[rt.key];
        return h("div", { class: "cell" },
          h("span", { class: `heat ${heatClass(r.win_rate)}` }, r.played ? fmtPct(r.win_rate) : "—"),
          h("span", { class: "lbl", title: rt.name }, SHORT_ROUND[rt.key] ?? rt.name));
      })));
  }));
}

/* =========================================================================
   Rendering: toolbar, footer
   ========================================================================= */

function renderToolbar() {
  for (const b of document.querySelectorAll(".segmented button")) {
    b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
  }
  $("#sort-select").value = state.sortKey;
  const dir = $("#sort-dir");
  dir.replaceChildren(icon(state.sortDir === "asc" ? ICONS.arrowUp : ICONS.arrowDown));
  dir.setAttribute("aria-label", state.sortDir === "asc" ? "Ascending, tap to reverse" : "Descending, tap to reverse");
}

function renderFoot(players) {
  const total = state.players.filter((p) => state.filter === "all" || (state.filter === "archived") === p.archived).length;
  const ramp = h("span", { class: "legend-ramp", "aria-hidden": "true" },
    [0, 1, 2, 3, 4, 5, 6].map((i) => h("i", { style: { background: `var(--heat-${i})` } })));
  $("#foot").replaceChildren(
    h("span", {}, state.loading ? "Loading…" : `Showing ${players.length} of ${total}`),
    h("span", { class: "legend" }, "Round win rate: 0%", ramp, "100%"),
  );
}

function render() {
  const players = state.loading ? [] : visiblePlayers();
  renderKpis();
  renderHead();
  renderTable(players);
  renderCards(players);
  renderToolbar();
  renderFoot(players);
}

/* =========================================================================
   Drawer
   ========================================================================= */

const drawer = $("#drawer");
const scrim = $("#scrim");
let lastFocus = null;

async function openDrawer(id) {
  if (state.drawerId !== id) { state.renaming = false; state.drawerDetail = null; }
  state.drawerId = id;
  lastFocus = document.activeElement;
  drawer.classList.add("open");
  scrim.classList.add("open");
  drawer.removeAttribute("inert");
  document.body.style.overflow = "hidden";
  renderDrawer();
  render();
  await loadDrawer(id);
  $(".drawer-close", drawer)?.focus();
}

async function loadDrawer(id) {
  try {
    const detail = await api(`/api/players/${id}`);
    if (state.drawerId === id) { state.drawerDetail = detail; renderDrawer(); }
  } catch (err) {
    toast(err.message, { error: true });
    closeDrawer();
  }
}

function closeDrawer() {
  state.drawerId = null;
  state.drawerDetail = null;
  state.renaming = false;
  drawer.classList.remove("open");
  scrim.classList.remove("open");
  drawer.setAttribute("inert", "");
  document.body.style.overflow = "";
  hideTooltip();
  render();
  lastFocus?.focus?.();
}

function renderDrawer() {
  const p = state.drawerDetail ?? state.players.find((x) => x.id === state.drawerId);
  if (!p) return;
  const g = p.games;

  const title = state.renaming
    ? h("form", { class: "rename-form", onsubmit: (e) => { e.preventDefault(); rename(p, e.target.elements.name.value); } },
        h("label", { class: "sr-only", for: "rename-input" }, "Player name"),
        h("input", { id: "rename-input", name: "name", value: p.name, maxlength: "40", required: true }),
        h("button", { class: "btn primary", type: "submit" }, "Save"),
        h("button", { class: "btn", type: "button", onclick: () => { state.renaming = false; renderDrawer(); } }, "Cancel"))
    : h("h2", { id: "drawer-title" }, p.name);

  const actions = p.archived
    ? [h("button", { class: "btn", type: "button", onclick: () => restore(p) }, icon(ICONS.restore), "Restore player")]
    : [
        h("button", { class: "btn", type: "button", onclick: () => { state.renaming = true; renderDrawer(); } }, icon(ICONS.edit), "Rename"),
        h("button", { class: "btn subtle-danger", type: "button", onclick: () => confirmRemove(p) }, icon(ICONS.trash), "Remove"),
      ];

  const head = h("div", { class: "drawer-head" },
    avatar(p, "lg"),
    h("div", { class: "who" },
      title,
      h("p", { class: "field-error", id: "rename-error", role: "alert" }),
      h("div", { class: "meta" },
        p.archived ? h("span", { class: "badge" }, "Removed") : null,
        `Joined ${fmtDate(p.created_at)} · Last played ${fmtAgo(p.last_played_at).toLowerCase()}`),
      state.renaming ? null : h("div", { class: "drawer-actions" }, actions)),
    h("button", { class: "btn ghost icon-btn drawer-close", type: "button", "aria-label": "Close", onclick: closeDrawer }, icon(ICONS.close)));

  const mini = (k, v) => h("div", { class: "mini-kpi" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v));
  const body = h("div", { class: "drawer-body" },
    h("div", { class: "mini-kpis" },
      mini("Games", g.played),
      mini("Win rate", fmtPct(g.win_rate)),
      mini("Avg place", fmtPlace(g.avg_place)),
      mini("Wins", g.won),
      mini("Avg points", fmtPts(g.avg_points)),
      mini("Best game", fmtPts(g.best_total))),
    roundBarsSection(p),
    trendSection(p),
    formSection(p));

  drawer.replaceChildren(head, body);
  if (state.renaming) { const i = $("#rename-input"); i.focus(); i.select(); }
}

function roundBarsSection(p) {
  const rows = state.roundTypes.map((rt) => {
    const r = p.rounds[rt.key];
    const avg = state.roundAverages[rt.key];
    const row = h("div", { class: "bar-row bar-hit" },
      h("span", { class: "lbl", title: rt.name }, roundCard(rt.key), h("span", {}, rt.name)),
      h("div", { class: "bar-track" },
        r.played ? h("div", { class: "bar-fill", style: { width: `${r.win_rate * 100}%` } }) : null,
        avg != null ? h("div", { class: "bar-avg", style: { left: `${avg * 100}%` } }) : null),
      h("span", { class: "val" }, h("b", {}, fmtPct(r.win_rate)), " ", h("span", {}, r.played ? `${r.won}/${r.played}` : "")));
    row.addEventListener("pointerenter", (e) => showTooltip(e, roundTooltip(p, rt.key)));
    row.addEventListener("pointermove", moveTooltip);
    row.addEventListener("pointerleave", hideTooltip);
    return row;
  });
  return h("section", { class: "section" },
    h("h3", {}, "Win rate by round"),
    h("p", { class: "hint" }, "A round is won by having the best score in it. Ties count for everyone tied."),
    h("div", { class: "bars" }, rows),
    h("div", { class: "chart-legend" },
      h("span", {}, h("i", { class: "sw-bar" }), p.name.split(" ")[0]),
      h("span", {}, h("i", { class: "sw-avg" }), "Group average")));
}

function formSection(p) {
  const history = p.history;
  if (!history) return null;
  const recent = history.slice(-10).reverse();
  return h("section", { class: "section" },
    h("h3", {}, "Recent form"),
    h("p", { class: "hint" }, recent.length ? "Finishing place in the last 10 games, newest first." : "No finished games yet."),
    h("div", { class: "form" }, recent.map((g) => {
      const chip = h("span", { class: `place p${g.place}` }, g.place === 1 ? crown() : null, ordinal(g.place));
      chip.addEventListener("pointerenter", (e) => showTooltip(e, [
        h("div", { class: "t-title" }, fmtDate(g.date)),
        h("div", { class: "t-row" }, "Place", h("b", {}, `${ordinal(g.place)} of ${g.seats}`)),
        h("div", { class: "t-row" }, "Points", h("b", {}, fmtPts(g.total))),
      ]));
      chip.addEventListener("pointerleave", hideTooltip);
      return chip;
    })));
}

function trendSection(p) {
  const history = p.history;
  const section = h("section", { class: "section" },
    h("h3", {}, "Points per game"),
    h("p", { class: "hint" }, history?.length ? `Last ${history.length} finished games. Closer to 0 is better.` : "No finished games yet."));
  if (!history) {
    section.append(h("span", { class: "skeleton", style: { height: "160px" } }));
    return section;
  }
  if (history.length < 2) return section;
  const chart = h("div", { class: "line-chart" });
  section.append(chart, h("div", { class: "chart-legend" },
    h("span", {}, h("i", { class: "sw-line" }), "Points"),
    h("span", {}, h("i", { class: "sw-win" }), "Won the game")));
  requestAnimationFrame(() => drawTrend(chart, history));
  return section;
}

function niceStep(range) {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

function drawTrend(root, history) {
  const W = Math.max(260, root.clientWidth);
  const H = 170;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const totals = history.map((g) => g.total);
  const step = niceStep(Math.max(100, -Math.min(...totals)));
  const yMin = Math.floor(Math.min(...totals) / step) * step;
  const yMax = 0;
  const x = (i) => pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((yMax - v) / (yMax - yMin)) * (H - pad.t - pad.b);

  const ticks = [];
  for (let v = yMax; v >= yMin; v -= step) ticks.push(v);

  const line = history.map((g, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(g.total).toFixed(1)}`).join("");
  const area = `${line}L${x(history.length - 1).toFixed(1)},${y(yMin)}L${x(0).toFixed(1)},${y(yMin)}Z`;

  // Only numbers and formatted dates go into this markup; no user-entered text.
  root.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Points per game, last ${history.length} games">
      ${ticks.map((v) => `
        <line class="gridline ${v === 0 ? "zero" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtPts(v)}</text>`).join("")}
      <text class="axis-label" x="${pad.l}" y="${H - 4}">${fmtDate(history[0].date)}</text>
      <text class="axis-label" x="${W - pad.r}" y="${H - 4}" text-anchor="end">${fmtDate(history[history.length - 1].date)}</text>
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      ${history.map((g, i) => (g.place === 1 ? `<circle class="win" cx="${x(i)}" cy="${y(g.total)}" r="4.5"/>` : "")).join("")}
      <line class="crosshair" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      <circle class="dot" r="5" visibility="hidden"/>
      <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
    </svg>`;

  const svg = root.firstElementChild;
  const cross = svg.querySelector(".crosshair");
  const dot = svg.querySelector(".dot");
  const hit = svg.querySelector("rect");

  const onMove = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(history.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (history.length - 1))));
    const g = history[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(g.total)); dot.setAttribute("visibility", "visible");
    showTooltip(e, [
      h("div", { class: "t-title" }, fmtDate(g.date)),
      h("div", { class: "t-row" }, "Points", h("b", {}, fmtPts(g.total))),
      h("div", { class: "t-row" }, "Place", h("b", {}, `${ordinal(g.place)} of ${g.seats}`)),
    ]);
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    hideTooltip();
  });
}

/* =========================================================================
   Tooltip, menu, toast, dialogs
   ========================================================================= */

const tooltip = $("#tooltip");

function showTooltip(e, content) {
  tooltip.replaceChildren(...content);
  tooltip.hidden = false;
  moveTooltip(e);
}

function moveTooltip(e) {
  if (tooltip.hidden) return;
  const pad = 14;
  const { width, height } = tooltip.getBoundingClientRect();
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  if (left + width > window.innerWidth - 8) left = e.clientX - width - pad;
  if (top + height > window.innerHeight - 8) top = e.clientY - height - pad;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() { tooltip.hidden = true; }
document.addEventListener("pointermove", moveTooltip, { passive: true });

const menu = $("#menu");
let menuButton = null;

function openMenu(button, p) {
  closeMenu();
  menuButton = button;
  button.setAttribute("aria-expanded", "true");
  const items = p.archived
    ? [h("button", { role: "menuitem", type: "button", onclick: () => { closeMenu(); restore(p); } }, "Restore")]
    : [
        h("button", { role: "menuitem", type: "button", onclick: () => { closeMenu(); openDrawer(p.id); } }, "View details"),
        h("button", { role: "menuitem", type: "button", onclick: () => { closeMenu(); state.renaming = true; openDrawer(p.id).then(() => { state.renaming = true; renderDrawer(); }); } }, "Rename"),
        h("button", { role: "menuitem", type: "button", class: "danger", onclick: () => { closeMenu(); confirmRemove(p); } }, "Remove"),
      ];
  menu.replaceChildren(...items);
  menu.hidden = false;
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, r.right - w)}px`;
  menu.querySelector("button")?.focus();
}

function closeMenu() {
  menu.hidden = true;
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton = null;
}

document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuButton) closeMenu(); });
window.addEventListener("scroll", closeMenu, { passive: true, capture: true });

function toast(message, { error = false, action = null } = {}) {
  const el = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status" }, h("span", {}, message),
    action ? h("button", { type: "button", onclick: () => { el.remove(); action.run(); } }, action.label) : null);
  $("#toasts").append(el);
  setTimeout(() => el.remove(), action ? 6000 : 3500);
}

const newDialog = $("#new-dialog");
function openNewDialog() {
  $("#new-error").textContent = "";
  $("#new-name").value = "";
  newDialog.showModal();
  $("#new-name").focus();
}

$("#new-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#new-name").value;
  try {
    const p = await api("/api/players", { method: "POST", body: { name } });
    newDialog.close();
    if (state.filter === "archived") state.filter = "active";
    await refresh();
    toast(`${p.name} added`);
  } catch (err) {
    $("#new-error").textContent = err.message;
    $("#new-name").focus();
  }
});

const confirmDialog = $("#confirm-dialog");
function confirmRemove(p) {
  const hasHistory = p.games.played > 0 || p.rounds_overall.played > 0;
  $("#confirm-title").textContent = `Remove ${p.name}?`;
  $("#confirm-body").textContent = hasHistory
    ? "They'll be hidden from the list. Their games and stats are kept, and you can restore them any time from Removed."
    : "They haven't played any games, so they'll be deleted permanently.";
  $("#confirm-ok").textContent = hasHistory ? "Remove" : "Delete";
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  confirmDialog.addEventListener("close", async function onClose() {
    confirmDialog.removeEventListener("close", onClose);
    if (confirmDialog.returnValue !== "confirm") return;
    try {
      const { result } = await api(`/api/players/${p.id}`, { method: "DELETE" });
      if (state.drawerId === p.id && result === "deleted") closeDrawer();
      await refresh();
      if (result === "archived") toast(`${p.name} removed`, { action: { label: "Undo", run: () => restore(p) } });
      else toast(`${p.name} deleted`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

for (const d of [newDialog, confirmDialog]) {
  d.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === d) d.close(); });
}

async function rename(p, name) {
  try {
    await api(`/api/players/${p.id}`, { method: "PATCH", body: { name } });
    state.renaming = false;
    await refresh();
    toast("Name updated");
  } catch (err) {
    const el = $("#rename-error");
    if (el) el.textContent = err.message;
  }
}

async function restore(p) {
  try {
    await api(`/api/players/${p.id}`, { method: "PATCH", body: { archived: false } });
    await refresh();
    toast(`${p.name} restored`);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

/* =========================================================================
   Theme & prefs
   ========================================================================= */

function currentTheme() { return document.documentElement.dataset.theme ?? "system"; }

function renderThemeButton() {
  const t = currentTheme();
  const btn = $("#theme-btn");
  btn.replaceChildren(icon(t === "dark" ? ICONS.moon : t === "light" ? ICONS.sun : ICONS.system));
  btn.setAttribute("aria-label", `Theme: ${t}. Click to change.`);
  btn.title = `Theme: ${t}`;
}

$("#theme-btn").addEventListener("click", () => {
  const next = { system: "light", light: "dark", dark: "system" }[currentTheme()];
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  renderThemeButton();
  if (state.drawerId != null) renderDrawer();
});

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sortKey: state.sortKey, sortDir: state.sortDir, filter: state.filter })); } catch {}
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (!p) return;
    if (SORTS[p.sortKey]) { state.sortKey = p.sortKey; state.sortDir = p.sortDir === "asc" ? "asc" : "desc"; }
    if (["active", "archived", "all"].includes(p.filter)) state.filter = p.filter;
  } catch {}
}

/* =========================================================================
   Wiring
   ========================================================================= */

$("#new-btn").addEventListener("click", openNewDialog);
scrim.addEventListener("click", closeDrawer);

$("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });

for (const b of document.querySelectorAll(".segmented button")) {
  b.addEventListener("click", () => { state.filter = b.dataset.filter; savePrefs(); render(); });
}

$("#sort-select").addEventListener("change", (e) => {
  state.sortKey = e.target.value;
  state.sortDir = SORTS[state.sortKey].dir;
  savePrefs();
  render();
});
$("#sort-dir").addEventListener("click", () => { state.sortDir = state.sortDir === "asc" ? "desc" : "asc"; savePrefs(); render(); });

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) { e.preventDefault(); $("#search").focus(); }
  if (e.key === "Escape") {
    if (!menu.hidden) { closeMenu(); return; }
    if (state.renaming) { state.renaming = false; renderDrawer(); return; }
    if (state.drawerId != null && !document.querySelector("dialog[open]")) closeDrawer();
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.drawerId != null) renderDrawer(); }, 150);
});

async function init() {
  renderThemeButton();
  state.roundTypes = await api("/api/round-types");
  COLUMNS = buildColumns();
  buildSorts();
  loadPrefs();
  const select = $("#sort-select");
  for (const [key, s] of Object.entries(SORTS)) select.append(h("option", { value: key }, s.label));
  render();
  await refresh();
}

init().catch((err) => toast(err.message, { error: true }));
