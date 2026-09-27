import { byId, RESULTS } from "./state.js";

/* ============================================================
   KNOCKOUT — single elimination, seeded bracket
   ============================================================ */
export function koSurvivors(players, roundList) {
  if (!roundList.length) return players.slice().sort((a, b) => a.seed - b.seed);
  const last = roundList[roundList.length - 1];
  const out = [];
  last.boards.forEach(b => {
    if (b.black == null) { out.push(byId(b.white)); return; }
    if (b.result === "1-0") out.push(byId(b.white));
    else if (b.result === "0-1") out.push(byId(b.black));
    else if (b.result === RESULTS[1]) {
      // Draw: needs a replay / tiebreak. Flagged in the UI; for bracket
      // continuity the higher seed advances so the event can keep moving.
      const w = byId(b.white), bl = byId(b.black);
      out.push(w.seed <= bl.seed ? w : bl);
    }
  });
  return out.filter(Boolean).sort((a, b) => a.seed - b.seed);
}

export function koRound(players, roundList) {
  const alive = koSurvivors(players, roundList).filter(p => !p.withdrawn);
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(alive.length, 2))));
  const slots = alive.slice();
  while (slots.length < size) slots.push(null);     // byes go to the top seeds
  const boards = [];
  for (let i = 0; i < size / 2; i++) {
    const a = slots[i], b = slots[size - 1 - i];
    if (!a && !b) continue;
    if (!a || !b) { boards.push({ white: (a || b).id, black: null, result: null }); continue; }
    boards.push({ white: a.id, black: b.id, result: null });
  }
  return boards;
}

