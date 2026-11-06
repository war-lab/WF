// 操作の一覧（BD01 11章）。各候補を validate に通して enabled を決める。
// 画面はこの一覧でボタンの有効と無効を決め、ルールを画面側に書かない（方式設計5.1）。
import { bagGet, bagKeys } from "./bag.ts";
import { board } from "./board.ts";
import { harborAccepts, validate } from "./commands.ts";
import { setupPlacer } from "./flow.ts";
import type {
  Actor,
  Animal,
  Command,
  Crop,
  GameState,
  HarborKind,
  OrderId,
  Product,
  Prompt,
  PromptAnswer,
  RejectCode,
  Seat,
  VertexId,
  WordCard,
} from "./types.ts";
import { ANIMAL_CARDS, CROP_CARDS, PRODUCTS, WORD_CARDS } from "./types.ts";

export interface Hint<T> {
  value: T;
  enabled: boolean;
  reason?: RejectCode;
}

export interface ActionHints {
  placeHouse?: { vertices: VertexId[] };
  prompts: { prompt: Prompt; answer: PromptAnswer | null }[];
  rollDice?: Hint<null>;
  /** dice: manual の設定のときだけ出す。BD01 11章にない項目 */
  inputDice?: Hint<null>;
  plant: Hint<Crop>[];
  buyAnimal: Hint<Animal>[];
  feed: Hint<number>[];
  sellProducts: { product: Product; max: number }[];
  sellAnimal: Hint<number>[];
  deliver: Hint<{ orderId: OrderId; kind: "normal" | "bonus" | "animals" }>[];
  contributeJoint: Hint<{ jointId: OrderId }>[];
  buildHouse: Hint<{ vertices: VertexId[] }>;
  bankTrade: { give: WordCard[]; get: WordCard[] };
  harborTrade: { vertex: VertexId; kind: HarborKind; give: WordCard[]; get: WordCard[] }[];
  buyCard: Hint<{ kinds: WordCard[] }>;
  buyProduct: Hint<{ products: Product[] }>;
  tradePartners: Seat[];
  japanese: {
    word: Hint<"coin" | "ticket">[];
    talk: Hint<"coin" | "ticket">[];
    undeclared: Hint<"coin">;
  };
  endTurn?: Hint<null>;
}

function hint<T>(s: GameState, a: Actor, value: T, cmd: Command): Hint<T> {
  const code = validate(s, a, cmd);
  return code ? { value, enabled: false, reason: code } : { value, enabled: true };
}

const ALL_VERTICES = board.vertices.map((v) => v.id);

export function legalActions(s: GameState, seat: Seat): ActionHints {
  const a: Actor = { k: "seat", seat };
  const me = s.players[seat];
  if (!me) throw new Error(`席 ${seat} がない`);
  const isMain = s.phase.k === "main" && !s.result;
  const myTurn = s.turn?.seat === seat;
  const off: RejectCode = isMain ? "NOT_YOUR_TURN" : "WRONG_PHASE";

  const out: ActionHints = {
    prompts: s.prompts.filter((p) => p.seat === seat).map((p) => ({ prompt: p, answer: s.answers[p.id] ?? null })),
    plant: CROP_CARDS.map((c) => hint(s, a, c, { t: "plant", crop: c })),
    buyAnimal: ANIMAL_CARDS.map((x) => hint(s, a, x, { t: "buyAnimal", animal: x })),
    feed: me.plots.flatMap((p, i) => (p.t === "animal" ? [hint(s, a, i, { t: "feed", plot: i })] : [])),
    sellProducts: [],
    sellAnimal: me.plots.flatMap((p, i) => (p.t === "animal" ? [hint(s, a, i, { t: "sellAnimal", plot: i })] : [])),
    deliver: [],
    contributeJoint: [],
    buildHouse: { value: { vertices: [] }, enabled: false, reason: off },
    bankTrade: { give: [], get: [] },
    harborTrade: [],
    buyCard: { value: { kinds: [] }, enabled: false, reason: off },
    buyProduct: { value: { products: [] }, enabled: false, reason: off },
    tradePartners: [],
    japanese: {
      word: (["coin", "ticket"] as const).map((m) => hint(s, a, m, { t: "payJapanese", kind: "word", method: m })),
      talk: (["coin", "ticket"] as const).map((m) => hint(s, a, m, { t: "payJapanese", kind: "talk", method: m })),
      undeclared: hint(s, a, "coin" as const, { t: "payJapanese", kind: "undeclared", method: "coin" }),
    },
  };

  if (s.phase.k === "setupPlace" && setupPlacer(s, s.phase.step) === seat) {
    out.placeHouse = { vertices: ALL_VERTICES.filter((v) => !validate(s, a, { t: "placeHouse", vertex: v })) };
  }
  if (myTurn && s.phase.k === "roll") {
    if (s.config.dice === "server") out.rollDice = hint(s, a, null, { t: "rollDice" });
    else out.inputDice = hint(s, a, null, { t: "inputDice", a: 1, b: 1 });
  }
  if (myTurn && !s.result) out.endTurn = hint(s, a, null, { t: "endTurn" });

  // 注文。enabled は届ける前提だけを表し、条件を満たすかは含めない（BD01 11章）
  for (const f of s.orders.faceUp) {
    const c = f.order.cond;
    const kind = c.k === "bonus" ? "bonus" : c.k === "animals" ? "animals" : "normal";
    let cmd: Command;
    if (kind === "animals") cmd = { t: "claimAnimalOrder", orderId: f.order.id };
    else {
      const held = PRODUCTS.find((p) => bagGet(me.products, p) > 0) ?? "carrot";
      cmd =
        kind === "bonus"
          ? { t: "deliverBonus", orderId: f.order.id, product: held, n: 1 }
          : { t: "deliverOrder", orderId: f.order.id, items: { [held]: 1 } };
    }
    out.deliver.push(hint(s, a, { orderId: f.order.id, kind }, cmd));
  }

  // 共同注文。enabled は sell を持ち、この手番に出しておらず、空いている行があるかだけ（BD01 11章）
  for (const f of s.joint.faceUp) {
    const value = { jointId: f.joint.id };
    let reason: RejectCode | null = null;
    if (!isMain) reason = "WRONG_PHASE";
    else if (!myTurn) reason = "NOT_YOUR_TURN";
    else if (s.turn!.jointRowDone) reason = "JOINT_LIMIT";
    else if (bagGet(me.hand, "sell") < 1) reason = "MISSING_CARDS";
    else if (bagKeys(me.products).length === 0) reason = "MISSING_PRODUCTS";
    out.contributeJoint.push(reason ? { value, enabled: false, reason } : { value, enabled: true });
  }

  if (isMain && myTurn) {
    if (bagGet(me.hand, "sell") >= 1) {
      out.sellProducts = PRODUCTS.filter((p) => bagGet(me.products, p) > 0).map((p) => ({ product: p, max: bagGet(me.products, p) }));
    }
    const vs = ALL_VERTICES.filter((v) => !validate(s, a, { t: "buildHouse", vertex: v }));
    const anyCode = validate(s, a, { t: "buildHouse", vertex: ALL_VERTICES.find((v) => s.board.houses[v] === undefined) ?? -1 });
    out.buildHouse = vs.length > 0 ? { value: { vertices: vs }, enabled: true } : { value: { vertices: [] }, enabled: false, reason: anyCode ?? "BAD_VERTEX" };

    const gets = WORD_CARDS.filter((k) => s.piles[k] > 0);
    out.bankTrade = { give: gets.length ? WORD_CARDS.filter((k) => bagGet(me.hand, k) >= s.config.bankRatio) : [], get: gets };
    for (const h of s.board.harbors) {
      if (s.board.houses[h.vertex] !== seat) continue;
      const ratio = h.kind === "any" ? s.config.genericHarborRatio : s.config.specialHarborRatio;
      out.harborTrade.push({
        vertex: h.vertex,
        kind: h.kind,
        give: gets.length ? WORD_CARDS.filter((k) => harborAccepts(h.kind, k) && bagGet(me.hand, k) >= ratio) : [],
        get: gets,
      });
    }
    const kinds = gets;
    const cardCode = me.coins < s.config.cardBuyPrice ? "NOT_ENOUGH_COINS" : kinds.length === 0 ? "PILE_EMPTY" : null;
    out.buyCard = cardCode ? { value: { kinds }, enabled: false, reason: cardCode } : { value: { kinds }, enabled: true };
    const prods = PRODUCTS.filter((p) => !validate(s, a, { t: "buyProduct", product: p }));
    const prodCode = s.turn!.productBuys >= s.config.productBuyPerTurn ? "PRODUCT_BUY_LIMIT" : prods.length === 0 ? "NOT_ENOUGH_COINS" : null;
    out.buyProduct = prodCode ? { value: { products: prods }, enabled: false, reason: prodCode } : { value: { products: prods }, enabled: true };
  }

  if (isMain) {
    out.tradePartners = myTurn ? s.players.map((p) => p.seat).filter((x) => x !== seat) : [s.turn!.seat];
  }
  return out;
}
