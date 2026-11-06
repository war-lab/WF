// 準備（TC-SET）、手番の初め（TC-TRN）、収入（TC-INC）、収穫（TC-HAR）。BD06 4.1〜4.4
import { describe, expect, it } from "vitest";
import { bagGet, bagTotal } from "../src/bag.ts";
import { board } from "../src/board.ts";
import { apply, createGame } from "../src/game.ts";
import type { GameState, Seat, WordCard } from "../src/types.ts";
import { WORD_CARDS } from "../src/types.ts";
import {
  addPoints,
  answerAllFirst,
  autoSetup,
  checked,
  clearHands,
  config,
  diceFor,
  giveCards,
  mainState,
  MARKET,
  numberOf,
  ok,
  okEv,
  participants,
  rejects,
  rollState,
  safeVertices,
  seat,
  setHouses,
  setPile,
  setTile,
  spread,
  started,
  uniqueTiles,
  vertexOf,
} from "./helpers.ts";

const tileAdj = (a: number, b: number) => board.tiles[a]!.vertices.some((v) => board.tiles[b]!.vertices.includes(v));

/** 準備の配置を、置く人の席の列として記録しながら進める */
function placementOrder(n: 3 | 4): Seat[] {
  let s = createGame(config(), { participants: participants(n) }, `order${n}`);
  const seq: Seat[] = [];
  while (s.phase.k === "setupPlace" || s.phase.k === "setupPrompt") {
    if (s.phase.k === "setupPrompt") {
      s = answerAllFirst(s);
      continue;
    }
    const step = s.phase.step;
    const placer = step < n ? step : 2 * n - 1 - step;
    seq.push(placer);
    const v = board.vertices.map((x) => x.id).find((x) => apply(s, seat(placer), { t: "placeHouse", vertex: x }).ok)!;
    s = ok(s, seat(placer), { t: "placeHouse", vertex: v });
  }
  return seq;
}

/** step 0 から、置く人に far な交点を順に置かせ、2個目の拠点を置く直前（step n）まで進める */
function untilSecondHouse(n: 3 | 4, reserve: number[]): GameState {
  let s = createGame(config(), { participants: participants(n) }, "second");
  for (let step = 0; step < n; step++) {
    const avoid = new Set(reserve.flatMap((v) => [v, ...vertexOf.get(v)!.neighbors]));
    const v = board.vertices.map((x) => x.id).find((x) => !avoid.has(x) && apply(s, seat(step), { t: "placeHouse", vertex: x }).ok)!;
    s = ok(s, seat(step), { t: "placeHouse", vertex: v });
  }
  return s;
}

describe("準備（TC-SET）", () => {
  it("TC-SET-01、02 種を変えて1万回、タイルと港の割り当てが条件を満たす", () => {
    const hi = new Set([5, 6, 8, 9]);
    for (let i = 0; i < 10000; i++) {
      const s = createGame(config(), { participants: participants(4) }, `set01-${i}`);
      const land = s.board.tiles.filter((t) => t.kind !== "market");
      for (const k of ["grow", "buy", "feed", "sell", "seed", "animal"]) {
        const ts = land.filter((t) => t.kind === k);
        expect(ts).toHaveLength(2);
        expect(ts.filter((t) => hi.has(t.number!))).toHaveLength(1);
      }
      const sellHi = land.find((t) => t.kind === "sell" && hi.has(t.number!))!;
      expect([6, 8]).toContain(sellHi.number);
      for (const a of land) for (const b of land) if (a.id !== b.id && tileAdj(a.id, b.id)) expect(a.kind).not.toBe(b.kind);
      const spec = s.board.harbors.filter((h) => h.kind !== "any").map((h) => h.kind);
      expect(new Set(spec).size).toBe(4);
      expect(s.board.harbors.filter((h) => h.kind === "any").map((h) => h.vertex).sort((a, b) => a - b)).toEqual([3, 37]);
    }
  }, 120000);

  it("TC-SET-03 同じ種と参加者なら状態が完全に一致する", () => {
    const a = createGame(config(), { participants: participants(4) }, "same");
    const b = createGame(config(), { participants: participants(4) }, "same");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("TC-SET-04 時計回りに A、B、C、D で開始プレイヤーが C なら、席0が C、1が D、2が A、3が B", () => {
    const ps = ["A", "B", "C", "D"].map((id, i) => ({ participantId: id, color: (["red", "blue", "green", "yellow"] as const)[i]!, japaneseRate: 1 as const }));
    let found = false;
    for (let i = 0; i < 100 && !found; i++) {
      const s = createGame(config(), { participants: ps }, `set04-${i}`);
      if (s.players[0]!.participantId !== "C") continue;
      expect(s.players.map((p) => p.participantId)).toEqual(["C", "D", "A", "B"]);
      found = true;
    }
    expect(found).toBe(true);
  });

  it("TC-SET-05 4人戦の配置の順は席0、1、2、3、3、2、1、0", () => {
    expect(placementOrder(4)).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });
  it("TC-SET-06 3人戦の配置の順は席0、1、2、2、1、0", () => {
    expect(placementOrder(3)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it("TC-SET-07〜10 置く人でない、隣、置き済みは拒否。1個目ではカードを配らない", () => {
    const s = createGame(config(), { participants: participants(4) }, "set07");
    const v = 20;
    rejects(s, seat(1), { t: "placeHouse", vertex: v }, "NOT_YOUR_TURN");
    const hand = structuredClone(s.players[0]!.hand);
    const s1 = ok(s, seat(0), { t: "placeHouse", vertex: v });
    expect(s1.players[0]!.hand).toEqual(hand); // TC-SET-10
    rejects(s1, seat(1), { t: "placeHouse", vertex: vertexOf.get(v)!.neighbors[0]! }, "BAD_VERTEX"); // TC-SET-08
    rejects(s1, seat(1), { t: "placeHouse", vertex: v }, "BAD_VERTEX"); // TC-SET-09
  });

  it("TC-SET-11 2個目の拠点が grow、sell、Market に接するなら grow 1、sell 1。Market からは配らない", () => {
    const v = board.vertices.find((x) => x.tiles.includes(MARKET) && x.tiles.length === 3)!;
    const [t1, t2] = v.tiles.filter((t) => t !== MARKET) as [number, number];
    let s = untilSecondHouse(4, [v.id]);
    s = structuredClone(s);
    setTile(s, t1, "grow");
    setTile(s, t2, "sell");
    const hand = structuredClone(s.players[3]!.hand);
    const piles = { ...s.piles };
    s = ok(s, seat(3), { t: "placeHouse", vertex: v.id });
    expect(bagGet(s.players[3]!.hand, "grow")).toBe(bagGet(hand, "grow") + 1);
    expect(bagGet(s.players[3]!.hand, "sell")).toBe(bagGet(hand, "sell") + 1);
    expect(bagTotal(s.players[3]!.hand)).toBe(bagTotal(hand) + 2);
    expect(s.piles.grow).toBe(piles.grow - 1);
    expect(s.piles.sell).toBe(piles.sell - 1);
  });

  it("TC-SET-12 2個目の拠点が seed と animal に接するなら、置いた人にだけ作物と動物の問い。答えるまで次の人は置けない", () => {
    const v = board.vertices.find((x) => x.tiles.length === 3 && !x.tiles.includes(MARKET))!;
    const [t1, t2, t3] = v.tiles as [number, number, number];
    let s = structuredClone(untilSecondHouse(4, [v.id]));
    setTile(s, t1, "seed");
    setTile(s, t2, "animal");
    setTile(s, t3, "grow");
    s = ok(s, seat(3), { t: "placeHouse", vertex: v.id });
    expect(s.phase.k).toBe("setupPrompt");
    expect(s.prompts.map((p) => p.seat)).toEqual([3, 3]);
    const opts = s.prompts.map((p) => (p.k === "chooseKind" ? [...p.options].sort() : []));
    expect(opts).toContainEqual(["carrot", "potato", "wheat"]);
    expect(opts).toContainEqual(["chicken", "cow"]);
    const free = board.vertices.map((x) => x.id).find((x) => apply({ ...s, phase: { k: "setupPlace", step: 5 } }, seat(2), { t: "placeHouse", vertex: x }).ok)!;
    rejects(s, seat(2), { t: "placeHouse", vertex: free }, "WRONG_PHASE");
    s = answerAllFirst(s);
    expect(s.phase).toEqual({ k: "setupPlace", step: 5 });
  });

  it("TC-SET-13 3人戦、cow の山が1枚。席2と席0が cow を選び、席2が先に答えても、席0がもらい席2に出し直す", () => {
    let s = createGame(config(), { participants: participants(3) }, "set13");
    // 拠点を置き終える直前まで進める
    while (!(s.phase.k === "setupPlace" && s.phase.step === 5)) {
      if (s.phase.k === "setupPrompt") s = answerAllFirst(s);
      else {
        const step = (s.phase as { step: number }).step;
        const placer = step < 3 ? step : 5 - step;
        const v = board.vertices.map((x) => x.id).find((x) => apply(s, seat(placer), { t: "placeHouse", vertex: x }).ok)!;
        s = ok(s, seat(placer), { t: "placeHouse", vertex: v });
      }
    }
    // 最後の拠点は seed、animal に接しない交点に置く
    const v = board.vertices.map((x) => x.id).find((x) => vertexOf.get(x)!.tiles.every((t) => !["seed", "animal"].includes(s.board.tiles[t]!.kind)) && apply(s, seat(0), { t: "placeHouse", vertex: x }).ok)!;
    s = structuredClone(s);
    setPile(s, "cow", 1);
    s = ok(s, seat(0), { t: "placeHouse", vertex: v });
    expect(s.phase.k).toBe("setupPrompt");
    expect(s.prompts).toHaveLength(3);
    const pOf = (st: Seat) => s.prompts.find((p) => p.seat === st)!;
    const cows = bagGet(s.players[0]!.hand, "cow");
    s = ok(s, seat(2), { t: "answerPrompt", promptId: pOf(2).id, answer: { k: "chooseKind", kinds: ["cow"] } });
    s = ok(s, seat(1), { t: "answerPrompt", promptId: pOf(1).id, answer: { k: "chooseKind", kinds: ["grow"] } });
    s = ok(s, seat(0), { t: "answerPrompt", promptId: pOf(0).id, answer: { k: "chooseKind", kinds: ["cow"] } });
    expect(bagGet(s.players[0]!.hand, "cow")).toBe(cows + 1);
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]!.seat).toBe(2);
    expect(s.prompts[0]).toMatchObject({ k: "chooseKind" });
    expect((s.prompts[0] as { options: string[] }).options).not.toContain("cow");
  });

  it("TC-SET-14 4人戦では追加の1枚の問いを出さない（3人戦では出る）", () => {
    /** 準備を手で進め、出た問いの source を集める */
    const sources = (n: 3 | 4) => {
      let s = createGame(config(), { participants: participants(n) }, `set14-${n}`);
      const seen: string[] = [];
      while (s.phase.k === "setupPlace" || s.phase.k === "setupPrompt") {
        for (const p of s.prompts) if (p.k === "chooseKind" && !seen.includes(`${p.id}:${p.source}`)) seen.push(`${p.id}:${p.source}`);
        if (s.phase.k === "setupPrompt") {
          s = answerAllFirst(s);
          continue;
        }
        const step = s.phase.step;
        const placer = step < n ? step : 2 * n - 1 - step;
        const v = board.vertices.map((x) => x.id).find((x) => apply(s, seat(placer), { t: "placeHouse", vertex: x }).ok)!;
        s = ok(s, seat(placer), { t: "placeHouse", vertex: v });
      }
      expect(s.phase.k).toBe("roll");
      return seen.map((x) => x.split(":")[1]);
    };
    expect(sources(4)).not.toContain("threePlayer");
    expect(sources(3).filter((x) => x === "threePlayer")).toHaveLength(3);
  });

  it("TC-SET-15 手札が initialHand と配置のカード、無料券、コインが席順の設定どおり（4人戦、3人戦）", () => {
    for (const n of [3, 4] as const) {
      const cfg = config();
      let s = createGame(cfg, { participants: participants(n) }, `set15-${n}`);
      const granted: Record<number, number> = {};
      while (s.phase.k === "setupPlace" || s.phase.k === "setupPrompt") {
        let r;
        if (s.phase.k === "setupPrompt") {
          const p = s.prompts.find((x) => !s.answers[x.id])!;
          r = okEv(s, seat(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array((p as { count: number }).count).fill((p as { options: WordCard[] }).options[0]) } });
        } else {
          const step = s.phase.step;
          const placer = step < n ? step : 2 * n - 1 - step;
          const v = board.vertices.map((x) => x.id).find((x) => apply(s, seat(placer), { t: "placeHouse", vertex: x }).ok)!;
          r = okEv(s, seat(placer), { t: "placeHouse", vertex: v });
        }
        for (const e of r.events) if (e.k === "cardsGranted") granted[e.seat] = (granted[e.seat] ?? 0) + bagTotal(e.cards);
        s = r.state;
      }
      for (const p of s.players) {
        expect(bagTotal(p.hand)).toBe(bagTotal(cfg.initialHand) + (granted[p.seat] ?? 0));
        for (const k of WORD_CARDS) expect(bagGet(p.hand, k)).toBeGreaterThanOrEqual(cfg.initialHand[k] ?? 0);
        expect(p.freeTickets).toBe(cfg.freeTickets);
        expect(p.coins).toBe(cfg.seatCoins[n][p.seat]);
      }
    }
  });

  it("TC-SET-15F 既定の設定は seatCoins 3、3、4、5（3人戦 3、3、4）、initialHand grow 1 sell 1、freeTickets 2", () => {
    const c = config();
    expect(c.seatCoins[4]).toEqual([3, 3, 4, 5]);
    expect(c.seatCoins[3]).toEqual([3, 3, 4]);
    expect(c.initialHand).toEqual({ grow: 1, sell: 1 });
    expect(c.freeTickets).toBe(2);
    expect(c.cardCounts).toEqual({ grow: 14, buy: 8, feed: 14, sell: 18, carrot: 8, potato: 8, wheat: 8, cow: 6, chicken: 6 });
  });

  it("TC-SET-16 準備を終えると共同注文が2枚表、通常の注文は表0枚で山36枚", () => {
    const s = started(4);
    expect(s.joint.faceUp).toHaveLength(2);
    expect(s.orders.faceUp).toHaveLength(0);
    expect(s.orders.deck).toHaveLength(36);
  });
});

/** 手番を1つ進める。出目は手で入れ、問いは先頭で答え、手番を終える */
function passTurn(s: GameState, sum = 12): GameState {
  let st = s;
  if (st.phase.k === "roll") st = ok(st, seat(st.turn!.seat), diceFor(sum));
  while (st.phase.k === "income") st = answerAllFirst(st);
  if (st.phase.k === "main") st = ok(st, seat(st.turn!.seat), { t: "endTurn" });
  return st;
}

describe("手番の初め（TC-TRN）", () => {
  it("TC-TRN-01 手番を4回進めると serial 1〜4 で round 1。5回目で round 2", () => {
    let s = started(4, "trn01", { dice: "manual" });
    const seen: [number, number][] = [[s.turn!.serial, s.turn!.round]];
    for (let i = 0; i < 4; i++) {
      s = passTurn(s);
      seen.push([s.turn!.serial, s.turn!.round]);
    }
    expect(seen).toEqual([[1, 1], [2, 1], [3, 1], [4, 1], [5, 2]]);
  });

  it("TC-TRN-02、03 ラウンド1、2では表にならず、ラウンド3の席0の初めに3枚表（counterSeat 0、revealedTurn はこの手番）", () => {
    let s = started(4, "trn02", { dice: "manual" });
    for (let i = 0; i < 8; i++) {
      expect(s.orders.faceUp).toHaveLength(0);
      s = passTurn(s);
    }
    expect(s.turn!.round).toBe(3);
    expect(s.turn!.seat).toBe(0);
    expect(s.orders.faceUp).toHaveLength(3);
    for (const f of s.orders.faceUp) {
      expect(f.counterSeat).toBe(0);
      expect(f.revealedTurn).toBe(s.turn!.serial);
    }
  });

  it("TC-TRN-04 手番の人が16半点なら、手番の初めに勝ってサイコロを振らない", () => {
    const s = checked(mainState({ seat: 3 }));
    addPoints(s, 0, s.config.targetHalfPoints);
    const t = ok(s, seat(3), { t: "endTurn" });
    expect(t.phase.k).toBe("over");
    expect(t.result!.winnerSeat).toBe(0);
    expect(t.turn!.dice).toBeNull();
  });

  it("TC-TRN-05 席1と席2が16半点以上で、次が席1なら席1の勝ち", () => {
    const s = mainState({ seat: 0 });
    addPoints(s, 1, 16);
    addPoints(s, 2, 18);
    const t = ok(s, seat(0), { t: "endTurn" });
    expect(t.result!.winnerSeat).toBe(1);
  });

  it("TC-TRN-06 roll の段階では交換、銀行、行動がすべて WRONG_PHASE", () => {
    const s = started(4);
    giveCards(s, 0, { grow: 4, potato: 1 });
    rejects(s, seat(0), { t: "plant", crop: "potato" }, "WRONG_PHASE");
    rejects(s, seat(0), { t: "bankTrade", give: "grow", get: "sell" }, "WRONG_PHASE");
    rejects(s, seat(0), { t: "buyCard", kind: "sell" }, "WRONG_PHASE");
    rejects(s, seat(0), { t: "proposeTrade", to: 1, give: { cards: { grow: 1 }, products: {}, coins: 0 }, get: { cards: {}, products: {}, coins: 1 } }, "WRONG_PHASE");
    rejects(s, seat(0), { t: "endTurn" }, "WRONG_PHASE");
  });

  it("TC-TRN-07 手番を始めると ownTurns が手番の人だけ1増える", () => {
    const s = mainState({ seat: 0 });
    const before = s.players.map((p) => p.ownTurns);
    const t = ok(s, seat(0), { t: "endTurn" });
    expect(t.players.map((p) => p.ownTurns)).toEqual(before.map((x, i) => (i === 1 ? x + 1 : x)));
  });
});

/** 一意の数字を持つ外周寄りのタイルと、その交点 */
function tileWithVertices(k: number, exclude: number[] = []): { t: number; vs: number[] } {
  for (const t of uniqueTiles()) {
    if (exclude.includes(t)) continue;
    try {
      return { t, vs: spread(safeVertices(t), k) };
    } catch {
      // この タイルでは k 個を選べない
    }
  }
  throw new Error("タイルが見つからない");
}

describe("収入（TC-INC）", () => {
  it("TC-INC-01、03 出目のタイルの角に拠点1個で1枚。手番でない人ももらう", () => {
    const { t, vs } = tileWithVertices(2);
    const s = rollState({ seat: 0 });
    setTile(s, t, "grow");
    setHouses(s, { 0: [vs[0]!], 2: [vs[1]!] });
    const g0 = bagGet(s.players[0]!.hand, "grow");
    const g2 = bagGet(s.players[2]!.hand, "grow");
    const r = ok(checked(s), seat(0), diceFor(numberOf(t)));
    expect(bagGet(r.players[0]!.hand, "grow")).toBe(g0 + 1);
    expect(bagGet(r.players[2]!.hand, "grow")).toBe(g2 + 1);
  });

  it("TC-INC-02 1枚のタイルに自分の拠点2個で2枚", () => {
    const { t, vs } = tileWithVertices(2);
    const s = rollState({ seat: 0 });
    setTile(s, t, "feed");
    setHouses(s, { 0: vs });
    const r = ok(s, seat(0), diceFor(numberOf(t)));
    expect(bagGet(r.players[0]!.hand, "feed") - bagGet(s.players[0]!.hand, "feed")).toBe(2);
  });

  it("TC-INC-04 手番の人は席2、grow の山が1枚、席3と席0が grow を受け取るなら席3だけがもらう", () => {
    const { t, vs } = tileWithVertices(2);
    const s = rollState({ seat: 2 });
    setTile(s, t, "grow");
    setHouses(s, { 0: [vs[0]!], 3: [vs[1]!] });
    setPile(s, "grow", 1);
    const g0 = bagGet(s.players[0]!.hand, "grow");
    const g3 = bagGet(s.players[3]!.hand, "grow");
    const r = ok(checked(s), seat(2), diceFor(numberOf(t)));
    expect(bagGet(r.players[3]!.hand, "grow")).toBe(g3 + 1);
    expect(bagGet(r.players[0]!.hand, "grow")).toBe(g0);
  });

  it("TC-INC-05 seed のタイルの角に拠点2個なら、1つの問いで count 2", () => {
    const { t, vs } = tileWithVertices(2);
    const s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 0: vs });
    const r = ok(s, seat(0), diceFor(numberOf(t)));
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]).toMatchObject({ k: "chooseKind", seat: 0, count: 2 });
  });

  it("TC-INC-06 carrot の山が0なら seed の問いの options に carrot がない", () => {
    const { t, vs } = tileWithVertices(1);
    const s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 1: vs });
    setPile(s, "carrot", 0);
    const r = ok(checked(s), seat(0), diceFor(numberOf(t)));
    const p = r.prompts.find((x) => x.seat === 1)!;
    expect(p.k === "chooseKind" && p.options).toEqual(["potato", "wheat"]);
  });

  it("TC-INC-07 作物の山がすべて0なら seed の権利に問いを出さず、受け取りもない", () => {
    const { t, vs } = tileWithVertices(1);
    const s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 1: vs, 0: [] });
    for (const k of ["carrot", "potato", "wheat"] as const) setPile(s, k, 0);
    const hand = structuredClone(s.players[1]!.hand);
    const r = ok(checked(s), seat(0), diceFor(numberOf(t)));
    expect(r.prompts.filter((p) => p.seat === 1)).toHaveLength(0);
    expect(r.players[1]!.hand).toEqual(hand);
  });

  it("TC-INC-08 手番の人は席2。席0と席3が potato を選び、山が1なら席3がもらい、席0に potato のない出し直し", () => {
    const { t, vs } = tileWithVertices(2);
    let s = rollState({ seat: 2 });
    setTile(s, t, "seed");
    setHouses(s, { 0: [vs[0]!], 3: [vs[1]!] });
    setPile(s, "potato", 1);
    s = ok(checked(s), seat(2), diceFor(numberOf(t)));
    const p0 = s.prompts.find((p) => p.seat === 0)!;
    const p3 = s.prompts.find((p) => p.seat === 3)!;
    s = ok(s, seat(0), { t: "answerPrompt", promptId: p0.id, answer: { k: "chooseKind", kinds: ["potato"] } });
    s = ok(s, seat(3), { t: "answerPrompt", promptId: p3.id, answer: { k: "chooseKind", kinds: ["potato"] } });
    expect(bagGet(s.players[3]!.hand, "potato")).toBeGreaterThanOrEqual(1);
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).toMatchObject({ seat: 0, reissued: true });
    expect(s.prompts[0]).toMatchObject({ k: "chooseKind" });
    expect((s.prompts[0] as { options: string[] }).options).not.toContain("potato");
  });

  it("TC-INC-08b 席3の出し直しを処理するまで、席0の権利を保留する", () => {
    // 手番の席2、席3、席0 がそれぞれ seed から1枚。carrot と wheat の山は1枚ずつ
    const { t, vs } = tileWithVertices(3);
    let s = rollState({ seat: 2 });
    setTile(s, t, "seed");
    setHouses(s, { 2: [vs[0]!], 3: [vs[1]!], 0: [vs[2]!] });
    clearHands(s);
    setPile(s, "carrot", 1);
    setPile(s, "wheat", 1);
    s = ok(checked(s), seat(2), diceFor(numberOf(t)));
    const ans = (st: Seat, k: WordCard) => {
      const p = s.prompts.find((x) => x.seat === st)!;
      s = ok(s, seat(st), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: [k] } });
    };
    ans(2, "carrot");
    ans(3, "carrot");
    ans(0, "wheat");
    // 席2が carrot をもらい、席3の carrot は尽きている。席3にだけ出し直し、席0の wheat はまだ渡さない
    expect(bagGet(s.players[2]!.hand, "carrot")).toBe(1);
    expect(s.prompts.map((p) => p.seat)).toEqual([3]);
    expect(bagGet(s.players[0]!.hand, "wheat")).toBe(0);
    ans(3, "wheat");
    expect(bagGet(s.players[3]!.hand, "wheat")).toBe(1);
    expect(s.prompts.map((p) => p.seat)).toEqual([0]);
    expect(s.prompts[0]!.k === "chooseKind" && s.prompts[0]!.options).toEqual(["potato"]);
  });

  it("TC-INC-08c seed と animal から1枚ずつ得る人には別々の問い。作物2枚や動物2枚の答えは BAD_ANSWER", () => {
    // 数字8のタイル2枚（一方を seed、他方を animal）に、同じ人の拠点を1つずつ
    const eights = board.tiles.filter((t) => t.number === 8).map((t) => t.id);
    const [a, b] = eights as [number, number];
    const va = board.tiles[a]!.vertices.find((v) => vertexOf.get(v)!.tiles.length === 1 || vertexOf.get(v)!.tiles.every((u) => u === a || board.tiles[u]!.number !== 8))!;
    const vb = spread(board.tiles[b]!.vertices.filter((v) => vertexOf.get(v)!.tiles.every((u) => u === b || board.tiles[u]!.number !== 8)), 1, [va])[0]!;
    let s = rollState({ seat: 0 });
    setTile(s, a, "seed");
    setTile(s, b, "animal");
    setHouses(s, { 1: [va, vb] });
    s = ok(checked(s), seat(0), diceFor(8));
    const mine = s.prompts.filter((p) => p.seat === 1);
    expect(mine).toHaveLength(2);
    const crop = mine.find((p) => p.k === "chooseKind" && p.options.includes("carrot"))!;
    const animal = mine.find((p) => p.k === "chooseKind" && p.options.includes("cow"))!;
    rejects(s, seat(1), { t: "answerPrompt", promptId: crop.id, answer: { k: "chooseKind", kinds: ["carrot", "carrot"] } }, "BAD_ANSWER");
    rejects(s, seat(1), { t: "answerPrompt", promptId: crop.id, answer: { k: "chooseKind", kinds: ["cow"] } }, "BAD_ANSWER");
    rejects(s, seat(1), { t: "answerPrompt", promptId: animal.id, answer: { k: "chooseKind", kinds: ["cow", "cow"] } }, "BAD_ANSWER");
    s = ok(s, seat(1), { t: "answerPrompt", promptId: crop.id, answer: { k: "chooseKind", kinds: ["carrot"] } });
    ok(s, seat(1), { t: "answerPrompt", promptId: animal.id, answer: { k: "chooseKind", kinds: ["cow"] } });
  });

  it("TC-INC-09、TC-SYS-04c 答えがそろう前に送り直すと、後の答えで処理", () => {
    const { t, vs } = tileWithVertices(2);
    let s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 1: [vs[0]!], 2: [vs[1]!] });
    clearHands(s);
    s = ok(checked(s), seat(0), diceFor(numberOf(t)));
    const p1 = s.prompts.find((p) => p.seat === 1)!;
    const p2 = s.prompts.find((p) => p.seat === 2)!;
    s = ok(s, seat(1), { t: "answerPrompt", promptId: p1.id, answer: { k: "chooseKind", kinds: ["carrot"] } });
    s = ok(s, seat(1), { t: "answerPrompt", promptId: p1.id, answer: { k: "chooseKind", kinds: ["wheat"] } });
    s = ok(s, seat(2), { t: "answerPrompt", promptId: p2.id, answer: { k: "chooseKind", kinds: ["potato"] } });
    expect(s.players[1]!.hand).toEqual({ wheat: 1 });
  });

  it("TC-INC-10、11 問いの対象でなければ NOT_PROMPTED、options にない種類は BAD_ANSWER", () => {
    const { t, vs } = tileWithVertices(1);
    let s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 1: vs });
    s = ok(checked(s), seat(0), diceFor(numberOf(t)));
    const p = s.prompts.find((x) => x.seat === 1)!;
    rejects(s, seat(2), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: ["carrot"] } }, "NOT_PROMPTED");
    rejects(s, seat(1), { t: "answerPrompt", promptId: "nope", answer: { k: "chooseKind", kinds: ["carrot"] } }, "NOT_PROMPTED");
    rejects(s, seat(1), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: ["grow"] } }, "BAD_ANSWER");
  });

  it("TC-INC-12 手番の人に拠点がない出目なら、救済の chooseKind（count 1）", () => {
    const { t, vs } = tileWithVertices(1);
    const s = rollState({ seat: 0 });
    setTile(s, t, "grow");
    setHouses(s, { 1: vs });
    const r = ok(s, seat(0), diceFor(numberOf(t)));
    expect(r.prompts).toEqual([expect.objectContaining({ seat: 0, k: "chooseKind", count: 1, source: "relief" })]);
  });

  it("TC-INC-13 手番の人の権利の山が0なら受け取りなしで、救済の問い", () => {
    const { t, vs } = tileWithVertices(1);
    const s = rollState({ seat: 0 });
    setTile(s, t, "buy");
    setHouses(s, { 0: vs });
    setPile(s, "buy", 0);
    const hand = structuredClone(s.players[0]!.hand);
    const r = ok(checked(s), seat(0), diceFor(numberOf(t)));
    expect(r.players[0]!.hand).toEqual(hand);
    expect(r.prompts[0]).toMatchObject({ seat: 0, source: "relief" });
  });

  /** 出目7の状態。手札の枚数を席ごとに指定する */
  function sevenState(sizes: number[], turnSeat: Seat = 0): GameState {
    const s = rollState({ seat: turnSeat });
    clearHands(s);
    sizes.forEach((n, st) => giveCards(s, st, { feed: Math.min(n, 3), grow: Math.max(0, n - 3) }));
    return checked(s);
  }

  it("TC-INC-14 出目7で手番の人が6枚以下なら、救済の問いは出ない", () => {
    let s = ok(sevenState([2, 2, 2, 2]), seat(0), diceFor(7));
    expect(s.prompts.every((p) => p.k === "chooseKind" && p.source === "marketDay")).toBe(true);
    s = answerAllFirst(s);
    expect(s.phase.k).toBe("main");
    expect(s.prompts).toHaveLength(0);
  });

  it("TC-INC-15 しきい値より1枚少ない人は問いなし。ちょうどと2枚多い人は半分の切り捨ての discard", () => {
    const th = config().sevenThreshold;
    const s = ok(sevenState([th - 1, th, th + 2, 0]), seat(0), diceFor(7));
    const d = s.prompts.filter((p) => p.k === "discard");
    expect(d.map((p) => [p.seat, p.count])).toEqual([
      [1, Math.floor(th / 2)],
      [2, Math.floor((th + 2) / 2)],
    ]);
  });

  it("TC-INC-15F 既定の設定で手札6、7、9枚の人は、問いなし、3枚、4枚", () => {
    const s = ok(sevenState([6, 7, 9, 0]), seat(0), diceFor(7));
    expect(s.prompts.map((p) => [p.seat, p.count])).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it("TC-INC-16 単語カード6枚と無料券2枚なら捨てない", () => {
    const s = sevenState([6, 0, 0, 0]);
    expect(s.players[0]!.freeTickets).toBe(2);
    const r = ok(s, seat(0), diceFor(7));
    expect(r.prompts.filter((p) => p.k === "discard")).toHaveLength(0);
  });

  it("TC-INC-17、18 7枚から3枚捨て、1枚もらって5枚。再び捨てない。捨てた grow は選ぶ前に山に戻る", () => {
    let s = sevenState([7, 0, 0, 0]);
    // grow の山を0にしておき、捨てた grow が戻ることを options で確かめる
    setPile(s, "grow", 0);
    s = checked(s);
    s = ok(s, seat(0), diceFor(7));
    const d = s.prompts[0]!;
    s = ok(s, seat(0), { t: "answerPrompt", promptId: d.id, answer: { k: "discard", cards: { grow: 3 } } });
    const mine = s.prompts.find((p) => p.seat === 0)!;
    expect(mine.k === "chooseKind" && mine.options.includes("grow")).toBe(true);
    // 全員が先頭の種類を選ぶと山が尽きて出し直しになるため、問いがなくなるまで答える
    while (s.phase.k === "income") s = answerAllFirst(s);
    expect(bagTotal(s.players[0]!.hand)).toBe(5);
    expect(s.phase.k).toBe("main");
  });

  it("TC-INC-19 持っていないカード、合計が違う discard の答えは BAD_ANSWER", () => {
    const s = ok(sevenState([8, 0, 0, 0]), seat(0), diceFor(7));
    const d = s.prompts[0]!;
    rejects(s, seat(0), { t: "answerPrompt", promptId: d.id, answer: { k: "discard", cards: { cow: 4 } } }, "BAD_ANSWER");
    rejects(s, seat(0), { t: "answerPrompt", promptId: d.id, answer: { k: "discard", cards: { grow: 3 } } }, "BAD_ANSWER");
    rejects(s, seat(0), { t: "answerPrompt", promptId: d.id, answer: { k: "chooseKind", kinds: ["grow"] } }, "BAD_ANSWER");
  });

  it("TC-INC-20 手番の人は席2、出目7。buy の山が1で席0と席3が buy を選ぶと、席3がもらい席0に出し直す", () => {
    let s = sevenState([0, 0, 0, 0], 2);
    setPile(s, "buy", 1);
    s = ok(checked(s), seat(2), diceFor(7));
    expect(s.prompts.map((p) => p.seat)).toEqual([2, 3, 0, 1]);
    for (const p of [...s.prompts]) {
      const k: WordCard = p.seat === 0 || p.seat === 3 ? "buy" : "feed";
      s = ok(s, seat(p.seat), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: [k] } });
    }
    expect(bagGet(s.players[3]!.hand, "buy")).toBe(1);
    expect(bagGet(s.players[0]!.hand, "buy")).toBe(0);
    expect(s.prompts.map((p) => p.seat)).toEqual([0]);
  });

  it("TC-INC-24 前回の収入で carrot を選んだ人の seed の問いは、既定の選択が carrot。自動では答えない", () => {
    const { t, vs } = tileWithVertices(1);
    let s = rollState({ seat: 0 });
    setTile(s, t, "seed");
    setHouses(s, { 1: vs });
    s = ok(checked(s), seat(0), diceFor(numberOf(t)));
    let p = s.prompts.find((x) => x.seat === 1)!;
    expect(p.k === "chooseKind" && p.preset).toBeNull();
    s = ok(s, seat(1), { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: ["carrot"] } });
    s = answerAllFirst(s);
    s = ok(s, seat(0), { t: "endTurn" });
    s = ok(s, seat(1), diceFor(numberOf(t)));
    p = s.prompts.find((x) => x.seat === 1)!;
    expect(p.k === "chooseKind" && p.preset).toBe("carrot");
    expect(s.answers[p.id]).toBeUndefined();
    expect(s.phase.k).toBe("income");
  });

  it("TC-INC-21 income の段階では交換の申し出と payJapanese が WRONG_PHASE", () => {
    const s = ok(sevenState([0, 0, 0, 0]), seat(0), diceFor(7));
    expect(s.phase.k).toBe("income");
    rejects(s, seat(1), { t: "proposeTrade", to: 0, give: { cards: {}, products: {}, coins: 1 }, get: { cards: {}, products: {}, coins: 1 } }, "WRONG_PHASE");
    rejects(s, seat(1), { t: "payJapanese", kind: "word", method: "coin" }, "WRONG_PHASE");
  });

  it("TC-INC-22 dice: server で inputDice は BAD_DICE", () => {
    rejects(started(4), seat(0), { t: "inputDice", a: 3, b: 4 }, "BAD_DICE");
  });

  it("TC-INC-23 dice: manual で inputDice(0, 7) は BAD_DICE", () => {
    const s = started(4, "inc23", { dice: "manual" });
    rejects(s, seat(0), { t: "inputDice", a: 0, b: 7 }, "BAD_DICE");
    rejects(s, seat(0), { t: "rollDice" }, "BAD_DICE");
  });
});

describe("収穫（TC-HAR）", () => {
  it("TC-HAR-01〜03 この手番に植えたものは収穫されず、次の自分の手番の収入のあとに産物3つで区画が空く。2区画とも収穫", () => {
    let s = mainState({ seat: 0, config: { dice: "manual" } });
    setHouses(s, {});
    clearHands(s);
    giveCards(s, 0, { grow: 2, potato: 1, wheat: 1 });
    s = checked(s);
    s = ok(s, seat(0), { t: "plant", crop: "potato" });
    s = ok(s, seat(0), { t: "plant", crop: "wheat" });
    expect(s.players[0]!.products).toEqual({}); // TC-HAR-01
    // 席1〜3 の手番（TC-HAR-04：ほかの人の手番では収穫されない）
    s = ok(s, seat(0), { t: "endTurn" });
    for (const st of [1, 2, 3]) {
      s = ok(s, seat(st), diceFor(12));
      while (s.phase.k === "income") s = answerAllFirst(s);
      expect(s.players[0]!.products).toEqual({});
      s = ok(s, seat(st), { t: "endTurn" });
    }
    s = ok(s, seat(0), diceFor(12));
    while (s.phase.k === "income") s = answerAllFirst(s);
    expect(s.players[0]!.products).toEqual({ potato: 3, wheat: 3 });
    expect(s.players[0]!.plots.slice(0, 2)).toEqual([{ t: "empty" }, { t: "empty" }]);
  });
});
