// 模擬の1局の記録（sim/record.py の出力）を、エンジンのコマンドの列に写して再適用し、
// 手番ごとの終わりの状態を模擬の写しと比べる（BD06 5.5）。
//
//   node tools/replay.ts <記録のフォルダか JSON ファイル> [...]
//
// 局ごとに、最初に食い違った手番と、その中身を1行で出す。食い違いがなければ「一致」と出す。
// 終了コードは、食い違った局が1つでもあれば1。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "../src/config.ts";
import { apply, createGame } from "../src/game.ts";
import type {
  Actor,
  Animal,
  Bag,
  Command,
  Crop,
  GameState,
  Goods,
  HarborKind,
  JointOrder,
  Order,
  OrderCondition,
  OrderLevel,
  Participant,
  Product,
  Seat,
  TileKind,
  WordCard,
} from "../src/types.ts";

// ---------- 記録の型（sim/record.py） ----------

type SimBag = Record<string, number>;
interface SimOrder {
  id: number;
  kind: "fixed" | "anyof" | "same" | "animals" | "bonus";
  req: SimBag;
  text: string;
  level: string;
  pts: number;
  to: string | null;
  picture: boolean;
  n?: number;
  incl?: Animal | null;
  total?: number;
  allowed?: Crop[];
  pair?: [Product, Product];
  items?: Product[];
}
interface SimJoint {
  id: number;
  text: string | null;
  to: string | null;
  bonus: number;
  lines: { item: Product; n: number; pts: number }[];
}
interface SimField {
  t: "crop" | "cow" | "chicken";
  c?: Crop;
  planted?: number;
}
interface SimSnap {
  round: number;
  cur: number;
  ended: boolean;
  reason: string | null;
  players: { hand: SimBag; prod: SimBag; coins: number; pts: number; fields: (SimField | null)[]; bases: number[]; turns: number }[];
  face: number[];
  deck: number;
  jfaces: { id: number; by: (number | null)[] }[];
  jdeck: number;
}
type SimEvent = { t: string } & Record<string, unknown>;
interface SimTurn {
  p: number;
  /** 手番の初めに勝ったときは null（出目を振らずに終わる） */
  roll: number | null;
  events: SimEvent[];
  /** 席ごとに、この手番に選んだカード */
  choices: WordCard[][];
  /** 収入と収穫のあと、行動の前 */
  start: SimSnap;
  /** 行動のあと、手番の終わりの処理の前 */
  end: SimSnap;
  /** 手番の終わりの処理のあと。アプリは次の手番の始まりまで進めるため、比べない */
  snap: SimSnap;
}
export interface SimRecord {
  seed: number;
  n: 3 | 4;
  strats: string[];
  target: number;
  tcat: (string | null)[];
  tnum: (number | null)[];
  harbor: Record<string, HarborKind>;
  coins: number[];
  orders: SimOrder[];
  jfaces: SimJoint[];
  jdeck: SimJoint[];
  setup: [number, number][];
  afterSetup: SimSnap;
  setupChoices: WordCard[][];
  turns: SimTurn[];
  end: { reason: string; winner: number | null; winners: number[]; pts: number[] };
}

/** 食い違い。where は手番の位置、what は中身 */
export class Mismatch extends Error {
  where: string;
  constructor(where: string, what: string) {
    super(what);
    this.where = where;
  }
}

// ---------- 記録からエンジンの状態を作る ----------

const LEVEL: Record<string, OrderLevel> = { 易: "easy", 中: "medium", 難: "hard", ボーナス: "bonus" };
const orderId = (id: number) => `o${id}`;
const jointId = (id: number) => `j${id}`;
const hp = (pts: number) => Math.round(pts * 2);

function toOrder(o: SimOrder): Order {
  let cond: OrderCondition;
  switch (o.kind) {
    case "fixed":
      cond = { k: "exact", items: { ...o.req } as Bag<Product> };
      break;
    case "anyof":
      cond = { k: "total", allowed: o.allowed!, total: o.total! };
      break;
    case "same":
      cond = { k: "same", pair: o.pair!, min: 2 };
      break;
    case "animals":
      cond = { k: "animals", min: o.n!, include: o.incl ?? null };
      break;
    case "bonus":
      cond = { k: "bonus", accepted: o.items! };
      break;
  }
  const items = Object.keys(o.req);
  return {
    id: orderId(o.id),
    text: o.text,
    level: LEVEL[o.level] ?? "medium",
    isBonus: o.kind === "bonus",
    picture: o.picture && items.length === 1 ? (items[0] as Product) : null,
    to: o.to,
    cond,
    hp: o.kind === "bonus" ? null : hp(o.pts),
    source: { mode: "fixed", printedNo: o.id },
  };
}

function toJoint(j: SimJoint): JointOrder {
  const l = j.lines.map((x) => ({ product: x.item, n: x.n, hp: hp(x.pts) }));
  return { id: jointId(j.id), text: j.text ?? "", to: j.to ?? "", lines: [l[0]!, l[1]!, l[2]!], source: { mode: "fixed", printedNo: j.id } };
}

const COLORS = ["red", "blue", "green", "yellow"] as const;

export function initialState(r: SimRecord): GameState {
  const cfg = { ...defaultConfig(), dice: "manual" as const, targetHalfPoints: r.target * 2 };
  const participants: Participant[] = Array.from({ length: r.n }, (_, i) => ({ participantId: `P${i}`, color: COLORS[i]!, japaneseRate: 1 }));
  const s = createGame(cfg, { participants }, `replay-${r.seed}`);
  s.board.tiles = s.board.tiles.map((t) => ({
    id: t.id,
    kind: (r.tcat[t.id] ?? "market") as TileKind,
    number: r.tcat[t.id] ? r.tnum[t.id]! : null,
  }));
  s.board.harbors = Object.entries(r.harbor).map(([v, kind]) => ({ vertex: Number(v), kind }));
  s.orders.deck = r.orders.map(toOrder);
  // 共同注文は、模擬で準備のときに表にした2枚を山の先頭に置く（アプリは準備の終わりに山の先頭から表にする）
  s.joint.deck = [...r.jfaces, ...r.jdeck].map(toJoint);
  if (r.coins.join() !== cfg.seatCoins[r.n].join()) throw new Mismatch("準備", `席のコインが違う 模擬 ${r.coins} アプリ ${cfg.seatCoins[r.n]}`);
  return s;
}

// ---------- 再適用 ----------

interface Ctx {
  r: SimRecord;
  s: GameState;
  queue: WordCard[][];
  discards: Map<number, WordCard[]>;
  where: string;
  log: string[];
  stats: ReplayStats;
}

/** 山が尽きたことによる扱いの回数（方式設計5.4の見積もりの実測に使う） */
export interface ReplayStats {
  /** 選んだ山が尽きて、問いを出し直した回数 */
  reissued: number;
  /** 前の人が最後の1枚を取ったため、問いに答えても配られなかった回数 */
  unanswered: number;
}

const seatA = (seat: number): Actor => ({ k: "seat", seat });

function run(ctx: Ctx, actor: Actor, cmd: Command): void {
  const r = apply(ctx.s, actor, cmd);
  if (!r.ok) throw new Mismatch(ctx.where, `拒否 ${r.code}: ${JSON.stringify(cmd)}`);
  ctx.s = r.state;
  ctx.log.push(JSON.stringify(cmd));
}

/** 開いている問いに、模擬が選んだカードで答える */
function answerPrompts(ctx: Ctx): void {
  for (let guard = 0; guard < 50; guard++) {
    const p = ctx.s.prompts.find((x) => !ctx.s.answers[x.id]);
    if (!p) return;
    if (p.k === "chooseKind") {
      if (p.reissued) ctx.stats.reissued += 1;
      const q = ctx.queue[p.seat]!;
      const kinds: WordCard[] = [];
      for (let i = 0; i < p.count; i++) {
        const idx = q.findIndex((c) => p.options.includes(c));
        if (idx >= 0) {
          kinds.push(q.splice(idx, 1)[0]!);
          continue;
        }
        // 模擬は1枚ずつ配りながら選ぶため、前の人が山の最後の1枚を取ると選ばない。アプリは配る前に問うので、問いは出る。
        // 仮の答えを入れる。山が尽きていて配られないことは、手番の比較で確かめる（配られたら手札が食い違う）
        if (p.reissued) throw new Mismatch(ctx.where, `席${p.seat}の出し直しの問い（${p.source}、${p.options.join("/")}）に当たる模擬の選択がない。残り ${q.join(",")}`);
        kinds.push(p.options[0]!);
        ctx.stats.unanswered += 1;
      }
      if (process.env.REPLAY_DEBUG) console.error(`${ctx.where} 席${p.seat} ${p.source} [${p.options.join("/")}]x${p.count} → ${kinds.join(",")} 残り ${q.join(",")}`);
      run(ctx, seatA(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds } });
    } else {
      const cards = ctx.discards.get(p.seat);
      if (!cards) throw new Mismatch(ctx.where, `席${p.seat}に捨て札の問い（${p.count}枚）が出たが、模擬は捨てていない`);
      const bag: Bag<WordCard> = {};
      for (const c of cards) bag[c] = (bag[c] ?? 0) + 1;
      ctx.discards.delete(p.seat);
      run(ctx, seatA(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "discard", cards: bag } });
    }
  }
  throw new Mismatch(ctx.where, "問いが終わらない");
}

/** 模擬が選んだのに、アプリが問わなかったカードが残っていないか */
function leftover(ctx: Ctx): void {
  const rest = ctx.queue.map((q, i) => (q.length ? `席${i}:${q.join(",")}` : "")).filter(Boolean);
  if (rest.length) throw new Mismatch(ctx.where, `模擬は選んだがアプリは問わなかった ${rest.join(" ")}`);
}

function goods(g: { cards?: SimBag; prod?: SimBag; coins?: number }): Goods {
  return { cards: { ...(g.cards ?? {}) } as Bag<WordCard>, products: { ...(g.prod ?? {}) } as Bag<Product>, coins: g.coins ?? 0 };
}

const AUTO = new Set(["turn", "income", "market_day", "relief", "seven_discard", "harvest", "milk", "refill", "joint_refill", "order_expire", "joint_expire", "win", "refuse", "joint_done"]);

function eventCommand(ctx: Ctx, seat: Seat, e: SimEvent): void {
  if (AUTO.has(e.t)) return;
  const a = seatA(seat);
  switch (e.t) {
    case "plant":
      return run(ctx, a, { t: "plant", crop: e.crop as Crop });
    case "buy":
      return run(ctx, a, { t: "buyAnimal", animal: e.animal as Animal });
    case "feed":
      return run(ctx, a, { t: "feed", plot: e.field as number });
    case "animal_sell":
      return run(ctx, a, { t: "sellAnimal", plot: e.field as number });
    case "market":
      return run(ctx, a, { t: "sellProducts", product: e.prod as Product, n: e.n as number });
    case "deliver": {
      const sim = ctx.r.orders.find((o) => o.id === e.order)!;
      const id = orderId(sim.id);
      const g = e.goods as SimBag;
      if (sim.kind === "animals") return run(ctx, a, { t: "claimAnimalOrder", orderId: id });
      if (sim.kind === "bonus") {
        const [product, n] = Object.entries(g)[0]!;
        return run(ctx, a, { t: "deliverBonus", orderId: id, product: product as Product, n });
      }
      return run(ctx, a, { t: "deliverOrder", orderId: id, items: { ...g } as Bag<Product> });
    }
    case "joint_line":
      return run(ctx, a, { t: "contributeJoint", jointId: jointId(e.order as number), product: e.item as Product, n: e.n as number });
    case "house":
      return run(ctx, a, { t: "buildHouse", vertex: e.v as number });
    case "bank": {
      const k = e.k as number;
      const give = e.give as WordCard;
      const get = e.get as WordCard;
      if (k === ctx.s.config.bankRatio) return run(ctx, a, { t: "bankTrade", give, get });
      const want: HarborKind | null = k === ctx.s.config.genericHarborRatio ? "any" : null;
      const mine = ctx.s.players[seat]!.houses;
      const h = ctx.s.board.harbors.find((x) => mine.includes(x.vertex) && (want ? x.kind === want : x.kind !== "any" && harborTakes(x.kind, give)));
      if (!h) throw new Mismatch(ctx.where, `席${seat}の ${k}:1 の交換に使える港がない`);
      return run(ctx, a, { t: "harborTrade", vertex: h.vertex, give, get });
    }
    case "coinbank":
      return run(ctx, a, { t: "buyCard", kind: e.card as WordCard });
    case "prodbuy":
      return run(ctx, a, { t: "buyProduct", product: e.item as Product });
    case "trade": {
      const to = e.q as number;
      run(ctx, a, { t: "proposeTrade", to, give: goods(e.give as never), get: goods(e.get as never) });
      const id = ctx.s.trades[ctx.s.trades.length - 1]!.id;
      return run(ctx, seatA(to), { t: "respondTrade", id, accept: true });
    }
    default:
      throw new Mismatch(ctx.where, `写し方の分からない出来事 ${e.t}`);
  }
}

/** 専門港がその種類のカードを受け付けるか（模擬の CARDSET と同じ） */
function harborTakes(kind: HarborKind, give: WordCard): boolean {
  if (kind === "seed") return give === "carrot" || give === "potato" || give === "wheat";
  if (kind === "animal") return give === "cow" || give === "chicken";
  return kind === give;
}

// ---------- 比べる ----------

function bagEq(a: Record<string, number | undefined>, b: SimBag): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff: string[] = [];
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) diff.push(`${k} アプリ${a[k] ?? 0}/模擬${b[k] ?? 0}`);
  return diff.length ? diff.join(" ") : null;
}

function compare(ctx: Ctx, sn: SimSnap, when = ""): void {
  const s = ctx.s;
  const out: string[] = [];
  s.players.forEach((p, i) => {
    const q = sn.players[i]!;
    const h = bagEq(p.hand, q.hand);
    if (h) out.push(`席${i}の手札 ${h}`);
    const pr = bagEq(p.products, q.prod);
    if (pr) out.push(`席${i}の産物 ${pr}`);
    if (p.coins !== q.coins) out.push(`席${i}のコイン アプリ${p.coins}/模擬${q.coins}`);
    if (p.halfPoints !== hp(q.pts)) out.push(`席${i}の点 アプリ${p.halfPoints / 2}/模擬${q.pts}`);
    const plots = p.plots.map((x) => (x.t === "empty" ? "-" : x.t === "crop" ? x.crop : x.animal)).join(",");
    const fields = q.fields.map((x) => (x === null ? "-" : x.t === "crop" ? x.c : x.t)).join(",");
    if (plots !== fields) out.push(`席${i}の区画 アプリ${plots}/模擬${fields}`);
    if ([...p.houses].sort((a, b) => a - b).join() !== [...q.bases].sort((a, b) => a - b).join()) out.push(`席${i}の拠点 アプリ${p.houses}/模擬${q.bases}`);
  });
  const face = s.orders.faceUp.map((f) => f.order.id).sort().join();
  const sface = sn.face.map(orderId).sort().join();
  if (face !== sface) out.push(`表の注文 アプリ[${face}]/模擬[${sface}]`);
  if (s.orders.deck.length !== sn.deck) out.push(`注文の山 アプリ${s.orders.deck.length}/模擬${sn.deck}`);
  const jf = s.joint.faceUp.map((f) => `${f.joint.id}:${f.rows.map((x) => (x ? x.seat : "-")).join("")}`).sort().join();
  const sjf = sn.jfaces.map((f) => `${jointId(f.id)}:${f.by.map((x) => (x === null ? "-" : x)).join("")}`).sort().join();
  if (jf !== sjf) out.push(`表の共同注文 アプリ[${jf}]/模擬[${sjf}]`);
  if (s.joint.deck.length !== sn.jdeck) out.push(`共同注文の山 アプリ${s.joint.deck.length}/模擬${sn.jdeck}`);
  const over = s.phase.k === "over";
  if (over !== sn.ended) out.push(`終わり アプリ${over ? s.result?.reason : "続く"}/模擬${sn.ended ? sn.reason : "続く"}`);
  if (out.length) throw new Mismatch(`${ctx.where}${when ? `の${when}` : ""}`, out.join("; "));
}

// ---------- 1局 ----------

export interface ReplayResult {
  ok: boolean;
  turns: number;
  totalTurns: number;
  where?: string;
  what?: string;
  last?: string[];
  stats: ReplayStats;
}

export function replay(r: SimRecord): ReplayResult {
  const ctx: Ctx = { r, s: undefined as never, queue: r.setupChoices.map((x) => [...x]), discards: new Map(), where: "準備", log: [], stats: { reissued: 0, unanswered: 0 } };
  let done = 0;
  try {
    ctx.s = initialState(r);
    for (const [seat, v] of r.setup) {
      run(ctx, seatA(seat), { t: "placeHouse", vertex: v });
      answerPrompts(ctx);
    }
    leftover(ctx);
    compare(ctx, r.afterSetup);
    for (const [i, t] of r.turns.entries()) {
      ctx.where = `手番${i + 1}（R${t.snap.round} 席${t.p}）`;
      ctx.log = [];
      if (t.roll === null) {
        // 模擬は手番の初めに勝った。アプリも、前の手番の終わりの処理で同じ人の勝ちで終わっているはず
        const res = ctx.s.result;
        if (ctx.s.phase.k !== "over" || res?.reason !== "target" || res.winnerSeat !== r.end.winner) {
          throw new Mismatch(ctx.where, `模擬は手番の初めに席${r.end.winner}の勝ち。アプリ ${ctx.s.phase.k} ${JSON.stringify(res)}`);
        }
        compare(ctx, t.end, "手番の初めの勝ち");
        done += 1;
        break;
      }
      if (ctx.s.phase.k !== "roll" || ctx.s.turn?.seat !== t.p) {
        throw new Mismatch(ctx.where, `手番の始まりが合わない アプリ ${ctx.s.phase.k} 席${ctx.s.turn?.seat}`);
      }
      ctx.queue = t.choices.map((x) => [...x]);
      for (const e of t.events) if (e.t === "seven_discard") ctx.discards.set(e.p as number, [...(e.cards as WordCard[])]);
      const a = Math.min(6, t.roll - 1);
      run(ctx, seatA(t.p), { t: "inputDice", a, b: t.roll - a });
      answerPrompts(ctx);
      leftover(ctx);
      compare(ctx, t.start, "収入のあと");
      if (ctx.discards.size) throw new Mismatch(ctx.where, `模擬は捨てたがアプリは捨て札の問いを出さない 席${[...ctx.discards.keys()]}`);
      for (const e of t.events) {
        if ((ctx.s.phase.k as string) === "over") break;
        eventCommand(ctx, t.p, e);
      }
      compare(ctx, t.end, "行動のあと");
      if ((ctx.s.phase.k as string) === "main") run(ctx, seatA(t.p), { t: "endTurn" });
      done += 1;
    }
    return { ok: true, turns: done, totalTurns: r.turns.length, stats: ctx.stats };
  } catch (e) {
    if (e instanceof Mismatch) return { ok: false, turns: done, totalTurns: r.turns.length, where: e.where, what: e.message, last: ctx.log.slice(-4), stats: ctx.stats };
    throw e;
  }
}

function files(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (statSync(a).isDirectory()) {
      for (const f of readdirSync(a).sort()) if (f.endsWith(".json")) out.push(join(a, f));
    } else out.push(a);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = files(process.argv.slice(2));
  let bad = 0;
  for (const f of list) {
    const r = JSON.parse(readFileSync(f, "utf8")) as SimRecord;
    const res = replay(r);
    if (res.ok) console.log(`${f}: 一致（${res.turns}手番）`);
    else {
      bad += 1;
      console.log(`${f}: ${res.where}（${res.turns}/${res.totalTurns}手番まで一致）: ${res.what}`);
      if (res.last?.length) console.log(`  直前のコマンド: ${res.last.join(" | ")}`);
    }
  }
  console.log(`${list.length}局中 ${list.length - bad}局一致`);
  process.exitCode = bad ? 1 : 0;
}
