// 表示用の状態（BD03 1章）。見せてよい項目だけを選んで組み立てる。写してから消す作りにしない（BD03 1.3）。
// サーバーが付ける項目（rev、paused、clock、名前、接続の状態、lastCommand）はここでは作らない。
import { bagTotal } from "./bag.ts";
import type { ActionHints } from "./legal.ts";
import { legalActions } from "./legal.ts";
import type {
  Bag,
  BoardState,
  GameResult,
  GameState,
  HalfPoints,
  Order,
  OrderCondition,
  OrderId,
  Phase,
  Plot,
  PointEntry,
  Product,
  Prompt,
  PromptAnswer,
  RuleConfig,
  Seat,
  TradeOffer,
  TurnSerial,
  VertexId,
  WordCard,
  Color,
} from "./types.ts";

export interface PublicPlayer {
  seat: Seat;
  participantId: string;
  color: Color;
  handCount: number;
  freeTickets: number;
  japaneseRate: 1 | 2;
  products: Bag<Product>;
  coins: number;
  halfPoints: HalfPoints;
  plots: Plot[];
  houses: VertexId[];
  ledger: PointEntry[];
}

export interface TurnView {
  serial: TurnSerial;
  seat: Seat;
  round: number;
  dice: [number, number] | null;
  fedPlots: number[];
  jointRowDone: boolean;
  productBought: boolean;
  failedOrders: OrderId[];
}

export interface FaceUpOrderView {
  slot: number;
  id: OrderId;
  text: string;
  picture: Product | null;
  isBonus: boolean;
  to: string | null;
  counterSeat: Seat;
  remaining: number;
  revealedTurn: TurnSerial;
}

export interface FaceUpJointView {
  slot: number;
  id: OrderId;
  text: string;
  to: string;
  rowPoints: [HalfPoints, HalfPoints, HalfPoints];
  rows: [{ seat: Seat } | null, { seat: Seat } | null, { seat: Seat } | null];
  counter: { seat: Seat; remaining: number; startedTurn: TurnSerial } | null;
}

export interface RevealedOrder {
  id: OrderId;
  text: string;
  cond: OrderCondition;
  hp: HalfPoints | null;
  declaredBy: Seat;
  turn: TurnSerial;
}

/** BD03 1.3 の BoardView のうち、エンジンが作る部分 */
export interface EngineBoardView {
  kind: "board";
  rulesVersion: string;
  config: RuleConfig;
  n: 3 | 4;
  phase: Phase;
  endFlag: { reason: "orders" | "host"; at: TurnSerial } | null;
  board: BoardState;
  piles: Record<WordCard, number>;
  players: PublicPlayer[];
  turn: TurnView | null;
  orders: { faceUp: FaceUpOrderView[]; deckCount: number; revealed: boolean };
  joint: { faceUp: FaceUpJointView[]; deckCount: number };
  revealedOrders: RevealedOrder[];
  promptStatus: { promptId: string; seat: Seat; k: "chooseKind" | "discard"; count: number; answered: boolean }[];
  trades: TradeOffer[];
  result: GameResult | null;
  finalReveal: { orders: Order[] } | null;
}

export interface EnginePlayerView extends Omit<EngineBoardView, "kind"> {
  kind: "player";
  me: {
    seat: Seat;
    hand: Bag<WordCard>;
    prompts: Prompt[];
    answers: Record<string, PromptAnswer>;
  };
  legal: ActionHints;
}

const clone = <T>(x: T): T => structuredClone(x);

function boardView(s: GameState): EngineBoardView {
  return {
    kind: "board",
    rulesVersion: s.rulesVersion,
    config: clone(s.config),
    n: s.n,
    phase: clone(s.phase),
    endFlag: clone(s.endFlag),
    board: clone(s.board),
    piles: clone(s.piles),
    players: s.players.map((p) => ({
      seat: p.seat,
      participantId: p.participantId,
      color: p.color,
      handCount: bagTotal(p.hand),
      freeTickets: p.freeTickets,
      japaneseRate: p.japaneseRate,
      products: clone(p.products),
      coins: p.coins,
      halfPoints: p.halfPoints,
      plots: clone(p.plots),
      houses: [...p.houses],
      ledger: clone(p.ledger),
    })),
    turn: s.turn
      ? {
          serial: s.turn.serial,
          seat: s.turn.seat,
          round: s.turn.round,
          dice: s.turn.dice ? [s.turn.dice[0], s.turn.dice[1]] : null,
          fedPlots: [...s.turn.fedPlots],
          jointRowDone: s.turn.jointRowDone,
          productBought: s.turn.productBought,
          failedOrders: [...s.turn.failedOrders],
        }
      : null,
    orders: {
      faceUp: s.orders.faceUp.map((f) => ({
        slot: f.slot,
        id: f.order.id,
        text: f.order.text,
        picture: f.order.picture,
        isBonus: f.order.isBonus,
        to: f.order.to,
        counterSeat: f.counterSeat,
        remaining: f.remaining,
        revealedTurn: f.revealedTurn,
      })),
      deckCount: s.orders.deck.length,
      revealed: s.orders.revealed,
    },
    joint: {
      faceUp: s.joint.faceUp.map((f) => ({
        slot: f.slot,
        id: f.joint.id,
        text: f.joint.text,
        to: f.joint.to,
        rowPoints: [f.joint.lines[0].hp, f.joint.lines[1].hp, f.joint.lines[2].hp],
        rows: [f.rows[0] ? { seat: f.rows[0].seat } : null, f.rows[1] ? { seat: f.rows[1].seat } : null, f.rows[2] ? { seat: f.rows[2].seat } : null],
        counter: clone(f.counter),
      })),
      deckCount: s.joint.deck.length,
    },
    revealedOrders: s.orders.done.map((d) => ({
      id: d.order.id,
      text: d.order.text,
      cond: clone(d.order.cond),
      hp: d.order.hp,
      declaredBy: d.declaredBy,
      turn: d.turn,
    })),
    promptStatus: s.prompts.map((p) => ({ promptId: p.id, seat: p.seat, k: p.k, count: p.count, answered: s.answers[p.id] !== undefined })),
    trades: clone(s.trades),
    result: clone(s.result),
    // ゲームの終わりにだけ、表と山の全注文を公開する（BD03 1.2）
    finalReveal: s.phase.k === "over" ? { orders: clone([...s.orders.faceUp.map((f) => f.order), ...s.orders.deck]) } : null,
  };
}

/** 各端末に送る表示用の状態（方式設計5.1） */
export function viewFor(s: GameState, viewer: Seat | "board"): EngineBoardView | EnginePlayerView {
  const b = boardView(s);
  if (viewer === "board") return b;
  const p = s.players[viewer];
  if (!p) throw new Error(`席 ${viewer} がない`);
  const mine = s.prompts.filter((x) => x.seat === viewer);
  const answers: Record<string, PromptAnswer> = {};
  for (const x of mine) if (s.answers[x.id]) answers[x.id] = clone(s.answers[x.id]!);
  const { kind: _kind, ...rest } = b;
  return {
    ...rest,
    kind: "player",
    me: { seat: viewer, hand: clone(p.hand), prompts: clone(mine), answers },
    legal: legalActions(s, viewer),
  };
}
