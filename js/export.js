import { S, byId, RESULTS, FORFEITS, byeKind, isForfeit } from "./state.js";
import { standings } from "./tiebreaks.js";

/* ============================================================
   CSV EXPORT  (Blob download — no server round-trip)
   ============================================================ */
function csv(rows) {
  return rows.map(r => r.map(c => {
    const s = c == null ? "" : String(c);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\r\n");
}
function download(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = () => (S.name || "tournament").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
const csvResult = r => {
  if (r === RESULTS[1]) return "1/2-1/2";
  const k = byeKind(r);
  if (k) return "bye " + k.symbol;
  return r || "";
};

export function exportPlayers() {
  const ranked = S.players.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  const rows = [["name", "rating", "starting rank"]];
  ranked.forEach((p, i) => rows.push([p.name, p.rating, i + 1]));
  download(slug() + "-players.csv", csv(rows));
}

export function exportPairings() {
  const rd = S.roundList[S.viewRound - 1];
  if (!rd) return;
  const rows = [["round", "board", "white", "black", "result"]];
  rd.boards.forEach((b, i) => {
    const w = byId(b.white), bl = b.black == null ? null : byId(b.black);
    rows.push([rd.number, i + 1, w ? w.name : "", bl ? bl.name : "bye",
               b.black == null
                 ? (S.format === "ko" ? "bye (advances)" : csvResult(b.result || "bye"))
                 : csvResult(b.result)]);
  });
  download(slug() + "-round-" + rd.number + "-pairings.csv", csv(rows));
}

/* Full cross-table: one row per player, one column per round. */
export function exportResults() {
  const rows = standings();
  const n = S.roundList.length;
  const head = ["rank", "player", "rating", "starting rank", "status"];
  for (let i = 1; i <= n; i++) head.push("R" + i);
  head.push("score", "modified median", "solkoff", "cumulative");
  const out = [head];
  rows.forEach(r => {
    const line = [r.rank, r.p.name, r.p.rating, r.p.seed,
                  r.p.withdrawn ? "withdrawn" : (r.p.joinedRound || 1) > 1
                    ? "joined R" + r.p.joinedRound : "active"];
    /* US Chess crosstable key: X won by forfeit, F lost by forfeit,
       B full-point bye, H half-point bye, U unplayed. */
    S.roundList.forEach(rd => {
      let cell = "U";
      rd.boards.forEach(b => {
        const isW = b.white === r.p.id, isB = b.black === r.p.id;
        if (!isW && !isB) return;
        if (b.black == null) {
          const k = byeKind(b.result);
          cell = k ? k.symbol : "U";
          return;
        }
        const opp = byId(isW ? b.black : b.white);
        const n = opp ? opp.seed : "";
        if (b.result === "0-0F") { cell = "F" + n; return; }
        if (isForfeit(b.result)) {
          const won = (isW && b.result === "1-0F") || (isB && b.result === "0-1F");
          cell = (won ? "X" : "F") + n;
          return;
        }
        if (!b.result) { cell = "U"; return; }
        const col = isW ? "w" : "b";
        const res = b.result === RESULTS[1] ? "="
          : ((isW && b.result === "1-0") || (isB && b.result === "0-1")) ? "1" : "0";
        cell = n + col + res;
      });
      line.push(cell);
    });
    line.push(r.p.score, r.modMedian, r.solkoff, r.cumulative);
    out.push(line);
  });
  download(slug() + "-results.csv", csv(out));
}

