// エンジンの型（BD01 2章、BD02 1章）。型の正本は BD01 と BD02 で、ここはその写しである。
// BD01 にない項目を足したものは、項目ごとにコメントで理由を書く。
import type { TileId, VertexId } from "./board.ts";

export type { TileId, VertexId };

export type Seat = number; // 0〜3。開始プレイヤーが0
export type TurnSerial = number; // 1から
export type OrderId = string;
export type HalfPoints = number; // 半点の整数。8点 = 16

export type ActionCard = "grow" | "buy" | "feed" | "sell";
export type CropCard = "carrot" | "potato" | "wheat";
export type AnimalCard = "cow" | "chicken";
export type WordCard = ActionCard | CropCard | AnimalCard;
export type Crop = CropCard;
export type Product = "carrot" | "potato" | "wheat" | "egg" | "milk";
export type Animal = AnimalCard;

export type TileKind = "grow" | "buy" | "feed" | "sell" | "seed" | "animal" | "market";
export type HarborKind = "any" | Exclude<TileKind, "market">;

/** 数の入れ物。0の項目は持たない（BD01 2.1） */
export type Bag<K extends string> = Partial<Record<K, number>>;

export const ACTION_CARDS: readonly ActionCard[] = ["grow", "buy", "feed", "sell"];
export const CROP_CARDS: readonly CropCard[] = ["carrot", "potato", "wheat"];
export const ANIMAL_CARDS: readonly AnimalCard[] = ["cow", "chicken"];
export const WORD_CARDS: readonly WordCard[] = [...ACTION_CARDS, ...CROP_CARDS, ...ANIMAL_CARDS];
/** 産物の並びの基準（BD02 5.2、7.1） */
export const PRODUCTS: readonly Product[] = ["carrot", "potato", "wheat", "egg", "milk"];
/** タイルの種類（Market を除く6種類） */
export const TILE_KINDS: readonly Exclude<TileKind, "market">[] = ["grow", "buy", "feed", "sell", "seed", "animal"];

export type Color = "red" | "blue" | "green" | "yellow";

// ---------- ルール設定（方式設計5.3、BD01 3章） ----------

export interface RuleConfig {
  rulesVersion: string;
  targetHalfPoints: number;
  initialHand: Bag<WordCard>;
  freeTickets: number;
  seatCoins: { 3: number[]; 4: number[] };
  threePlayerExtraCard: number;
  cardCounts: Record<WordCard, number>;
  maxHouses: number;
  houseCost: number;
  plots: number;
  cropYield: number;
  animalCost: Record<Animal, number>;
  animalExtraCard: Partial<Record<Animal, WordCard>>;
  carrotExtraCard: WordCard;
  animalSellPrice: Record<Animal, number>;
  feedYield: Record<Animal, { product: Product; n: number }>;
  marketPrice: Record<Product, number>;
  productBuyPrice: Record<Product, number>;
  productBuyPerTurn: number;
  cardBuyPrice: number;
  bankRatio: number;
  genericHarborRatio: number;
  specialHarborRatio: number;
  sevenThreshold: number;
  orderFaceUp: number;
  orderRevealRound: number;
  orderExpireTurns: number;
  orderCoins: number;
  jointFaceUp: number;
  jointExpireTurns: number;
  jointFinishHalfPoints: number;
  japaneseCost: { word: number; talk: number; undeclared: number };
  animalInclude: boolean;
  orderDeck: "generated" | "fixed";
  dice: "server" | "manual";
}

// ---------- 盤面（BD01 2.2） ----------

export interface BoardState {
  tiles: { id: TileId; kind: TileKind; number: number | null }[];
  harbors: { vertex: VertexId; kind: HarborKind }[];
  houses: Partial<Record<VertexId, Seat>>;
}

// ---------- プレイヤー（BD01 2.3） ----------

export type Plot =
  | { t: "empty" }
  | { t: "crop"; crop: Crop; plantedOwnTurn: number }
  | { t: "animal"; animal: Animal };

export type PointEntry =
  | { src: "order"; orderId: OrderId; hp: HalfPoints; coins: number; turn: TurnSerial }
  | { src: "bonus"; orderId: OrderId; hp: HalfPoints; coins: number; turn: TurnSerial }
  | { src: "jointRow"; jointId: OrderId; row: 0 | 1 | 2; hp: HalfPoints; turn: TurnSerial }
  | { src: "jointFinish"; jointId: OrderId; hp: number; turn: TurnSerial }
  | {
      src: "jointHalf";
      jointId: OrderId;
      row: 0 | 1 | 2;
      hp: HalfPoints;
      turn: TurnSerial;
      reason: "expire" | "gameEnd";
    };

export interface PlayerState {
  seat: Seat;
  participantId: string;
  color: Color;
  hand: Bag<WordCard>;
  freeTickets: number;
  japaneseRate: 1 | 2;
  products: Bag<Product>;
  coins: number;
  halfPoints: HalfPoints;
  plots: Plot[];
  houses: VertexId[];
  ownTurns: number;
  ledger: PointEntry[];
  /**
   * 前回の収入で選んだ種類。BD01 2.3 にない項目。
   * 収入の問いの既定の選択（BD04 3.6.1、TC-INC-24）に使う。
   */
  lastChoice: { crop: CropCard | null; animal: AnimalCard | null };
}

// ---------- 注文（BD02 1章、BD01 2.4） ----------

export type OrderLevel = "easy" | "medium" | "hard" | "bonus";

export type OrderCondition =
  | { k: "exact"; items: Bag<Product> }
  | { k: "total"; allowed: Crop[]; total: number }
  | { k: "same"; pair: [Product, Product]; min: number }
  | { k: "animals"; min: number; include: Animal | null }
  | { k: "bonus"; accepted: Product[] };

export interface Order {
  id: OrderId;
  text: string;
  level: OrderLevel;
  isBonus: boolean;
  picture: Product | null;
  to: string | null;
  cond: OrderCondition;
  hp: HalfPoints | null;
  source: { mode: "generated"; seed: string } | { mode: "fixed"; printedNo: number };
}

export interface JointLine {
  product: Product;
  n: number;
  hp: HalfPoints;
}

export interface JointOrder {
  id: OrderId;
  text: string;
  to: string;
  lines: [JointLine, JointLine, JointLine];
  source: { mode: "generated"; seed: string } | { mode: "fixed"; printedNo: number };
}

export interface FaceUpOrder {
  slot: number;
  order: Order;
  counterSeat: Seat;
  remaining: number;
  revealedTurn: TurnSerial;
}

export interface JointRowFill {
  seat: Seat;
  turn: TurnSerial;
}

export interface FaceUpJoint {
  slot: number;
  joint: JointOrder;
  rows: [JointRowFill | null, JointRowFill | null, JointRowFill | null];
  counter: { seat: Seat; remaining: number; startedTurn: TurnSerial } | null;
}

/** 成立した注文。表から消えたあとも条件を見せるために持つ（BD03 1.3 の revealedOrders）。BD01 2.6 にない項目 */
export interface DoneOrder {
  order: Order;
  declaredBy: Seat;
  turn: TurnSerial;
}

// ---------- 手番と問い（BD01 2.5） ----------

export type Phase =
  | { k: "lobby" }
  | { k: "setupPlace"; step: number }
  | { k: "setupPrompt" }
  | { k: "roll" }
  | { k: "income" }
  | { k: "main" }
  | { k: "over" };

export interface TurnState {
  serial: TurnSerial;
  seat: Seat;
  round: number;
  dice: [number, number] | null;
  fedPlots: number[];
  jointRowDone: boolean;
  productBought: boolean;
  failedOrders: OrderId[];
  receivedIncome: boolean;
}

export type PromptSource = "setupTile" | "threePlayer" | "income" | "marketDay" | "relief";

export type Prompt =
  | {
      id: string;
      k: "chooseKind";
      seat: Seat;
      options: WordCard[];
      count: number;
      source: PromptSource;
      /** 既定で選んだ状態にする種類（BD04 3.6.1）。BD01 2.5 にない項目 */
      preset: WordCard | null;
      /** 選んだ山が尽きて出し直した問いか（BD04 3.6.1 の見出し）。BD01 2.5 にない項目 */
      reissued: boolean;
    }
  | { id: string; k: "discard"; seat: Seat; count: number };

export type PromptAnswer = { k: "chooseKind"; kinds: WordCard[] } | { k: "discard"; cards: Bag<WordCard> };

/** 権利の種類のまとまり。作物、動物、全種類 */
export type ChoiceGroup = "crop" | "animal" | "any";

/**
 * カードを配る処理の途中の状態（BD01 7.2 の「権利の一覧」と、止めた位置）。BD01 2.6 にない項目。
 * 問いの答えを待つ間、どこまで配ったかを持つ必要があるため、状態に置く。
 */
export interface Distribution {
  source: PromptSource;
  grants: Grant[];
  cursor: number;
  /** `${seat}|${group}` → 答えの種類の列。権利の順に先頭から使う */
  queue: Record<string, WordCard[]>;
  /** 問いの id → `${seat}|${group}`。答えをどのまとまりの列に入れるかを決める */
  promptKeys: Record<string, string>;
  /** 準備の拠点の配置から始めた場合の step。配り終えたら次の step に進む */
  setupStep: number | null;
}

export interface Grant {
  seat: Seat;
  /** 種類が決まっている権利なら、その種類 */
  fixed: WordCard | null;
  /** 種類を選ぶ権利なら、そのまとまり */
  group: ChoiceGroup | null;
  tile: TileId | null;
  /** pending：未処理、given：渡した、empty：山が尽きて渡せなかった、none：選べる種類がなく問いを出さなかった */
  status: "pending" | "given" | "empty" | "none";
}

// ---------- 交換（BD01 2.6） ----------

export interface Goods {
  cards: Bag<WordCard>;
  products: Bag<Product>;
  coins: number;
}

export interface TradeOffer {
  id: string;
  from: Seat;
  to: Seat;
  give: Goods;
  get: Goods;
  turn: TurnSerial;
}

// ---------- ゲームの状態（BD01 2.6） ----------

export interface RngState {
  s: [number, number, number, number];
}

export interface GameResult {
  reason: "target" | "orders" | "host" | "aborted";
  winnerSeat: Seat | null;
  ranking: { seat: Seat; rank: number; halfPoints: HalfPoints; coins: number }[];
}

export interface GameState {
  rulesVersion: string;
  config: RuleConfig;
  rng: RngState;
  n: 3 | 4;
  board: BoardState;
  piles: Record<WordCard, number>;
  players: PlayerState[];
  orders: { deck: Order[]; faceUp: FaceUpOrder[]; revealed: boolean; done: DoneOrder[] };
  joint: { deck: JointOrder[]; faceUp: FaceUpJoint[] };
  turn: TurnState | null;
  phase: Phase;
  prompts: Prompt[];
  answers: Record<string, PromptAnswer>;
  /** 配る処理の途中の状態。BD01 2.6 にない項目（Distribution の説明を参照） */
  dist: Distribution | null;
  trades: TradeOffer[];
  endFlag: { reason: "orders" | "host"; at: TurnSerial } | null;
  result: GameResult | null;
  /** 問いと交換の申し出の識別子を作る通し番号。BD01 2.6 にない項目。乱数を使わずに一意の id を作るため */
  nextId: number;
}

// ---------- ゲームの作成 ----------

export interface Participant {
  participantId: string;
  color: Color;
  japaneseRate: 1 | 2;
}

export interface GameSetup {
  /** 時計回りの並び（BD01 1.1）。3人か4人 */
  participants: Participant[];
}

// ---------- コマンド（BD01 8章、方式設計 付録B） ----------

export type Actor = { k: "seat"; seat: Seat } | { k: "admin" };

export type Command =
  | { t: "placeHouse"; vertex: VertexId }
  | { t: "rollDice" }
  | { t: "inputDice"; a: number; b: number }
  | { t: "answerPrompt"; promptId: string; answer: PromptAnswer }
  | { t: "plant"; crop: Crop }
  | { t: "buyAnimal"; animal: Animal }
  | { t: "feed"; plot: number }
  | { t: "sellProducts"; product: Product; n: number }
  | { t: "sellAnimal"; plot: number }
  | { t: "deliverOrder"; orderId: OrderId; items: Bag<Product> }
  | { t: "deliverBonus"; orderId: OrderId; product: Product; n: number }
  | { t: "claimAnimalOrder"; orderId: OrderId }
  | { t: "contributeJoint"; jointId: OrderId; product: Product; n: number }
  | { t: "buildHouse"; vertex: VertexId }
  | { t: "bankTrade"; give: WordCard; get: WordCard }
  | { t: "harborTrade"; vertex: VertexId; give: WordCard; get: WordCard }
  | { t: "buyCard"; kind: WordCard }
  | { t: "buyProduct"; product: Product }
  | { t: "proposeTrade"; to: Seat; give: Goods; get: Goods }
  | { t: "respondTrade"; id: string; accept: boolean }
  | { t: "withdrawTrade"; id: string }
  | { t: "payJapanese"; kind: "word" | "talk" | "undeclared"; method: "coin" | "ticket" }
  | { t: "endTurn" }
  // 管理（ホストの大画面だけ）
  | { t: "answerFor"; promptId: string; answer: PromptAnswer }
  | { t: "endTurnFor"; turnSerial: TurnSerial }
  | { t: "callLastRound" }
  | { t: "abortGame" };

/** 拒否の理由（BD01 9章）。PAUSED、NOTHING_TO_UNDO、BAD_MESSAGE の一部はサーバーが返す */
export type RejectCode =
  | "PAUSED"
  | "GAME_OVER"
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "NOT_PROMPTED"
  | "BAD_ANSWER"
  | "MISSING_CARDS"
  | "MISSING_PRODUCTS"
  | "NOT_ENOUGH_COINS"
  | "NO_TICKET"
  | "NO_EMPTY_PLOT"
  | "NOT_ANIMAL_PLOT"
  | "ALREADY_FED"
  | "PILE_EMPTY"
  | "BAD_VERTEX"
  | "HOUSE_LIMIT"
  | "NOT_HARBOR_OWNER"
  | "HARBOR_KIND"
  | "NOT_FACE_UP"
  | "ORDER_KIND"
  | "ORDER_FAILED_THIS_TURN"
  | "JOINT_MISMATCH"
  | "JOINT_LIMIT"
  | "PRODUCT_BUY_LIMIT"
  | "TRADE_PARTIES"
  | "TRADE_EMPTY"
  | "TRADE_NOT_HOLDING"
  | "TRADE_GONE"
  | "BAD_DICE"
  | "BAD_AMOUNT"
  | "ALREADY_ENDING"
  | "NOT_TRADE_PARTY"
  | "TICKET_NOT_ALLOWED"
  | "STALE_TARGET"
  | "NOTHING_TO_UNDO"
  | "BAD_MESSAGE";
