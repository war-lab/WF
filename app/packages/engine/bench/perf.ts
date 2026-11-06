// 処理時間と記録の大きさの測定（BD06 10.2 の PERF-01、PERF-03。BD05 6章）。
//   node bench/perf.ts [局数=50]
// PERF-01：1件のコマンドの処理（apply、状態の写しの JSON 化、5台分の viewFor と JSON 化）の99%点。目標5ミリ秒以内
// PERF-03：1局分の記録の大きさ（コマンドと、各行の状態の写し）。目標30MB以内
// ゲームの作成：createGame と、作成直後の写しの JSON 化と5台分の viewFor（方式設計12章 M1、BD05 1.4）
// 局は、正しい操作を乱数で選んで進める（ボットの移植は M2）。乱数の局はボットより1手番の操作が多く、局が長くなりやすい。
import { performance } from "node:perf_hooks";
import { defaultConfig } from "../src/config.ts";
import { apply, createGame } from "../src/game.ts";
import { viewFor } from "../src/view.ts";
import { participants } from "../test/helpers.ts";
import { candidates, seededPicker } from "../test/play.ts";

const games = Number(process.argv[2] ?? 50);
const times: number[] = [];
const sizes: number[] = [];
const cmdCounts: number[] = [];
const stateSizes: number[] = [];
const createTimes: number[] = [];

for (let g = 0; g < games; g++) {
  const n = g % 2 === 0 ? 4 : 3;
  const c0 = performance.now();
  let s = createGame(defaultConfig(), { participants: participants(n) }, `perf-${g}`);
  let bytes = JSON.stringify(s).length;
  JSON.stringify(viewFor(s, "board"));
  for (let i = 0; i < 4; i++) JSON.stringify(viewFor(s, i % n));
  createTimes.push(performance.now() - c0);
  let count = 0;
  for (let op = 0; op < 5000 && s.phase.k !== "over"; op++) {
    const pk = seededPicker(g * 100003 + op);
    const moves = candidates(s, pk);
    const m = moves[pk.pick(moves.length)]!;
    const t0 = performance.now();
    const r = apply(s, m.actor, m.cmd);
    if (!r.ok) continue;
    const snap = JSON.stringify(r.state);
    JSON.stringify(viewFor(r.state, "board"));
    for (let i = 0; i < 4; i++) JSON.stringify(viewFor(r.state, i % n));
    const t1 = performance.now();
    times.push(t1 - t0);
    bytes += JSON.stringify(m).length + snap.length;
    stateSizes.push(snap.length);
    count += 1;
    s = r.state;
  }
  if (s.phase.k !== "over") throw new Error(`局 ${g} が終わらない`);
  sizes.push(bytes);
  cmdCounts.push(count);
}

const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const mb = (b: number) => (b / 1024 / 1024).toFixed(2);
console.log(`局数 ${games}、コマンド ${times.length} 件`);
console.log(`PERF-01 1件の処理：中央値 ${q(times, 0.5).toFixed(3)}ms、99%点 ${q(times, 0.99).toFixed(3)}ms、最大 ${q(times, 1).toFixed(3)}ms（目標 99%点 5ms 以内）`);
console.log(`ゲームの作成：中央値 ${q(createTimes, 0.5).toFixed(3)}ms、最大 ${q(createTimes, 1).toFixed(3)}ms（最初の1局はモジュールの読み込みを含む）`);
console.log(`PERF-03 1局の記録：中央値 ${mb(q(sizes, 0.5))}MB、最大 ${mb(q(sizes, 1))}MB（目標 30MB 以内）`);
console.log(`  1局のコマンド数：中央値 ${q(cmdCounts, 0.5)}、最大 ${q(cmdCounts, 1)}。写し1件：中央値 ${(q(stateSizes, 0.5) / 1024).toFixed(1)}KB、最大 ${(q(stateSizes, 1) / 1024).toFixed(1)}KB`);
