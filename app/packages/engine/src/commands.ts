// コマンドの前提の確認（validate）と効果（execute）。BD01 8章、9章。
// validate は状態を変えない。legalActions も validate を使い、「enabled なら受け付ける」を作りで保証する。
import { bagAdd, bagContains, bagGet, bagKeys, bagNormalize, bagTotal, bagValid } from "./bag.ts";
import {
  award,
  canPlaceAt,
  checkWinInMain,
  drawCard,
  endTurn,
  finishGame,
  flagIfOrdersOut,
  handleDice,
  isVertex,
  newId,
  player,
  refillJoint,
  refillOrder,
  resolveChoices,
  resolveDiscards,
  returnCard,
  rollServerDice,
  setupPlacer,
  startDistribution,
  tileGrant,
  vertexTiles,
  type Events,
} from "./flow.ts";
import {
  sentenceAnimals,
  sentenceBonus,
  sentenceBuildHouse,
  sentenceBuyAnimal,
  sentenceDeliver,
  sentenceFeed,
  sentenceJoint,
  sentencePlant,
  sentenceSellAnimal,
  sentenceSellProducts,
} from "./orders/english.ts";
import { bonusHalfPoints } from "./orders/points.ts";
import type {
  Actor,
  Bag,
  Command,
  FaceUpJoint,
  FaceUpOrder,
  GameState,
  Goods,
  Grant,
  OrderCondition,
  PlayerState,
  Product,
  Prompt,
  PromptAnswer,
  RejectCode,
  Seat,
  WordCard,
} from "./types.ts";
import { ANIMAL_CARDS, CROP_CARDS, PRODUCTS, WORD_CARDS } from "./types.ts";

const isWordCard = (k: unknown): k is WordCard => typeof k === "string" && (WORD_CARDS as readonly string[]).includes(k);
const isProduct = (k: unknown): k is Product => typeof k === "string" && (PRODUCTS as readonly string[]).includes(k);
const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;

function actorSeat(a: Actor): Seat | null {
  return a.k === "seat" ? a.seat : null;
}

// ---------- 共通の前提 ----------

/** 行動と銀行の共通の前提（BD01 8章の冒頭） */
function mainTurnCheck(s: GameState, a: Actor): RejectCode | null {
  if (s.phase.k !== "main") return "WRONG_PHASE";
  if (actorSeat(a) !== s.turn!.seat) return "NOT_YOUR_TURN";
  return null;
}

function emptyPlot(p: PlayerState): number {
  return p.plots.findIndex((x) => x.t === "empty");
}

export function findOrder(s: GameState, id: string): FaceUpOrder | undefined {
  return s.orders.faceUp.find((f) => f.order.id === id);
}

export function findJoint(s: GameState, id: string): FaceUpJoint | undefined {
  return s.joint.faceUp.find((f) => f.joint.id === id);
}

export function animalCount(p: PlayerState): { total: number; chicken: number; cow: number } {
  let chicken = 0;
  let cow = 0;
  for (const x of p.plots) {
    if (x.t === "animal") {
      if (x.animal === "chicken") chicken += 1;
      else cow += 1;
    }
  }
  return { total: chicken + cow, chicken, cow };
}

function goodsValid(g: unknown): g is Goods {
  if (typeof g !== "object" || g === null) return false;
  const x = g as Goods;
  return bagValid(x.cards, WORD_CARDS) && bagValid(x.products, PRODUCTS) && typeof x.coins === "number" && Number.isInteger(x.coins) && x.coins >= 0;
}

function goodsEmpty(g: Goods): boolean {
  return bagTotal(g.cards) === 0 && bagTotal(g.products) === 0 && g.coins === 0;
}

function holds(p: PlayerState, g: Goods): boolean {
  return bagContains(p.hand, g.cards) && bagContains(p.products, g.products) && p.coins >= g.coins;
}

/** 港の種類に合うカードか（BD01 8.2） */
export function harborAccepts(kind: string, give: WordCard): boolean {
  if (kind === "any") return true;
  if (kind === "seed") return (CROP_CARDS as readonly string[]).includes(give);
  if (kind === "animal") return (ANIMAL_CARDS as readonly string[]).includes(give);
  return kind === give;
}

/** 問いへの答えの形を確かめる（BD01 8.6） */
function answerCheck(s: GameState, p: Prompt, ans: PromptAnswer): RejectCode | null {
  if (typeof ans !== "object" || ans === null) return "BAD_ANSWER";
  if (p.k === "chooseKind") {
    if (ans.k !== "chooseKind" || !Array.isArray(ans.kinds) || ans.kinds.length !== p.count) return "BAD_ANSWER";
    if (!ans.kinds.every((k) => p.options.includes(k))) return "BAD_ANSWER";
    return null;
  }
  if (ans.k !== "discard" || !bagValid(ans.cards, WORD_CARDS)) return "BAD_ANSWER";
  if (bagTotal(ans.cards) !== p.count) return "BAD_ANSWER";
  if (!bagContains(player(s, p.seat).hand, ans.cards)) return "BAD_ANSWER";
  return null;
}

// ---------- 前提の確認 ----------

export function validate(s: GameState, a: Actor, c: Command): RejectCode | null {
  if (s.phase.k === "over" || s.result) return "GAME_OVER";
  const me = actorSeat(a);
  const isAdminCmd = c.t === "answerFor" || c.t === "endTurnFor" || c.t === "callLastRound" || c.t === "abortGame";
  if (isAdminCmd !== (a.k === "admin")) return "BAD_MESSAGE";
  if (me !== null && (me < 0 || me >= s.n)) return "BAD_MESSAGE";

  switch (c.t) {
    case "placeHouse": {
      if (s.phase.k !== "setupPlace") return "WRONG_PHASE";
      if (me !== setupPlacer(s, s.phase.step)) return "NOT_YOUR_TURN";
      if (!canPlaceAt(s, c.vertex)) return "BAD_VERTEX";
      return null;
    }
    case "rollDice":
    case "inputDice": {
      if (s.phase.k !== "roll") return "WRONG_PHASE";
      if (me !== s.turn!.seat) return "NOT_YOUR_TURN";
      if (c.t === "rollDice") return s.config.dice === "server" ? null : "BAD_DICE";
      if (s.config.dice !== "manual") return "BAD_DICE";
      const ok = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 6;
      return ok(c.a) && ok(c.b) ? null : "BAD_DICE";
    }
    case "answerPrompt":
    case "answerFor": {
      const p = s.prompts.find((x) => x.id === c.promptId);
      if (!p) return "NOT_PROMPTED";
      if (c.t === "answerPrompt" && p.seat !== me) return "NOT_PROMPTED";
      return answerCheck(s, p, c.answer);
    }
    case "plant": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!(CROP_CARDS as readonly string[]).includes(c.crop)) return "BAD_MESSAGE";
      const p = player(s, me!);
      if (emptyPlot(p) < 0) return "NO_EMPTY_PLOT";
      const need: Bag<WordCard> = { grow: 1 };
      bagAdd(need, c.crop, 1);
      if (c.crop === "carrot") bagAdd(need, s.config.carrotExtraCard, 1);
      return bagContains(p.hand, need) ? null : "MISSING_CARDS";
    }
    case "buyAnimal": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!(ANIMAL_CARDS as readonly string[]).includes(c.animal)) return "BAD_MESSAGE";
      const p = player(s, me!);
      if (emptyPlot(p) < 0) return "NO_EMPTY_PLOT";
      const need: Bag<WordCard> = { buy: 1 };
      bagAdd(need, c.animal, 1);
      const extra = s.config.animalExtraCard[c.animal];
      if (extra) bagAdd(need, extra, 1);
      if (!bagContains(p.hand, need)) return "MISSING_CARDS";
      return p.coins >= s.config.animalCost[c.animal] ? null : "NOT_ENOUGH_COINS";
    }
    case "feed": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const p = player(s, me!);
      const plot = Number.isInteger(c.plot) ? p.plots[c.plot] : undefined;
      if (!plot || plot.t !== "animal") return "NOT_ANIMAL_PLOT";
      if (s.turn!.fedPlots.includes(c.plot)) return "ALREADY_FED";
      return bagGet(p.hand, "feed") >= 1 ? null : "MISSING_CARDS";
    }
    case "sellProducts": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!isProduct(c.product)) return "BAD_MESSAGE";
      if (!isPosInt(c.n)) return "BAD_AMOUNT";
      const p = player(s, me!);
      if (bagGet(p.products, c.product) < c.n) return "MISSING_PRODUCTS";
      return bagGet(p.hand, "sell") >= 1 ? null : "MISSING_CARDS";
    }
    case "sellAnimal": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const p = player(s, me!);
      const plot = Number.isInteger(c.plot) ? p.plots[c.plot] : undefined;
      if (!plot || plot.t !== "animal") return "NOT_ANIMAL_PLOT";
      return bagGet(p.hand, "sell") >= 1 ? null : "MISSING_CARDS";
    }
    case "deliverOrder": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const f = findOrder(s, c.orderId);
      if (!f) return "NOT_FACE_UP";
      if (f.order.cond.k === "bonus" || f.order.cond.k === "animals") return "ORDER_KIND";
      if (s.turn!.failedOrders.includes(f.order.id)) return "ORDER_FAILED_THIS_TURN";
      if (!bagValid(c.items, PRODUCTS)) return "BAD_MESSAGE";
      if (bagTotal(c.items) < 1) return "BAD_AMOUNT";
      const p = player(s, me!);
      if (!bagContains(p.products, c.items)) return "MISSING_PRODUCTS";
      return bagGet(p.hand, "sell") >= 1 ? null : "MISSING_CARDS";
    }
    case "deliverBonus": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const f = findOrder(s, c.orderId);
      if (!f) return "NOT_FACE_UP";
      if (f.order.cond.k !== "bonus") return "ORDER_KIND";
      if (s.turn!.failedOrders.includes(f.order.id)) return "ORDER_FAILED_THIS_TURN";
      if (!isProduct(c.product)) return "BAD_MESSAGE";
      if (!isPosInt(c.n)) return "BAD_AMOUNT";
      const p = player(s, me!);
      if (bagGet(p.products, c.product) < c.n) return "MISSING_PRODUCTS";
      return bagGet(p.hand, "sell") >= 1 ? null : "MISSING_CARDS";
    }
    case "claimAnimalOrder": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const f = findOrder(s, c.orderId);
      if (!f) return "NOT_FACE_UP";
      if (f.order.cond.k !== "animals") return "ORDER_KIND";
      if (s.turn!.failedOrders.includes(f.order.id)) return "ORDER_FAILED_THIS_TURN";
      return null;
    }
    case "contributeJoint": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const f = findJoint(s, c.jointId);
      if (!f) return "NOT_FACE_UP";
      if (s.turn!.jointRowDone) return "JOINT_LIMIT";
      if (!isProduct(c.product)) return "BAD_MESSAGE";
      if (!isPosInt(c.n)) return "BAD_AMOUNT";
      const p = player(s, me!);
      if (bagGet(p.products, c.product) < c.n) return "MISSING_PRODUCTS";
      if (matchRow(f, c.product, c.n) < 0) return "JOINT_MISMATCH";
      return bagGet(p.hand, "sell") >= 1 ? null : "MISSING_CARDS";
    }
    case "buildHouse": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      const p = player(s, me!);
      if (p.houses.length >= s.config.maxHouses) return "HOUSE_LIMIT";
      if (!canPlaceAt(s, c.vertex)) return "BAD_VERTEX";
      return p.coins >= s.config.houseCost ? null : "NOT_ENOUGH_COINS";
    }
    case "bankTrade": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!isWordCard(c.give) || !isWordCard(c.get)) return "BAD_MESSAGE";
      if (bagGet(player(s, me!).hand, c.give) < s.config.bankRatio) return "MISSING_CARDS";
      return s.piles[c.get] > 0 ? null : "PILE_EMPTY";
    }
    case "harborTrade": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!isWordCard(c.give) || !isWordCard(c.get)) return "BAD_MESSAGE";
      const h = s.board.harbors.find((x) => x.vertex === c.vertex);
      if (!h || s.board.houses[c.vertex] !== me) return "NOT_HARBOR_OWNER";
      if (!harborAccepts(h.kind, c.give)) return "HARBOR_KIND";
      const ratio = h.kind === "any" ? s.config.genericHarborRatio : s.config.specialHarborRatio;
      if (bagGet(player(s, me!).hand, c.give) < ratio) return "MISSING_CARDS";
      return s.piles[c.get] > 0 ? null : "PILE_EMPTY";
    }
    case "buyCard": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!isWordCard(c.kind)) return "BAD_MESSAGE";
      if (player(s, me!).coins < s.config.cardBuyPrice) return "NOT_ENOUGH_COINS";
      return s.piles[c.kind] > 0 ? null : "PILE_EMPTY";
    }
    case "buyProduct": {
      const e = mainTurnCheck(s, a);
      if (e) return e;
      if (!isProduct(c.product)) return "BAD_MESSAGE";
      if (s.turn!.productBuys >= s.config.productBuyPerTurn) return "PRODUCT_BUY_LIMIT";
      return player(s, me!).coins >= s.config.productBuyPrice[c.product] ? null : "NOT_ENOUGH_COINS";
    }
    case "proposeTrade": {
      if (s.phase.k !== "main") return "WRONG_PHASE";
      const t = s.turn!;
      if (typeof c.to !== "number" || !Number.isInteger(c.to) || c.to < 0 || c.to >= s.n || c.to === me) return "TRADE_PARTIES";
      if (me !== t.seat && c.to !== t.seat) return "TRADE_PARTIES";
      if (!goodsValid(c.give) || !goodsValid(c.get)) return "BAD_MESSAGE";
      if (goodsEmpty(c.give) || goodsEmpty(c.get)) return "TRADE_EMPTY";
      return holds(player(s, me!), c.give) ? null : "TRADE_NOT_HOLDING";
    }
    case "respondTrade": {
      if (s.phase.k !== "main") return "WRONG_PHASE";
      const tr = s.trades.find((x) => x.id === c.id);
      if (!tr) return "TRADE_GONE";
      if (typeof c.accept !== "boolean") return "BAD_MESSAGE";
      if (tr.to !== me) return "NOT_TRADE_PARTY";
      if (c.accept && (!holds(player(s, tr.from), tr.give) || !holds(player(s, tr.to), tr.get))) return "TRADE_NOT_HOLDING";
      return null;
    }
    case "withdrawTrade": {
      if (s.phase.k !== "main") return "WRONG_PHASE";
      const tr = s.trades.find((x) => x.id === c.id);
      if (!tr) return "TRADE_GONE";
      return tr.from === me ? null : "NOT_TRADE_PARTY";
    }
    case "payJapanese": {
      if (s.phase.k !== "main") return "WRONG_PHASE";
      const p = player(s, me!);
      if (c.kind !== "word" && c.kind !== "talk" && c.kind !== "undeclared") return "BAD_MESSAGE";
      if (c.method === "ticket") {
        if (c.kind === "undeclared") return "TICKET_NOT_ALLOWED";
        return p.freeTickets >= 1 ? null : "NO_TICKET";
      }
      if (c.method !== "coin") return "BAD_MESSAGE";
      if (c.kind === "undeclared") return null;
      return p.coins >= s.config.japaneseCost[c.kind] * p.japaneseRate ? null : "NOT_ENOUGH_COINS";
    }
    case "endTurn": {
      if (s.phase.k !== "main") return "WRONG_PHASE";
      return me === s.turn!.seat ? null : "NOT_YOUR_TURN";
    }
    case "endTurnFor": {
      if (!s.turn || c.turnSerial !== s.turn.serial) return "STALE_TARGET";
      return s.phase.k === "main" ? null : "WRONG_PHASE";
    }
    case "callLastRound":
      return s.endFlag ? "ALREADY_ENDING" : null;
    case "abortGame":
      return null;
  }
  return "BAD_MESSAGE";
}

/** 空いている行のうち、産物と数がちょうど一致する行の番号。なければ -1 */
export function matchRow(f: FaceUpJoint, product: Product, n: number): number {
  return f.joint.lines.findIndex((l, i) => f.rows[i] === null && l.product === product && l.n === n);
}

// ---------- 条件の判定（BD02 2章） ----------

export function conditionMet(cond: OrderCondition, items: Bag<Product>): boolean {
  const it = bagNormalize(items);
  const keys = bagKeys(it);
  switch (cond.k) {
    case "exact": {
      const want = bagNormalize(cond.items);
      const wk = bagKeys(want);
      return keys.length === wk.length && wk.every((k) => bagGet(it, k) === bagGet(want, k));
    }
    case "total":
      return keys.every((k) => (cond.allowed as readonly string[]).includes(k)) && bagTotal(it) === cond.total;
    case "same": {
      const [x, y] = cond.pair;
      return keys.every((k) => k === x || k === y) && bagGet(it, x) === bagGet(it, y) && bagGet(it, x) >= cond.min;
    }
    default:
      return false;
  }
}

// ---------- 効果 ----------

/** 前提を満たしたコマンドの効果を、写した状態に適用する */
export function execute(s: GameState, a: Actor, c: Command, ev: Events): void {
  const me = actorSeat(a);
  switch (c.t) {
    case "placeHouse": {
      const step = (s.phase as { k: "setupPlace"; step: number }).step;
      const p = player(s, me!);
      s.board.houses[c.vertex] = p.seat;
      p.houses.push(c.vertex);
      ev.push({ k: "housePlaced", seat: p.seat, vertex: c.vertex, setup: true });
      if (step >= s.n) {
        // 2個目の拠点。接するタイル（Market を除く）1枚につき1枚
        const grants: Grant[] = [];
        for (const tile of vertexTiles(c.vertex)) {
          const kind = s.board.tiles[tile]!.kind;
          if (kind === "market") continue;
          const g = tileGrant(kind);
          grants.push({ seat: p.seat, fixed: g.fixed, group: g.group, tile, status: "pending" });
        }
        startDistribution(s, "setupTile", grants, ev, step);
        return;
      }
      s.phase = { k: "setupPlace", step: step + 1 };
      return;
    }
    case "rollDice":
      handleDice(s, rollServerDice(s), false, ev);
      return;
    case "inputDice":
      handleDice(s, [c.a, c.b], true, ev);
      return;
    case "answerPrompt":
    case "answerFor": {
      const p = s.prompts.find((x) => x.id === c.promptId)!;
      // 決まった項目だけを組み立てて保存する。余分な項目と0の項目を状態に残さない
      s.answers[p.id] = c.answer.k === "chooseKind" ? { k: "chooseKind", kinds: [...c.answer.kinds] } : { k: "discard", cards: bagNormalize(c.answer.cards) };
      ev.push({ k: "promptAnswered", promptId: p.id, seat: p.seat });
      if (s.prompts.every((x) => s.answers[x.id] !== undefined)) {
        if (s.prompts.some((x) => x.k === "discard")) resolveDiscards(s, ev);
        else resolveChoices(s, ev);
      }
      return;
    }
    case "plant": {
      const p = player(s, me!);
      returnCard(s, p.seat, "grow");
      returnCard(s, p.seat, c.crop);
      if (c.crop === "carrot") returnCard(s, p.seat, s.config.carrotExtraCard);
      const i = emptyPlot(p);
      p.plots[i] = { t: "crop", crop: c.crop, plantedOwnTurn: p.ownTurns };
      ev.push({ k: "planted", seat: p.seat, plot: i, crop: c.crop, sentence: sentencePlant(c.crop) });
      return;
    }
    case "buyAnimal": {
      const p = player(s, me!);
      returnCard(s, p.seat, "buy");
      returnCard(s, p.seat, c.animal);
      const extra = s.config.animalExtraCard[c.animal];
      if (extra) returnCard(s, p.seat, extra);
      const cost = s.config.animalCost[c.animal];
      p.coins -= cost;
      const i = emptyPlot(p);
      p.plots[i] = { t: "animal", animal: c.animal };
      ev.push({ k: "animalBought", seat: p.seat, plot: i, animal: c.animal, coins: cost, sentence: sentenceBuyAnimal(c.animal) });
      return;
    }
    case "feed": {
      const p = player(s, me!);
      const plot = p.plots[c.plot] as { t: "animal"; animal: "cow" | "chicken" };
      returnCard(s, p.seat, "feed");
      const y = s.config.feedYield[plot.animal];
      bagAdd(p.products, y.product, y.n);
      s.turn!.fedPlots.push(c.plot);
      ev.push({ k: "fed", seat: p.seat, plot: c.plot, animal: plot.animal, product: y.product, n: y.n, sentence: sentenceFeed(plot.animal) });
      return;
    }
    case "sellProducts": {
      const p = player(s, me!);
      returnCard(s, p.seat, "sell");
      bagAdd(p.products, c.product, -c.n);
      const coins = s.config.marketPrice[c.product] * c.n;
      p.coins += coins;
      ev.push({ k: "productsSold", seat: p.seat, product: c.product, n: c.n, coins, sentence: sentenceSellProducts(c.product, c.n) });
      return;
    }
    case "sellAnimal": {
      const p = player(s, me!);
      const plot = p.plots[c.plot] as { t: "animal"; animal: "cow" | "chicken" };
      returnCard(s, p.seat, "sell");
      const coins = s.config.animalSellPrice[plot.animal];
      p.coins += coins;
      p.plots[c.plot] = { t: "empty" };
      ev.push({ k: "animalSold", seat: p.seat, plot: c.plot, animal: plot.animal, coins, sentence: sentenceSellAnimal(plot.animal) });
      return;
    }
    case "deliverOrder": {
      const p = player(s, me!);
      const f = findOrder(s, c.orderId)!;
      const items = bagNormalize(c.items);
      ev.push({ k: "orderDeclared", seat: p.seat, orderId: f.order.id, items, sentence: sentenceDeliver(items, f.order.text, f.order.to) });
      returnCard(s, p.seat, "sell");
      if (conditionMet(f.order.cond, items)) {
        for (const k of bagKeys(items)) bagAdd(p.products, k, -bagGet(items, k));
        orderSucceeded(s, p, f, f.order.hp ?? 0, s.config.orderCoins, items, "order", ev);
      } else {
        s.turn!.failedOrders.push(f.order.id);
        ev.push({ k: "orderFailed", seat: p.seat, orderId: f.order.id, cond: structuredClone(f.order.cond), hp: f.order.hp, items });
      }
      return;
    }
    case "deliverBonus": {
      const p = player(s, me!);
      const f = findOrder(s, c.orderId)!;
      const items: Bag<Product> = { [c.product]: c.n };
      ev.push({ k: "orderDeclared", seat: p.seat, orderId: f.order.id, items, sentence: sentenceBonus(c.product, c.n) });
      returnCard(s, p.seat, "sell");
      const cond = f.order.cond as { k: "bonus"; accepted: Product[] };
      if (cond.accepted.includes(c.product)) {
        bagAdd(p.products, c.product, -c.n);
        orderSucceeded(s, p, f, bonusHalfPoints(c.product, c.n), c.n, items, "bonus", ev);
      } else {
        s.turn!.failedOrders.push(f.order.id);
        ev.push({ k: "orderFailed", seat: p.seat, orderId: f.order.id, cond: structuredClone(f.order.cond), hp: null, items });
      }
      return;
    }
    case "claimAnimalOrder": {
      const p = player(s, me!);
      const f = findOrder(s, c.orderId)!;
      const cnt = animalCount(p);
      ev.push({ k: "orderDeclared", seat: p.seat, orderId: f.order.id, items: {}, sentence: sentenceAnimals(cnt.total) });
      const cond = f.order.cond as { k: "animals"; min: number; include: "cow" | "chicken" | null };
      const ok = cnt.total >= cond.min && (cond.include === null || cnt[cond.include] >= 1);
      if (ok) {
        orderSucceeded(s, p, f, f.order.hp ?? 0, s.config.orderCoins, {}, "order", ev);
      } else {
        s.turn!.failedOrders.push(f.order.id);
        ev.push({ k: "orderFailed", seat: p.seat, orderId: f.order.id, cond: structuredClone(f.order.cond), hp: f.order.hp, items: {} });
      }
      return;
    }
    case "contributeJoint": {
      const p = player(s, me!);
      const f = findJoint(s, c.jointId)!;
      const row = matchRow(f, c.product, c.n);
      const t = s.turn!;
      returnCard(s, p.seat, "sell");
      bagAdd(p.products, c.product, -c.n);
      f.rows[row] = { seat: p.seat, turn: t.serial };
      t.jointRowDone = true;
      if (!f.counter) f.counter = { seat: p.seat, remaining: s.config.jointExpireTurns, startedTurn: t.serial };
      ev.push({ k: "jointRowFilled", seat: p.seat, jointId: f.joint.id, row, product: c.product, n: c.n, sentence: sentenceJoint(c.product, c.n, f.joint.to) });
      if (f.rows.every((r) => r !== null)) {
        // 完成（BD01 8.1.1）
        const rows = f.rows.map((r, i) => {
          const hp = f.joint.lines[i]!.hp;
          award(s, r!.seat, { src: "jointRow", jointId: f.joint.id, row: i as 0 | 1 | 2, hp, turn: t.serial });
          return { seat: r!.seat, hp };
        });
        award(s, p.seat, { src: "jointFinish", jointId: f.joint.id, hp: s.config.jointFinishHalfPoints, turn: t.serial });
        s.joint.faceUp = s.joint.faceUp.filter((x) => x !== f);
        ev.push({ k: "jointCompleted", jointId: f.joint.id, rows, finisher: p.seat, finishHp: s.config.jointFinishHalfPoints });
        refillJoint(s, f.slot, ev);
        checkWinInMain(s, ev);
      }
      return;
    }
    case "buildHouse": {
      const p = player(s, me!);
      p.coins -= s.config.houseCost;
      s.board.houses[c.vertex] = p.seat;
      p.houses.push(c.vertex);
      ev.push({ k: "housePlaced", seat: p.seat, vertex: c.vertex, setup: false });
      ev.push({ k: "houseBuilt", seat: p.seat, vertex: c.vertex, coins: s.config.houseCost, sentence: sentenceBuildHouse() });
      return;
    }
    case "bankTrade": {
      const p = player(s, me!);
      returnCard(s, p.seat, c.give, s.config.bankRatio);
      drawCard(s, p.seat, c.get);
      ev.push({ k: "bankTraded", seat: p.seat, give: c.give, n: s.config.bankRatio, get: c.get });
      return;
    }
    case "harborTrade": {
      const p = player(s, me!);
      const h = s.board.harbors.find((x) => x.vertex === c.vertex)!;
      const ratio = h.kind === "any" ? s.config.genericHarborRatio : s.config.specialHarborRatio;
      returnCard(s, p.seat, c.give, ratio);
      drawCard(s, p.seat, c.get);
      ev.push({ k: "harborTraded", seat: p.seat, vertex: c.vertex, give: c.give, n: ratio, get: c.get });
      return;
    }
    case "buyCard": {
      const p = player(s, me!);
      p.coins -= s.config.cardBuyPrice;
      drawCard(s, p.seat, c.kind);
      ev.push({ k: "cardBought", seat: p.seat, kind: c.kind, coins: s.config.cardBuyPrice });
      return;
    }
    case "buyProduct": {
      const p = player(s, me!);
      const price = s.config.productBuyPrice[c.product];
      p.coins -= price;
      bagAdd(p.products, c.product, 1);
      s.turn!.productBuys += 1;
      ev.push({ k: "productBought", seat: p.seat, product: c.product, coins: price });
      return;
    }
    case "proposeTrade": {
      const old = s.trades.find((x) => x.from === me && x.to === c.to);
      if (old) {
        s.trades = s.trades.filter((x) => x !== old);
        ev.push({ k: "tradeWithdrawn", id: old.id, reason: "replaced" });
      }
      const offer = {
        id: newId(s, "t"),
        from: me!,
        to: c.to,
        give: normGoods(c.give),
        get: normGoods(c.get),
        turn: s.turn!.serial,
      };
      s.trades.push(offer);
      ev.push({ k: "tradeProposed", offer: structuredClone(offer) });
      return;
    }
    case "respondTrade": {
      const tr = s.trades.find((x) => x.id === c.id)!;
      s.trades = s.trades.filter((x) => x !== tr);
      if (!c.accept) {
        ev.push({ k: "tradeDeclined", id: tr.id });
        return;
      }
      moveGoods(s, tr.from, tr.to, tr.give);
      moveGoods(s, tr.to, tr.from, tr.get);
      ev.push({ k: "tradeAccepted", id: tr.id, from: tr.from, to: tr.to, give: tr.give, get: tr.get });
      return;
    }
    case "withdrawTrade": {
      s.trades = s.trades.filter((x) => x.id !== c.id);
      ev.push({ k: "tradeWithdrawn", id: c.id, reason: "self" });
      return;
    }
    case "payJapanese": {
      const p = player(s, me!);
      let coins = 0;
      if (c.method === "ticket") p.freeTickets -= 1;
      else {
        coins = s.config.japaneseCost[c.kind] * p.japaneseRate;
        if (c.kind === "undeclared") coins = Math.min(coins, p.coins);
        p.coins -= coins;
      }
      ev.push({ k: "japanesePaid", seat: p.seat, kind: c.kind, method: c.method, coins });
      return;
    }
    case "endTurn":
    case "endTurnFor":
      endTurn(s, ev);
      return;
    case "callLastRound":
      s.endFlag = { reason: "host", at: s.turn?.serial ?? 0 };
      ev.push({ k: "endFlagged", reason: "host", at: s.endFlag.at });
      return;
    case "abortGame":
      finishGame(s, "aborted", ev);
      return;
  }
}

function normGoods(g: Goods): Goods {
  return { cards: bagNormalize(g.cards), products: bagNormalize(g.products), coins: g.coins };
}

function moveGoods(s: GameState, from: Seat, to: Seat, g: Goods): void {
  const a = player(s, from);
  const b = player(s, to);
  for (const k of bagKeys(g.cards)) {
    bagAdd(a.hand, k, -bagGet(g.cards, k));
    bagAdd(b.hand, k, bagGet(g.cards, k));
  }
  for (const k of bagKeys(g.products)) {
    bagAdd(a.products, k, -bagGet(g.products, k));
    bagAdd(b.products, k, bagGet(g.products, k));
  }
  a.coins -= g.coins;
  b.coins += g.coins;
}

/** 注文の成立。点とコインを払い、条件を公開し、同じ slot に補充する（BD01 8.1） */
function orderSucceeded(
  s: GameState,
  p: PlayerState,
  f: FaceUpOrder,
  hp: number,
  coins: number,
  items: Bag<Product>,
  src: "order" | "bonus",
  ev: Events,
): void {
  const t = s.turn!;
  award(s, p.seat, { src, orderId: f.order.id, hp, coins, turn: t.serial });
  p.coins += coins;
  s.orders.faceUp = s.orders.faceUp.filter((x) => x !== f);
  s.orders.done.push({ order: f.order, declaredBy: p.seat, turn: t.serial });
  ev.push({ k: "orderSucceeded", seat: p.seat, orderId: f.order.id, cond: structuredClone(f.order.cond), hp, coins, items });
  refillOrder(s, f.slot, p.seat, ev);
  flagIfOrdersOut(s, ev);
  checkWinInMain(s, ev);
}
