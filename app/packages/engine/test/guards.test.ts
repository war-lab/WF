// 不変条件の確認と入力の検査そのもののテスト。
// 性質のテストは checkInvariants に頼るため、確認が壊れた状態を見逃さないことをここで確かめる（空回りの防止）。
import { describe, expect, it } from "vitest";
import { bagAdd, bagValid } from "../src/bag.ts";
import { apply } from "../src/game.ts";
import { checkInvariants } from "../src/invariants.ts";
import { numberWord } from "../src/orders/english.ts";
import { choice, intBelow, seedRng } from "../src/rng.ts";
import type { GameState } from "../src/types.ts";
import { addPoints, mainState, mkJoint, mkOrder, putJoints, putOrders, seat } from "./helpers.ts";

const broken = (f: (s: GameState) => void): string[] => {
  const s = mainState();
  f(s);
  return checkInvariants(s);
};

describe("不変条件の確認が破れを見つける（BD01 4章）", () => {
  it("正しい状態では空", () => expect(checkInvariants(mainState())).toEqual([]));
  it("1 カードの総数", () => expect(broken((s) => (s.piles.grow += 1))[0]).toMatch(/^1:/));
  it("2 負の山、0の項目、負のコインと無料券", () => {
    expect(broken((s) => (s.piles.cow = -1)).some((e) => e.startsWith("2: 山"))).toBe(true);
    expect(broken((s) => (s.players[0]!.hand.cow = 0)).some((e) => e.includes("手札"))).toBe(true);
    expect(broken((s) => (s.players[0]!.products.egg = 0)).some((e) => e.includes("産物"))).toBe(true);
    expect(broken((s) => (s.players[0]!.coins = -1)).some((e) => e.includes("コイン"))).toBe(true);
    expect(broken((s) => (s.players[0]!.freeTickets = -1)).some((e) => e.includes("無料券"))).toBe(true);
  });
  it("3 点と内訳", () => expect(broken((s) => (s.players[1]!.halfPoints = 3))[0]).toMatch(/^3:/));
  it("4 拠点の上限、盤面との食い違い、隣り合い", () => {
    expect(broken((s) => (s.players[0]!.houses = [...s.players[0]!.houses, 1, 2])).some((e) => e.startsWith("4:"))).toBe(true);
    expect(
      broken((s) => {
        const v = s.players[0]!.houses[0]!;
        const u = 0 === v ? 1 : 0;
        s.board.houses[u] = 0;
      }).some((e) => e.startsWith("4:")),
    ).toBe(true);
  });
  it("5 表の注文の枚数と slot の重なり、共同注文も", () => {
    expect(broken((s) => putOrders(s, [1, 2, 3, 4].map(() => mkOrder({ k: "exact", items: { egg: 1 } }, 2))))).toContain("5: 表の注文が多い");
    expect(
      broken((s) => {
        putOrders(s, [mkOrder({ k: "exact", items: { egg: 1 } }, 2), mkOrder({ k: "exact", items: { egg: 1 } }, 2)]);
        s.orders.faceUp[1]!.slot = 0;
      }),
    ).toContain("5: 注文の slot が重なる");
    expect(broken((s) => putJoints(s, [1, 2, 3].map(() => mkJoint([["egg", 2, 2], ["milk", 2, 2], ["wheat", 2, 2]]))))).toContain("5: 表の共同注文が多い");
    expect(broken((s) => (s.joint.faceUp[1]!.slot = 0))).toContain("5: 共同注文の slot が重なる");
  });
  it("6〜9 段階と申し出、問い、結果、3行そろった共同注文", () => {
    expect(
      broken((s) => {
        s.trades = [{ id: "t", from: 0, to: 1, give: { cards: {}, products: {}, coins: 1 }, get: { cards: {}, products: {}, coins: 1 }, turn: 1 }];
        s.phase = { k: "roll" };
      }),
    ).toContain("6: main 以外で申し出がある");
    expect(broken((s) => (s.prompts = [{ id: "p", k: "discard", seat: 0, count: 1 }]))).toContain("7: 問いの段階が違う");
    expect(broken((s) => (s.phase = { k: "over" }))).toContain("8: 結果がない");
    expect(broken((s) => (s.joint.faceUp[0]!.rows = [{ seat: 0, turn: 1 }, { seat: 0, turn: 1 }, { seat: 0, turn: 1 }])).some((e) => e.startsWith("9:"))).toBe(true);
  });
});

describe("入力の検査", () => {
  it("bagAdd は負にしない", () => expect(() => bagAdd({ egg: 1 }, "egg", -2)).toThrow());
  it("bagValid は形の違う入れ物を通さない", () => {
    expect(bagValid(null, ["egg"])).toBe(false);
    expect(bagValid([], ["egg"])).toBe(false);
    expect(bagValid({ egg: 1.5 }, ["egg"])).toBe(false);
    expect(bagValid({ egg: "1" }, ["egg"])).toBe(false);
    expect(bagValid({ egg: 1 }, ["egg"])).toBe(true);
  });
  it("乱数の引数の誤りは例外", () => {
    expect(() => intBelow(seedRng("x"), 0)).toThrow();
    expect(() => choice(seedRng("x"), [])).toThrow();
    expect(seedRng("00000000000000000000000000000000").s).toEqual([1, 0, 0, 0]);
  });
  it("数詞の範囲外は例外", () => expect(() => numberWord(-1)).toThrow());
  it("形の壊れたコマンドは BAD_MESSAGE（例外にしない）", () => {
    const s = mainState();
    expect(apply(s, seat(0), { t: "nope" } as never)).toEqual({ ok: false, code: "BAD_MESSAGE" });
    expect(apply(s, seat(9), { t: "endTurn" })).toEqual({ ok: false, code: "BAD_MESSAGE" });
    expect(apply(s, seat(0), { t: "deliverOrder", orderId: "x", items: null } as never).ok).toBe(false);
    expect(apply(s, seat(0), { t: "plant", crop: "egg" } as never)).toEqual({ ok: false, code: "BAD_MESSAGE" });
    expect(apply(s, seat(0), { t: "bankTrade", give: "egg", get: "grow" } as never)).toEqual({ ok: false, code: "BAD_MESSAGE" });
    expect(apply(s, seat(0), { t: "payJapanese", kind: "word", method: "card" } as never)).toEqual({ ok: false, code: "BAD_MESSAGE" });
  });
  it("addPoints の補助は内訳も足す", () => {
    const s = mainState();
    addPoints(s, 0, 4);
    expect(checkInvariants(s)).toEqual([]);
  });
});
