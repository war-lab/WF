// 性質のテスト（方式設計11.2、BD06 5章）。
// 正しい操作を乱数で選び続けるゲームを多数回し、各操作のあとに不変条件と秘密の扱いを確かめる。
// 回数は環境変数 PROP_RUNS で変える（既定はコミットの前の200。毎晩は5000。BD06 5.2）。
// 失敗したときの縮小は選択の列が長いため時間がかかる。開発中に縮小を省くときは PROP_NO_SHRINK=1 にする。
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validate } from "../src/commands.ts";
import { apply, createGame } from "../src/game.ts";
import { checkInvariants } from "../src/invariants.ts";
import type { Actor, Command, GameState, Seat } from "../src/types.ts";
import { viewFor } from "../src/view.ts";
import { config, participants } from "./helpers.ts";
import { candidates, seededPicker, type Move } from "./play.ts";

// npm run test:nightly は --mode nightly で5000局にする（Windows の cmd でも動くよう、環境変数ではなく mode で切り替える）
const MODE = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
const RUNS = Number(process.env.PROP_RUNS ?? (MODE === "nightly" ? 5000 : 200));
const MAX_OPS = 3000;

/** 乱入させる不正なコマンドの材料（形は正しいが、状態に合わないことが多い） */
function junkCommand(x: number, y: number): { actor: Actor; cmd: Command } {
  const seat = x % 4;
  const actor: Actor = y % 13 === 0 ? { k: "admin" } : { k: "seat", seat };
  const list: Command[] = [
    { t: "placeHouse", vertex: y % 60 },
    { t: "rollDice" },
    { t: "inputDice", a: y % 8, b: x % 8 },
    { t: "answerPrompt", promptId: `p${y % 50}`, answer: { k: "chooseKind", kinds: ["cow"] } },
    { t: "plant", crop: "carrot" },
    { t: "buyAnimal", animal: "cow" },
    { t: "feed", plot: y % 5 },
    { t: "sellProducts", product: "egg", n: y % 4 },
    { t: "sellAnimal", plot: y % 5 },
    { t: "deliverOrder", orderId: `o${String(y % 40).padStart(2, "0")}`, items: { egg: 1 + (y % 3) } },
    { t: "deliverBonus", orderId: `o${String(y % 40).padStart(2, "0")}`, product: "milk", n: y % 3 },
    { t: "claimAnimalOrder", orderId: `o${String(y % 40).padStart(2, "0")}` },
    { t: "contributeJoint", jointId: `j0${y % 9}`, product: "egg", n: 2 + (y % 3) },
    { t: "buildHouse", vertex: y % 60 },
    { t: "bankTrade", give: "grow", get: "sell" },
    { t: "harborTrade", vertex: [17, 38, 37, 33, 3, 8][y % 6]!, give: "carrot", get: "cow" },
    { t: "buyCard", kind: "buy" },
    { t: "buyProduct", product: "milk" },
    { t: "proposeTrade", to: y % 4, give: { cards: { sell: 1 }, products: {}, coins: 0 }, get: { cards: {}, products: {}, coins: 1 } },
    { t: "respondTrade", id: `t${y % 30}`, accept: true },
    { t: "withdrawTrade", id: `t${y % 30}` },
    { t: "payJapanese", kind: "undeclared", method: "ticket" },
    { t: "endTurn" },
    { t: "endTurnFor", turnSerial: y % 200 },
    { t: "answerFor", promptId: `p${y % 50}`, answer: { k: "discard", cards: { grow: 9 } } },
  ];
  return { actor, cmd: list[x % list.length]! };
}

const SECRET_ORDER_KEYS = ["cond", "hp", "level", "source"];

/** 表示用の状態に秘密が入っていないか（BD06 5.3 の4、5） */
function checkViews(s: GameState, viewer: Seat): void {
  const b = viewFor(s, "board") as unknown as Record<string, unknown>;
  const json = JSON.stringify({ ...b, revealedOrders: null, finalReveal: null });
  expect(json).not.toContain('"rng"');
  expect(json).not.toContain('"deck"');
  for (const p of b.players as Record<string, unknown>[]) expect(p).not.toHaveProperty("hand");
  for (const f of (b.orders as { faceUp: Record<string, unknown>[] }).faceUp) for (const k of SECRET_ORDER_KEYS) expect(f).not.toHaveProperty(k);
  for (const f of (b.joint as { faceUp: Record<string, unknown>[] }).faceUp) {
    expect(f).not.toHaveProperty("joint");
    expect(f).not.toHaveProperty("lines");
  }
  if (s.phase.k !== "over") expect(b.finalReveal).toBeNull();

  const v = viewFor(s, viewer) as unknown as { players: Record<string, unknown>[]; me: { hand: unknown } };
  for (const p of v.players) expect(p).not.toHaveProperty("hand");
  expect(v.me.hand).toEqual(s.players[viewer]!.hand);
}

interface Input {
  seed: string;
  n: 3 | 4;
  choices: number[];
  junk: { at: number; x: number; y: number }[];
}

export function runGame(inp: Input): void {
  const cfg = config();
  let s = createGame(cfg, { participants: participants(inp.n) }, inp.seed);
  const log: Move[] = [];
  const junkAt = new Map(inp.junk.map((j) => [j.at, j]));

  for (let op = 0; op < MAX_OPS && s.phase.k !== "over"; op++) {
    // 不正なコマンドを挟む。拒否なら状態は変わらない。受け付けたら正しい操作として続ける
    const j = junkAt.get(op);
    if (j) {
      const { actor, cmd } = junkCommand(j.x, j.y);
      const before = JSON.stringify(s);
      const r = apply(s, actor, cmd);
      expect(JSON.stringify(s)).toBe(before);
      if (r.ok) {
        s = r.state;
        log.push({ actor, cmd });
        expect(checkInvariants(s)).toEqual([]);
        if (s.phase.k === "over") break;
      }
    }

    // 1操作に選択の列の値を1つ使う。候補の選択はその値の剰余、売る数などの細かい値はその値を種にした乱数で決める
    const v = inp.choices[op] ?? 0;
    const pk = seededPicker(v);
    const moves = candidates(s, pk);
    expect(moves.length, `候補がない: phase=${s.phase.k}`).toBeGreaterThan(0);
    // legalActions の enabled から作った候補は、必ず受け付けられる（承諾は持ち物の変化で拒否されうるので除く）
    for (const m of moves) {
      if (m.cmd.t === "respondTrade" && m.cmd.accept) continue;
      expect(validate(s, m.actor, m.cmd), JSON.stringify(m)).toBeNull();
    }
    const m = moves[v % moves.length]!;
    const r = apply(s, m.actor, m.cmd);
    if (!r.ok) {
      expect(m.cmd.t === "respondTrade" && r.code === "TRADE_NOT_HOLDING", `${JSON.stringify(m)} → ${r.code}`).toBe(true);
      continue;
    }
    s = r.state;
    log.push(m);
    expect(checkInvariants(s), JSON.stringify(m)).toEqual([]);
    checkViews(s, op % s.n);
  }

  expect(s.phase.k, "上限の操作数で終わらない").toBe("over");
  expect(s.result!.ranking.map((r) => r.seat).sort()).toEqual(Array.from({ length: inp.n }, (_, i) => i));

  // 記録したコマンドの列を最初から再適用すると、同じ最終状態になる
  let t = createGame(cfg, { participants: participants(inp.n) }, inp.seed);
  for (const m of log) {
    const r = apply(t, m.actor, m.cmd);
    if (!r.ok) throw new Error(`再適用で拒否: ${r.code}`);
    t = r.state;
  }
  expect(JSON.stringify(t)).toBe(JSON.stringify(s));
}

const inputArb: fc.Arbitrary<Input> = fc.record({
  seed: fc.stringMatching(/^[0-9a-f]{32}$/),
  n: fc.constantFrom(3 as const, 4 as const),
  choices: fc.array(fc.nat({ max: 1_000_000 }), { minLength: MAX_OPS, maxLength: MAX_OPS }),
  junk: fc.array(fc.record({ at: fc.nat({ max: MAX_OPS }), x: fc.nat(), y: fc.nat() }), { maxLength: 40 }),
});

describe("性質のテスト（BD06 5章）", () => {
  it(`正しい操作を乱数で選び続けるゲーム ${RUNS} 局で、不変条件、受け付け（TC-SYS-06）、秘密、再現性（TC-SYS-10）が成り立つ`, () => {
    fc.assert(fc.property(inputArb, runGame), { numRuns: RUNS, endOnFailure: process.env.PROP_NO_SHRINK === "1" });
  }, 3_600_000);
});
