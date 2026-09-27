import { S, byId, RESULTS, isForfeit, recomputeStats } from "./state.js";

/* ============================================================
   TIEBREAKS — US Chess Rule 34
     Solkoff (34E2)        sum of every opponent's final score
     Modified Median (34E1) Solkoff less the highest and/or lowest opponent,
                            which one(s) depending on the player's own score
     Cumulative (34E3)      sum of the player's running score after each round
   Unplayed games — byes and forfeits alike — do not contribute the absent
   opponent's real score. Under the variable-bye adjustment (Rule 34E2) they
   contribute the player's own score instead, so a forfeit is neutral rather
   than rewarding or punishing whoever happened to be scheduled opposite a
   no-show. Cumulative uses the played-only running total for the same reason.
   ============================================================ */
export function opponentScores(p) {
  const out = [];
  S.roundList.forEach(rd => rd.boards.forEach(b => {
    const isW = b.white === p.id, isB = b.black === p.id;
    if (!isW && !isB) return;
    // bye or forfeit: neutral, worth the player's own standing
    if (b.black == null || isForfeit(b.result)) { out.push(p.score); return; }
    const opp = byId(isW ? b.black : b.white);
    if (opp) out.push(opp.score);
  }));
  return out;
}

export function tiebreaks(p) {
  const opps = opponentScores(p).sort((a, b) => a - b);
  const solkoff = opps.reduce((a, b) => a + b, 0);

  // 34E1: above an even score drop only the lowest, below it drop only the
  // highest, at an even score drop both. "Even" is half the rounds played.
  const played = opps.length;
  const even = played / 2;                        // an "even score" for this player
  let dropLow  = p.score >= even ? 1 : 0;
  let dropHigh = p.score <= even ? 1 : 0;
  if (played >= 9) { dropLow *= 2; dropHigh *= 2; }  // 34E1: two each way from 9 rounds
  let kept = opps.slice(Math.min(dropLow, opps.length));
  kept = kept.slice(0, Math.max(0, kept.length - dropHigh));
  const modMedian = kept.reduce((a, b) => a + b, 0);

  const cumulative = (p.roundScoresPlayed || []).reduce((a, b) => a + b, 0);
  return { modMedian, solkoff, cumulative };
}

export function headToHead(a, b) {
  let d = 0;
  S.roundList.forEach(rd => rd.boards.forEach(bd => {
    if (!bd.result || !RESULTS.includes(bd.result)) return;   // only played games
    const pair = (bd.white === a.id && bd.black === b.id) || (bd.white === b.id && bd.black === a.id);
    if (!pair) return;
    if (bd.result === RESULTS[1]) return;
    const winner = bd.result === "1-0" ? bd.white : bd.black;
    d += winner === a.id ? 1 : -1;
  }));
  return d;
}

export function standings() {
  recomputeStats();
  const rows = S.players.map(p => Object.assign({ p }, tiebreaks(p)));
  rows.sort((x, y) =>
    y.p.score - x.p.score ||
    y.modMedian - x.modMedian ||
    y.solkoff - x.solkoff ||
    y.cumulative - x.cumulative ||
    headToHead(y.p, x.p) ||
    y.p.rating - x.p.rating ||
    x.p.seed - y.p.seed
  );
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    const key = [r.p.score, r.modMedian, r.solkoff, r.cumulative].join("|");
    if (key !== prev) { rank = i + 1; prev = key; }
    r.rank = rank;
  });
  return rows;
}

