/* ============================================================
   STATE — the in-memory store. Imports nothing, so every other
   module can depend on it without a cycle.

   Player : { id, name, rating, seed, score, roundScores[],
              colorHistory[], opponentIds[], hadBye, hadForfeit,
              unrated, withdrawn, withdrawnRound, joinedRound }
   Round  : { number, boards: [{ white, black, result }] }

   A board result is one of:
     "1-0" "½-½" "0-1"     played
     "1-0F" "0-1F" "0-0F"  forfeit (unplayed), 0-0F = double forfeit
     "bye" "bye-h" "bye-0" unpaired: full, half and zero point
     null                  not entered yet
   ============================================================ */
export const S = {
  id: null,          // set when the tournament is first saved
  dateCreated: null,
  name: "",
  format: "swiss",
  rounds: 0,
  roundsTouched: false,
  players: [],
  schedule: [],      // pre-generated board lists (round robin only)
  roundList: [],     // Round objects that exist so far
  viewRound: 0,      // 1-based index of round being viewed
  started: false,
  finished: false,
  tab: "setup"
};
export let nextId = 1;
export const setNextId = n => { nextId = n; };

export const FORMATS = {
  rr:     "Round Robin",
  drr:    "Double Round Robin",
  swiss:  "Swiss",
  ko:     "Knockout"
};


export const RESULTS  = ["1-0", "½-½", "0-1"];      // played; keyboard 1 / 2 / 3
export const FORFEITS = ["1-0F", "0-1F", "0-0F"];   // unplayed; click only
export const BYE_KINDS = [
  { result: "bye",   points: 1,   label: "Full point", symbol: "B" },
  { result: "bye-h", points: 0.5, label: "Half point", symbol: "H" },
  { result: "bye-0", points: 0,   label: "Zero point", symbol: "F" }
];
export const isPlayed  = r => RESULTS.indexOf(r) >= 0;
export const isForfeit = r => FORFEITS.indexOf(r) >= 0;
export const byeKind   = r => BYE_KINDS.find(k => k.result === r) || null;
export const byId = id => S.players.find(p => p.id === id);
export const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmtNum = n => String(Math.round(n * 100) / 100);
export const fmtScore = n => {
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n * 2 - Math.round(n * 2)) < 1e-9) return (Math.floor(n) || "") + "½";
  return fmtNum(n);
};

export function defaultRounds() {
  const n = S.players.length;
  if (n < 2) return 0;
  switch (S.format) {
    case "rr":  return n % 2 === 0 ? n - 1 : n;
    case "drr": return (n % 2 === 0 ? n - 1 : n) * 2;
    case "swiss": return Math.max(1, Math.ceil(Math.log2(n)));
    case "ko":  return Math.max(1, Math.ceil(Math.log2(n)));
  }
  return 0;
}
export function syncRounds() {
  if (!S.roundsTouched) S.rounds = defaultRounds();
}

/* ============================================================
   STATS — always recomputed from the round list, never mutated
   incrementally, so undoing a result can never desync anything.
   ============================================================ */
export function recomputeStats() {
  S.players.forEach(p => {
    p.score = 0; p.playedScore = 0;
    p.colorHistory = []; p.opponentIds = [];
    p.hadBye = false; p.hadForfeit = false;
    p.roundScores = []; p.roundScoresPlayed = []; p.eliminated = false;
  });
  S.roundList.forEach(rd => {
    rd.boards.forEach(b => {
      const w = byId(b.white), bl = b.black == null ? null : byId(b.black);
      if (!w) return;

      if (!bl) {                                   // unpaired: a bye of some kind
        w.hadBye = true;
        const kind = byeKind(b.result);
        if (kind && S.format !== "ko") w.score += kind.points;
        return;                                    // never counts as a played game
      }

      // Being paired counts for the no-repeat rule even if the game went unplayed.
      w.opponentIds.push(bl.id); bl.opponentIds.push(w.id);

      // Rule 29E1: only a game actually played affects colour history.
      if (isPlayed(b.result)) { w.colorHistory.push("W"); bl.colorHistory.push("B"); }
      if (isForfeit(b.result)) { w.hadForfeit = true; bl.hadForfeit = true; }

      switch (b.result) {
        case "1-0":  w.score += 1;  w.playedScore += 1;
                     if (S.format === "ko") bl.eliminated = true; break;
        case "0-1":  bl.score += 1; bl.playedScore += 1;
                     if (S.format === "ko") w.eliminated = true; break;
        case "½-½":  w.score += 0.5; bl.score += 0.5;
                     w.playedScore += 0.5; bl.playedScore += 0.5; break;
        // A forfeit point is won, not played: it stays out of playedScore so the
        // Cumulative tiebreak does not reward a no-show (Rule 34E3 adjustment).
        case "1-0F": w.score += 1;  if (S.format === "ko") bl.eliminated = true; break;
        case "0-1F": bl.score += 1; if (S.format === "ko") w.eliminated = true; break;
        case "0-0F": if (S.format === "ko") { w.eliminated = true; bl.eliminated = true; } break;
      }
    });
    // running totals after this round — the basis of the Cumulative tiebreak
    S.players.forEach(p => {
      p.roundScores.push(p.score);
      p.roundScoresPlayed.push(p.playedScore);
    });
  });
}

/* ============================================================
   WITHDRAWAL — the record is kept, only future pairing changes.
   ============================================================ */
export function withdrawPlayer(id) {
  const p = byId(id);
  if (!p || p.withdrawn) return false;
  p.withdrawn = true;
  p.withdrawnRound = S.roundList.length || null;

  // Pairings already posted for the open round: the opponent takes a forfeit
  // win. Withdrawing before the next round is paired generates nothing.
  const rd = S.roundList[S.roundList.length - 1];
  if (rd && !rd.locked) {
    rd.boards.forEach(b => {
      if (b.black == null || b.result) return;     // byes stand; decided boards stand
      const isW = b.white === id, isB = b.black === id;
      if (!isW && !isB) return;
      const other = byId(isW ? b.black : b.white);
      b.result = (other && other.withdrawn) ? "0-0F" : (isW ? "0-1F" : "1-0F");
    });
  }
  recomputeStats();
  return true;
}

export function reinstatePlayer(id) {
  const p = byId(id);
  if (!p || !p.withdrawn) return false;
  p.withdrawn = false; p.withdrawnRound = null;
  recomputeStats();                                // forfeits already entered stand
  return true;
}

export function roundComplete(rd) {
  return rd && rd.boards.length > 0 && rd.boards.every(b => !!b.result);
}

/* ============================================================
   PLAYER EDITING (setup tab only)
   ============================================================ */
export const LATE_ENTRY_BLOCKED = {
  rr:  "Round Robin",
  drr: "Double Round Robin",
  ko:  "Knockout"
};

/* A Swiss field can take a late entrant; the other formats cannot, because
   their whole schedule or bracket was fixed when the event started. */
export function canAddPlayer() {
  if (!S.started) return { ok: true };
  const blocked = LATE_ENTRY_BLOCKED[S.format];
  if (!blocked) return { ok: true, late: true, round: S.roundList.length + 1 };
  return { ok: false, error: blocked +
    " fixes every pairing when the tournament starts, so a player cannot be added now. " +
    "Rounds already played would have to be recomputed. Finish this event, or start a new one from History." };
}

export function addPlayer(name, ratingRaw, opts) {
  const gate = canAddPlayer();
  if (!gate.ok) return gate;
  name = String(name || "").trim();
  if (!name) return { ok: false, error: "Enter a name." };
  const unrated = String(ratingRaw || "").trim() === "";   // paired at 1500, but see rule 28L2
  const rating = unrated ? 1500 : Math.max(0, parseInt(ratingRaw, 10) || 1500);
  const joinedRound = gate.late ? gate.round : 1;
  const p = { id: nextId++, name, rating, unrated, seed: 0, score: 0, playedScore: 0,
              roundScores: [], roundScoresPlayed: [], colorHistory: [], opponentIds: [],
              hadBye: false, hadForfeit: false,
              withdrawn: false, withdrawnRound: null, joinedRound };
  S.players.push(p);

  if (gate.late) {
    p.seed = S.players.reduce((m, q) => Math.max(m, q.seed), 0) + 1;
    // Rounds before they joined are simply unplayed unless the director says
    // otherwise, in which case each is recorded as a zero-point forfeit.
    if (opts && opts.forfeitMissed) {
      S.roundList.forEach(rd => {
        if (rd.number < joinedRound) rd.boards.push({ white: p.id, black: null, result: "bye-0" });
      });
    }
    recomputeStats();
  } else {
    syncRounds();
  }
  return { ok: true, late: !!gate.late, round: joinedRound };
}
export function removePlayer(id) {
  S.players = S.players.filter(p => p.id !== id);
  syncRounds();
}
export function renamePlayer(id, v) { const p = byId(id); if (p) p.name = String(v).trim() || p.name; }
export function rerate(id, v) {
  const p = byId(id);
  if (!p) return;
  p.unrated = String(v).trim() === "";
  p.rating = p.unrated ? 1500 : Math.max(0, parseInt(v, 10) || 1500);
}

/* ============================================================
   RESULT ENTRY — pure mutations; the caller repaints.
   ============================================================ */
export function setResult(bi, res) {
  const rd = S.roundList[S.viewRound - 1];
  if (!rd || rd.locked) return false;
  const b = rd.boards[bi];
  if (!b) return false;
  if (b.black == null) {                             // bye row: pick its value
    if (!byeKind(res)) return false;
    b.result = res;
    recomputeStats();
    return true;
  }
  b.result = (b.result === res) ? null : res;        // click again to clear
  recomputeStats();
  return true;
}
export function clearResult(bi) {
  const rd = S.roundList[S.viewRound - 1];
  if (!rd || rd.locked || !rd.boards[bi]) return false;
  if (rd.boards[bi].black == null) return false;   // a bye always has a result
  rd.boards[bi].result = null;
  recomputeStats();
  return true;
}
