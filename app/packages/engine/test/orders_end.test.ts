// 注文（TC-ORD）、時間切れ（TC-EXP）、共同注文（TC-JNT）、終わり方（TC-END）、問い・管理・表示（TC-SYS）。BD06 4.9〜4.13
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game.ts";
import { legalActions } from "../src/legal.ts";
import type { GameState, Order, Seat } from "../src/types.ts";
import { viewFor, type EngineBoardView, type EnginePlayerView } from "../src/view.ts";
import {
  addPoints,
  admin,
  answerAllFirst,
  checked,
  clearHands,
  config,
  diceFor,
  giveCards,
  giveProducts,
  mainState,
  mkJoint,
  mkOrder,
  ok,
  okEv,
  participants,
  putJoints,
  putOrders,
  rejects,
  rollState,
  seat,
  started,
} from "./helpers.ts";

function base(opts: { seat?: Seat; serial?: number; n?: 3 | 4 } = {}): GameState {
  const s = mainState({ seat: opts.seat ?? 0, ...(opts.serial ? { serial: opts.serial } : {}), ...(opts.n ? { n: opts.n } : {}) });
  clearHands(s);
  for (const p of s.players) p.coins = 0;
  return s;
}

const exact3 = () => mkOrder({ k: "exact", items: { carrot: 3 } }, 3, { text: "The cafe needs three carrots.", to: "the cafe" });

describe("注文（TC-ORD）", () => {
  it("TC-ORD-01 exact carrot 3 に carrot 3 で成立。産物 −3、点、コイン +2、同じ slot に補充", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { carrot: 3 });
    putOrders(s, [mkOrder({ k: "exact", items: { egg: 1 } }, 2), exact3()]);
    const deckTop = s.orders.deck[0]!.id;
    const t = ok(checked(s), seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[1]!.order.id, items: { carrot: 3 } });
    expect(t.players[0]!.products).toEqual({});
    expect(t.players[0]!.halfPoints).toBe(3);
    expect(t.players[0]!.coins).toBe(s.config.orderCoins);
    expect(t.orders.faceUp.find((f) => f.slot === 1)!.order.id).toBe(deckTop);
  });
  it("TC-ORD-02 counterSeat 0 の注文を席2が届けて成立すると、補充は counterSeat 2、revealedTurn はこの手番", () => {
    const s = base({ seat: 2 });
    giveCards(s, 2, { sell: 1 });
    giveProducts(s, 2, { carrot: 3 });
    putOrders(s, [exact3()], 0, 1);
    const t = ok(checked(s), seat(2), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    expect(t.orders.faceUp[0]).toMatchObject({ slot: 0, counterSeat: 2, revealedTurn: s.turn!.serial });
  });

  /** 条件と出す物を指定して、成立か不成立かを返す */
  function deliver(cond: Order["cond"], items: Record<string, number>, hold: Record<string, number> = items): { ok: boolean; state: GameState } {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, hold);
    putOrders(s, [mkOrder(cond, 4)]);
    const r = okEv(checked(s), seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items });
    return { ok: r.events.some((e) => e.k === "orderSucceeded"), state: r.state };
  }
  it("TC-ORD-03、04 exact carrot 3 に carrot 4、carrot 2 は不成立", () => {
    expect(deliver({ k: "exact", items: { carrot: 3 } }, { carrot: 4 }).ok).toBe(false);
    expect(deliver({ k: "exact", items: { carrot: 3 } }, { carrot: 2 }).ok).toBe(false);
  });
  it("TC-ORD-05 否定の罠（egg 2、milk 1）に carrot を混ぜると不成立", () => {
    expect(deliver({ k: "exact", items: { egg: 2, milk: 1 } }, { egg: 2, milk: 1, carrot: 1 }).ok).toBe(false);
    expect(deliver({ k: "exact", items: { egg: 2, milk: 1 } }, { egg: 2, milk: 1 }).ok).toBe(true);
  });
  it("TC-ORD-06〜09 total（potato、wheat、4）", () => {
    const c = { k: "total" as const, allowed: ["potato", "wheat"] as ["potato", "wheat"], total: 4 };
    expect(deliver(c, { potato: 2, wheat: 2 }).ok).toBe(true);
    expect(deliver(c, { potato: 4 }).ok).toBe(true);
    expect(deliver(c, { potato: 2, wheat: 1, egg: 1 }).ok).toBe(false);
    expect(deliver(c, { potato: 3, wheat: 2 }).ok).toBe(false);
  });
  it("TC-ORD-10〜12 same（carrot、potato、2）。carrot 3、potato 3 は成立で6つすべてを渡す", () => {
    const c = { k: "same" as const, pair: ["carrot", "potato"] as ["carrot", "potato"], min: 2 };
    const r = deliver(c, { carrot: 3, potato: 3 });
    expect(r.ok).toBe(true);
    expect(r.state.players[0]!.products).toEqual({});
    expect(deliver(c, { carrot: 3, potato: 2 }).ok).toBe(false);
    expect(deliver(c, { carrot: 1, potato: 1 }).ok).toBe(false);
  });

  function animalState(chicken: number, cow: number, min: number): GameState {
    const s = base();
    for (let i = 0; i < chicken; i++) s.players[0]!.plots[i] = { t: "animal", animal: "chicken" };
    for (let i = 0; i < cow; i++) s.players[0]!.plots[chicken + i] = { t: "animal", animal: "cow" };
    putOrders(s, [mkOrder({ k: "animals", min, include: null }, min >= 3 ? 5 : 3)]);
    return checked(s);
  }
  it("TC-ORD-13、13b animals 3、ニワトリ2と牛1、sell 0枚で成立。動物は残り sell を使わない。legalActions の deliver は enabled", () => {
    const s = animalState(2, 1, 3);
    const h = legalActions(s, 0).deliver[0]!;
    expect(h).toMatchObject({ enabled: true, value: { kind: "animals" } });
    const t = ok(s, seat(0), { t: "claimAnimalOrder", orderId: s.orders.faceUp[0]!.order.id });
    expect(t.players[0]!.halfPoints).toBe(5);
    expect(t.players[0]!.plots.filter((p) => p.t === "animal")).toHaveLength(3);
  });
  it("TC-ORD-14、15 animals 3 に2頭は不成立で何も失わず、同じ注文は ORDER_FAILED_THIS_TURN", () => {
    const s = animalState(2, 0, 3);
    const id = s.orders.faceUp[0]!.order.id;
    const t = ok(s, seat(0), { t: "claimAnimalOrder", orderId: id });
    expect(t.players[0]!.halfPoints).toBe(0);
    expect(t.turn!.failedOrders).toEqual([id]);
    rejects(t, seat(0), { t: "claimAnimalOrder", orderId: id }, "ORDER_FAILED_THIS_TURN");
  });
  it("TC-ORD-16〜19 exact の不成立で sell が山に戻り、産物は戻る。同じ注文は拒否、別の注文と次の手番は受け付ける", () => {
    let s = base();
    giveCards(s, 0, { sell: 2 });
    giveProducts(s, 0, { carrot: 3, egg: 1 });
    putOrders(s, [exact3(), mkOrder({ k: "exact", items: { egg: 1 } }, 2)]);
    const [a, b] = s.orders.faceUp.map((f) => f.order.id) as [string, string];
    const pile = s.piles.sell;
    s = ok(checked(s), seat(0), { t: "deliverOrder", orderId: a, items: { carrot: 2 } });
    expect(s.piles.sell).toBe(pile + 1);
    expect(s.players[0]!.products).toEqual({ carrot: 3, egg: 1 });
    expect(s.turn!.failedOrders).toEqual([a]);
    rejects(s, seat(0), { t: "deliverOrder", orderId: a, items: { carrot: 3 } }, "ORDER_FAILED_THIS_TURN");
    s = ok(s, seat(0), { t: "deliverOrder", orderId: b, items: { egg: 1 } });
    // 次の自分の手番
    s = structuredClone(s);
    s.turn = { ...s.turn!, serial: s.turn!.serial + 4, failedOrders: [] };
    giveCards(s, 0, { sell: 1 });
    ok(checked(s), seat(0), { t: "deliverOrder", orderId: a, items: { carrot: 3 } });
  });
  it("TC-ORD-20〜23 ボーナス（egg、milk）：egg 6 は3半点とコイン6、egg 1 は0半点とコイン1、carrot は不成立で sell が戻り、再挑戦は拒否", () => {
    const mk = () => {
      const s = base();
      giveCards(s, 0, { sell: 2 });
      giveProducts(s, 0, { egg: 6, carrot: 3 });
      putOrders(s, [mkOrder({ k: "bonus", accepted: ["egg", "milk"] }, null)]);
      return checked(s);
    };
    let s = mk();
    let id = s.orders.faceUp[0]!.order.id;
    let t = ok(s, seat(0), { t: "deliverBonus", orderId: id, product: "egg", n: 6 });
    expect([t.players[0]!.halfPoints, t.players[0]!.coins]).toEqual([3, 6]);
    s = mk();
    t = ok(s, seat(0), { t: "deliverBonus", orderId: s.orders.faceUp[0]!.order.id, product: "egg", n: 1 });
    expect([t.players[0]!.halfPoints, t.players[0]!.coins]).toEqual([0, 1]);
    s = mk();
    id = s.orders.faceUp[0]!.order.id;
    const pile = s.piles.sell;
    t = ok(s, seat(0), { t: "deliverBonus", orderId: id, product: "carrot", n: 3 });
    expect(t.piles.sell).toBe(pile + 1);
    expect(t.players[0]!.products).toEqual({ egg: 6, carrot: 3 });
    rejects(t, seat(0), { t: "deliverBonus", orderId: id, product: "egg", n: 2 }, "ORDER_FAILED_THIS_TURN");
  });
  it("TC-ORD-24、25 ボーナスに deliverOrder、exact に claimAnimalOrder は ORDER_KIND", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { egg: 2 });
    putOrders(s, [mkOrder({ k: "bonus", accepted: ["egg"] }, null), exact3()]);
    rejects(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { egg: 2 } }, "ORDER_KIND");
    rejects(s, seat(0), { t: "claimAnimalOrder", orderId: s.orders.faceUp[1]!.order.id }, "ORDER_KIND");
    rejects(s, seat(0), { t: "deliverBonus", orderId: s.orders.faceUp[1]!.order.id, product: "egg", n: 1 }, "ORDER_KIND");
  });
  it("TC-ORD-26、27、31 山の注文と存在しない注文は NOT_FACE_UP。持たない産物、空の items、sell なし", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { carrot: 3 });
    putOrders(s, [exact3()]);
    const id = s.orders.faceUp[0]!.order.id;
    rejects(s, seat(0), { t: "deliverOrder", orderId: s.orders.deck[0]!.id, items: { carrot: 3 } }, "NOT_FACE_UP");
    rejects(s, seat(0), { t: "deliverOrder", orderId: "zzz", items: { carrot: 3 } }, "NOT_FACE_UP");
    rejects(s, seat(0), { t: "deliverOrder", orderId: id, items: { egg: 1 } }, "MISSING_PRODUCTS");
    rejects(s, seat(0), { t: "deliverOrder", orderId: id, items: {} }, "BAD_AMOUNT");
    const u = base();
    giveProducts(u, 0, { carrot: 3 });
    putOrders(u, [exact3()]);
    rejects(u, seat(0), { t: "deliverOrder", orderId: u.orders.faceUp[0]!.order.id, items: { carrot: 3 } }, "MISSING_CARDS");
  });
  it("TC-ORD-28 届けて補充された注文に、同じ手番に届けられる", () => {
    let s = base();
    giveCards(s, 0, { sell: 2 });
    giveProducts(s, 0, { carrot: 6 });
    putOrders(s, [exact3()]);
    s.orders.deck.unshift(exact3());
    s = ok(checked(s), seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    s = ok(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    expect(s.players[0]!.halfPoints).toBe(6);
  });
  it("TC-ORD-32、TC-SYS-09 成立は orderSucceeded に条件が載り表示にも残る。不成立は orderFailed に載るが表示では隠れる", () => {
    const s = base();
    giveCards(s, 0, { sell: 2 });
    giveProducts(s, 0, { carrot: 3 });
    putOrders(s, [exact3(), mkOrder({ k: "exact", items: { egg: 2 } }, 2)]);
    const [a, b] = s.orders.faceUp.map((f) => f.order.id) as [string, string];
    const r1 = okEv(checked(s), seat(0), { t: "deliverOrder", orderId: b, items: { carrot: 1 } });
    const fail = r1.events.find((e) => e.k === "orderFailed")!;
    expect(fail).toMatchObject({ cond: { k: "exact", items: { egg: 2 } }, hp: 2 });
    for (const v of [viewFor(r1.state, "board"), viewFor(r1.state, 0), viewFor(r1.state, 1)]) {
      const f = v.orders.faceUp.find((x) => x.id === b)!;
      expect(f).not.toHaveProperty("cond");
      expect(f).not.toHaveProperty("hp");
      expect(v.revealedOrders).toEqual([]);
    }
    const r2 = okEv(r1.state, seat(0), { t: "deliverOrder", orderId: a, items: { carrot: 3 } });
    expect(r2.events.find((e) => e.k === "orderSucceeded")).toMatchObject({ cond: { k: "exact", items: { carrot: 3 } }, hp: 3 });
    expect((viewFor(r2.state, "board") as EngineBoardView).revealedOrders).toEqual([expect.objectContaining({ id: a, cond: { k: "exact", items: { carrot: 3 } }, declaredBy: 0 })]);
  });
});

describe("注文切れと勝ち（TC-ORD-29、30）", () => {
  const mk = (pts: number) => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { carrot: 3 });
    addPoints(s, 0, pts);
    putOrders(s, [mkOrder({ k: "exact", items: { carrot: 3 } }, 4)]);
    s.orders.deck = [];
    return checked(s);
  };
  it("TC-ORD-29 14半点の手番の人が2点の注文で、その場で勝つ", () => {
    const s = mk(14);
    const t = ok(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    expect(t.phase.k).toBe("over");
    expect(t.result).toMatchObject({ reason: "target", winnerSeat: 0 });
  });
  it("TC-ORD-30 表も山も0枚になると endFlag が orders", () => {
    const s = mk(0);
    const t = ok(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    expect(t.orders.faceUp).toEqual([]);
    expect(t.endFlag).toEqual({ reason: "orders", at: s.turn!.serial });
  });
});

/** 手番を進める（main → endTurn → 次の人の roll → 出目12 → 問いに答える → main） */
function next(s: GameState): GameState {
  let t = ok(s, seat(s.turn!.seat), { t: "endTurn" });
  if (t.phase.k === "over") return t;
  t = ok(t, seat(t.turn!.seat), diceFor(12));
  while (t.phase.k === "income") t = answerAllFirst(t);
  return t;
}

/** 拠点を外した、手で振る main の状態 */
function manualMain(opts: { seat?: Seat; serial?: number; n?: 3 | 4 } = {}): GameState {
  const s = rollState({ seat: opts.seat ?? 0, ...(opts.serial ? { serial: opts.serial } : {}), ...(opts.n ? { n: opts.n } : {}) });
  s.phase = { k: "main" };
  s.turn!.dice = [6, 6];
  return s;
}

describe("時間切れ（TC-EXP）", () => {
  it("TC-EXP-01 4人戦、s=9 に表にした3枚は、通し番号21の手番の終わりで流れる", () => {
    let s = manualMain({ seat: 0, serial: 9 });
    putOrders(s, [exact3(), exact3(), exact3()], 0, 9);
    const ids = s.orders.faceUp.map((f) => f.order.id);
    s = checked(s);
    while (s.turn!.serial < 21) {
      expect(s.orders.faceUp.map((f) => f.order.id)).toEqual(ids);
      s = next(s);
    }
    expect(s.orders.faceUp.map((f) => f.order.id)).toEqual(ids);
    expect(s.orders.faceUp.map((f) => f.remaining)).toEqual([1, 1, 1]);
    s = next(s);
    expect(s.orders.faceUp.map((f) => f.order.id).some((id) => ids.includes(id))).toBe(false);
  });
  it("TC-EXP-02 3人戦、s=7 なら通し番号16の終わりで流れる", () => {
    let s = manualMain({ n: 3, seat: 0, serial: 7 });
    putOrders(s, [exact3()], 0, 7);
    const id = s.orders.faceUp[0]!.order.id;
    s = checked(s);
    while (s.turn!.serial < 16) s = next(s);
    expect(s.orders.faceUp[0]!.order.id).toBe(id);
    s = next(s);
    expect(s.orders.faceUp[0]!.order.id).not.toBe(id);
  });
  it("TC-EXP-03 席1が表にした注文は、席0、2、3の手番の終わりでは減らない", () => {
    let s = manualMain({ seat: 0, serial: 9 });
    putOrders(s, [exact3()], 1, 2);
    s = checked(s);
    s = next(s); // 席0の終わり
    expect(s.orders.faceUp[0]!.remaining).toBe(3);
    s = next(s); // 席1の終わり
    expect(s.orders.faceUp[0]!.remaining).toBe(2);
    s = next(s); // 席2
    s = next(s); // 席3
    expect(s.orders.faceUp[0]!.remaining).toBe(2);
  });
  it("TC-EXP-04、05 流れたら counterSeat は同じ人、revealedTurn はこの手番。点もコインも入らない。2枚なら slot の小さい順に補充", () => {
    let s = manualMain({ seat: 1, serial: 10 });
    putOrders(s, [exact3(), exact3()], 1, 2);
    for (const f of s.orders.faceUp) f.remaining = 1;
    const deck = s.orders.deck.slice(0, 2).map((o) => o.id);
    s = checked(s);
    const r = okEv(s, seat(1), { t: "endTurn" });
    const t = r.state;
    expect(t.orders.faceUp.map((f) => [f.slot, f.order.id, f.counterSeat, f.revealedTurn])).toEqual([
      [0, deck[0], 1, 10],
      [1, deck[1], 1, 10],
    ]);
    expect(t.players[1]!.halfPoints).toBe(s.players[1]!.halfPoints);
    expect(t.players[1]!.coins).toBe(s.players[1]!.coins);
    expect(r.events.filter((e) => e.k === "orderExpired").map((e) => (e as { slot: number }).slot)).toEqual([0, 1]);
  });
  it("TC-EXP-06 山0で流れると補充せず、表も0なら endFlag が orders", () => {
    const s = manualMain({ seat: 1, serial: 10 });
    putOrders(s, [exact3()], 1, 2);
    s.orders.faceUp[0]!.remaining = 1;
    s.orders.deck = [];
    const t = ok(checked(s), seat(1), { t: "endTurn" });
    expect(t.orders.faceUp).toEqual([]);
    expect(t.endFlag).toEqual({ reason: "orders", at: 10 });
  });
  it("TC-EXP-07 誰も行を出していない共同注文は、手番を多数進めても時間切れにならない", () => {
    let s = checked(manualMain());
    const ids = s.joint.faceUp.map((f) => f.joint.id);
    for (let i = 0; i < 20; i++) s = next(s);
    expect(s.joint.faceUp.map((f) => f.joint.id)).toEqual(ids);
  });
});

describe("共同注文（TC-JNT）", () => {
  const joint = () => mkJoint([["egg", 3, 3], ["milk", 2, 2], ["wheat", 4, 4]]);
  function jbase(st: Seat = 0): GameState {
    const s = base({ seat: st });
    putJoints(s, [joint(), mkJoint([["carrot", 2, 2], ["egg", 2, 2], ["milk", 3, 3]], "the harvest fair")]);
    for (const p of s.players) {
      giveCards(s, p.seat, { sell: 3 });
      giveProducts(s, p.seat, { egg: 5, milk: 3, wheat: 4, carrot: 2 });
    }
    return checked(s);
  }
  const jid = (s: GameState, i = 0) => s.joint.faceUp[i]!.joint.id;

  it("TC-JNT-01、06 空いた行 egg 3 に egg 5 を持って出すと egg −3、sell −1、行が埋まり counter ができる", () => {
    const s = jbase();
    const t = ok(s, seat(0), { t: "contributeJoint", jointId: jid(s), product: "egg", n: 3 });
    expect(t.players[0]!.products.egg).toBe(2);
    expect(t.players[0]!.hand.sell).toBe(2);
    expect(t.joint.faceUp[0]!.rows[0]).toEqual({ seat: 0, turn: s.turn!.serial });
    expect(t.joint.faceUp[0]!.counter).toEqual({ seat: 0, remaining: 3, startedTurn: s.turn!.serial });
  });
  it("TC-JNT-02 egg 2 で egg 3 の行は MISSING_PRODUCTS", () => {
    const s = jbase();
    s.players[0]!.products.egg = 2;
    rejects(s, seat(0), { t: "contributeJoint", jointId: jid(s), product: "egg", n: 3 }, "MISSING_PRODUCTS");
  });
  it("TC-JNT-02b egg 4、milk 3 の指定は JOINT_MISMATCH。sell も産物も減らず、出した扱いにならない", () => {
    const s = jbase();
    rejects(s, seat(0), { t: "contributeJoint", jointId: jid(s), product: "egg", n: 4 }, "JOINT_MISMATCH");
    rejects(s, seat(0), { t: "contributeJoint", jointId: jid(s), product: "milk", n: 3 }, "JOINT_MISMATCH");
    expect(s.turn!.jointRowDone).toBe(false);
  });
  it("TC-JNT-03 この手番に1行出したら、別の共同注文の行も JOINT_LIMIT", () => {
    const s0 = jbase();
    const s = ok(s0, seat(0), { t: "contributeJoint", jointId: jid(s0), product: "egg", n: 3 });
    rejects(s, seat(0), { t: "contributeJoint", jointId: jid(s, 1), product: "carrot", n: 2 }, "JOINT_LIMIT");
  });
  it("TC-JNT-04 1人で3手番かけて3行出すと完成。全行の点と＋1半点がその人に入る", () => {
    let s = jbase();
    const id = jid(s);
    for (const [p, n] of [["egg", 3], ["milk", 2], ["wheat", 4]] as const) {
      s = ok(s, seat(0), { t: "contributeJoint", jointId: id, product: p, n });
      s = structuredClone(s);
      s.turn = { ...s.turn!, serial: s.turn!.serial + 4, jointRowDone: false };
    }
    expect(s.players[0]!.halfPoints).toBe(3 + 2 + 4 + 1);
    expect(s.joint.faceUp.find((f) => f.joint.id === id)).toBeUndefined();
  });
  it("TC-JNT-05 埋まった行と同じ産物と数は JOINT_MISMATCH", () => {
    const s0 = jbase();
    let s = ok(s0, seat(0), { t: "contributeJoint", jointId: jid(s0), product: "egg", n: 3 });
    s = structuredClone(s);
    s.turn = { ...s.turn!, jointRowDone: false };
    giveProducts(s, 0, { egg: 3 });
    rejects(checked(s), seat(0), { t: "contributeJoint", jointId: jid(s), product: "egg", n: 3 }, "JOINT_MISMATCH");
  });
  it("TC-JNT-07、08 3人が1行ずつ出して3行目を出すと、各人に行の点、3行目の人に＋1半点、コインは0。山0なら補充しない", () => {
    let s = jbase(0);
    s.joint.deck = [];
    const id = jid(s);
    const rows = [["egg", 3], ["milk", 2], ["wheat", 4]] as const;
    rows.forEach(([p, n], i) => {
      s = structuredClone(s);
      s.turn = { ...s.turn!, seat: i, serial: s.turn!.serial + 1, jointRowDone: false };
      s = ok(s, seat(i), { t: "contributeJoint", jointId: id, product: p, n });
    });
    expect(s.players.map((p) => p.halfPoints)).toEqual([3, 2, 4 + 1, 0]);
    expect(s.players.map((p) => p.coins)).toEqual([0, 0, 0, 0]);
    expect(s.joint.faceUp).toHaveLength(1);
  });
  it("TC-JNT-07 補充がある場合は同じ slot に表にする", () => {
    let s = jbase(0);
    const top = s.joint.deck[0]!.id;
    const id = jid(s);
    s.joint.faceUp[0]!.rows = [{ seat: 1, turn: 1 }, { seat: 2, turn: 2 }, null];
    s = ok(checked(s), seat(0), { t: "contributeJoint", jointId: id, product: "wheat", n: 4 });
    expect(s.joint.faceUp.find((f) => f.slot === 0)!.joint.id).toBe(top);
  });
  it("TC-JNT-09 共同注文の表が0でも、通常の注文が残ればゲームは終わらない", () => {
    let s = manualMain();
    s.joint.faceUp = [];
    s.joint.deck = [];
    s = checked(s);
    for (let i = 0; i < 8; i++) s = next(s);
    expect(s.phase.k).toBe("main");
  });
  it("TC-JNT-10 手番の人が完成で16半点以上になればその場で勝ち", () => {
    let s = jbase(0);
    addPoints(s, 0, 12);
    s.joint.faceUp[0]!.rows = [{ seat: 0, turn: 1 }, { seat: 0, turn: 2 }, null];
    s = ok(checked(s), seat(0), { t: "contributeJoint", jointId: jid(s), product: "wheat", n: 4 });
    expect(s.result).toMatchObject({ reason: "target", winnerSeat: 0 });
  });
  it("TC-JNT-11 手番でない人が完成で16半点以上になっても終わらず、その人の手番の初めに勝つ", () => {
    let s = jbase(0);
    addPoints(s, 1, 14);
    s.joint.faceUp[0]!.rows = [{ seat: 1, turn: 1 }, { seat: 1, turn: 2 }, null];
    s = ok(checked(s), seat(0), { t: "contributeJoint", jointId: jid(s), product: "wheat", n: 4 });
    expect(s.players[1]!.halfPoints).toBeGreaterThanOrEqual(16);
    expect(s.phase.k).toBe("main");
    s = ok(s, seat(0), { t: "endTurn" });
    expect(s.result).toMatchObject({ reason: "target", winnerSeat: 1 });
  });
  it("TC-JNT-12、TC-PTS-11 1.5点と2点の2行が出ていて時間切れになると、0.5点と1点を払い補充する", () => {
    const s = manualMain({ seat: 2, serial: 11 });
    putJoints(s, [mkJoint([["egg", 3, 3], ["wheat", 4, 4], ["milk", 2, 2]])]);
    const f = s.joint.faceUp[0]!;
    f.rows = [{ seat: 0, turn: 5 }, { seat: 1, turn: 6 }, null];
    f.counter = { seat: 2, remaining: 1, startedTurn: 7 };
    const top = s.joint.deck[0]!.id;
    const t = ok(checked(s), seat(2), { t: "endTurn" });
    expect(t.players[0]!.ledger.at(-1)).toMatchObject({ src: "jointHalf", hp: 1, reason: "expire" });
    expect(t.players[1]!.ledger.at(-1)).toMatchObject({ src: "jointHalf", hp: 2, reason: "expire" });
    expect(t.joint.faceUp[0]!.joint.id).toBe(top);
  });
  it("TC-JNT-13、14 手番の終わりの時間切れで16半点以上になっても、その場では勝たない。先に手番が来た人の勝ち", () => {
    const s = manualMain({ seat: 2, serial: 11 });
    putJoints(s, [mkJoint([["egg", 3, 4], ["wheat", 4, 4], ["milk", 2, 2]])]);
    const f = s.joint.faceUp[0]!;
    f.rows = [{ seat: 2, turn: 5 }, null, null];
    f.counter = { seat: 2, remaining: 1, startedTurn: 7 };
    addPoints(s, 2, 14);
    addPoints(s, 3, 16);
    const t = ok(checked(s), seat(2), { t: "endTurn" });
    expect(t.players[2]!.halfPoints).toBe(16);
    // 席2はその場で勝たず、次に手番が来た席3が勝つ
    expect(t.result).toMatchObject({ reason: "target", winnerSeat: 3 });
  });
  it("TC-JNT-13 その人だけが16半点以上なら、次の人の手番に進む", () => {
    const s = manualMain({ seat: 2, serial: 11 });
    putJoints(s, [mkJoint([["egg", 3, 4], ["wheat", 4, 4], ["milk", 2, 2]])]);
    s.joint.faceUp[0]!.rows = [{ seat: 2, turn: 5 }, null, null];
    s.joint.faceUp[0]!.counter = { seat: 2, remaining: 1, startedTurn: 7 };
    addPoints(s, 2, 14);
    const t = ok(checked(s), seat(2), { t: "endTurn" });
    expect(t.phase.k).toBe("roll");
    expect(t.turn!.seat).toBe(3);
  });
  it("TC-JNT-15 行に出した産物を取り戻すコマンドはない", () => {
    const L = legalActions(jbase(), 0) as unknown as Record<string, unknown>;
    expect(Object.keys(L).filter((k) => /withdraw|reclaim|takeBack/i.test(k))).toEqual([]);
  });
  it("TC-JNT-16 準備直後のラウンド1でも contributeJoint を受け付ける", () => {
    let s = started(4, "jnt16", { dice: "manual" });
    s = ok(s, seat(0), diceFor(12));
    while (s.phase.k === "income") s = answerAllFirst(s);
    s = structuredClone(s);
    const f = s.joint.faceUp[0]!;
    const l = f.joint.lines[0];
    clearHands(s);
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { [l.product]: l.n });
    expect(s.turn!.round).toBe(1);
    ok(checked(s), seat(0), { t: "contributeJoint", jointId: f.joint.id, product: l.product, n: l.n });
  });
});

describe("終わり方（TC-END）", () => {
  it("TC-END-01 席1の手番で endFlag が orders なら、席3の手番の終わりで終わる", () => {
    let s = manualMain({ seat: 1, serial: 10 });
    s.endFlag = { reason: "orders", at: 10 };
    s = checked(s);
    s = next(s); // 席1 → 席2
    expect(s.phase.k).toBe("main");
    s = next(s); // 席2 → 席3
    expect(s.turn!.seat).toBe(3);
    s = ok(s, seat(3), { t: "endTurn" });
    expect(s.result!.reason).toBe("orders");
  });
  it("TC-END-02 席3の手番中に callLastRound すると、その手番の終わりで終わる（reason host）", () => {
    let s = checked(manualMain({ seat: 3, serial: 12 }));
    s = ok(s, admin, { t: "callLastRound" });
    s = ok(s, seat(3), { t: "endTurn" });
    expect(s.result!.reason).toBe("host");
  });
  it("TC-END-03 席0の手番中に callLastRound すると、席3の手番の終わりで終わる", () => {
    let s = checked(manualMain({ seat: 0, serial: 9 }));
    s = ok(s, admin, { t: "callLastRound" });
    for (let i = 0; i < 3; i++) {
      s = next(s);
      expect(s.phase.k).toBe("main");
    }
    s = ok(s, seat(3), { t: "endTurn" });
    expect(s.result!.reason).toBe("host");
  });
  it("TC-END-04 endFlag があれば callLastRound は ALREADY_ENDING", () => {
    for (const reason of ["orders", "host"] as const) {
      const s = manualMain();
      s.endFlag = { reason, at: 1 };
      rejects(s, admin, { t: "callLastRound" }, "ALREADY_ENDING");
    }
  });
  it("TC-END-05、06 未完成の共同注文の2行に半分の点を払う。最後の手番の時間切れと二重に払わない", () => {
    const s = manualMain({ seat: 3, serial: 12 });
    putJoints(s, [mkJoint([["egg", 3, 3], ["wheat", 4, 4], ["milk", 2, 2]]), mkJoint([["carrot", 2, 2], ["egg", 4, 4], ["milk", 3, 3]], "the harvest fair")]);
    const [a, b] = s.joint.faceUp;
    a!.rows = [{ seat: 0, turn: 5 }, { seat: 1, turn: 6 }, null];
    a!.counter = { seat: 0, remaining: 3, startedTurn: 5 };
    b!.rows = [null, { seat: 2, turn: 7 }, null];
    b!.counter = { seat: 3, remaining: 1, startedTurn: 7 }; // この手番の終わりで時間切れ
    s.endFlag = { reason: "host", at: 12 };
    const t = ok(checked(s), seat(3), { t: "endTurn" });
    expect(t.players.map((p) => p.halfPoints)).toEqual([1, 2, 2, 0]);
    expect(t.players[2]!.ledger.filter((e) => e.src === "jointHalf")).toHaveLength(1);
    expect(t.players[2]!.ledger[0]).toMatchObject({ reason: "expire" });
    expect(t.players[0]!.ledger[0]).toMatchObject({ reason: "gameEnd" });
  });
  it("TC-END-07 点が同じでコインが違う2人はコインの多い人が上。点もコインも同じ2人は同順位", () => {
    const s = manualMain({ seat: 3, serial: 12 });
    s.joint.faceUp = [];
    addPoints(s, 0, 10);
    addPoints(s, 1, 10);
    addPoints(s, 2, 8);
    addPoints(s, 3, 8);
    s.players[0]!.coins = 5;
    s.players[1]!.coins = 7;
    s.players[2]!.coins = 3;
    s.players[3]!.coins = 3;
    s.endFlag = { reason: "orders", at: 12 };
    const t = ok(checked(s), seat(3), { t: "endTurn" });
    expect(t.result!.ranking.map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [0, 2],
      [2, 3],
      [3, 3],
    ]);
  });
  it("TC-END-08、11 勝ちで終わると reason target、winnerSeat、ranking があり、申し出が残っていても trades は空", () => {
    let s = base();
    giveCards(s, 0, { sell: 1, grow: 1 });
    giveProducts(s, 0, { carrot: 3 });
    s.players[1]!.coins = 2;
    addPoints(s, 0, 13);
    putOrders(s, [exact3()]);
    s = ok(checked(s), seat(0), { t: "proposeTrade", to: 1, give: { cards: { grow: 1 }, products: {}, coins: 0 }, get: { cards: {}, products: {}, coins: 1 } });
    expect(s.trades).toHaveLength(1);
    s = ok(s, seat(0), { t: "deliverOrder", orderId: s.orders.faceUp[0]!.order.id, items: { carrot: 3 } });
    expect(s.result!.reason).toBe("target");
    expect(s.result!.winnerSeat).toBe(0);
    expect(s.result!.ranking).toHaveLength(4);
    expect(s.trades).toEqual([]);
  });
  it("TC-END-09 途中の abortGame で半分の点を払い、reason が aborted", () => {
    const s = manualMain();
    s.joint.faceUp[0]!.rows = [{ seat: 2, turn: 1 }, null, null];
    const hp = Math.floor(s.joint.faceUp[0]!.joint.lines[0].hp / 2);
    const t = ok(checked(s), admin, { t: "abortGame" });
    expect(t.result!.reason).toBe("aborted");
    expect(t.players[2]!.halfPoints).toBe(hp);
  });
  it("TC-END-10 終わったあとの各コマンドは GAME_OVER", () => {
    const t = ok(checked(manualMain()), admin, { t: "abortGame" });
    rejects(t, seat(0), { t: "endTurn" }, "GAME_OVER");
    rejects(t, seat(1), { t: "payJapanese", kind: "word", method: "coin" }, "GAME_OVER");
    rejects(t, admin, { t: "callLastRound" }, "GAME_OVER");
    rejects(t, admin, { t: "abortGame" }, "GAME_OVER");
  });
});

describe("問い、管理、表示（TC-SYS）", () => {
  function promptState(): GameState {
    // 出目7で全員に好きな1枚の問いが出た状態
    const s = rollState({ seat: 0 });
    clearHands(s);
    return ok(checked(s), seat(0), diceFor(7));
  }
  it("TC-SYS-01 問いが残っていれば endTurn は WRONG_PHASE", () => {
    rejects(promptState(), seat(0), { t: "endTurn" }, "WRONG_PHASE");
  });
  it("TC-SYS-02 問いが残っていても callLastRound を受け付け、endFlag が host", () => {
    expect(ok(promptState(), admin, { t: "callLastRound" }).endFlag).toMatchObject({ reason: "host" });
  });
  it("TC-SYS-03 答えない人がいれば answerFor で処理が進む", () => {
    let s = promptState();
    for (const p of [...s.prompts]) {
      const answer = { k: "chooseKind" as const, kinds: [(p as { options: string[] }).options[0]!] as never };
      s = p.seat === 2 ? ok(s, admin, { t: "answerFor", promptId: p.id, answer }) : ok(s, seat(p.seat), { t: "answerPrompt", promptId: p.id, answer });
    }
    expect(s.phase.k).toBe("main");
  });
  it("管理のコマンドを席から送る、席のコマンドを管理から送ると BAD_MESSAGE", () => {
    const s = checked(manualMain());
    rejects(s, seat(0), { t: "callLastRound" }, "BAD_MESSAGE");
    rejects(s, admin, { t: "endTurn" }, "BAD_MESSAGE");
  });
  it("TC-SYS-04、04b endTurnFor(t) は endTurn と同じ。t+1 に進んだあとは STALE_TARGET", () => {
    const s = checked(manualMain({ seat: 1, serial: 2 }));
    const a = ok(s, admin, { t: "endTurnFor", turnSerial: 2 });
    const b = ok(s, seat(1), { t: "endTurn" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    rejects(a, admin, { t: "endTurnFor", turnSerial: 2 }, "STALE_TARGET");
  });
  it("TC-SYS-05 deliver の enabled は条件を満たす注文と満たさない注文で同じ", () => {
    const s = base();
    giveCards(s, 0, { sell: 1 });
    giveProducts(s, 0, { carrot: 3 });
    putOrders(s, [exact3(), mkOrder({ k: "exact", items: { milk: 4 } }, 4)]);
    const d = legalActions(checked(s), 0).deliver;
    expect(d.map((h) => h.enabled)).toEqual([true, true]);
  });
  it("TC-SYS-07、08 board は手札の中身、cond、hp、山の順番、乱数を含まず、枚数は含む。席1の表示は席1の手札だけ", () => {
    const s = base();
    giveCards(s, 1, { cow: 2 });
    giveCards(s, 2, { grow: 1 });
    putOrders(s, [exact3()]);
    const b = viewFor(checked(s), "board") as EngineBoardView;
    const json = JSON.stringify(b);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"cond"');
    expect(json).not.toContain('"hand"');
    expect(json).not.toContain(s.orders.deck[0]!.text.length > 20 ? s.orders.deck[0]!.text : "§§");
    expect(b.players.map((p) => p.handCount)).toEqual([0, 2, 1, 0]);
    expect(b.orders.deckCount).toBe(s.orders.deck.length);
    const v = viewFor(s, 1) as EnginePlayerView;
    expect(v.me.hand).toEqual({ cow: 2 });
    expect(JSON.stringify(v)).not.toContain('"grow":1}');
  });
  it("TC-SYS-10 記録を最初から再適用すると元の状態と完全に一致する", () => {
    // 性質のテスト（property.test.ts）でも毎局確かめる
    const cmds: { a: Parameters<typeof ok>[1]; c: Parameters<typeof ok>[2] }[] = [];
    let s = createGame(config({ dice: "manual" }), { participants: participants(4) }, "sys10");
    const g0 = s;
    const step = (a: Parameters<typeof ok>[1], c: Parameters<typeof ok>[2]) => {
      cmds.push({ a, c });
      s = ok(s, a, c);
    };
    while (s.phase.k === "setupPlace" || s.phase.k === "setupPrompt") {
      if (s.phase.k === "setupPrompt") {
        for (const p of [...s.prompts]) step(seat(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array((p as { count: number }).count).fill((p as { options: string[] }).options[0]) } });
        continue;
      }
      const st = s.phase.step < 4 ? s.phase.step : 7 - s.phase.step;
      step(seat(st), { t: "placeHouse", vertex: legalActions(s, st).placeHouse!.vertices[0]! });
    }
    step(seat(0), diceFor(5));
    let r = g0;
    for (const x of cmds) r = ok(r, x.a, x.c);
    expect(JSON.stringify(r)).toBe(JSON.stringify(s));
  });
  it("TC-SYS-11 参加者の名前は状態に入らない（参加者の識別子だけを持つ）", () => {
    const ps = participants(4).map((p, i) => ({ ...p, participantId: `id-${i}` }));
    const s = createGame(config(), { participants: ps }, "sys11");
    const json = JSON.stringify(s);
    expect(json).not.toContain("名前");
    expect(Object.keys(s.players[0]!)).not.toContain("name");
  });
});
