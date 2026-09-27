/* ============================================================
   RENDER — builds the DOM for each tab. Emits data-act hooks;
   app.js owns all the listeners, so no inline handlers.
   ============================================================ */
import { S, FORMATS, RESULTS, FORFEITS, BYE_KINDS, byeKind, isForfeit,
         byId, esc, fmtScore, fmtNum, canAddPlayer,
         defaultRounds, roundComplete } from "./state.js";
import { standings } from "./tiebreaks.js";
import { loadAll, isAvailable } from "./storage.js";

const TABS = [["setup", "Setup"], ["standings", "Standings"],
              ["pairings", "Pairings"], ["history", "History"]];

export function render() {
  renderMasthead();
  TABS.forEach(([id]) => {
    const b = document.getElementById("tab-" + id);
    b.setAttribute("aria-selected", S.tab === id ? "true" : "false");
    b.disabled = id !== "setup" && id !== "history" && !S.started;
  });
  document.getElementById("view").innerHTML =
    S.tab === "setup"     ? viewSetup()
  : S.tab === "standings" ? viewStandings()
  : S.tab === "history"   ? viewHistory()
                          : viewPairings();
}

/* ---------- masthead ---------- */
function renderMasthead() {
  const name = document.getElementById("hallName");
  const facts = document.getElementById("hallFacts");
  name.textContent = S.started ? S.name : "Tournament Manager";
  document.getElementById("hallKicker").textContent =
    S.started ? "Tournament bulletin" : "Set up a new event";
  if (!S.started) { facts.innerHTML = ""; return; }
  const played = S.roundList.filter(r => r.locked).length;
  facts.innerHTML = [
    ["Format", FORMATS[S.format]],
    ["Players", S.players.length],
    ["Rounds", played + " of " + S.rounds]
  ].map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + esc(String(v)) + "</dd></div>").join("");
}

/* ============================================================
   SETUP
   ============================================================ */
function viewSetup() {
  const locked = S.started;
  const dis = locked ? " disabled" : "";
  const opts = Object.keys(FORMATS).map(k =>
    '<option value="' + k + '"' + (S.format === k ? " selected" : "") + ">" + FORMATS[k] + "</option>").join("");

  return section("The event", "", exportBtn("export-players", "Export player list", !S.players.length),
    '<div class="setup-grid">' +
      field("Name", '<input type="text" data-field="name" placeholder="Club Championship 2026" value="' +
            esc(S.name) + '"' + dis + ">") +
      field("Format", '<select data-field="format"' + dis + ">" + opts + "</select>") +
      field("Rounds", '<input type="number" min="1" data-field="rounds" value="' + (S.rounds || "") + '"' + dis + ">") +
    "</div>" +
    '<p class="hint">' + roundsHint() + "</p>"
  ) + section("Players", rosterNote(), "",
    entryForm() +
    playerLedger(locked) +
    (locked ? "" :
      '<div class="footer">' +
        '<span class="tally">' + (S.players.length < 2
          ? "Two players minimum"
          : S.players.length + " players, " + S.rounds + " rounds") + "</span>" +
        '<span class="grow"></span>' +
        '<button class="btn btn--primary" data-act="start"' +
          (S.players.length < 2 ? " disabled" : "") + ">Start tournament</button>" +
      "</div>")
  );
}

function rosterNote() {
  const n = S.players.length;
  if (!S.started) return n + " entered";
  const out = S.players.filter(p => p.withdrawn).length;
  return (n - out) + " active" + (out ? ", " + out + " withdrawn" : "");
}

/* Before the start this is the normal add line. Afterwards a Swiss can still
   take a late entrant; the fixed-schedule formats explain why they cannot. */
function entryForm() {
  const gate = canAddPlayer();
  const err = S.entryError
    ? '<p class="notice notice--inline">' + esc(S.entryError) + "</p>" : "";
  if (!gate.ok) {
    return '<p class="notice notice--inline">' + esc(gate.error) + "</p>";
  }
  const late = gate.late;
  return err +
    '<div class="entry' + (late ? " entry--late" : "") + '">' +
      field("Name", '<input type="text" id="pname" placeholder="Magnus Carlsen">') +
      field("Rating", '<input type="number" id="prating" placeholder="Unrated">') +
      '<button class="btn" data-act="add-player">Add player</button>' +
    "</div>" +
    (late
      ? (gate.round > S.rounds
          ? '<p class="notice notice--inline">The open round is already paired, so a player added now ' +
            "would not join until round " + gate.round + " &mdash; past the last round of this " +
            S.rounds + "-round event. They would never be paired. Add them to a new tournament instead.</p>"
          : '<p class="hint">A player added now joins the pairing pool from <b>round ' + gate.round +
            "</b>, and is passed over for the bye in that round. Earlier rounds count as unplayed. " +
            '<label class="check"><input type="checkbox" id="pforfeit"> ' +
            "Score their missed rounds as forfeit losses instead</label></p>")
      : "");
}

function playerLedger(locked) {
  if (!S.players.length) return '<p class="empty">No players yet. Add the first one above.</p>';
  const ranked = S.players.slice().sort((a, b) =>
    (a.withdrawn ? 1 : 0) - (b.withdrawn ? 1 : 0) ||
    b.rating - a.rating || a.name.localeCompare(b.name));
  return '<table class="ledger"><thead><tr>' +
      "<th>Seed</th><th>Player</th><th>Rating</th><th></th>" +
      (locked ? "<th>Status</th>" : "") + "<th></th>" +
    "</tr></thead><tbody>" +
    ranked.map((p, i) =>
      '<tr' + (p.withdrawn ? ' class="is-withdrawn"' : "") + ">" +
        '<td class="seed">' + (locked ? p.seed : i + 1) + "</td>" +
        '<td><input class="cell-input" type="text" data-edit="name" data-id="' + p.id + '" value="' +
          esc(p.name) + '"' + (locked ? " disabled" : "") + "></td>" +
        '<td class="rating"><input class="cell-input" type="number" data-edit="rating" data-id="' + p.id +
          '" value="' + (p.unrated ? "" : p.rating) + '" placeholder="1500"' + (locked ? " disabled" : "") + "></td>" +
        '<td class="flagcol">' + (p.unrated ? '<span class="mark mark--out">Unrated</span>' : "") + "</td>" +
        (locked
          ? '<td class="statuscol">' +
              (p.withdrawn
                ? '<span class="mark mark--out">Withdrawn' +
                  (p.withdrawnRound ? " Rd " + p.withdrawnRound : "") + "</span>"
                : (p.joinedRound || 1) > 1
                  ? '<span class="mark mark--late">Joined Rd ' + p.joinedRound + "</span>"
                  : '<span class="mark mark--in">Playing</span>') + "</td>"
          : "") +
        '<td class="act">' + (locked
          ? (p.withdrawn
              ? '<button class="btn btn--mini" data-act="reinstate" data-id="' + p.id +
                '" title="Put ' + esc(p.name) + ' back in the pairing pool">Reinstate</button>'
              : '<button class="btn btn--mini" data-act="withdraw" data-id="' + p.id +
                '" title="Withdraw ' + esc(p.name) + '">Withdraw</button>')
          : '<button class="btn btn--ghost" data-act="remove-player" data-id="' + p.id +
            '" title="Remove ' + esc(p.name) + '">&times;</button>') + "</td>" +
      "</tr>").join("") +
    "</tbody></table>";
}

function roundsHint() {
  const n = S.players.length;
  if (n < 2) return "Rounds fill in automatically as players are added.";
  const d = defaultRounds();
  const why = { rr: "n − 1", drr: "2(n − 1)", swiss: "log₂ n, rounded up", ko: "log₂ n, rounded up" }[S.format];
  return S.rounds === d
    ? FORMATS[S.format] + " with " + n + " players suggests <b>" + d + " rounds</b> (" + why + "). You can change it."
    : FORMATS[S.format] + " with " + n + " players suggests " + d + " rounds (" + why +
      "); you have set <b>" + S.rounds + "</b>.";
}

/* ============================================================
   PAIRINGS — the live screen
   ============================================================ */
function viewPairings() {
  const rd = S.roundList[S.viewRound - 1];
  if (!rd) return '<p class="empty">No rounds yet.</p>';
  const locked = !!rd.locked;
  const playable = rd.boards.filter(b => b.black != null);
  const done = playable.filter(b => !!b.result).length;
  const total = playable.length;
  const ready = done === total;
  const isLast = rd.number >= S.rounds;
  const draws = S.format === "ko" ? rd.boards.filter(b => b.result === RESULTS[1]) : [];

  const strip = '<nav class="rounds">' + S.roundList.map(r =>
    '<button class="round-tab" aria-current="' + (r.number === S.viewRound) +
    '" data-act="view-round" data-round="' + r.number + '">Round ' + r.number +
    (r.locked ? '<span class="round-tab__state">closed</span>' : "") + "</button>").join("") + "</nav>";

  const rows = rd.boards.map((b, i) => {
    const w = byId(b.white), bl = b.black == null ? null : byId(b.black);
    if (!bl) {
      const kind = byeKind(b.result) || BYE_KINDS[0];
      const byeCtl = S.format === "ko"
        ? '<span class="mark mark--bye">Bye, advances</span>'
        : '<span class="mark mark--bye">Bye</span>' +
          '<span class="byepick">' + BYE_KINDS.map(k =>
            '<button aria-pressed="' + (kind.result === k.result) + '" title="' + k.label + ' bye"' +
            (locked ? "" : ' data-act="result" data-i="' + i + '" data-r="' + k.result + '"') + ">" +
            fmtScore(k.points) + "</button>").join("") + "</span>";
      return '<div class="board is-done" tabindex="0" data-board="' + i + '">' +
        '<div class="board__no">&mdash;</div>' +
        '<div class="board__bye">' +
          '<span class="side__name">' + esc(w.name) + "</span>" +
          '<span class="side__rating">' + (w.unrated ? "unr." : w.rating) + "</span>" +
          '<span class="side__score">' + fmtScore(w.score) + "</span>" +
          byeCtl + "</div></div>";
    }
    const buttons = resultControls(b, i, locked);
    const flag = (S.format === "ko" && b.result === RESULTS[1])
      ? '<span class="mark mark--flag" title="Single elimination cannot end in a draw">Replay</span>' : "";
    return '<div class="board' + (b.result ? " is-done" : "") + '" tabindex="0" data-board="' + i + '">' +
      '<div class="board__no">' + (i + 1) + "</div>" +
      '<div class="side side--white">' + sideInner(w) + "</div>" +
      '<div class="side side--black">' + sideInner(bl) + "</div>" +
      '<div class="result' + (locked ? " is-locked" : "") + '">' + flag + buttons + "</div>" +
    "</div>";
  }).join("");

  const notice = draws.length
    ? '<p class="notice">' + draws.length + (draws.length > 1 ? " drawn boards need" : " drawn board needs") +
      " a replay. Until it is played the higher seed advances.</p>"
    : "";

  const body = S.format === "ko"
    ? '<div class="pairings pairings--bracket">' + notice + bracket() + "</div>"
    : '<div class="pairings">' + notice +
      '<div class="pair-head"><span>Board</span><span>White</span><span>Black</span><span>Result</span></div>' +
      rows +
    "</div>";

  return section("Round " + rd.number, FORMATS[S.format],
      exportBtn("export-pairings", "Export pairings", false), null) +
    strip + body +
    '<div class="footer">' +
      '<span class="tally' + (ready ? " is-ready" : "") + '"><b>' + done + "</b> of <b>" + total +
        "</b> boards entered</span>" +
      '<span class="gauge"><i style="width:' + (total ? (done / total) * 100 : 0) + '%"></i></span>' +
      '<span class="keys"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> enter result, ' +
        "<kbd>0</kbd> clear, <kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span>" +
      '<span class="grow"></span>' +
      (locked
        ? '<span class="tally">Round closed</span>'
        : '<button class="btn btn--primary" data-act="advance"' + (ready ? "" : " disabled") + ">" +
          (isLast ? "Finish tournament" : "Simulate next round") + "</button>") +
    "</div>";
}

/* Played results keep the keyboard shortcuts and the visual weight; the
   forfeit row sits under them, quieter, click only. */
function resultControls(b, i, locked) {
  const btn = (r, label, title, extra) =>
    '<button' + (extra || "") + ' aria-pressed="' + (b.result === r) + '" title="' + title + '"' +
    (locked ? "" : ' data-act="result" data-i="' + i + '" data-r="' + r + '"') + ">" + label + "</button>";
  const played = RESULTS.map((r, k) => btn(r, r, r + " (key " + (k + 1) + ")")).join("");
  const forf = [
    ["1-0F", "1-0F", "White wins, Black forfeits"],
    ["0-1F", "0-1F", "Black wins, White forfeits"],
    ["0-0F", "0-0F", "Double forfeit, neither scores"]
  ].map(f => btn(f[0], f[1], f[2], ' class="ff"')).join("");
  return '<span class="result__played">' + played + "</span>" +
         '<span class="result__forfeit" title="Forfeits (Rule 29H)">' + forf + "</span>";
}

function sideInner(p) {
  if (!p) return "";
  return '<span class="side__name">' + esc(p.name) + "</span>" +
    '<span class="side__rating">' + (p.unrated ? "unr." : p.rating) + "</span>" +
    '<span class="side__score" title="Score so far">' + fmtScore(p.score) + "</span>";
}

/* ============================================================
   STANDINGS
   ============================================================ */
function viewStandings() {
  const rows = standings();
  const played = S.roundList.filter(r => r.locked || roundComplete(r)).length;
  const body = rows.map(r =>
    "<tr" + (r.rank === 1 ? ' class="is-leader"' : "") + ">" +
      '<td class="rank">' + r.rank + "</td>" +
      '<td class="who">' + esc(r.p.name) +
        (r.p.withdrawn ? ' <span class="mark mark--out">withdrawn</span>' : "") +
        ((r.p.joinedRound || 1) > 1 ? ' <span class="mark mark--late">joined Rd ' + r.p.joinedRound + "</span>" : "") +
        (S.format === "ko" && r.p.eliminated && !r.p.withdrawn ? ' <span class="mark mark--out">out</span>' : "") + "</td>" +
      '<td class="num tb">' + (r.p.unrated ? "unr." : r.p.rating) + "</td>" +
      '<td class="num pts">' + fmtScore(r.p.score) + "</td>" +
      '<td class="num tb">' + fmtNum(r.modMedian) + "</td>" +
      '<td class="num tb">' + fmtNum(r.solkoff) + "</td>" +
      '<td class="num tb">' + fmtNum(r.cumulative) + "</td>" +
    "</tr>").join("");

  return section("Standings",
      (S.finished ? "Final, after " : "After ") + played + " of " + S.rounds + " rounds",
      exportBtn("export-results", "Export results", false), null) +
    '<table class="chart"><thead><tr>' +
      "<th>Rank</th><th>Player</th>" +
      '<th class="num">Rating</th><th class="num">Score</th>' +
      '<th class="num" title="Solkoff less the highest and/or lowest opponent">Modified median</th>' +
      '<th class="num" title="Sum of all opponents’ scores">Solkoff</th>' +
      '<th class="num" title="Sum of the running score after each round">Cumulative</th>' +
    "</tr></thead><tbody>" + body + "</tbody>" +
    "<caption>Ranked on score, then US Chess Rule 34 tiebreaks: modified median, " +
      "Solkoff, cumulative, head to head. Results are entered on the Pairings tab.</caption>" +
    "</table>" +
    resultsView(rows);
}

/* ============================================================
   FORMAT-APPROPRIATE RESULTS VIEWS

   Round robin is all-play-all, so a player-vs-player grid is
   naturally full and is the right shape. Swiss pairs each player
   against a fraction of the field, so the same grid would be
   mostly empty — it gets the printed US Chess shape instead,
   with rounds across the top.
   ============================================================ */
function resultsView(rows) {
  if (!S.roundList.length) return "";
  if (S.format === "rr" || S.format === "drr") return gridView(rows);
  if (S.format === "swiss") return swissCrosstable(rows);
  return "";
}

/* Every game played between two players, oldest first, scored
   from `aId`'s point of view. */
function gamesBetween(aId, bId) {
  const out = [];
  S.roundList.forEach(rd => rd.boards.forEach(b => {
    if (b.black == null) return;
    const isA = b.white === aId && b.black === bId;
    const isB = b.white === bId && b.black === aId;
    if (!isA && !isB) return;
    let pts = null, forfeit = isForfeit(b.result);
    if (b.result === RESULTS[1]) pts = 0.5;
    else if (b.result === "1-0" || b.result === "1-0F") pts = isA ? 1 : 0;
    else if (b.result === "0-1" || b.result === "0-1F") pts = isA ? 0 : 1;
    else if (b.result === "0-0F") pts = 0;
    out.push({ pts, forfeit, color: isA ? "W" : "B", round: rd.number });
  }));
  return out.sort((x, y) => x.round - y.round);
}

const ptsMark = p => p == null ? "" : p === 1 ? "1" : p === 0 ? "0" : "½";

/* ---------- round robin: player-vs-player grid ---------- */
function gridView(rows) {
  const double = S.format === "drr";
  const cycle = double ? (S.gridCycle === 2 ? 2 : 1) : 1;
  const head = "<tr><th></th><th></th>" +
    rows.map((r, i) => '<th class="xt-col" title="' + esc(r.p.name) + '">' + (i + 1) + "</th>").join("") +
    '<th class="num">Score</th></tr>';

  const body = rows.map((r, i) =>
    "<tr>" +
      '<td class="xt-seat">' + (i + 1) + "</td>" +
      '<td class="xt-who">' + esc(r.p.name) + "</td>" +
      rows.map((c, j) => {
        if (i === j) return '<td class="xt-cell xt-cell--self">&times;</td>';
        const games = gamesBetween(r.p.id, c.p.id);
        const g = games[cycle - 1];
        if (!g) return '<td class="xt-cell"></td>';
        const tone = g.color === "W" ? " xt-cell--w" : " xt-cell--b";
        const title = esc(r.p.name) + " as " + (g.color === "W" ? "White" : "Black") +
                      " vs " + esc(c.p.name) + ", round " + g.round;
        const mark = g.forfeit ? (g.pts === 1 ? "X" : "F") : ptsMark(g.pts);
        return '<td class="xt-cell' + tone + (g.forfeit ? " xt-cell--ff" : "") +
          '" title="' + title + (g.forfeit ? ", forfeit" : "") + '">' + mark + "</td>";
      }).join("") +
      '<td class="num xt-total">' + fmtScore(r.p.score) + "</td>" +
    "</tr>").join("");

  const toggle = double
    ? '<span class="toggle">' +
        [1, 2].map(c => '<button data-act="grid-cycle" data-cycle="' + c + '" aria-pressed="' +
          (cycle === c) + '">Cycle ' + c + "</button>").join("") + "</span>"
    : "";

  return section("Results grid",
      double ? "Each pair meets twice; the cycles are shown separately" : "Every player meets every other",
      toggle, null) +
    '<div class="scroll-x"><table class="xtable"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" +
    '<p class="legend">Read across a row: each cell is that player&rsquo;s result. ' +
      '<span class="legend__key legend__key--w">light</span> they had White, ' +
      '<span class="legend__key legend__key--b">dark</span> they had Black, ' +
      "<span class=\"legend__key legend__key--self\">&times;</span> self. " +
      "X won by forfeit, F lost by forfeit.</p>";
}

/* ---------- swiss: the printed US Chess crosstable ---------- */
function swissCrosstable(rows) {
  const seat = new Map(rows.map((r, i) => [r.p.id, i + 1]));
  const head = "<tr><th></th><th></th>" +
    S.roundList.map(rd => '<th class="xt-col">Rd ' + rd.number + "</th>").join("") +
    '<th class="num">Total</th></tr>';

  const body = rows.map((r, i) =>
    "<tr>" +
      '<td class="xt-seat">' + (i + 1) + "</td>" +
      '<td class="xt-who">' + esc(r.p.name) + "</td>" +
      S.roundList.map(rd => {
        // U = not paired that round (late entry, withdrawn, or not yet played)
        let cell = '<td class="xt-cell xt-cell--none" title="Unplayed">' +
                   '<b class="xt-res xt-res--U">U</b></td>';
        rd.boards.forEach(b => {
          const isW = b.white === r.p.id, isB = b.black === r.p.id;
          if (!isW && !isB) return;
          const k = byeKind(b.result);
          if (b.black == null) {
            cell = k
              ? '<td class="xt-cell" title="' + k.label + ' bye"><b class="xt-res xt-res--' + k.symbol +
                '">' + k.symbol + "</b></td>"
              : cell;
            return;
          }
          const opp = byId(isW ? b.black : b.white);
          const n = opp ? seat.get(opp.id) : "";
          let letter = "", note = "";
          if (b.result === RESULTS[1])      { letter = "D"; note = "Drew"; }
          else if (b.result === "0-0F")     { letter = "F"; note = "Double forfeit"; }
          else if (isForfeit(b.result)) {
            const won = (isW && b.result === "1-0F") || (isB && b.result === "0-1F");
            letter = won ? "X" : "F";
            note = won ? "Win by forfeit" : "Loss by forfeit";
          }
          else if (b.result) {
            const won = (isW && b.result === "1-0") || (isB && b.result === "0-1");
            letter = won ? "W" : "L";
            note = won ? "Won" : "Lost";
          }
          if (!letter) {      // paired, no result yet — U, but still name the opponent
            cell = '<td class="xt-cell xt-cell--none" title="Paired, not yet played">' +
              '<b class="xt-res xt-res--U">U</b><span class="xt-opp">' + n + "</span></td>";
            return;
          }
          cell = '<td class="xt-cell" title="' + note + " against " + esc(opp ? opp.name : "") +
            (isForfeit(b.result) ? "" : " as " + (isW ? "White" : "Black")) + '">' +
            '<b class="xt-res xt-res--' + letter + '">' + letter + "</b>" +
            '<span class="xt-opp">' + n + "</span></td>";
        });
        return cell;
      }).join("") +
      '<td class="num xt-total">' + fmtScore(r.p.score) + "</td>" +
    "</tr>").join("");

  return section("Crosstable", "Opponent and result, round by round", "", null) +
    '<div class="scroll-x"><table class="xtable xtable--swiss"><thead>' + head +
      "</thead><tbody>" + body + "</tbody></table></div>" +
    '<p class="legend">W won, L lost, D drew, X won by forfeit, F lost by forfeit, ' +
      "B full-point bye, H half-point bye, U unplayed. " +
      "The number is the opponent&rsquo;s row in this table.</p>";
}

/* ============================================================
   KNOCKOUT BRACKET — the shape of the event is the point here,
   so rounds become columns that narrow toward the final.
   ============================================================ */
function bracket() {
  // The whole tree is drawn, not just the rounds played: future rounds show
  // as empty slots so the shape of the event is visible from round one.
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(S.players.length, 2))));
  const cols = [];
  for (let r = 1; r <= S.rounds; r++) {
    const rd = S.roundList[r - 1];
    const live = rd && rd.number === S.viewRound && !rd.locked;
    const slots = Math.max(1, size / Math.pow(2, r));
    let matches;
    if (rd) {
      matches = rd.boards.map((b, i) => matchBox(b, i, live)).join("");
    } else {
      matches = Array.from({ length: slots }, () =>
        '<div class="match match--pending">' +
          '<div class="seatline is-pending"><span class="seatline__name">&mdash;</span></div>' +
          '<div class="seatline is-pending"><span class="seatline__name">&mdash;</span></div>' +
        "</div>").join("");
    }
    cols.push('<div class="bracket__col' + (live ? " is-live" : "") + '">' +
      '<div class="bracket__label">' + roundLabel(r) + "</div>" +
      '<div class="bracket__matches">' + matches + "</div></div>");
  }
  return '<div class="scroll-x"><div class="bracket">' + cols.join("") + "</div></div>";
}

function matchBox(b, i, live) {
  const w = byId(b.white), bl = b.black == null ? null : byId(b.black);
  if (!bl) {
    return '<div class="match match--bye">' +
      '<div class="seatline is-through">' + seatInner(w) + "</div>" +
      '<div class="match__note">Bye, advances</div></div>';
  }
  const wWon = b.result === "1-0", bWon = b.result === "0-1", drew = b.result === RESULTS[1];
  const pick = side => live ? ' data-act="ko-pick" data-i="' + i + '" data-side="' + side + '"' : "";
  return '<div class="match' + (live ? " is-live" : "") + (b.result ? " is-done" : "") + '"' +
      (live ? ' tabindex="0" data-board="' + i + '"' : "") + ">" +
    '<div class="seatline' + (wWon ? " is-through" : bWon ? " is-out" : "") + '"' + pick("white") + ">" +
      seatInner(w) + (wWon ? '<span class="seatline__pt">1</span>' : bWon ? '<span class="seatline__pt">0</span>' : "") +
    "</div>" +
    '<div class="seatline' + (bWon ? " is-through" : wWon ? " is-out" : "") + '"' + pick("black") + ">" +
      seatInner(bl) + (bWon ? '<span class="seatline__pt">1</span>' : wWon ? '<span class="seatline__pt">0</span>' : "") +
    "</div>" +
    (drew ? '<div class="match__note match__note--flag">Drawn, needs a replay</div>' : "") +
    (live ? '<div class="match__draw"><button data-act="result" data-i="' + i + '" data-r="' + RESULTS[1] +
            '" aria-pressed="' + drew + '">Draw</button></div>' : "") +
  "</div>";
}

function roundLabel(n) {
  const left = S.rounds - n;
  if (left === 0) return "Final";
  if (left === 1) return "Semi-finals";
  if (left === 2) return "Quarter-finals";
  return "Round " + n;
}
function seatInner(p) {
  if (!p) return '<span class="seatline__name">&mdash;</span>';
  return '<span class="seatline__name">' + esc(p.name) + "</span>" +
    '<span class="seatline__rating">' + (p.unrated ? "unr." : p.rating) + "</span>";
}

/* ============================================================
   HISTORY — saved tournaments, this browser only
   ============================================================ */
function viewHistory() {
  const list = loadAll().slice().sort((a, b) =>
    String(b.dateSaved || b.dateCreated || "").localeCompare(String(a.dateSaved || a.dateCreated || "")));
  const usable = isAvailable();

  const warn = usable ? "" :
    '<p class="notice">This browser is not allowing the page to save. ' +
      "A private window or blocked site data will do that; tournaments will be lost on reload.</p>";

  let body;
  if (!list.length) {
    body = '<p class="empty">Nothing saved yet. Start a tournament and it is kept here automatically.</p>';
  } else {
    body = '<table class="ledger ledger--history"><thead><tr>' +
      "<th>Tournament</th><th>Format</th><th>Players</th><th>Saved</th><th>Status</th><th></th>" +
      "</tr></thead><tbody>" +
      list.map(t => {
        const confirming = S.confirmDelete === t.id;
        const lead = (t.standingsSnapshot || [])[0];
        const done = t.status === "completed";
        return "<tr" + (t.id === S.id ? ' class="is-current"' : "") + ">" +
          '<td class="hist-name">' +
            '<button class="linkish" data-act="open-tournament" data-id="' + t.id + '">' +
              esc(t.name || "Untitled") + "</button>" +
            (done && lead ? '<span class="hist-lead">Won by ' + esc(lead.name) + "</span>" : "") +
          "</td>" +
          "<td>" + (FORMATS[t.format] || t.format) + "</td>" +
          '<td class="num">' + (t.players ? t.players.length : 0) + "</td>" +
          '<td class="hist-when">' + when(t.dateSaved || t.dateCreated) + "</td>" +
          '<td><span class="status status--' + (done ? "done" : "live") + '">' +
            (done ? "Completed" : "In progress") + "</span></td>" +
          '<td class="act">' + (confirming
            ? '<span class="confirm">Delete?' +
                '<button class="btn btn--danger" data-act="delete-confirm" data-id="' + t.id + '">Delete</button>' +
                '<button class="btn" data-act="delete-cancel">Keep</button></span>'
            : '<button class="btn btn--ghost" data-act="delete-ask" data-id="' + t.id +
              '" title="Delete ' + esc(t.name || "") + '">&times;</button>') +
          "</td>" +
        "</tr>";
      }).join("") + "</tbody></table>";
  }

  return section("History", list.length + (list.length === 1 ? " tournament" : " tournaments"),
      '<button class="btn" data-act="new-tournament">New tournament</button>', null) +
    warn + body +
    '<p class="legend legend--local">Saved in this browser only. Nothing is sent anywhere, ' +
      "and these will not appear on another device or in a different browser.</p>";
}

function when(iso) {
  if (!iso) return "&mdash;";
  const d = new Date(iso);
  if (isNaN(d)) return "&mdash;";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ---------- small builders ---------- */
function section(title, note, aside, body) {
  const head = '<div class="section__head">' +
    '<h2 class="section__title">' + esc(title) + "</h2>" +
    (note ? '<span class="section__note">' + esc(note) + "</span>" : "") +
    '<span class="grow"></span>' + (aside || "") + "</div>";
  return '<section class="section">' + head +
    (body == null ? "" : '<div class="section__body">' + body + "</div>") + "</section>";
}
function field(label, control) {
  return '<label class="field"><span class="field__label">' + label + "</span>" + control + "</label>";
}
function exportBtn(act, label, disabled) {
  return '<button class="btn btn--export" data-act="' + act + '"' + (disabled ? " disabled" : "") + ">" +
    label + "</button>";
}
