// エンジンの公開する関数のうち、createGame と apply（方式設計5.1、BD01 5章）
import { bagAdd } from "./bag.ts";
import { board } from "./board.ts";
import { execute, validate } from "./commands.ts";
import type { EngineEvent } from "./events.ts";
import { fixedJoints, fixedOrders } from "./orders/fixed.ts";
import { genJointDeck, genOrderDeck } from "./orders/generate.ts";
import { childRng, intBelow, rngToHex, sample, seedRng, shuffle } from "./rng.ts";
import type { Actor, BoardState, Command, GameSetup, GameState, RejectCode, RngState, RuleConfig, TileKind, WordCard } from "./types.ts";
import { TILE_KINDS, WORD_CARDS } from "./types.ts";

export type ApplyResult = { ok: true; state: GameState; events: EngineEvent[] } | { ok: false; code: RejectCode };

/** タイルの隣接（頂点を共有するタイル）。sim/mapwf.py の TADJ と同じ */
const tileAdj: Map<number, Set<number>> = (() => {
  const m = new Map<number, Set<number>>();
  for (const t of board.tiles) m.set(t.id, new Set());
  for (const v of board.vertices) {
    for (const a of v.tiles) for (const b of v.tiles) if (a !== b) m.get(a)!.add(b);
  }
  return m;
})();

const HIGH_NUMBERS = new Set([5, 6, 8, 9]);
const MAX_LAYOUT_TRIES = 5000;

/** タイルの種類を割り当てる（BD01 5章 手順2。sim/mapwf.py の layout_tiles と同じ方式） */
export function layoutTiles(r: RngState): TileKind[] {
  const land = board.tiles.filter((t) => !t.market);
  const hiBase = land.filter((t) => HIGH_NUMBERS.has(t.number!)).map((t) => t.id);
  const loBase = land.filter((t) => !HIGH_NUMBERS.has(t.number!)).map((t) => t.id);
  for (let i = 0; i < MAX_LAYOUT_TRIES; i++) {
    const hi = shuffle(r, [...hiBase]);
    const lo = shuffle(r, [...loBase]);
    const kinds = shuffle(r, [...TILE_KINDS]);
    const out: TileKind[] = board.tiles.map((t) => (t.market ? "market" : "grow"));
    kinds.forEach((k, j) => {
      out[hi[j]!] = k;
      out[lo[j]!] = k;
    });
    const sellHi = hi[kinds.indexOf("sell")]!;
    const sellNum = board.tiles[sellHi]!.number;
    if (sellNum !== 6 && sellNum !== 8) continue;
    const same = land.some((t) => [...tileAdj.get(t.id)!].some((u) => !board.tiles[u]!.market && out[u] === out[t.id]));
    if (!same) return out;
  }
  throw new Error("タイルの種類を割り当てられない");
}

function buildBoard(r: RngState): BoardState {
  const kinds = layoutTiles(r);
  const specs = sample(r, TILE_KINDS, board.harbors.filter((h) => h.kind === "specialized").length);
  let si = 0;
  return {
    tiles: board.tiles.map((t) => ({ id: t.id, kind: kinds[t.id]!, number: t.number })),
    harbors: board.harbors.map((h) => ({ vertex: h.vertex, kind: h.kind === "any" ? "any" : specs[si++]! })),
    houses: {},
  };
}

/** 新しいゲームを作る（方式設計5.1）。席を振り、盤面と注文の山を作り、最初の拠点の配置を待つ */
export function createGame(config: RuleConfig, setup: GameSetup, seed: string): GameState {
  const n = setup.participants.length;
  if (n !== 3 && n !== 4) throw new Error("参加者は3人か4人");
  const rng = seedRng(seed);

  // 1. 開始プレイヤー。席0とし、時計回りの並びどおりに席を振る（BD01 1.1）
  const start = intBelow(rng, n);
  const ordered = Array.from({ length: n }, (_, i) => setup.participants[(start + i) % n]!);

  // 2〜3. 盤面
  const boardState = buildBoard(rng);

  // 4. 注文の山。子の生成器で作る（BD02 4.3）
  const orderRng = childRng(rng);
  const jointRng = childRng(rng);
  let orderDeck;
  let jointDeck;
  if (config.orderDeck === "fixed") {
    orderDeck = shuffle(orderRng, fixedOrders());
    jointDeck = shuffle(jointRng, fixedJoints());
  } else {
    orderDeck = genOrderDeck(orderRng, rngToHex(orderRng), config.animalInclude);
    jointDeck = genJointDeck(jointRng, rngToHex(jointRng));
  }

  const piles = { ...config.cardCounts } as Record<WordCard, number>;
  const players = ordered.map((pt, seat) => {
    const hand = {};
    for (const k of WORD_CARDS) {
      const c = config.initialHand[k] ?? 0;
      if (c > 0) {
        piles[k] -= c;
        bagAdd(hand, k, c);
      }
    }
    return {
      seat,
      participantId: pt.participantId,
      color: pt.color,
      hand,
      freeTickets: config.freeTickets,
      japaneseRate: pt.japaneseRate,
      products: {},
      coins: 0,
      halfPoints: 0,
      plots: Array.from({ length: config.plots }, () => ({ t: "empty" as const })),
      houses: [],
      ownTurns: 0,
      ledger: [],
      lastChoice: { crop: null, animal: null },
    };
  });

  return {
    rulesVersion: config.rulesVersion,
    config: structuredClone(config),
    rng,
    n: n as 3 | 4,
    board: boardState,
    piles,
    players,
    orders: { deck: orderDeck, faceUp: [], revealed: false, done: [] },
    joint: { deck: jointDeck, faceUp: [] },
    turn: null,
    phase: { k: "setupPlace", step: 0 },
    prompts: [],
    answers: {},
    dist: null,
    trades: [],
    endFlag: null,
    result: null,
    nextId: 0,
  };
}

/** コマンドを適用する。不正なら理由を返し、状態は変えない（方式設計5.1） */
export function apply(state: GameState, actor: Actor, cmd: Command): ApplyResult {
  let code: RejectCode | null;
  try {
    code = validate(state, actor, cmd);
  } catch {
    // 形の確かめ（protocol の zod）をすり抜けた不正な形
    return { ok: false, code: "BAD_MESSAGE" };
  }
  if (code) return { ok: false, code };
  const s = structuredClone(state);
  const events: EngineEvent[] = [];
  execute(s, actor, cmd, events);
  return { ok: true, state: s, events };
}
