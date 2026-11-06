// 不変条件（BD01 4章）。破れている条件を文で返す。空なら満たしている。
// 性質のテスト（BD06 5.3）と、テストの状態の組み立て器（BD06 2章）が使う。
import { bagTotal } from "./bag.ts";
import { vertexNeighbors } from "./flow.ts";
import type { GameState } from "./types.ts";
import { WORD_CARDS } from "./types.ts";

export function checkInvariants(s: GameState): string[] {
  const errs: string[] = [];
  // 1. カードの総数
  for (const k of WORD_CARDS) {
    const held = s.players.reduce((t, p) => t + (p.hand[k] ?? 0), 0);
    if (s.piles[k] + held !== s.config.cardCounts[k]) errs.push(`1: ${k} の総数が ${s.piles[k] + held}`);
  }
  // 2. 負にならない（Bag は0の項目を持たない形も確かめる）
  for (const k of WORD_CARDS) if (s.piles[k] < 0) errs.push(`2: 山 ${k} が負`);
  for (const p of s.players) {
    for (const [k, v] of Object.entries(p.hand)) if (!(v! > 0)) errs.push(`2: 席${p.seat} の手札 ${k}=${v}`);
    for (const [k, v] of Object.entries(p.products)) if (!(v! > 0)) errs.push(`2: 席${p.seat} の産物 ${k}=${v}`);
    if (p.coins < 0) errs.push(`2: 席${p.seat} のコインが負`);
    if (p.freeTickets < 0) errs.push(`2: 席${p.seat} の無料券が負`);
    // 3. 点と内訳
    const sum = p.ledger.reduce((t, e) => t + e.hp, 0);
    if (sum !== p.halfPoints) errs.push(`3: 席${p.seat} の点 ${p.halfPoints} と内訳 ${sum}`);
    // 4. 拠点の上限
    if (p.houses.length > s.config.maxHouses) errs.push(`4: 席${p.seat} の拠点が ${p.houses.length}`);
    for (const v of p.houses) if (s.board.houses[v] !== p.seat) errs.push(`4: 席${p.seat} の拠点 ${v} が盤面と合わない`);
  }
  // 4. 拠点が隣り合わない
  const hv = Object.keys(s.board.houses).map(Number);
  for (const v of hv) for (const u of vertexNeighbors(v)) if (s.board.houses[u] !== undefined) errs.push(`4: 拠点 ${v} と ${u} が隣り合う`);
  if (hv.length !== s.players.reduce((t, p) => t + p.houses.length, 0)) errs.push("4: 盤面の拠点の数が合わない");
  // 5. 表の注文の枚数と slot
  if (s.orders.faceUp.length > s.config.orderFaceUp) errs.push("5: 表の注文が多い");
  if (new Set(s.orders.faceUp.map((f) => f.slot)).size !== s.orders.faceUp.length) errs.push("5: 注文の slot が重なる");
  if (s.joint.faceUp.length > s.config.jointFaceUp) errs.push("5: 表の共同注文が多い");
  if (new Set(s.joint.faceUp.map((f) => f.slot)).size !== s.joint.faceUp.length) errs.push("5: 共同注文の slot が重なる");
  // 6. 申し出は main のときだけ
  if (s.trades.length > 0 && s.phase.k !== "main") errs.push("6: main 以外で申し出がある");
  // 7. 問いは setupPrompt か income のときだけ
  if (s.prompts.length > 0 && s.phase.k !== "setupPrompt" && s.phase.k !== "income") errs.push("7: 問いの段階が違う");
  // 8. over なら result
  if (s.phase.k === "over" && !s.result) errs.push("8: 結果がない");
  // 9. 表の共同注文は3行そろっていない
  for (const f of s.joint.faceUp) if (f.rows.every((r) => r !== null)) errs.push(`9: 共同注文 ${f.joint.id} が3行そろったまま`);
  // 補助：手札の合計が整数
  for (const p of s.players) if (!Number.isInteger(bagTotal(p.hand))) errs.push("2: 手札の数が整数でない");
  return errs;
}
