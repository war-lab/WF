// 模擬との照合（BD06 5.5）。模擬で局を記録し（sim/record.py、APPRULES=1）、エンジンで再適用して手番ごとに比べる。
//
//   node tools/compare.ts [人数ごとの局数=1600] [最初の種=1]
//
// python が要る。記録は一時フォルダに書き、終わったら消す。食い違った局が1つでもあれば終了コード1。
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replay, type SimRecord } from "./replay.ts";

const games = Number(process.argv[2] ?? 1600);
const first = Number(process.argv[3] ?? 1);
const here = dirname(fileURLToPath(import.meta.url));
const record = resolve(here, "../../../../sim/record.py");
const out = mkdtempSync(join(tmpdir(), "wf-compare-"));

function rec(n: 3 | 4): Promise<void> {
  return new Promise((ok, ng) => {
    const p = spawn("python", [record, out, String(games), String(n), String(first)], { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? ok() : ng(new Error(`record.py ${n}人戦が終了コード ${code}`))));
    p.on("error", ng);
  });
}

try {
  const t0 = Date.now();
  await Promise.all([rec(4), rec(3)]);
  const t1 = Date.now();
  const files = readdirSync(out).filter((f) => f.endsWith(".json")).sort();
  let bad = 0;
  let turns = 0;
  const st = { reissued: 0, unanswered: 0, gamesReissued: 0, gamesUnanswered: 0 };
  for (const f of files) {
    const r = replay(JSON.parse(readFileSync(join(out, f), "utf8")) as SimRecord);
    turns += r.turns;
    st.reissued += r.stats.reissued;
    st.unanswered += r.stats.unanswered;
    if (r.stats.reissued) st.gamesReissued += 1;
    if (r.stats.unanswered) st.gamesUnanswered += 1;
    if (!r.ok) {
      bad += 1;
      console.log(`${f}: ${r.where}（${r.turns}/${r.totalTurns}手番まで一致）: ${r.what}`);
      if (r.last?.length) console.log(`  直前のコマンド: ${r.last.join(" | ")}`);
    }
  }
  const t2 = Date.now();
  console.log(
    `山が尽きて問いを出し直した回数 ${st.reissued}（起きた局 ${st.gamesReissued}）。前の人が最後の1枚を取り、答えても配られなかった問い ${st.unanswered}（起きた局 ${st.gamesUnanswered}）`,
  );
  console.log(`${files.length}局（4人戦と3人戦を各${games}局、種 ${first}〜${first + games - 1}）中 ${files.length - bad}局が一致。比べた手番 ${turns}`);
  console.log(`記録 ${((t1 - t0) / 1000).toFixed(0)}秒、再適用 ${((t2 - t1) / 1000).toFixed(0)}秒`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(out, { recursive: true, force: true });
}
