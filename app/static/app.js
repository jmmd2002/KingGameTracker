"use strict";

const state = {
  roundTypes: [],
  players: [],
  sortKey: "game_win_rate",
  sortRound: null,
  sortDir: "desc",
  showArchived: false,
  editingId: null,
};

const fmtPct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const fmtNum = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
const fmtDate = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString() : "—");

// Each sort: label, value getter (null = no data, always sorted last),
// default direction, and how to show it as the card's headline number.
const SORTS = {
  name: {
    label: "Name", dir: "asc", text: true,
    get: (p) => p.name.toLocaleLowerCase(),
  },
  game_win_rate: {
    label: "Game win rate", dir: "desc",
    get: (p) => p.games.win_rate,
    show: (p) => [fmtPct(p.games.win_rate), `${p.games.won}/${p.games.played} games`],
  },
  round_win_rate: {
    label: "Win rate in one round", dir: "desc", needsRound: true,
    get: (p) => p.rounds[state.sortRound]?.win_rate ?? null,
    show: (p) => {
      const r = p.rounds[state.sortRound];
      return [fmtPct(r.win_rate), `${r.won}/${r.played} ${roundName(state.sortRound)}`];
    },
  },
  overall_round_win_rate: {
    label: "Win rate, all rounds", dir: "desc",
    get: (p) => p.rounds_overall.win_rate,
    show: (p) => [fmtPct(p.rounds_overall.win_rate), `${p.rounds_overall.won}/${p.rounds_overall.played} rounds`],
  },
  avg_points: {
    label: "Average points per game", dir: "desc",
    get: (p) => p.games.avg_points,
    show: (p) => [fmtNum(p.games.avg_points), "avg per game"],
  },
  best_game: {
    label: "Best game", dir: "desc",
    get: (p) => p.games.best_total,
    show: (p) => [fmtNum(p.games.best_total), "best game"],
  },
  games_played: {
    label: "Games played", dir: "desc",
    get: (p) => p.games.played,
    show: (p) => [String(p.games.played), "games"],
  },
  last_played: {
    label: "Last played", dir: "desc", text: true,
    get: (p) => p.last_played_at,
    show: (p) => [fmtDate(p.last_played_at), "last played"],
  },
  created: {
    label: "Recently added", dir: "desc", text: true,
    get: (p) => p.created_at,
  },
};

const $ = (id) => document.getElementById(id);
const roundName = (key) => state.roundTypes.find((r) => r.key === key)?.name ?? key;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) node.append(c);
  }
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

// ---------- sorting ----------

function compare(a, b) {
  const sort = SORTS[state.sortKey];
  const va = sort.get(a);
  const vb = sort.get(b);
  // Players with no data go last regardless of direction.
  if (va == null && vb != null) return 1;
  if (vb == null && va != null) return -1;
  let diff = 0;
  if (va != null && vb != null) {
    diff = sort.text ? String(va).localeCompare(String(vb)) : va - vb;
    if (state.sortDir === "desc") diff = -diff;
  }
  // Ties: more games first (a 100% over 10 games beats 100% over 1), then name.
  return diff || b.games.played - a.games.played || a.name.localeCompare(b.name);
}

// ---------- rendering ----------

function headline(p) {
  const sort = SORTS[state.sortKey];
  const show = sort.show ?? SORTS.game_win_rate.show;
  const [value, sub] = show(p);
  return el("div", { class: "headline" }, el("strong", {}, value), el("span", {}, sub));
}

function statTile(label, bucket, highlight) {
  return el(
    "div",
    { class: "stat" + (highlight ? " highlight" : "") },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, fmtPct(bucket.win_rate)),
    el("div", { class: "sub" },
      bucket.played ? `${bucket.won}/${bucket.played} won · avg ${fmtNum(bucket.avg_points)}` : "not played"),
    el("div", { class: "bar" }, el("i", { style: `width:${(bucket.win_rate ?? 0) * 100}%` })),
  );
}

function playerCard(p, index) {
  const editing = state.editingId === p.id;

  const nameNode = editing
    ? el("form", { class: "edit-row", onsubmit: (e) => { e.preventDefault(); saveName(p.id, e.target.elements.name.value); } },
        el("label", { class: "sr-only", for: `edit-${p.id}` }, "Player name"),
        el("input", { id: `edit-${p.id}`, name: "name", value: p.name, maxlength: 40, required: true }),
        el("button", { type: "submit", class: "primary small" }, "Save"),
        el("button", { type: "button", class: "small", onclick: () => { state.editingId = null; render(); } }, "Cancel"))
    : el("div", { class: "player-name" }, p.name, p.archived ? el("span", { class: "badge" }, "removed") : null);

  const g = p.games;
  const tiles = [
    statTile("Games", g, state.sortKey === "game_win_rate"),
    statTile("All rounds", p.rounds_overall, state.sortKey === "overall_round_win_rate"),
    ...state.roundTypes.map((rt) =>
      statTile(rt.name, p.rounds[rt.key], state.sortKey === "round_win_rate" && state.sortRound === rt.key)),
  ];

  const actions = editing ? null : el("div", { class: "actions" },
    p.archived
      ? el("button", { type: "button", class: "small", onclick: () => restore(p) }, "Restore")
      : [
          el("button", { type: "button", class: "small", onclick: () => { state.editingId = p.id; render(); } }, "Edit"),
          el("button", { type: "button", class: "small danger", onclick: () => remove(p) }, "Remove"),
        ]);

  return el("li", { class: "player" + (p.archived ? " archived" : "") },
    el("div", { class: "player-head" },
      el("span", { class: "rank" }, `${index + 1}.`),
      nameNode,
      editing ? null : headline(p)),
    el("details", {},
      el("summary", {}, g.played
        ? `Stats · best game ${fmtNum(g.best_total)} · last played ${fmtDate(p.last_played_at)}`
        : "Stats · no games yet"),
      el("div", { class: "stats-grid" }, tiles)),
    actions);
}

function render() {
  const list = $("player-list");
  const players = [...state.players].sort(compare);
  list.replaceChildren(
    ...(players.length
      ? players.map(playerCard)
      : [el("li", { class: "empty" }, "No players yet. Add the first one above.")]),
  );
  const active = players.filter((p) => !p.archived).length;
  $("status").textContent = players.length ? `${active} player${active === 1 ? "" : "s"}` : "";
  $("sort-dir").textContent = state.sortDir === "asc" ? "↑" : "↓";
  $("sort-dir").setAttribute("aria-label", state.sortDir === "asc" ? "Ascending" : "Descending");
  $("round-field").hidden = !SORTS[state.sortKey].needsRound;

  if (state.editingId != null) {
    const input = $(`edit-${state.editingId}`);
    input?.focus();
    input?.select();
  }
}

// ---------- actions ----------

async function load() {
  state.players = await api(`/api/players${state.showArchived ? "?archived=1" : ""}`);
  render();
}

function showError(msg) {
  $("form-error").textContent = msg;
  $("form-error").hidden = !msg;
}

async function addPlayer(e) {
  e.preventDefault();
  const input = $("new-name");
  try {
    await api("/api/players", { method: "POST", body: { name: input.value } });
    input.value = "";
    showError("");
    await load();
  } catch (err) {
    showError(err.message);
  }
  input.focus();
}

async function saveName(id, name) {
  try {
    await api(`/api/players/${id}`, { method: "PATCH", body: { name } });
    state.editingId = null;
    showError("");
    await load();
  } catch (err) {
    showError(err.message);
  }
}

async function remove(p) {
  const msg = p.games.played || p.rounds_overall.played
    ? `Remove ${p.name}? They have played games, so their history is kept and they can be restored later.`
    : `Remove ${p.name}? They have no games, so they will be deleted.`;
  if (!confirm(msg)) return;
  try {
    await api(`/api/players/${p.id}`, { method: "DELETE" });
    showError("");
    await load();
  } catch (err) {
    showError(err.message);
  }
}

async function restore(p) {
  try {
    await api(`/api/players/${p.id}`, { method: "PATCH", body: { archived: false } });
    showError("");
    await load();
  } catch (err) {
    showError(err.message);
  }
}

// ---------- setup ----------

const PREFS_KEY = "king-tracker:sort";

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      sortKey: state.sortKey, sortRound: state.sortRound, sortDir: state.sortDir,
    }));
  } catch { /* storage unavailable; ignore */ }
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (p && SORTS[p.sortKey]) Object.assign(state, p);
  } catch { /* ignore */ }
}

async function init() {
  loadPrefs();
  state.roundTypes = await api("/api/round-types");
  if (!state.roundTypes.some((r) => r.key === state.sortRound)) state.sortRound = state.roundTypes[0]?.key;

  const sortKey = $("sort-key");
  for (const [key, s] of Object.entries(SORTS)) sortKey.append(el("option", { value: key }, s.label));
  sortKey.value = state.sortKey;
  sortKey.addEventListener("change", () => {
    state.sortKey = sortKey.value;
    state.sortDir = SORTS[state.sortKey].dir;
    savePrefs();
    render();
  });

  const sortRound = $("sort-round");
  for (const rt of state.roundTypes) sortRound.append(el("option", { value: rt.key }, rt.name));
  sortRound.value = state.sortRound;
  sortRound.addEventListener("change", () => { state.sortRound = sortRound.value; savePrefs(); render(); });

  $("sort-dir").addEventListener("click", () => {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    savePrefs();
    render();
  });

  $("show-archived").addEventListener("change", (e) => { state.showArchived = e.target.checked; load(); });
  $("add-form").addEventListener("submit", addPlayer);

  await load();
}

init().catch((err) => showError(err.message));
