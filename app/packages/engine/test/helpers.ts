// テストの補助（BD06 2章）。状態の組み立て器と、コマンドを続けて適用する関数。
import { expect } from "vitest";
import { bagAdd, bagGet } from "../src/bag.ts";
import { defaultConfig } from "../src/config.ts";
import { apply, createGame } from "../src/game.ts";
import { checkInvariants } from "../src/invariants.ts";
import { legalActions } from "../src/legal.ts";
import type {
  Actor,
  Command,
  GameState,
  Participant,
  Product,
  RejectCode,
  RuleConfig,
  Seat,
  WordCard,
} from "../src/types.ts";
import { WORD_CARDS } from "../src/types.ts";

export const COLORS = ["red", "blue", "green", "yellow"] as const;

export function participants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({ participantId: `P${i}`, color: COLORS[i]!, japaneseRate: 1 as const }));
}

export function config(over: Partial<RuleConfig> = {}): RuleConfig {
  return { ...defaultConfig(), ...over };
}

export const seat = (s: Seat): Actor => ({ k: "seat", seat: s });
export const admin: Actor = { k: "admin" };

/** 受け付けられることを確かめて、新しい状態を返す */
export function ok(s: GameState, a: Actor, c: Command): GameState {
  const r = apply(s, a, c);
  if (!r.ok) throw new Error(`拒否された: ${JSON.stringify(c)} → ${r.code}`);
  const errs = checkInvariants(r.state);
  if (errs.length) throw new Error(`不変条件: ${errs.join(" / ")}`);
  return r.state;
}

export function okEv(s: GameState, a: Actor, c: Command) {
  const r = apply(s, a, c);
  if (!r.ok) throw new Error(`拒否された: ${JSON.stringify(c)} → ${r.code}`);
  return r;
}

/** 拒否されること、理由、状態が変わらないことを確かめる */
export function rejects(s: GameState, a: Actor, c: Command, code: RejectCode): void {
  const before = JSON.stringify(s);
  const r = apply(s, a, c);
  expect(r.ok ? "accepted" : r.code).toBe(code);
  expect(JSON.stringify(s)).toBe(before);
}

/** 準備を自動で進める。拠点は置ける交点の先頭、問いは options の先頭で答える */
export function autoSetup(s: GameState, vertexPick: (vs: number[], seat: Seat) => number = (vs) => vs[0]!): GameState {
  let st = s;
  for (let guard = 0; guard < 100; guard++) {
    if (st.phase.k === "setupPlace") {
      const placer = st.phase.step < st.n ? st.phase.step : 2 * st.n - 1 - st.phase.step;
      const vs = legalActions(st, placer).placeHouse!.vertices;
      st = ok(st, seat(placer), { t: "placeHouse", vertex: vertexPick(vs, placer) });
      continue;
    }
    if (st.phase.k === "setupPrompt") {
      st = answerAllFirst(st);
      continue;
    }
    return st;
  }
  throw new Error("準備が終わらない");
}

/** 残っている問いに、options の先頭（捨て札は手札の先頭から）で全部答える */
export function answerAllFirst(s: GameState): GameState {
  let st = s;
  for (const p of [...st.prompts]) {
    if (st.answers[p.id]) continue;
    if (!st.prompts.find((x) => x.id === p.id)) continue;
    if (p.k === "chooseKind") {
      st = ok(st, seat(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array(p.count).fill(p.options[0]) } });
    } else {
      const cards: Partial<Record<WordCard, number>> = {};
      let left = p.count;
      for (const k of WORD_CARDS) {
        const take = Math.min(left, bagGet(st.players[p.seat]!.hand, k));
        if (take > 0) cards[k] = take;
        left -= take;
      }
      st = ok(st, seat(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "discard", cards } });
    }
  }
  return st;
}

/** 準備を終えた4人戦（既定）の状態。最初の手番の roll の段階 */
export function started(n = 4, seed = "base", over: Partial<RuleConfig> = {}): GameState {
  return autoSetup(createGame(config(over), { participants: participants(n) }, seed));
}

// ---------- 状態の組み立て器 ----------
// 準備を終えた状態を写し、手札、産物、コインなどを直接書き換える。最後に不変条件を確かめる（BD06 2章）。

/** 全員の手札を山に戻し、空にする */
export function clearHands(s: GameState): void {
  for (const p of s.players) {
    for (const k of WORD_CARDS) {
      const n = bagGet(p.hand, k);
      if (n > 0) {
        s.piles[k] += n;
        delete p.hand[k];
      }
    }
  }
}

/** 山から手札へ渡す（総数を保つ） */
export function giveCards(s: GameState, st: Seat, cards: Partial<Record<WordCard, number>>): void {
  for (const k of WORD_CARDS) {
    const n = cards[k] ?? 0;
    if (n <= 0) continue;
    if (s.piles[k] < n) throw new Error(`山の ${k} が足りない`);
    s.piles[k] -= n;
    bagAdd(s.players[st]!.hand, k, n);
  }
}

export function giveProducts(s: GameState, st: Seat, items: Partial<Record<Product, number>>): void {
  for (const [k, n] of Object.entries(items)) bagAdd(s.players[st]!.products, k as Product, n!);
}

/** 山の枚数を n にする。差分は持ち主のいない分として、手札のない席を作らずに総数の設定を書き換える */
export function setPile(s: GameState, k: WordCard, n: number): void {
  const held = s.players.reduce((t, p) => t + bagGet(p.hand, k), 0);
  s.piles[k] = n;
  s.config.cardCounts[k] = n + held;
}

/**
 * main の段階の状態を作る。手番の人と通し番号、ラウンドを指定できる。
 * 準備を終えた状態から、指定の席の手番まで、出目を手で入れて進める代わりに、turn を直接置き換える。
 */
export function mainState(opts: { n?: 3 | 4; seat?: Seat; serial?: number; round?: number; seed?: string; config?: Partial<RuleConfig> } = {}): GameState {
  const n = opts.n ?? 4;
  const s = structuredClone(started(n, opts.seed ?? "base", opts.config));
  const st = opts.seat ?? 0;
  const serial = opts.serial ?? st + 1;
  const round = opts.round ?? Math.floor((serial - 1) / n) + 1;
  // 通し番号 1..serial のうち、その席の手番の数（席 p の手番は通し番号 k で (k-1) % n === p）
  for (const p of s.players) p.ownTurns = serial - 1 >= p.seat ? Math.floor((serial - 1 - p.seat) / n) + 1 : 0;
  s.turn = {
    serial,
    seat: st,
    round,
    dice: [3, 3],
    fedPlots: [],
    jointRowDone: false,
    productBought: false,
    failedOrders: [],
    receivedIncome: true,
  };
  s.phase = { k: "main" };
  return s;
}

/** 組み立てた状態の不変条件を確かめる */
export function checked(s: GameState): GameState {
  const errs = checkInvariants(s);
  if (errs.length) throw new Error(`組み立てた状態が不変条件を破る: ${errs.join(" / ")}`);
  return s;
}

// ---------- 盤面と場面の組み立て ----------

import { board } from "../src/board.ts";
import type { Crop, FaceUpJoint, JointLine, Order, OrderCondition, Product as Prod, TileKind } from "../src/types.ts";

export const vertexOf = new Map(board.vertices.map((v) => [v.id, v]));
export const MARKET = board.tiles.find((t) => t.market)!.id;

/** タイル t の交点のうち、t 以外に同じ数字のタイルに接しないもの */
export function safeVertices(t: number): number[] {
  const num = board.tiles[t]!.number;
  return board.tiles[t]!.vertices.filter((v) => vertexOf.get(v)!.tiles.every((u) => u === t || board.tiles[u]!.number !== num));
}

/** 互いに隣り合わず、taken とも隣り合わない交点を k 個選ぶ */
export function spread(vs: number[], k: number, taken: number[] = []): number[] {
  const out: number[] = [];
  const bad = (v: number) => [...taken, ...out].some((u) => u === v || vertexOf.get(u)!.neighbors.includes(v));
  for (const v of vs) if (!bad(v) && out.length < k) out.push(v);
  if (out.length < k) throw new Error("交点を選べない");
  return out;
}

/** 数字が一意なタイル（6と8以外、Market 以外） */
export function uniqueTiles(): number[] {
  return board.tiles.filter((t) => t.number !== null && board.tiles.filter((u) => u.number === t.number).length === 1).map((t) => t.id);
}

/** 拠点をすべて置き直す */
export function setHouses(s: GameState, houses: Record<number, number[]>): void {
  s.board.houses = {};
  for (const p of s.players) p.houses = [];
  for (const [st, vs] of Object.entries(houses)) {
    for (const v of vs) {
      s.board.houses[v] = Number(st);
      s.players[Number(st)]!.houses.push(v);
    }
  }
}

export function setTile(s: GameState, t: number, kind: TileKind): void {
  s.board.tiles[t]!.kind = kind;
}

/** roll の段階の状態（手で入れるサイコロ）。拠点は空にする */
export function rollState(opts: { n?: 3 | 4; seat?: Seat; serial?: number } = {}): GameState {
  const s = mainState({ ...opts, config: { dice: "manual" } });
  s.phase = { k: "roll" };
  s.turn!.dice = null;
  s.turn!.receivedIncome = false;
  setHouses(s, {});
  return s;
}

/** 合計 sum になる2つの目 */
export function diceFor(sum: number): { t: "inputDice"; a: number; b: number } {
  const a = Math.min(6, sum - 1);
  return { t: "inputDice", a, b: sum - a };
}

export function numberOf(t: number): number {
  return board.tiles[t]!.number!;
}

/** 点を足す（内訳も足して不変条件を保つ） */
export function addPoints(s: GameState, st: Seat, hp: number): void {
  s.players[st]!.ledger.push({ src: "order", orderId: "test", hp, coins: 0, turn: 0 });
  s.players[st]!.halfPoints += hp;
}

let orderSeq = 900;
export function mkOrder(cond: OrderCondition, hp: number | null, over: Partial<Order> = {}): Order {
  orderSeq += 1;
  return {
    id: `x${orderSeq}`,
    text: "Test order.",
    level: cond.k === "bonus" ? "bonus" : "medium",
    isBonus: cond.k === "bonus",
    picture: null,
    to: null,
    cond,
    hp,
    source: { mode: "fixed", printedNo: 0 },
    ...over,
  };
}

/** 表の注文を置き換える（山はそのまま） */
export function putOrders(s: GameState, orders: Order[], counterSeat: Seat = 0, revealedTurn = 0): void {
  s.orders.revealed = true;
  s.orders.faceUp = orders.map((order, slot) => ({ slot, order, counterSeat, remaining: s.config.orderExpireTurns, revealedTurn }));
}

export function mkJoint(lines: [Prod, number, number][], to = "the village festival"): FaceUpJoint {
  orderSeq += 1;
  return {
    slot: 0,
    joint: {
      id: `y${orderSeq}`,
      text: "Test joint.",
      to,
      lines: lines.map(([product, n, hp]) => ({ product, n, hp })) as [JointLine, JointLine, JointLine],
      source: { mode: "fixed", printedNo: 0 },
    },
    rows: [null, null, null],
    counter: null,
  };
}

export function putJoints(s: GameState, joints: FaceUpJoint[]): void {
  s.joint.faceUp = joints.map((j, slot) => ({ ...j, slot }));
}

export type { Crop };
