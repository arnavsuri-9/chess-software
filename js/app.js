/* ============================================================
   APP — entry point. Owns round orchestration, tab switching
   and every event listener (delegated, so re-rendering never
   leaves a stale handler behind).
   ============================================================ */
import { S, RESULTS, byId, syncRounds, recomputeStats, roundComplete,
         addPlayer, removePlayer, renamePlayer, rerate, canAddPlayer,
         withdrawPlayer, reinstatePlayer,
         setResult, clearResult } from "./state.js";
import { buildSchedule } from "./pairing-roundrobin.js";
import { swissRound1, swissNext } from "./pairing-swiss.js";
import { koRound } from "./pairing-knockout.js";
import { exportPlayers, exportPairings, exportResults } from "./export.js";
import { saveCurrent, beginRecord, restore, find, remove } from "./storage.js";
import { render } from "./render.js";

/* Autosave runs after every result entry and every round advance, so
   closing the tab never loses a tournament. A failure (storage full or
   blocked) surfaces once rather than silently doing nothing. */
let saveWarned = false;
function autosave() {
  const res = saveCurrent();
  if (!res.ok && !saveWarned) {
    saveWarned = true;
    window.alert("Could not save this tournament.\n\n" + res.error +
      "\n\nPlay can continue, but it will be lost when the tab closes.");
  }
}

/* ============================================================
   ROUND ORCHESTRATION
   ============================================================ */
/* Who may be paired in round n: nobody withdrawn, and nobody who joins later. */
function activePool(n) {
  return S.players.filter(p => !p.withdrawn && (p.joinedRound || 1) <= n);
}

function makeRound(n) {
  let boards;
  if (S.format === "rr" || S.format === "drr") {
    boards = (S.schedule[n - 1] || []).map(b => Object.assign({}, b));
    // Rule 30D: a withdrawn player forfeits the rest of their fixed schedule,
    // so the crosstable completes instead of carrying permanent gaps.
    boards.forEach(b => {
      if (b.black == null || b.result) return;
      const w = byId(b.white), bl = byId(b.black);
      const wOut = w && w.withdrawn, bOut = bl && bl.withdrawn;
      if (wOut && bOut) b.result = "0-0F";
      else if (wOut)    b.result = "0-1F";
      else if (bOut)    b.result = "1-0F";
    });
  } else if (S.format === "ko") {
    boards = koRound(S.players, S.roundList);
  } else {
    const pool = activePool(n);
    boards = n === 1 ? swissRound1(pool) : swissNext(pool, n);
  }
  boards.forEach(b => { if (b.black == null) b.result = "bye"; });
  // A knockout bye belongs in its seeded bracket slot; elsewhere it reads
  // better at the foot of the pairing sheet.
  if (S.format !== "ko") boards.sort((a, b) => (a.black == null ? 1 : 0) - (b.black == null ? 1 : 0));
  return { number: n, boards };
}

function startTournament() {
  S.name = (S.name || "").trim() || "Untitled Tournament";
  if (S.players.length < 2) return;
  S.players.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
    .forEach((p, i) => p.seed = i + 1);
  if (S.format === "rr" || S.format === "drr") {
    S.schedule = buildSchedule(S.players, S.format === "drr");
    S.rounds = Math.min(S.rounds || S.schedule.length, S.schedule.length);
  }
  S.started = true; S.finished = false;
  S.roundList = [];
  recomputeStats();
  S.roundList.push(makeRound(1));
  S.viewRound = 1;
  beginRecord();
  autosave();
  showTab("pairings");
}

function advanceRound() {
  const rd = S.roundList[S.roundList.length - 1];
  if (!roundComplete(rd)) return;
  rd.locked = true;
  recomputeStats();
  if (S.roundList.length >= S.rounds) {
    S.finished = true;
    autosave();
    showTab("standings");
    return;
  }
  S.roundList.push(makeRound(S.roundList.length + 1));
  S.viewRound = S.roundList.length;
  autosave();
  render();
  requestAnimationFrame(() => focusBoard(nextOpen(-1)));
}

/* ============================================================
   TABS + BOARD FOCUS
   ============================================================ */
function showTab(t) {
  if ((t === "pairings" || t === "standings") && !S.started) t = "setup";
  if (t !== "history") S.confirmDelete = null;
  S.tab = t;
  render();
  if (t === "pairings") requestAnimationFrame(() => {
    const rd = S.roundList[S.viewRound - 1];
    if (rd && !rd.locked) focusBoard(nextOpen(-1));
  });
}

function focusBoard(i) {
  const el = document.querySelector('[data-board="' + i + '"]');
  if (el) el.focus();
}
function nextOpen(from) {
  const rd = S.roundList[S.viewRound - 1];
  if (!rd) return Math.max(from, 0);
  for (let i = from + 1; i < rd.boards.length; i++) if (!rd.boards[i].result) return i;
  for (let i = 0; i < rd.boards.length; i++) if (!rd.boards[i].result) return i;
  return Math.min(from + 1, rd.boards.length - 1);
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
const view = document.getElementById("view");

document.querySelectorAll("[data-tab]").forEach(btn =>
  btn.addEventListener("click", () => showTab(btn.dataset.tab)));

view.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === "add-player") {
    const n = document.getElementById("pname"), r = document.getElementById("prating");
    const miss = document.getElementById("pforfeit");
    const res = addPlayer(n.value, r.value, { forfeitMissed: miss ? miss.checked : false });
    if (!res.ok) {
      S.entryError = res.error;
      if (res.error === "Enter a name.") { render(); const f = document.getElementById("pname"); if (f) f.focus(); }
      else render();
      return;
    }
    S.entryError = null;
    if (res.late) autosave();
    render();
    const f = document.getElementById("pname"); if (f) f.focus();
  }
  else if (act === "withdraw") {
    if (withdrawPlayer(+el.dataset.id)) { autosave(); render(); }
  }
  else if (act === "reinstate") {
    if (reinstatePlayer(+el.dataset.id)) { autosave(); render(); }
  }
  else if (act === "remove-player") { removePlayer(+el.dataset.id); render(); }
  else if (act === "start") startTournament();
  else if (act === "advance") advanceRound();
  else if (act === "view-round") { S.viewRound = +el.dataset.round; render(); }
  else if (act === "result") {
    const i = +el.dataset.i;
    if (setResult(i, el.dataset.r)) {
      const rd = S.roundList[S.viewRound - 1];
      autosave();
      autosave();
      render();
      focusBoard(rd.boards[i].result ? nextOpen(i) : i);
    }
  }
  /* bracket: clicking a player declares them the winner of that match */
  else if (act === "ko-pick") {
    const i = +el.dataset.i;
    if (setResult(i, el.dataset.side === "white" ? "1-0" : "0-1")) {
      autosave(); render(); focusBoard(i);
    }
  }
  else if (act === "grid-cycle") { S.gridCycle = +el.dataset.cycle; render(); }
  else if (act === "new-tournament") newTournament();
  else if (act === "open-tournament") openTournament(el.dataset.id);
  else if (act === "delete-ask")    { S.confirmDelete = el.dataset.id; render(); }
  else if (act === "delete-cancel") { S.confirmDelete = null; render(); }
  else if (act === "delete-confirm") {
    const id = el.dataset.id;
    const res = remove(id);
    S.confirmDelete = null;
    if (!res.ok) window.alert("Could not delete that tournament.\n\n" + res.error);
    else if (id === S.id) newTournament(true);
    render();
  }
  else if (act === "export-players")  exportPlayers();
  else if (act === "export-pairings") exportPairings();
  else if (act === "export-results")  exportResults();
});

/* setup fields: keep the store in step without repainting mid-keystroke */
view.addEventListener("input", e => {
  const f = e.target.dataset.field;
  if (f === "name") S.name = e.target.value;
  else if (f === "rounds") { S.roundsTouched = true; S.rounds = Math.max(1, parseInt(e.target.value, 10) || 1); }
});
view.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.field === "format") { S.format = t.value; syncRounds(); render(); }
  else if (t.dataset.edit === "name")   renamePlayer(+t.dataset.id, t.value);
  else if (t.dataset.edit === "rating") { rerate(+t.dataset.id, t.value); render(); }
});
view.addEventListener("keydown", e => {
  if (e.target.id === "pname" || e.target.id === "prating") {
    if (e.key === "Enter") {
      e.preventDefault();
      const n = document.getElementById("pname"), r = document.getElementById("prating");
      const miss = document.getElementById("pforfeit");
      const res = addPlayer(n.value, r.value, { forfeitMissed: miss ? miss.checked : false });
      S.entryError = res.ok ? null : res.error;
      if (res.ok && res.late) autosave();
      render();
      const f = document.getElementById("pname"); if (f) f.focus();
    }
    return;
  }
  const board = e.target.closest("[data-board]");
  if (!board) return;
  const i = +board.dataset.board, k = e.key;
  if (k === "1" || k === "2" || k === "3") {
    e.preventDefault();
    if (setResult(i, RESULTS[+k - 1])) {
      const rd = S.roundList[S.viewRound - 1];
      autosave();
      render();
      focusBoard(rd.boards[i].result ? nextOpen(i) : i);
    }
  } else if (k === "0" || k === "Backspace" || k === "Delete") {
    e.preventDefault();
    if (clearResult(i)) { autosave(); render(); focusBoard(i); }
  } else if (k === "ArrowDown" || k === "j") { e.preventDefault(); focusBoard(i + 1); }
  else if (k === "ArrowUp" || k === "k")     { e.preventDefault(); focusBoard(Math.max(0, i - 1)); }
  else if (k === "Enter")                    { e.preventDefault(); focusBoard(nextOpen(i)); }
});

render();

/* ============================================================
   HISTORY ACTIONS
   ============================================================ */
function newTournament(silent) {
  if (!silent && S.started && !S.finished &&
      !window.confirm("Start a new tournament?\n\n" + S.name +
        " is still in progress. It stays saved in History, so you can pick it up again."))
    return;
  S.id = null; S.dateCreated = null;
  S.name = ""; S.format = "swiss"; S.rounds = 0; S.roundsTouched = false;
  S.players = []; S.schedule = []; S.roundList = [];
  S.viewRound = 0; S.started = false; S.finished = false;
  S.confirmDelete = null;
  showTab("setup");
}

function openTournament(id) {
  const rec = find(id);
  if (!rec) { window.alert("That tournament is no longer saved."); render(); return; }
  restore(rec);
  S.confirmDelete = null;
  // completed events open read-only on Standings; active ones resume on Pairings
  showTab(rec.status === "completed" ? "standings" : "pairings");
}

render();
