import { byId } from "./state.js";

/* ============================================================
   COLOUR ALLOCATION FOR ROUND ROBIN
   The circle method alone produces long same-colour runs, so the schedule
   is walked in order handing each player the colour they are due. Swiss
   uses its own US Chess colour rules further down.
   ============================================================ */
function prefOf(h) {
  const n = h.length;
  if (!n) return { want: 0, strength: 0, bal: 0 };
  let bal = 0; h.forEach(c => bal += c === "W" ? 1 : -1);
  const last = h[n - 1];
  let streak = 0;
  for (let i = n - 1; i >= 0 && h[i] === last; i--) streak++;
  let want = last === "W" ? -1 : 1;                 // alternate by default
  const absolute = streak >= 2;                     // a third same colour in a row
  let strength = absolute ? 4 : 1;
  const balWant = bal > 0 ? -1 : bal < 0 ? 1 : 0;
  if (balWant) {
    if (balWant === want) strength += Math.abs(bal);
    else if (!absolute && Math.abs(bal) >= 2) { want = balWant; strength = Math.abs(bal) + 1; }
  }
  return { want, strength, bal, absolute };
}
/* true = the first player takes White. */
function decideWhite(ha, hb, aWinsTie) {
  const pa = prefOf(ha), pb = prefOf(hb);
  if (pa.want && pb.want) {
    if (pa.want !== pb.want) return pa.want === 1;
    // Both want the same colour. Avoiding a third same colour in a row trumps
    // everything else; otherwise the stronger preference wins.
    let aGets;
    if (pa.absolute !== pb.absolute) aGets = pa.absolute;
    else if (pa.strength !== pb.strength) aGets = pa.strength > pb.strength;
    else aGets = aWinsTie;
    return pa.want === 1 ? aGets : !aGets;
  }
  if (pa.want) return pa.want === 1;
  if (pb.want) return pb.want !== 1;
  return aWinsTie;                                  // round 1: higher seed takes White
}

/* ============================================================
   ROUND ROBIN — circle method, whole schedule built up front
   ============================================================ */
function circlePairs(ids) {
  const a = ids.slice();
  if (a.length % 2) a.push(null);                   // ghost player = bye
  const n = a.length, out = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([a[i], a[n - 1 - i]]);
    out.push(pairs);
    const rest = a.slice(1);
    rest.unshift(rest.pop());
    a.splice(1, a.length - 1, ...rest);
  }
  return out;
}

/* Walk the schedule in order, giving each player the colour they are due —
   the circle method alone produces long same-colour runs. */
function colorize(pairRounds, seedOf) {
  const hist = new Map();
  const h = id => { if (!hist.has(id)) hist.set(id, []); return hist.get(id); };
  return pairRounds.map(pairs => pairs.map(([x, y]) => {
    if (x == null || y == null) return { white: x == null ? y : x, black: null, result: null };
    const aFirst = decideWhite(h(x), h(y), seedOf(x) <= seedOf(y));
    const w = aFirst ? x : y, b = aFirst ? y : x;
    h(w).push("W"); h(b).push("B");
    return { white: w, black: b, result: null };
  }));
}

export function buildSchedule(players, isDouble) {
  const ordered = players.slice().sort((x, y) => x.seed - y.seed);
  const seedOf = id => byId(id).seed;
  const cycle = colorize(circlePairs(ordered.map(p => p.id)), seedOf);
  let sched = cycle;
  if (isDouble) {
    const back = cycle.map(bs => bs.map(b => ({          // second cycle: colours reversed
      white: b.black == null ? b.white : b.black,
      black: b.black == null ? null : b.white,
      result: null
    })));
    sched = cycle.concat(back);
  }
  return sched;
}

