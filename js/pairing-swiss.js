import { byId } from "./state.js";

/* ============================================================
   SWISS — US Chess Rule 27A priority order.
   A lower rule is yielded only when a higher one cannot be satisfied:
     1. no repeat pairings          (hardest rule, never broken)
     2. equal scores                (group by total points)
     3. upper half vs lower half    (rank the group by rating, top vs bottom)
     4. equalize colours            (even White/Black over the whole event)
     5. alternate colours           (only once a player's colours are equal)
   ============================================================ */

/* ---- colours: rules 27A.4 / 27A.5, with the 29E5f escape ---- */
function colorBalance(p) {
  let bal = 0;
  p.colorHistory.forEach(c => bal += c === "W" ? 1 : -1);
  return bal;                                     // + = has had more Whites
}
/* Would this colour be a third of the same in a row? (29E5f) */
function wouldRepeatThrice(p, c) {
  const h = p.colorHistory, n = h.length;
  return n >= 2 && h[n - 1] === c && h[n - 2] === c;
}
/* Cost of giving player p this colour — lower is better. */
function colorCost(p, c) {
  const bal = colorBalance(p);
  const after = bal + (c === "W" ? 1 : -1);
  let k = after * after * 100;                    // 27A.4 equalize: drive |balance| to 0
  if (wouldRepeatThrice(p, c)) k += 100000;       // 29E5f: avoid a third in a row
  const h = p.colorHistory;
  if (bal === 0 && h.length && h[h.length - 1] === c) k += 10;   // 27A.5 alternate
  return k;
}
/* Returns [white, black] for a board. */
function assignColors(a, b) {
  const aWhite = colorCost(a, "W") + colorCost(b, "B");
  const bWhite = colorCost(b, "W") + colorCost(a, "B");
  if (aWhite !== bWhite) return aWhite < bWhite ? [a, b] : [b, a];
  return a.seed <= b.seed ? [a, b] : [b, a];      // equal claim: higher rank takes White
}
/* True when BOTH colour assignments force somebody into a third same colour —
   only then may rule 29E5f be broken. */
function forcesThirdColor(a, b) {
  const one = wouldRepeatThrice(a, "W") || wouldRepeatThrice(b, "B");
  const two = wouldRepeatThrice(a, "B") || wouldRepeatThrice(b, "W");
  return one && two;
}

/* ---- round 1: seeded, top half vs bottom half (unchanged) ---- */
export function swissRound1(players) {
  const ps = players.slice().sort((a, b) => a.seed - b.seed);
  const boards = [];
  let bye = null;
  if (ps.length % 2) bye = pickBye(ps, 1);
  if (bye) ps.splice(ps.indexOf(bye), 1);
  const half = ps.length / 2;
  for (let i = 0; i < half; i++) {
    const top = ps[i], bot = ps[i + half];
    const [w, b] = i % 2 === 0 ? [top, bot] : [bot, top];
    boards.push({ white: w.id, black: b.id, result: null });
  }
  if (bye) boards.push({ white: bye.id, black: null, result: null });
  return boards;
}

/* ---- the bye: US Chess Rule 28L2 ----
   Lowest score group first, then the lowest-rated player inside it.
   Byes and forfeits share one eligibility pool: a player who already has a
   bye, a forfeit win or a forfeit loss has had their free round. A late
   entrant is passed over in the round they join, and in round 1 so is an
   unrated player. Filters are dropped from the end if nothing is eligible. */
export function pickBye(pool, roundNo) {
  const filters = [
    p => !(p.hadBye || p.hadForfeit),
    p => (p.joinedRound || 1) !== roundNo,
    p => roundNo !== 1 || !p.unrated
  ];
  let eligible = pool.filter(p => filters.every(f => f(p)));
  for (let k = filters.length - 1; k > 0 && !eligible.length; k--) {
    eligible = pool.filter(p => filters.slice(0, k).every(f => f(p)));
  }
  if (!eligible.length) eligible = pool.slice();
  const lowest = Math.min.apply(null, eligible.map(p => p.score));
  const group = eligible.filter(p => p.score === lowest);
  return group.sort((a, b) => a.rating - b.rating || b.seed - a.seed)[0];
}

/* ---- pairing one score group: rule 27A.3 ----
   The natural opponent of the top player is the one half a group away.
   Candidates are tried outward from there, so a repeat pairing is fixed by
   the smallest transposition that works. Colour only sorts candidates that
   are otherwise equally good, because rule 3 outranks rules 4 and 5 — the
   one exception is a pairing that would force a third same colour in a row,
   which 29E5f pushes to last resort. */
function pairGroup(pool, allowRepeats, crossGroup) {
  let budget = 60000;
  const walk = list => {
    if (!list.length) return [];
    if (budget-- < 0) return null;
    const p = list[0], rest = list.slice(1);
    // p is rank 0 of its score group; its natural opponent is half a group away
    const sameScore = rest.filter(x => x.score === p.score).length;
    const natural = Math.floor((sameScore + 1) / 2) - 1;   // index in `rest`
    const ranked = rest.map((c, i) => {
      let k = Math.abs(i - natural) * 10;                  // 27A.3 transposition distance
      // 27A.2 outranks everything below it: only cross score groups when stuck
      if (crossGroup) k += Math.abs(p.score - c.score) * 1000000;
      if (forcesThirdColor(p, c)) k += 100000;             // 29E5f
      const bp = colorBalance(p), bc = colorBalance(c);
      if (bp !== 0 && bp === bc) k += 5;                   // 27A.4 tiebreak only
      return { c, k };
    }).sort((x, y) => x.k - y.k).map(o => o.c);
    for (const c of ranked) {
      if (!allowRepeats && p.opponentIds.includes(c.id)) continue;
      const sub = walk(rest.filter(x => x !== c));
      if (sub) return [[p, c]].concat(sub);
    }
    return null;
  };
  return walk(pool);
}

/* The odd player out of a group floats to the next group down. US Chess
   floats the lowest-ranked player who actually has an opponent there. */
function chooseFloater(pool, nextGroup) {
  const cands = pool.slice().sort((a, b) => a.rating - b.rating || b.seed - a.seed);
  for (const c of cands) {
    if (nextGroup.some(o => !c.opponentIds.includes(o.id))) return c;
  }
  return cands[0];
}

/* The matcher commits to each board as it walks the group, so the last boards
   can be left with two players who both need the same colour. Swapping
   partners between two boards often clears that. A swap is only allowed if it
   keeps rule 1 (no repeat) and rule 2 (equal scores) intact, since both
   outrank the colour rules. */
function colorBadness(a, b) {
  const [w, bl] = assignColors(a, b);
  let k = 0;
  [[w, "W"], [bl, "B"]].forEach(pair => {
    const p = pair[0], c = pair[1];
    if (wouldRepeatThrice(p, c)) k += 4;                      // 29E5f
    if (Math.abs(colorBalance(p) + (c === "W" ? 1 : -1)) > 1) k += 1;   // 27A.4
  });
  return k;
}
function repairColors(pairs) {
  const gap = pr => Math.abs(pr[0].score - pr[1].score);
  const fresh = (a, b) => !a.opponentIds.includes(b.id);
  for (let i = 0; i < pairs.length; i++) {
    if (!colorBadness(pairs[i][0], pairs[i][1])) continue;
    for (let j = 0; j < pairs.length; j++) {
      if (i === j) continue;
      const a1 = pairs[i][0], b1 = pairs[i][1], a2 = pairs[j][0], b2 = pairs[j][1];
      const before = colorBadness(a1, b1) + colorBadness(a2, b2);
      const gapBefore = gap(pairs[i]) + gap(pairs[j]);
      const options = [[[a1, b2], [a2, b1]], [[a1, a2], [b1, b2]]];
      for (const opt of options) {
        const x = opt[0], y = opt[1];
        if (!fresh(x[0], x[1]) || !fresh(y[0], y[1])) continue;
        if (gap(x) + gap(y) > gapBefore) continue;
        if (colorBadness(x[0], x[1]) + colorBadness(y[0], y[1]) >= before) continue;
        pairs[i] = x; pairs[j] = y;
        break;
      }
      if (!colorBadness(pairs[i][0], pairs[i][1])) break;
    }
  }
  return pairs;
}

/* One downward pass over the score groups: pair each group, float the odd
   player into the next one. Returns null rather than emit a repeat pairing —
   rule 1 outranks everything, so the caller then widens the search. */
function pairSinglePass(groups) {
  const pairs = [];
  let carry = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const isLast = gi === groups.length - 1;
    const nextGroup = isLast ? [] : groups[gi + 1].players;
    // Floaters sit above the group they drop into — they carry a higher score.
    let pool = carry.concat(groups[gi].players);
    carry = [];
    pool.sort((a, b) => b.score - a.score || b.rating - a.rating || a.seed - b.seed);

    let floater = null;
    if (pool.length % 2) {
      floater = chooseFloater(pool, nextGroup);
      pool = pool.filter(x => x !== floater);
    }

    const got = pool.length ? pairGroup(pool, false, false) : [];
    if (!got) {
      if (isLast) return null;
      // Nobody here can be paired without a repeat: float the whole group down
      // to the next one rather than break rule 1. Still a single pass.
      carry = pool.concat(floater ? [floater] : []);
      continue;
    }
    got.forEach(pr => pairs.push(pr));
    carry = floater ? [floater] : [];
  }
  if (carry.length) {
    const got = pairGroup(carry, false, false);
    if (!got) return null;
    got.forEach(pr => pairs.push(pr));
  }
  return pairs;
}

export function swissNext(players, roundNo) {
  let active = players.slice();
  let byeP = null;
  if (active.length % 2) {
    byeP = pickBye(active, roundNo);
    active = active.filter(p => p !== byeP);
  }

  // 27A.2 — score groups, highest first. Ranked inside by rating (27A.3).
  const scores = Array.from(new Set(active.map(p => p.score))).sort((a, b) => b - a);
  const groups = scores.map(sc => ({
    score: sc,
    players: active.filter(p => p.score === sc)
                   .sort((a, b) => b.rating - a.rating || a.seed - b.seed)
  }));

  const ordered = active.slice().sort((a, b) =>
    b.score - a.score || b.rating - a.rating || a.seed - b.seed);

  // Preferred: the single downward pass above. If that corner itself into a
  // repeat, search the whole field instead — score groups still dominate the
  // ordering, so players only cross groups when there is no other way.
  let pairs = pairSinglePass(groups)
           || pairGroup(ordered, false, true)
           || pairGroup(ordered, true, true)      // every opponent already played
           || [];
  pairs = repairColors(pairs);

  const boards = pairs.map(([a, b]) => {
    const [w, bl] = assignColors(a, b);
    return { white: w.id, black: bl.id, result: null };
  });
  boards.sort((x, y) => {
    const sx = Math.max(byId(x.white).score, byId(x.black).score);
    const sy = Math.max(byId(y.white).score, byId(y.black).score);
    return sy - sx || byId(x.white).seed - byId(y.white).seed;
  });
  if (byeP) boards.push({ white: byeP.id, black: null, result: null });
  return boards;
}

