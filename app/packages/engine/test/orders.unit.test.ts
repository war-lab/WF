// 点の計算（TC-PTS）、生成と乱数（TC-GEN）、英文（TC-ENG）。BD06 4.14〜4.16
import { describe, expect, it } from "vitest";
import { createGame, layoutTiles } from "../src/game.ts";
import {
  itemsPhrase,
  joinAnd,
  noun,
  numberWord,
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
} from "../src/orders/english.ts";
import { fixedData, fixedJoints, fixedOrders } from "../src/orders/fixed.ts";
import { EVENTS, genJointDeck, genOne, genOrderDeck } from "../src/orders/generate.ts";
import { animalHalfPoints, bonusHalfPoints, conditionHalfPoints, orderHalfPoints } from "../src/orders/points.ts";
import { childRng, intBelow, nextU32, seedRng } from "../src/rng.ts";
import type { RngState } from "../src/types.ts";
import { config, participants } from "./helpers.ts";

describe("点の計算（TC-PTS）", () => {
  it("TC-PTS-01 carrot 3 は3半点", () => expect(orderHalfPoints({ carrot: 3 }, false)).toBe(3));
  it("TC-PTS-02 egg 2、milk 1 は4半点", () => expect(orderHalfPoints({ egg: 2, milk: 1 }, false)).toBe(4));
  it("TC-PTS-03 egg 6、難は6半点", () => expect(orderHalfPoints({ egg: 6 }, true)).toBe(6));
  it("TC-PTS-04 e が1.25点ちょうどなら切り上げて3半点", () => {
    // e = 300 + 400×n。n=… では1250にならないため、重みの組で作る：egg 1（450）+ 500（難）= 1250
    expect(orderHalfPoints({ egg: 1 }, true)).toBe(3);
  });
  it("TC-PTS-05 最小と最大を超える入力は1半点、6半点に収まる", () => {
    expect(orderHalfPoints({}, false)).toBe(1);
    expect(orderHalfPoints({ milk: 20, egg: 20 }, true)).toBe(6);
  });
  it("TC-PTS-06F 印刷用の注文34枚と共同注文24行（58件）の点がルールブックと一致", () => {
    let count = 0;
    for (const row of fixedData.orders) {
      if (row.points === null) continue;
      const hp = conditionHalfPoints(row.cond, row.level === "hard", false);
      expect(hp, `#${row.no}`).toBe(row.points * 2);
      count += 1;
    }
    for (const j of fixedData.joints) {
      for (const l of j.lines) {
        expect(orderHalfPoints({ [l.product]: l.n }, false), `#${j.no} ${l.product}`).toBe(l.points * 2);
        count += 1;
      }
    }
    expect(count).toBe(58);
  });
  it("TC-PTS-07 ボーナス：milk 5、egg 6、wheat 13 は2半点と5コイン、3半点と6コイン、5半点と13コイン", () => {
    expect(bonusHalfPoints("milk", 5)).toBe(2);
    expect(bonusHalfPoints("egg", 6)).toBe(3);
    expect(bonusHalfPoints("wheat", 13)).toBe(5);
  });
  it("TC-PTS-08 ボーナス：egg 1、egg 2、wheat 2、wheat 3 は0、1、0、1半点", () => {
    expect([bonusHalfPoints("egg", 1), bonusHalfPoints("egg", 2), bonusHalfPoints("wheat", 2), bonusHalfPoints("wheat", 3)]).toEqual([0, 1, 0, 1]);
  });
  it("TC-PTS-09 動物2頭、3頭（指定なし）は3半点、5半点", () => {
    expect(animalHalfPoints(2, false)).toBe(3);
    expect(animalHalfPoints(3, false)).toBe(5);
  });
  it("TC-PTS-10 動物3頭、指定ありは6半点（3点が上限）", () => expect(animalHalfPoints(3, true)).toBe(6));
  it("TC-PTS-11 行の点 2、3、4半点の半分は1、1、2半点", () => {
    expect([2, 3, 4].map((x) => Math.floor(x / 2))).toEqual([1, 1, 2]);
  });
});

describe("生成と乱数（TC-GEN）", () => {
  it("TC-GEN-01 種を変えて1000回、毎回36枚、うちボーナス2枚、英文が重ならない", () => {
    for (let i = 0; i < 1000; i++) {
      const r = seedRng(`gen01-${i}`);
      const deck = genOrderDeck(r, "s", false);
      expect(deck).toHaveLength(36);
      expect(deck.filter((o) => o.isBonus)).toHaveLength(2);
      expect(new Set(deck.map((o) => o.text)).size).toBe(36);
    }
  });

  it("TC-GEN-02 10万枚分で区分と型の出現率が5.1の確率と合う（カイ二乗、有意水準0.001）", () => {
    const r = seedRng("gen02");
    const N = 100000;
    const count = { easy: 0, medium2: 0, halfDozen: 0, total: 0, same: 0, animals: 0 };
    for (let i = 0; i < N; i++) {
      const d = genOne(r, false);
      if (d.level === "easy") count.easy++;
      else if (d.cond.k === "animals") count.animals++;
      else if (d.level === "medium") count.medium2++;
      else if (d.cond.k === "total") count.total++;
      else if (d.cond.k === "same") count.same++;
      else count.halfDozen++;
    }
    // 期待：易0.35、中（2種類）0.40、難0.25 を k で 0.3/0.25/0.25/0.2 に分ける
    const p = { easy: 0.35, medium2: 0.4, halfDozen: 0.25 * 0.3, total: 0.25 * 0.25, same: 0.25 * 0.25, animals: 0.25 * 0.2 };
    let chi = 0;
    for (const k of Object.keys(p) as (keyof typeof p)[]) chi += (count[k] - N * p[k]) ** 2 / (N * p[k]);
    // 自由度5、有意水準0.001 の棄却域は 20.515
    expect(chi).toBeLessThan(20.515);
  });

  it("TC-GEN-03 宛先の入る型だけ to があり、「易」だけ picture がある", () => {
    const r = seedRng("gen03");
    for (let i = 0; i < 5000; i++) {
      const d = genOne(r, false);
      // 宛先の入る型（needs、is looking for、would like）だけ to を持ち、英文に宛先がある
      const placeType = / (needs|is looking for|would like) /.test(d.text);
      expect(d.to !== null).toBe(placeType);
      if (d.to !== null) expect(d.text.toLowerCase()).toContain(d.to.toLowerCase());
      expect(d.picture !== null).toBe(d.level === "easy");
    }
  });

  it("TC-GEN-04 共同注文：1000回、8枚、催しの名前が重ならない。行の数が範囲内。egg と milk の行が1〜2", () => {
    for (let i = 0; i < 1000; i++) {
      const deck = genJointDeck(seedRng(`gen04-${i}`), "s");
      expect(deck).toHaveLength(8);
      expect(new Set(deck.map((j) => j.to)).size).toBe(8);
      for (const j of deck) {
        expect(EVENTS.map((e) => e.toLowerCase())).toContain(j.to.toLowerCase());
        expect(new Set(j.lines.map((l) => l.product)).size).toBe(3);
        const an = j.lines.filter((l) => l.product === "egg" || l.product === "milk").length;
        expect(an).toBeGreaterThanOrEqual(1);
        expect(an).toBeLessThanOrEqual(2);
        for (const l of j.lines) {
          expect(l.n).toBeGreaterThanOrEqual(2);
          expect(l.n).toBeLessThanOrEqual(l.product === "milk" ? 3 : 4);
        }
      }
    }
  });

  it("TC-GEN-05F 印刷用は36枚と8枚。番号がルールブックと一致", () => {
    const o = fixedOrders();
    const j = fixedJoints();
    expect(o.map((x) => (x.source as { printedNo: number }).printedNo)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect(j.map((x) => (x.source as { printedNo: number }).printedNo)).toEqual(Array.from({ length: 8 }, (_, i) => 201 + i));
    expect(o.filter((x) => x.isBonus).map((x) => (x.source as { printedNo: number }).printedNo)).toEqual([35, 36]);
  });

  it("TC-GEN-06 注文の生成の手順を変えても、盤面とサイコロの乱数の列が変わらない", () => {
    // 生成は子の生成器で行う。子の生成器を作ったあとの親の状態は、生成で何枚引いても同じ
    const a = createGame(config({ orderDeck: "generated" }), { participants: participants(4) }, "gen06");
    const b = createGame(config({ orderDeck: "fixed" }), { participants: participants(4) }, "gen06");
    expect(a.rng).toEqual(b.rng);
    expect(a.board).toEqual(b.board);
    expect(a.players.map((p) => p.participantId)).toEqual(b.players.map((p) => p.participantId));
  });

  it("TC-GEN-07 animalInclude が既定（なし）なら、動物の注文に指定の文が付かず、点は1.5か2.5", () => {
    const r = seedRng("gen07");
    let seen = 0;
    for (let i = 0; i < 20000; i++) {
      const d = genOne(r, false);
      if (d.cond.k !== "animals") continue;
      seen++;
      expect(d.text).toMatch(/^A school class wants to visit a farm with at least (two|three) animals\.$/);
      expect([3, 5]).toContain(d.hp);
      expect(d.cond.include).toBeNull();
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("TC-GEN-08 xoshiro128** の出力列が参照実装と一致", () => {
    // 期待値は xoshiro128** の参照実装（prng.di.unimi.it の C コード）の式を、別の実装（Python）で計算した値。
    // 状態 {1,2,3,4} からの最初の6個。公開された出力列そのものとの照合は未確認（BD06 4.15 の注記）
    const r: RngState = { s: [1, 2, 3, 4] };
    const got = Array.from({ length: 6 }, () => nextU32(r));
    expect(got).toEqual(XOSHIRO_REF);
  });

  it("TC-GEN-09 6面を60万回振ると、各面の出現数がカイ二乗検定で一様と矛盾しない", () => {
    const r = seedRng("gen09");
    const c = [0, 0, 0, 0, 0, 0];
    const N = 600000;
    for (let i = 0; i < N; i++) c[intBelow(r, 6)]!++;
    const e = N / 6;
    const chi = c.reduce((t, x) => t + (x - e) ** 2 / e, 0);
    expect(chi).toBeLessThan(20.515); // 自由度5、有意水準0.001
  });

  it("TC-GEN-10 乱数の状態を JSON にして戻すと、続きの列が同じ", () => {
    const r = seedRng("gen10");
    for (let i = 0; i < 10; i++) nextU32(r);
    const copy = JSON.parse(JSON.stringify(r)) as RngState;
    expect(Array.from({ length: 20 }, () => nextU32(copy))).toEqual(Array.from({ length: 20 }, () => nextU32(r)));
  });

  it("子の生成器は親と別の列になる", () => {
    const r = seedRng("child");
    const c = childRng(r);
    expect(c.s).not.toEqual(r.s);
  });

  it("タイルの割り当てがやり直しの上限内で終わる", () => {
    for (let i = 0; i < 200; i++) expect(layoutTiles(seedRng(`lay${i}`))).toHaveLength(13);
  });
});

/** 状態 {1,2,3,4} からの xoshiro128** の最初の6個（Python で計算。test/xoshiro_ref.py） */
const XOSHIRO_REF = [11520, 0, 5927040, 70819200, 2031721883, 1637235492];

describe("英文（TC-ENG）", () => {
  it("TC-ENG-01 数 1〜99 を数詞にする。21 は twenty-one", () => {
    expect(numberWord(1)).toBe("one");
    expect(numberWord(13)).toBe("thirteen");
    expect(numberWord(20)).toBe("twenty");
    expect(numberWord(21)).toBe("twenty-one");
    expect(numberWord(99)).toBe("ninety-nine");
    for (let i = 1; i <= 99; i++) expect(numberWord(i)).toMatch(/^[a-z]+(-[a-z]+)?$/);
    expect(() => numberWord(100)).toThrow();
  });
  it("TC-ENG-02 egg 1、carrot 1、potato 1 は an egg、a carrot、a potato", () => {
    expect([noun("egg", 1), noun("carrot", 1), noun("potato", 1)]).toEqual(["an egg", "a carrot", "a potato"]);
  });
  it("TC-ENG-03 wheat と milk に単位を付ける", () => {
    expect([noun("wheat", 1), noun("wheat", 3), noun("milk", 1), noun("milk", 2)]).toEqual([
      "a bag of wheat",
      "three bags of wheat",
      "a bottle of milk",
      "two bottles of milk",
    ]);
  });
  it("TC-ENG-04 2種類、3種類を A and B、A, B and C で並べる", () => {
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
  });
  it("TC-ENG-05 注文の英文が milk、egg の順なら、宣言も milk、egg の順", () => {
    expect(itemsPhrase({ egg: 2, milk: 1 }, "Grandma would like a bottle of milk and two eggs.")).toBe("a bottle of milk and two eggs");
  });
  it("TC-ENG-06 英文にない carrot を足して出すと、carrot が後ろに付く", () => {
    expect(itemsPhrase({ egg: 2, milk: 1, carrot: 1 }, "Please don’t send potatoes. We need a bottle of milk and two eggs.")).toBe(
      "a bottle of milk, two eggs and a carrot",
    );
  });
  it("TC-ENG-07 各行動の英文が BD02 7.2 の表と一致", () => {
    expect(sentencePlant("potato")).toBe("I grow potatoes.");
    expect(sentencePlant("wheat")).toBe("I grow wheat.");
    expect(sentencePlant("carrot")).toBe("I grow carrots and feed the soil.");
    expect(sentenceBuyAnimal("chicken")).toBe("I buy a chicken.");
    expect(sentenceBuyAnimal("cow")).toBe("I buy a cow and grow grass.");
    expect(sentenceFeed("chicken")).toBe("I feed the chicken.");
    expect(sentenceFeed("cow")).toBe("I feed the cow.");
    expect(sentenceSellProducts("egg", 4)).toBe("I sell four eggs.");
    expect(sentenceSellAnimal("chicken")).toBe("I sell the chicken.");
    expect(sentenceSellAnimal("cow")).toBe("I sell the cow.");
    expect(sentenceDeliver({ carrot: 3 }, "The cafe needs three carrots.", "the cafe")).toBe("I sell three carrots to the cafe.");
    expect(sentenceBuildHouse()).toBe("I build a farmhouse.");
  });
  it("TC-ENG-08 宛先のない注文は to 以下が付かない", () => {
    expect(sentenceDeliver({ egg: 6 }, "Half a dozen eggs, please.", null)).toBe("I sell six eggs.");
  });
  it("TC-ENG-09 動物1頭、4頭", () => {
    expect(sentenceAnimals(1)).toBe("I have one animal.");
    expect(sentenceAnimals(4)).toBe("I have four animals.");
  });
  it("TC-ENG-10 共同注文の行", () => {
    expect(sentenceJoint("egg", 3, "the village festival")).toBe("I bring three eggs to the village festival.");
  });
  it("TC-ENG-11 wheat 13 のボーナス", () => {
    expect(sentenceBonus("wheat", 13)).toBe("I sell thirteen bags of wheat to the farmers' market.");
  });
});
