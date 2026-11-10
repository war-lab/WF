// エンジンが返す出来事（BD03 2.2）。eventSeq、rev、at はサーバーが付ける（BD03 2.1）。
// サーバーが出す paused、resumed、undone と、ロビーの seatsAssigned はここに含めない。
import type {
  Animal,
  Bag,
  Crop,
  GameResult,
  Goods,
  HalfPoints,
  OrderCondition,
  OrderId,
  PointEntry,
  Product,
  PromptSource,
  Seat,
  TileId,
  TradeOffer,
  TurnSerial,
  VertexId,
  WordCard,
} from "./types.ts";

/** 条件を持たない表の注文（BD03 1.3 の FaceUpOrderView と同じ項目） */
export interface FaceUpOrderPublic {
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

export type EngineEvent =
  | { k: "gameCreated"; orderDeckCount: number; jointDeckCount: number }
  | { k: "housePlaced"; seat: Seat; vertex: VertexId; setup: boolean }
  | { k: "cardsGranted"; seat: Seat; cards: Bag<WordCard>; reason: PromptSource; tile: TileId | null }
  | { k: "promptsOpened"; prompts: { promptId: string; seat: Seat; kind: "chooseKind" | "discard"; count: number; reissued: boolean }[] }
  | { k: "promptAnswered"; promptId: string; seat: Seat }
  | { k: "diceRolled"; seat: Seat; dice: [number, number]; manual: boolean }
  | { k: "cardsDiscarded"; seat: Seat; cards: Bag<WordCard> }
  | { k: "harvested"; seat: Seat; plot: number; crop: Crop; n: number }
  | { k: "planted"; seat: Seat; plot: number; crop: Crop; sentence: string }
  | { k: "animalBought"; seat: Seat; plot: number; animal: Animal; coins: number; sentence: string }
  | { k: "fed"; seat: Seat; plot: number; animal: Animal; product: Product; n: number; sentence: string }
  | { k: "productsSold"; seat: Seat; product: Product; n: number; coins: number; sentence: string }
  | { k: "animalSold"; seat: Seat; plot: number; animal: Animal; coins: number; sentence: string }
  | { k: "orderDeclared"; seat: Seat; orderId: OrderId; items: Bag<Product>; sentence: string }
  | { k: "orderSucceeded"; seat: Seat; orderId: OrderId; cond: OrderCondition; hp: HalfPoints; coins: number; items: Bag<Product> }
  | { k: "orderFailed"; seat: Seat; orderId: OrderId; cond: OrderCondition; hp: HalfPoints | null; items: Bag<Product> }
  | { k: "ordersRevealed"; orders: FaceUpOrderPublic[]; reason: "round3" | "refill" }
  | { k: "orderExpired"; orderId: OrderId; slot: number }
  | { k: "jointRowFilled"; seat: Seat; jointId: OrderId; row: number; product: Product; n: number; sentence: string }
  | { k: "jointCompleted"; jointId: OrderId; rows: { seat: Seat; hp: HalfPoints }[]; finisher: Seat; finishHp: HalfPoints }
  | { k: "jointExpired"; jointId: OrderId; rows: { row: number; seat: Seat; hp: HalfPoints }[] }
  | { k: "jointRevealed"; jointId: OrderId; slot: number }
  | { k: "houseBuilt"; seat: Seat; vertex: VertexId; coins: number; sentence: string }
  | { k: "bankTraded"; seat: Seat; give: WordCard; n: number; get: WordCard }
  | { k: "harborTraded"; seat: Seat; vertex: VertexId; give: WordCard; n: number; get: WordCard }
  | { k: "cardBought"; seat: Seat; kind: WordCard; coins: number }
  | { k: "productBought"; seat: Seat; product: Product; coins: number }
  | { k: "tradeProposed"; offer: TradeOffer }
  | { k: "tradeAccepted"; id: string; from: Seat; to: Seat; give: Goods; get: Goods }
  | { k: "tradeDeclined"; id: string }
  | { k: "tradeWithdrawn"; id: string; reason: "self" | "turnEnd" | "replaced" | "gameOver" }
  | { k: "japanesePaid"; seat: Seat; kind: "word" | "talk" | "undeclared"; method: "coin" | "ticket"; coins: number }
  | { k: "turnStarted"; seat: Seat; serial: TurnSerial; round: number }
  | { k: "turnEnded"; seat: Seat; serial: TurnSerial }
  | { k: "endFlagged"; reason: "orders" | "host"; at: TurnSerial }
  | { k: "gameOver"; result: GameResult; finalHalf: PointEntry[] };
