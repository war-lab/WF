// 行動（TC-ACT）、銀行（TC-BNK）、交換（TC-TRD）、日本語の支払い（TC-JPN）。BD06 4.5〜4.8
import { describe, expect, it } from "vitest";
import { board } from "../src/board.ts";
import { apply } from "../src/game.ts";
import { legalActions } from "../src/legal.ts";
import type { GameState, Goods, Seat } from "../src/types.ts";
import {
  checked,
  clearHands,
  giveCards,
  giveProducts,
  mainState,
  mkOrder,
  ok,
  okEv,
  putOrders,
  rejects,
  seat,
  setHouses,
  setPile,
  started,
} from "./helpers.ts";

/** 手札を空にした main の状態（席0の手番） */
function base(opts: { seat?: Seat; coins?: number } = {}): GameState {
  const s = mainState({ seat: opts.seat ?? 0 });
  clearHands(s);
  for (const p of s.players) p.coins = opts.coins ?? 0;
  return s;
}

const goods = (g: Partial<Goods>): Goods => ({ cards: {}, products: {}, coins: 0, ...g });

describe("行動（TC-ACT）", () => {
  it("TC-ACT-01 plant(potato) で grow と potato を使い山に戻る。最も番号の小さい空き区画に植わる", () => {
    const s = base();
    giveCards(s, 0, { grow: 1, potato: 1 });
    s.players[0]!.plots[0] = { t: "animal", animal: "chicken" };
    const piles = { ...s.piles };
    const t = ok(checked(s), seat(0), { t: "plant", crop: "potato" });
    expect(t.players[0]!.hand).toEqual({});
    expect(t.piles.grow).toBe(piles.grow + 1);
    expect(t.piles.potato).toBe(piles.potato + 1);
    expect(t.players[0]!.plots[1]).toEqual({ t: "crop", crop: "potato", plantedOwnTurn: t.players[0]!.ownTurns });
  });
  it("TC-ACT-02 grow、carrot で feed がなければ MISSING_CARDS", () => {
    const s = base();
    giveCards(s, 0, { grow: 1, carrot: 1 });
    rejects(s, seat(0), { t: "plant", crop: "carrot" }, "MISSING_CARDS");
    giveCards(s, 0, { feed: 1 });
    expect(ok(s, seat(0), { t: "plant", crop: "carrot" }).players[0]!.hand).toEqual({});
  });
  it("TC-ACT-03 4区画が埋まっていれば NO_EMPTY_PLOT", () => {
    const s = base();
    giveCards(s, 0, { grow: 1, potato: 1 });
    s.players[0]!.plots = Array.from({ length: 4 }, () => ({ t: "animal" as const, animal: "cow" as const }));
    rejects(s, seat(0), { t: "plant", crop: "potato" }, "NO_EMPTY_PLOT");
  });
  it("TC-ACT-04 buy、chicken、コイン1なら NOT_ENOUGH_COINS", () => {
    const s = base({ coins: 1 });
    giveCards(s, 0, { buy: 1, chicken: 1 });
    rejects(s, seat(0), { t: "buyAnimal", animal: "chicken" }, "NOT_ENOUGH_COINS");
  });
  it("TC-ACT-05 buy、cow、コイン4で grow がなければ MISSING_CARDS", () => {
    const s = base({ coins: 4 });
    giveCards(s, 0, { buy: 1, cow: 1 });
    rejects(s, seat(0), { t: "buyAnimal", animal: "cow" }, "MISSING_CARDS");
  });
  it("TC-ACT-06、10 この手番に買った牛に餌をやるとミルク3。牛は1区画だけ使う", () => {
    let s = base({ coins: 4 });
    giveCards(s, 0, { buy: 1, cow: 1, grow: 1, feed: 1 });
    s = ok(checked(s), seat(0), { t: "buyAnimal", animal: "cow" });
    expect(s.players[0]!.coins).toBe(0);
    expect(s.players[0]!.plots.filter((p) => p.t !== "empty")).toHaveLength(1);
    s = ok(s, seat(0), { t: "feed", plot: 0 });
    expect(s.players[0]!.products).toEqual({ milk: 3 });
  });
  it("TC-ACT-07、08、09 同じ区画は ALREADY_FED。ニワトリ2羽に餌で卵4。空き区画は NOT_ANIMAL_PLOT", () => {
    let s = base();
    giveCards(s, 0, { feed: 3 });
    s.players[0]!.plots[0] = { t: "animal", animal: "chicken" };
    s.players[0]!.plots[1] = { t: "animal", animal: "chicken" };
    s = ok(checked(s), seat(0), { t: "feed", plot: 0 });
    rejects(s, seat(0), { t: "feed", plot: 0 }, "ALREADY_FED");
    s = ok(s, seat(0), { t: "feed", plot: 1 });
    expect(s.players[0]!.products).toEqual({ egg: 4 });
    rejects(s, seat(0), { t: "feed", plot: 2 }, "NOT_ANIMAL_PLOT");
  });
  it("TC-ACT-11、12、13 egg 5 を売るとコイン5、sell 1。持たない数は MISSING_PRODUCTS、0は BAD_AMOUNT", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { egg: 5 });
    const t = ok(checked(s), seat(0), { t: "sellProducts", product: "egg", n: 5 });
    expect(t.players[0]!.coins).toBe(5);
    expect(t.players[0]!.hand).toEqual({});
    const u = base();
    giveCards(u, 0, { sell: 1 });
    giveProducts(u, 0, { egg: 2 });
    rejects(u, seat(0), { t: "sellProducts", product: "egg", n: 3 }, "MISSING_PRODUCTS");
    rejects(u, seat(0), { t: "sellProducts", product: "egg", n: 0 }, "BAD_AMOUNT");
  });
  it("TC-ACT-14 牛の区画を売るとコイン2、区画が空く", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    s.players[0]!.plots[2] = { t: "animal", animal: "cow" };
    const t = ok(checked(s), seat(0), { t: "sellAnimal", plot: 2 });
    expect(t.players[0]!.coins).toBe(2);
    expect(t.players[0]!.plots[2]).toEqual({ t: "empty" });
  });
  it("TC-ACT-15 sell 1枚で売ったあと deliverOrder は MISSING_CARDS", () => {
    let s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { carrot: 6 });
    putOrders(s, [mkOrder({ k: "exact", items: { carrot: 3 } }, 3)]);
    s = ok(checked(s), seat(0), { t: "sellProducts", product: "carrot", n: 1 });
    rejects(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } }, "MISSING_CARDS");
  });
  it("TC-ACT-16 カードと区画が十分なら1手番に3回植える", () => {
    let s = base();
    giveCards(s, 0, { grow: 3, potato: 2, wheat: 1 });
    s = ok(checked(s), seat(0), { t: "plant", crop: "potato" });
    s = ok(s, seat(0), { t: "plant", crop: "potato" });
    s = ok(s, seat(0), { t: "plant", crop: "wheat" });
    expect(s.players[0]!.plots.filter((p) => p.t === "crop")).toHaveLength(3);
  });
  it("TC-ACT-17、18 コイン5、拠点2個で buildHouse すると3個でカードなし。3個なら HOUSE_LIMIT", () => {
    const s = base({ coins: 10 });
    const hand = structuredClone(s.players[0]!.hand);
    const v = legalActions(s, 0).buildHouse.value.vertices[0]!;
    const t = ok(checked(s), seat(0), { t: "buildHouse", vertex: v });
    expect(t.players[0]!.houses).toHaveLength(3);
    expect(t.players[0]!.coins).toBe(5);
    expect(t.players[0]!.hand).toEqual(hand);
    const v2 = legalActions(t, 0).buildHouse;
    expect(v2.enabled).toBe(false);
    expect(v2.reason).toBe("HOUSE_LIMIT");
    rejects(t, seat(0), { t: "buildHouse", vertex: board.vertices.map((x) => x.id).find((x) => apply({ ...t, players: t.players.map((p, i) => (i === 0 ? { ...p, houses: [] } : p)) }, seat(0), { t: "buildHouse", vertex: x }).ok)! }, "HOUSE_LIMIT");
  });
  it("TC-ACT-19 港の交点に拠点を足した手番に、その港で交換できる", () => {
    let s = base({ coins: 5 });
    setHouses(s, {});
    const h = s.board.harbors.find((x) => x.kind === "any")!;
    giveCards(s, 0, { feed: 3 });
    s = ok(checked(s), seat(0), { t: "buildHouse", vertex: h.vertex });
    s = ok(s, seat(0), { t: "harborTrade", vertex: h.vertex, give: "feed", get: "sell" });
    expect(s.players[0]!.hand).toEqual({ sell: 1 });
  });
  it("TC-ACT-20 手番でない人の各行動は NOT_YOUR_TURN", () => {
    const s = base({ coins: 20 });
    giveCards(s, 1, { grow: 2, potato: 1, buy: 1, chicken: 1, feed: 1, sell: 1 });
    giveProducts(s, 1, { egg: 2 });
    s.players[1]!.plots[0] = { t: "animal", animal: "chicken" };
    putOrders(s, [mkOrder({ k: "exact", items: { egg: 2 } }, 2)]);
    const cmds = [
      { t: "plant", crop: "potato" },
      { t: "buyAnimal", animal: "chicken" },
      { t: "feed", plot: 0 },
      { t: "sellProducts", product: "egg", n: 1 },
      { t: "sellAnimal", plot: 0 },
      { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { egg: 2 } },
      { t: "buildHouse", vertex: 20 },
      { t: "endTurn" },
    ] as const;
    for (const c of cmds) rejects(s, seat(1), c, "NOT_YOUR_TURN");
  });
});

describe("銀行（TC-BNK）", () => {
  it("TC-BNK-01、02 grow 4 で bankTrade すると grow −4、sell +1。grow 3 なら MISSING_CARDS", () => {
    const s = base();
    giveCards(s, 0, { grow: 4 });
    expect(ok(checked(s), seat(0), { t: "bankTrade", give: "grow", get: "sell" }).players[0]!.hand).toEqual({ sell: 1 });
    const u = base();
    giveCards(u, 0, { grow: 3 });
    rejects(u, seat(0), { t: "bankTrade", give: "grow", get: "sell" }, "MISSING_CARDS");
  });
  /** 指定の種類の港に席0の拠点を置いた状態 */
  function harborState(kind: string): { s: GameState; v: number } {
    const s = base();
    setHouses(s, {});
    const h = s.board.harbors.find((x) => x.kind !== "any")!;
    h.kind = kind as never;
    setHouses(s, { 0: [h.vertex] });
    return { s, v: h.vertex };
  }
  it("TC-BNK-03 汎用港に拠点、feed 3 で feed −3、+1", () => {
    const s = base();
    setHouses(s, {});
    const h = s.board.harbors.find((x) => x.kind === "any")!;
    setHouses(s, { 0: [h.vertex] });
    giveCards(s, 0, { feed: 3 });
    expect(ok(checked(s), seat(0), { t: "harborTrade", vertex: h.vertex, give: "feed", get: "buy" }).players[0]!.hand).toEqual({ buy: 1 });
  });
  it("TC-BNK-04 港に拠点がなければ NOT_HARBOR_OWNER", () => {
    const s = base();
    setHouses(s, {});
    giveCards(s, 0, { feed: 3 });
    rejects(s, seat(0), { t: "harborTrade", vertex: s.board.harbors[0]!.vertex, give: "feed", get: "buy" }, "NOT_HARBOR_OWNER");
    rejects(s, seat(0), { t: "harborTrade", vertex: 20, give: "feed", get: "buy" }, "NOT_HARBOR_OWNER");
  });
  it("TC-BNK-05 sell の専門港に grow 2 は HARBOR_KIND", () => {
    const { s, v } = harborState("sell");
    giveCards(s, 0, { grow: 2 });
    rejects(checked(s), seat(0), { t: "harborTrade", vertex: v, give: "grow", get: "buy" }, "HARBOR_KIND");
  });
  it("TC-BNK-06 seed の専門港に carrot 2 で成功", () => {
    const { s, v } = harborState("seed");
    giveCards(s, 0, { carrot: 2 });
    expect(ok(checked(s), seat(0), { t: "harborTrade", vertex: v, give: "carrot", get: "sell" }).players[0]!.hand).toEqual({ sell: 1 });
  });
  it("TC-BNK-07 animal の専門港に cow 2 で成功", () => {
    const { s, v } = harborState("animal");
    giveCards(s, 0, { cow: 2 });
    expect(ok(checked(s), seat(0), { t: "harborTrade", vertex: v, give: "cow", get: "sell" }).players[0]!.hand).toEqual({ sell: 1 });
  });
  it("TC-BNK-08 もらう種類の山が0なら各交換が PILE_EMPTY", () => {
    const { s, v } = harborState("grow");
    giveCards(s, 0, { grow: 4 });
    s.players[0]!.coins = 5;
    setPile(s, "sell", 0);
    rejects(checked(s), seat(0), { t: "bankTrade", give: "grow", get: "sell" }, "PILE_EMPTY");
    rejects(s, seat(0), { t: "harborTrade", vertex: v, give: "grow", get: "sell" }, "PILE_EMPTY");
    rejects(s, seat(0), { t: "buyCard", kind: "sell" }, "PILE_EMPTY");
  });
  it("TC-BNK-09 コイン5で buyCard するとコイン0、+1", () => {
    const s = base({ coins: 5 });
    const t = ok(checked(s), seat(0), { t: "buyCard", kind: "cow" });
    expect(t.players[0]!.coins).toBe(0);
    expect(t.players[0]!.hand).toEqual({ cow: 1 });
  });
  it("TC-BNK-10、11 コイン25で carrot を買うと −15、続けて egg は PRODUCT_BUY_LIMIT。次の自分の手番には買える", () => {
    let s = base({ coins: 25 });
    s = ok(checked(s), seat(0), { t: "buyProduct", product: "carrot" });
    expect(s.players[0]!.coins).toBe(10);
    rejects(s, seat(0), { t: "buyProduct", product: "egg" }, "PRODUCT_BUY_LIMIT");
    // 次の自分の手番（turn を作り直す）
    s = structuredClone(s);
    s.turn = { ...s.turn!, serial: s.turn!.serial + 4, round: s.turn!.round + 1, productBought: false };
    expect(ok(s, seat(0), { t: "buyProduct", product: "egg" }).players[0]!.products).toEqual({ carrot: 1, egg: 1 });
  });
  it("TC-BNK-12 手番でない人の銀行の各操作は NOT_YOUR_TURN", () => {
    const s = base({ coins: 30 });
    giveCards(s, 1, { grow: 4 });
    rejects(s, seat(1), { t: "bankTrade", give: "grow", get: "sell" }, "NOT_YOUR_TURN");
    rejects(s, seat(1), { t: "harborTrade", vertex: s.board.harbors[0]!.vertex, give: "grow", get: "sell" }, "NOT_YOUR_TURN");
    rejects(s, seat(1), { t: "buyCard", kind: "sell" }, "NOT_YOUR_TURN");
    rejects(s, seat(1), { t: "buyProduct", product: "egg" }, "NOT_YOUR_TURN");
  });
});

describe("交換（TC-TRD）", () => {
  function tradeBase(): GameState {
    const s = base({ coins: 5 });
    giveCards(s, 0, { grow: 2 });
    giveCards(s, 1, { sell: 2 });
    giveCards(s, 2, { feed: 2 });
    giveProducts(s, 1, { egg: 2 });
    return checked(s);
  }
  it("TC-TRD-01 手番の人と席1で申し出と承諾。両者の物が入れ替わる", () => {
    let s = tradeBase();
    s = ok(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 }, coins: 2 }), get: goods({ products: { egg: 1 } }) });
    s = ok(s, seat(1), { t: "respondTrade", id: s.trades[0]!.id, accept: true });
    expect(s.players[0]!.hand).toEqual({ grow: 1 });
    expect(s.players[0]!.coins).toBe(3);
    expect(s.players[0]!.products).toEqual({ egg: 1 });
    expect(s.players[1]!.hand).toEqual({ sell: 2, grow: 1 });
    expect(s.players[1]!.coins).toBe(7);
    expect(s.trades).toEqual([]);
  });
  it("TC-TRD-02 手番でない人から手番の人へ申し出て承諾", () => {
    let s = tradeBase();
    s = ok(s, seat(2), { t: "proposeTrade", to: 0, give: goods({ cards: { feed: 1 } }), get: goods({ cards: { grow: 1 } }) });
    s = ok(s, seat(0), { t: "respondTrade", id: s.trades[0]!.id, accept: true });
    expect(s.players[0]!.hand).toEqual({ grow: 1, feed: 1 });
  });
  it("TC-TRD-03、04、05 手番でない2人は TRADE_PARTIES、get が空は TRADE_EMPTY、持っていない物は TRADE_NOT_HOLDING", () => {
    const s = tradeBase();
    rejects(s, seat(1), { t: "proposeTrade", to: 2, give: goods({ cards: { sell: 1 } }), get: goods({ cards: { feed: 1 } }) }, "TRADE_PARTIES");
    rejects(s, seat(0), { t: "proposeTrade", to: 0, give: goods({ cards: { grow: 1 } }), get: goods({ cards: { feed: 1 } }) }, "TRADE_PARTIES");
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({}) }, "TRADE_EMPTY");
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { cow: 1 } }), get: goods({ coins: 1 }) }, "TRADE_NOT_HOLDING");
  });
  it("TC-TRD-06 申し出のあとに相手がカードを使ったら承諾は TRADE_NOT_HOLDING で、申し出は残る", () => {
    let s = tradeBase();
    s = ok(s, seat(1), { t: "proposeTrade", to: 0, give: goods({ products: { egg: 2 } }), get: goods({ cards: { grow: 2 } }) });
    giveCards(s, 0, { potato: 1 });
    s = ok(checked(s), seat(0), { t: "plant", crop: "potato" });
    rejects(s, seat(0), { t: "respondTrade", id: s.trades[0]!.id, accept: true }, "TRADE_NOT_HOLDING");
    expect(s.trades).toHaveLength(1);
  });
  it("TC-TRD-07 同じ相手への2回目の申し出で、1回目の id は TRADE_GONE、2回目は有効", () => {
    let s = tradeBase();
    s = ok(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({ coins: 1 }) });
    const id1 = s.trades[0]!.id;
    s = ok(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 2 } }), get: goods({ coins: 1 }) });
    const id2 = s.trades[0]!.id;
    expect(id2).not.toBe(id1);
    expect(s.trades).toHaveLength(1);
    rejects(s, seat(1), { t: "respondTrade", id: id1, accept: true }, "TRADE_GONE");
    expect(ok(s, seat(1), { t: "respondTrade", id: id2, accept: true }).players[1]!.hand).toEqual({ sell: 2, grow: 2 });
  });
  it("TC-TRD-08、09 相手でない人の respondTrade、出した本人でない withdrawTrade は NOT_TRADE_PARTY", () => {
    const s = ok(tradeBase(), seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({ coins: 1 }) });
    const id = s.trades[0]!.id;
    rejects(s, seat(2), { t: "respondTrade", id, accept: true }, "NOT_TRADE_PARTY");
    rejects(s, seat(1), { t: "withdrawTrade", id }, "NOT_TRADE_PARTY");
    expect(ok(s, seat(0), { t: "withdrawTrade", id }).trades).toEqual([]);
  });
  it("TC-TRD-10 断ると申し出が消え、物は動かない", () => {
    const s = ok(tradeBase(), seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({ coins: 1 }) });
    const t = ok(s, seat(1), { t: "respondTrade", id: s.trades[0]!.id, accept: false });
    expect(t.trades).toEqual([]);
    expect(t.players.map((p) => p.hand)).toEqual(s.players.map((p) => p.hand));
  });
  it("TC-TRD-11 申し出が残っていても endTurn ですべて消える", () => {
    let s = ok(tradeBase(), seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({ coins: 1 }) });
    s = ok(s, seat(2), { t: "proposeTrade", to: 0, give: goods({ cards: { feed: 1 } }), get: goods({ coins: 1 }) });
    expect(ok(s, seat(0), { t: "endTurn" }).trades).toEqual([]);
  });
  it("TC-TRD-12（エンジンの範囲）産物の欄に動物、カードの欄に無料券など、型にない物は BAD_MESSAGE。protocol の zod での拒否は M3 で確かめる", () => {
    const s = tradeBase();
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ products: { cow: 1 } as never }), get: goods({ coins: 1 }) }, "BAD_MESSAGE");
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { freeTicket: 1 } as never }), get: goods({ coins: 1 }) }, "BAD_MESSAGE");
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: goods({ cards: { grow: 1 } }), get: goods({ coins: -1 }) }, "BAD_MESSAGE");
  });
  it("TC-TRD-13 コインだけと単語カードだけの申し出と承諾", () => {
    let s = ok(tradeBase(), seat(0), { t: "proposeTrade", to: 1, give: goods({ coins: 3 }), get: goods({ cards: { sell: 1 } }) });
    s = ok(s, seat(1), { t: "respondTrade", id: s.trades[0]!.id, accept: true });
    expect(s.players[0]!.hand).toEqual({ grow: 2, sell: 1 });
    expect(s.players[1]!.coins).toBe(8);
  });
});

describe("日本語の支払い（TC-JPN）", () => {
  const pay = (s: GameState, st: Seat, kind: "word" | "talk" | "undeclared", method: "coin" | "ticket") =>
    ok(s, seat(st), { t: "payJapanese", kind, method });
  it("TC-JPN-01 コイン3で word、coin はコイン2", () => expect(pay(base({ coins: 3 }), 0, "word", "coin").players[0]!.coins).toBe(2));
  it("TC-JPN-02 コイン1で talk、coin は NOT_ENOUGH_COINS", () => rejects(base({ coins: 1 }), seat(0), { t: "payJapanese", kind: "talk", method: "coin" }, "NOT_ENOUGH_COINS"));
  it("TC-JPN-03 無料券2で talk、ticket は無料券1、コインは変わらない", () => {
    const t = pay(base({ coins: 3 }), 0, "talk", "ticket");
    expect(t.players[0]!.freeTickets).toBe(1);
    expect(t.players[0]!.coins).toBe(3);
  });
  it("TC-JPN-04 無料券0で word、ticket は NO_TICKET", () => {
    const s = base();
    s.players[0]!.freeTickets = 0;
    rejects(s, seat(0), { t: "payJapanese", kind: "word", method: "ticket" }, "NO_TICKET");
  });
  it("TC-JPN-05、06 undeclared はコイン1でもコイン0でも拒否しない", () => {
    expect(pay(base({ coins: 1 }), 0, "undeclared", "coin").players[0]!.coins).toBe(0);
    expect(pay(base({ coins: 0 }), 0, "undeclared", "coin").players[0]!.coins).toBe(0);
  });
  it("TC-JPN-07 undeclared を ticket で払うと TICKET_NOT_ALLOWED", () => {
    rejects(base(), seat(0), { t: "payJapanese", kind: "undeclared", method: "ticket" }, "TICKET_NOT_ALLOWED");
  });
  it("TC-JPN-08、08b 倍率2、コイン5なら word、talk、undeclared でそれぞれ2、4、4。コイン3の undeclared はコイン0", () => {
    const mk = (coins: number) => {
      const s = base({ coins });
      s.players[0]!.japaneseRate = 2;
      return s;
    };
    expect(5 - pay(mk(5), 0, "word", "coin").players[0]!.coins).toBe(2);
    expect(5 - pay(mk(5), 0, "talk", "coin").players[0]!.coins).toBe(4);
    expect(5 - pay(mk(5), 0, "undeclared", "coin").players[0]!.coins).toBe(4);
    expect(pay(mk(3), 0, "undeclared", "coin").players[0]!.coins).toBe(0);
  });
  it("TC-JPN-09 倍率2でも talk、ticket は無料券1枚", () => {
    const s = base();
    s.players[0]!.japaneseRate = 2;
    expect(pay(s, 0, "talk", "ticket").players[0]!.freeTickets).toBe(1);
  });
  it("TC-JPN-10 手番でない人も main なら払える", () => expect(pay(base({ coins: 2 }), 2, "word", "coin").players[2]!.coins).toBe(1));
  it("TC-JPN-11 phase が income なら WRONG_PHASE", () => {
    const s = base({ coins: 5 });
    s.phase = { k: "roll" };
    rejects(s, seat(0), { t: "payJapanese", kind: "word", method: "coin" }, "WRONG_PHASE");
    rejects(started(4), seat(1), { t: "payJapanese", kind: "word", method: "coin" }, "WRONG_PHASE");
  });
  it("出来事に払ったコインが載る", () => {
    const r = okEv(base({ coins: 1 }), seat(0), { t: "payJapanese", kind: "undeclared", method: "coin" });
    expect(r.events).toEqual([{ k: "japanesePaid", seat: 0, kind: "undeclared", method: "coin", coins: 1 }]);
  });
});

