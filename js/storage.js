/* ============================================================
   STORAGE — localStorage persistence, one namespaced key.

   Everything here is local to this browser: no server, no sync.
   localStorage can be unavailable (private windows, blocked site
   data) or full, so every call is wrapped and returns a result
   rather than throwing into the render path.
   ============================================================ */
import { S, nextId, setNextId, recomputeStats } from "./state.js";
import { standings } from "./tiebreaks.js";

const KEY = "chess-tm:tournaments";

/* Probe once: a private window can expose localStorage but throw on write. */
export function isAvailable() {
  try {
    const probe = KEY + ":probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch (err) {
    return false;
  }
}

export function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn("chess-tm: could not read saved tournaments —", err.message);
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return { ok: true };
  } catch (err) {
    const full = err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014;
    return { ok: false, error: full
      ? "Storage is full. Delete an old tournament to free space."
      : "This browser will not let the page save (" + err.name + ")." };
  }
}

export function find(id) {
  return loadAll().find(t => t.id === id) || null;
}

export function remove(id) {
  const list = loadAll().filter(t => t.id !== id);
  return writeAll(list);
}

/* ---------- the record ---------- */
function newId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toRecord() {
  return {
    id: S.id,
    name: S.name,
    format: S.format,
    dateCreated: S.dateCreated,
    status: S.finished ? "completed" : "active",
    players: S.players.map(p => ({
      id: p.id, name: p.name, rating: p.rating, unrated: !!p.unrated, seed: p.seed,
      withdrawn: !!p.withdrawn, withdrawnRound: p.withdrawnRound || null,
      joinedRound: p.joinedRound || 1
    })),
    rounds: S.roundList.map(r => ({
      number: r.number,
      locked: !!r.locked,
      boards: r.boards.map(b => ({ white: b.white, black: b.black, result: b.result }))
    })),
    standingsSnapshot: standings().map(r => ({
      rank: r.rank, id: r.p.id, name: r.p.name, rating: r.p.rating,
      score: r.p.score, modMedian: r.modMedian, solkoff: r.solkoff, cumulative: r.cumulative
    })),
    // carried so an active tournament can actually resume where it left off
    roundsTotal: S.rounds,
    schedule: S.schedule,
    dateSaved: new Date().toISOString()
  };
}

/* Called on every result entry and every round advance. */
export function saveCurrent() {
  if (!S.started || !S.id) return { ok: true };
  const list = loadAll();
  const rec = toRecord();
  const at = list.findIndex(t => t.id === rec.id);
  if (at >= 0) list[at] = rec; else list.push(rec);
  return writeAll(list);
}

export function beginRecord() {
  S.id = newId();
  S.dateCreated = new Date().toISOString();
}

/* ---------- restoring ---------- */
export function restore(rec) {
  S.id = rec.id;
  S.name = rec.name;
  S.format = rec.format;
  S.dateCreated = rec.dateCreated;
  S.rounds = rec.roundsTotal || (rec.rounds ? rec.rounds.length : 0);
  S.roundsTouched = true;
  S.schedule = rec.schedule || [];
  S.players = (rec.players || []).map(p => ({
    id: p.id, name: p.name, rating: p.rating, unrated: !!p.unrated, seed: p.seed,
    withdrawn: !!p.withdrawn, withdrawnRound: p.withdrawnRound || null,
    joinedRound: p.joinedRound || 1,
    score: 0, playedScore: 0, roundScores: [], roundScoresPlayed: [],
    colorHistory: [], opponentIds: [], hadBye: false, hadForfeit: false
  }));
  setNextId(S.players.reduce((m, p) => Math.max(m, p.id), 0) + 1);
  S.roundList = (rec.rounds || []).map(r => ({
    number: r.number,
    locked: !!r.locked,
    boards: r.boards.map(b => ({ white: b.white, black: b.black, result: b.result }))
  }));
  S.started = true;
  S.finished = rec.status === "completed";
  S.viewRound = Math.max(1, S.roundList.length);
  recomputeStats();
}
