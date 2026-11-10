// 通信のメッセージの型と zod の定義（BD03 3章）。
// 端末からのメッセージは、サーバーがこの定義で形を確かめてから扱う（BD03 3.8）。
// ルールに合うかはエンジンが判定する。ここで確かめるのは形だけである。
import { z } from "zod";
import type {
  Color,
  Command,
  EngineBoardView,
  EngineEvent,
  EnginePlayerView,
  PromptAnswer,
  RejectCode,
  Seat,
  TurnSerial,
  VertexId,
} from "@word-farm/engine";

/** プロトコルの版（BD03 3.1）。メッセージの形を変えたら上げる */
export const PROTOCOL_VERSION = 1;

/** 端末 → サーバーの1件の上限（BD03 3.8） */
export const MAX_CLIENT_BYTES = 4 * 1024;
/** サーバー → 端末の1件の上限（BD03 3.8） */
export const MAX_SERVER_BYTES = 64 * 1024;

// ---------- 部品 ----------

/** 128ビットの16進表記（32文字）。コマンドの id、部屋の ID、トークン */
export const hex32 = z.string().regex(/^[0-9a-f]{32}$/);

const wordCard = z.enum(["grow", "buy", "feed", "sell", "carrot", "potato", "wheat", "cow", "chicken"]);
const crop = z.enum(["carrot", "potato", "wheat"]);
const animal = z.enum(["cow", "chicken"]);
const product = z.enum(["carrot", "potato", "wheat", "egg", "milk"]);
const color = z.enum(["red", "blue", "green", "yellow"]);
const count = z.number().int().min(0).max(999);
const smallInt = z.number().int().min(0).max(9999);

const bag = <K extends z.ZodEnum>(k: K) => z.partialRecord(k, count);
const goods = z.strictObject({ cards: bag(wordCard), products: bag(product), coins: count });

const promptAnswer = z.discriminatedUnion("k", [
  z.strictObject({ k: z.literal("chooseKind"), kinds: z.array(wordCard).max(20) }),
  z.strictObject({ k: z.literal("discard"), cards: bag(wordCard) }),
]);

/** BD01 8章のコマンド。形だけを確かめる */
export const commandSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("placeHouse"), vertex: smallInt }),
  z.strictObject({ t: z.literal("rollDice") }),
  z.strictObject({ t: z.literal("inputDice"), a: z.number().int(), b: z.number().int() }),
  z.strictObject({ t: z.literal("answerPrompt"), promptId: z.string().max(64), answer: promptAnswer }),
  z.strictObject({ t: z.literal("plant"), crop }),
  z.strictObject({ t: z.literal("buyAnimal"), animal }),
  z.strictObject({ t: z.literal("feed"), plot: smallInt }),
  z.strictObject({ t: z.literal("sellProducts"), product, n: z.number().int() }),
  z.strictObject({ t: z.literal("sellAnimal"), plot: smallInt }),
  z.strictObject({ t: z.literal("deliverOrder"), orderId: z.string().max(64), items: bag(product) }),
  z.strictObject({ t: z.literal("deliverBonus"), orderId: z.string().max(64), product, n: z.number().int() }),
  z.strictObject({ t: z.literal("claimAnimalOrder"), orderId: z.string().max(64) }),
  z.strictObject({ t: z.literal("contributeJoint"), jointId: z.string().max(64), product, n: z.number().int() }),
  z.strictObject({ t: z.literal("buildHouse"), vertex: smallInt }),
  z.strictObject({ t: z.literal("bankTrade"), give: wordCard, get: wordCard }),
  z.strictObject({ t: z.literal("harborTrade"), vertex: smallInt, give: wordCard, get: wordCard }),
  z.strictObject({ t: z.literal("buyCard"), kind: wordCard }),
  z.strictObject({ t: z.literal("buyProduct"), product }),
  z.strictObject({ t: z.literal("proposeTrade"), to: smallInt, give: goods, get: goods }),
  z.strictObject({ t: z.literal("respondTrade"), id: z.string().max(64), accept: z.boolean() }),
  z.strictObject({ t: z.literal("withdrawTrade"), id: z.string().max(64) }),
  z.strictObject({ t: z.literal("payJapanese"), kind: z.enum(["word", "talk", "undeclared"]), method: z.enum(["coin", "ticket"]) }),
  z.strictObject({ t: z.literal("endTurn") }),
]);

/** 管理操作（BD03 3.2）。ホストの鍵を示した大画面からだけ受け付ける */
export const adminOpSchema = z.discriminatedUnion("k", [
  z.strictObject({ k: z.literal("reorder"), participantIds: z.array(z.string().max(32)).max(4) }),
  z.strictObject({ k: z.literal("setColor"), participantId: z.string().max(32), color }),
  z.strictObject({ k: z.literal("setRate"), participantId: z.string().max(32), rate: z.union([z.literal(1), z.literal(2)]) }),
  z.strictObject({ k: z.literal("kick"), participantId: z.string().max(32) }),
  z.strictObject({
    k: z.literal("startGame"),
    options: z.strictObject({ orderDeck: z.enum(["generated", "fixed"]), dice: z.enum(["server", "manual"]), animalInclude: z.boolean() }),
  }),
  z.strictObject({ k: z.literal("pause") }),
  z.strictObject({ k: z.literal("resume") }),
  z.strictObject({ k: z.literal("undoLast"), seq: z.number().int().min(0) }),
  // answer を省くと、サーバーが既定の答え（種類は既定か最初の選択肢、捨て札は多く持つ種類から）を作る（BD04 2.5）
  z.strictObject({ k: z.literal("answerFor"), promptId: z.string().max(64), answer: promptAnswer.optional() }),
  z.strictObject({ k: z.literal("endTurnFor"), turnSerial: z.number().int().min(0) }),
  z.strictObject({ k: z.literal("reissueSeat"), seat: smallInt }),
  z.strictObject({ k: z.literal("approveClaim"), seat: smallInt, approve: z.boolean() }),
  z.strictObject({ k: z.literal("callLastRound") }),
  z.strictObject({ k: z.literal("abortGame") }),
]);

const name = z.string().trim().min(1).max(12);

/** 端末からサーバーへのメッセージ（BD03 3.2） */
export const clientMsgSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("hello"),
    v: z.number().int(),
    roomId: hex32,
    role: z.enum(["player", "board"]),
    token: hex32.optional(),
    claim: hex32.optional(),
    hostKey: z.string().max(256).optional(),
  }),
  z.strictObject({ t: z.literal("join"), name }),
  z.strictObject({ t: z.literal("rename"), name }),
  z.strictObject({ t: z.literal("leave") }),
  z.strictObject({ t: z.literal("cmd"), id: hex32, cmd: commandSchema, meta: z.strictObject({ sentenceShown: z.boolean().optional() }).optional() }),
  z.strictObject({ t: z.literal("admin"), id: hex32, op: adminOpSchema }),
  z.strictObject({ t: z.literal("ping"), n: z.number().int() }),
  z.strictObject({ t: z.literal("pointer"), vertex: smallInt.nullable() }),
  // 席の再発行の合言葉で入った端末が、その席に入ることを確かめた（BD03 3.6 の手順3）
  z.strictObject({ t: z.literal("claimConfirm") }),
]);

export type AdminOp = z.infer<typeof adminOpSchema>;
export type ClientMsg = z.infer<typeof clientMsgSchema>;

// 形の定義から作った型が、エンジンのコマンドの型に代入できることを確かめる（定義の書き漏らしを型で見つける）
type _CommandCheck = z.infer<typeof commandSchema> extends Command ? true : never;
const _commandCheck: _CommandCheck = true;
type _AnswerCheck = z.infer<typeof promptAnswer> extends PromptAnswer ? true : never;
const _answerCheck: _AnswerCheck = true;
void _commandCheck;
void _answerCheck;

// ---------- サーバーから端末へ（BD03 3.3） ----------

export interface ClockView {
  startedAt: number | null;
  elapsedMs: number;
  serverNow: number;
}

/** サーバーが付ける出来事（BD05 3.3、2.9）と、ロビーの出来事 */
export type ServerEvent =
  | { k: "seatsAssigned"; seats: { participantId: string; seat: Seat; color: Color }[] }
  | { k: "paused" }
  | { k: "resumed" }
  | { k: "undone"; seq: number; summary: string };

export type EventBody = EngineEvent | ServerEvent;
export type GameEvent = { eventSeq: number; rev: number; turn: TurnSerial | null; at: number } & EventBody;

interface ServerAdded {
  rev: number;
  paused: boolean;
  clock: ClockView;
  /** 取り消しの対象（BD05 2.9）。管理を許された大画面にだけ入れる */
  lastCommand: { seq: number; summary: string } | null;
}
/** BD03 1.3 の PublicPlayer。名前と接続の状態はサーバーが付ける（エンジンの状態は名前を持たない。BD05 5.3） */
export type PublicPlayerView = EngineBoardView["players"][number] & { name: string; connected: boolean };
export type BoardView = Omit<EngineBoardView, "players"> & ServerAdded & { players: PublicPlayerView[] };
export type PlayerView = Omit<EnginePlayerView, "players"> & ServerAdded & { players: PublicPlayerView[] };

export interface LobbyView {
  roomId: string;
  rev: number;
  participants: { id: string; name: string; color: Color; rate: 1 | 2; order: number; connected: boolean }[];
  canStart: boolean;
  gameStarted: boolean;
}

export type ProtocolErrorCode =
  | "BAD_MESSAGE"
  | "TOO_LARGE"
  | "VERSION"
  | "ROOM"
  | "TOKEN"
  | "NOT_ADMIN"
  | "LOBBY_FULL"
  | "NAME_TAKEN"
  | "GAME_STARTED"
  | "ENGINE_CHANGED"
  | "CLAIM";

export type ServerMsg =
  | { t: "welcome"; participantId: string | null; token: string | null; role: "player" | "board"; admin: boolean; serverNow: number; seat: Seat | null }
  | { t: "lobby"; lobby: LobbyView }
  | { t: "view"; view: BoardView | PlayerView; events: GameEvent[]; recent: GameEvent[] }
  | { t: "ack"; id: string; rev: number }
  | { t: "reject"; id: string; code: RejectCode; detail?: string }
  | { t: "error"; code: ProtocolErrorCode; message: string }
  | { t: "pong"; n: number }
  | { t: "claimPending"; seat: Seat; seatName: string }
  | { t: "claimRequest"; seat: Seat }                  // 管理を許された大画面へ：合言葉で入った端末が席の作り直しを確かめた（BD03 3.6 の手順3）
  | { t: "claimCode"; seat: Seat; code: string; expiresAt: number } // reissueSeat を送った大画面へ：QRコードに入れる合言葉（BD05 4.6）
  | { t: "replaced" }
  | { t: "pointer"; seat: Seat; vertex: VertexId | null };
