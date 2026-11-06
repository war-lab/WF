// 乱数で選んだ正しい操作でゲームを進める補助（BD06 5.1）。性質のテストと処理時間の測定が使う。
// 操作の候補は、legalActions の enabled: true の操作、問いへの答え、手番でない人の交換の申し出と日本語の支払い。
// 「何番目を選ぶか」の列で操作を表し、縮小しても正しい操作の列のままになるようにする。
import { bagGet, bagKeys } from "../src/bag.ts";
import { conditionMet, matchRow } from "../src/commands.ts";
import { legalActions } from "../src/legal.ts";
import type { Actor, Bag, Command, GameState, Product, Seat, WordCard } from "../src/types.ts";
import { PRODUCTS, WORD_CARDS } from "../src/types.ts";

export interface Picker {
  /** 0以上 k 未満 */
  pick(k: number): number;
}

/** 選択の列から値を取り出す。列が尽きたら exhausted を立てて0を返す */
export class ListPicker implements Picker {
  i = 0;
  exhausted = false;
  private readonly xs: number[];
  constructor(xs: number[]) {
    this.xs = xs;
  }
  pick(k: number): number {
    if (k <= 1) return 0;
    if (this.i >= this.xs.length) {
      this.exhausted = true;
      return 0;
    }
    return this.xs[this.i++]! % k;
  }
}

/** 整数の種から、決まった乱数の列で値を取り出す（mulberry32） */
export function seededPicker(seed: number): Picker {
  let a = seed >>> 0;
  return new RandPicker(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/** 乱数の関数から値を取り出す */
export class RandPicker implements Picker {
  private readonly rand: () => number;
  constructor(rand: () => number) {
    this.rand = rand;
  }
  pick(k: number): number {
    return k <= 1 ? 0 : Math.floor(this.rand() * k);
  }
}

export type Move = { actor: Actor; cmd: Command };

const seatA = (s: Seat): Actor => ({ k: "seat", seat: s });

/** 1..max の数を選ぶ */
const amount = (pk: Picker, max: number) => 1 + pk.pick(Math.max(1, max));

/** 持っている産物から、ランダムな組を作る */
function someItems(pk: Picker, products: Bag<Product>): Bag<Product> {
  const keys = bagKeys(products);
  const out: Bag<Product> = {};
  const k = keys[pk.pick(keys.length)];
  if (k) out[k] = amount(pk, bagGet(products, k));
  const k2 = keys[pk.pick(keys.length)];
  if (k2 && k2 !== k && pk.pick(2) === 0) out[k2] = amount(pk, bagGet(products, k2));
  return out;
}

/** 条件をちょうど満たす産物の組（持っていれば） */
function exactItems(s: GameState, orderId: string, products: Bag<Product>): Bag<Product> | null {
  const f = s.orders.faceUp.find((x) => x.order.id === orderId)!;
  const c = f.order.cond;
  let want: Bag<Product> | null = null;
  if (c.k === "exact") want = c.items;
  else if (c.k === "total") {
    const [a, b] = c.allowed;
    const ha = Math.min(bagGet(products, a!), c.total);
    want = ha === c.total ? { [a!]: ha } : { [a!]: ha, [b!]: c.total - ha };
    if (ha === 0) want = { [b!]: c.total };
  } else if (c.k === "same") {
    want = { [c.pair[0]]: c.min, [c.pair[1]]: c.min };
  }
  if (!want) return null;
  for (const k of bagKeys(want)) if (bagGet(products, k) < bagGet(want, k)) return null;
  return conditionMet(c, want) ? want : null;
}

/** その状態での操作の候補を作る。一部の数（売る数など）は picker で決める */
export function candidates(s: GameState, pk: Picker): Move[] {
  const moves: Move[] = [];
  if (s.phase.k === "over") return moves;

  // 問いへの答え（答え直しも候補に入れる）
  for (const p of s.prompts) {
    if (p.k === "chooseKind") {
      const kinds = Array.from({ length: p.count }, () => p.options[pk.pick(p.options.length)]!);
      moves.push({ actor: seatA(p.seat), cmd: { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds } } });
    } else {
      const hand = { ...s.players[p.seat]!.hand };
      const cards: Bag<WordCard> = {};
      for (let i = 0; i < p.count; i++) {
        const ks = WORD_CARDS.filter((k) => bagGet(hand, k) > 0);
        const k = ks[pk.pick(ks.length)]!;
        hand[k] = bagGet(hand, k) - 1;
        cards[k] = bagGet(cards, k) + 1;
      }
      moves.push({ actor: seatA(p.seat), cmd: { t: "answerPrompt", promptId: p.id, answer: { k: "discard", cards } } });
    }
  }

  for (const pl of s.players) {
    const me = pl.seat;
    const a = seatA(me);
    const L = legalActions(s, me);
    if (L.placeHouse && L.placeHouse.vertices.length) {
      moves.push({ actor: a, cmd: { t: "placeHouse", vertex: L.placeHouse.vertices[pk.pick(L.placeHouse.vertices.length)]! } });
    }
    if (L.rollDice?.enabled) moves.push({ actor: a, cmd: { t: "rollDice" } });
    if (L.inputDice?.enabled) moves.push({ actor: a, cmd: { t: "inputDice", a: 1 + pk.pick(6), b: 1 + pk.pick(6) } });
    for (const h of L.plant) if (h.enabled) moves.push({ actor: a, cmd: { t: "plant", crop: h.value } });
    for (const h of L.buyAnimal) if (h.enabled) moves.push({ actor: a, cmd: { t: "buyAnimal", animal: h.value } });
    for (const h of L.feed) if (h.enabled) moves.push({ actor: a, cmd: { t: "feed", plot: h.value } });
    for (const sp of L.sellProducts) moves.push({ actor: a, cmd: { t: "sellProducts", product: sp.product, n: amount(pk, sp.max) } });
    for (const h of L.sellAnimal) if (h.enabled) moves.push({ actor: a, cmd: { t: "sellAnimal", plot: h.value } });
    for (const h of L.deliver) {
      if (!h.enabled) continue;
      const id = h.value.orderId;
      if (h.value.kind === "animals") moves.push({ actor: a, cmd: { t: "claimAnimalOrder", orderId: id } });
      else if (h.value.kind === "bonus") {
        const ks = bagKeys(pl.products);
        const p = ks[pk.pick(ks.length)]!;
        moves.push({ actor: a, cmd: { t: "deliverBonus", orderId: id, product: p, n: amount(pk, bagGet(pl.products, p)) } });
      } else {
        // 条件を満たす組を持っていれば、半分の確率でそれを出す（成立の経路を通すため）
        const ex = exactItems(s, id, pl.products);
        const items = ex && pk.pick(2) === 0 ? ex : someItems(pk, pl.products);
        moves.push({ actor: a, cmd: { t: "deliverOrder", orderId: id, items } });
      }
    }
    for (const h of L.contributeJoint) {
      if (!h.enabled) continue;
      const f = s.joint.faceUp.find((x) => x.joint.id === h.value.jointId)!;
      // 持っている産物で埋められる行があればそれ、なければランダム（JOINT_MISMATCH などで拒否される）
      const fit = f.joint.lines.findIndex((l, i) => f.rows[i] === null && bagGet(pl.products, l.product) >= l.n);
      if (fit >= 0) {
        const l = f.joint.lines[fit]!;
        if (matchRow(f, l.product, l.n) >= 0) moves.push({ actor: a, cmd: { t: "contributeJoint", jointId: f.joint.id, product: l.product, n: l.n } });
      }
    }
    if (L.buildHouse.enabled) {
      const vs = L.buildHouse.value.vertices;
      moves.push({ actor: a, cmd: { t: "buildHouse", vertex: vs[pk.pick(vs.length)]! } });
    }
    if (L.bankTrade.give.length && L.bankTrade.get.length) {
      moves.push({ actor: a, cmd: { t: "bankTrade", give: L.bankTrade.give[pk.pick(L.bankTrade.give.length)]!, get: L.bankTrade.get[pk.pick(L.bankTrade.get.length)]! } });
    }
    for (const h of L.harborTrade) {
      if (h.give.length && h.get.length) {
        moves.push({ actor: a, cmd: { t: "harborTrade", vertex: h.vertex, give: h.give[pk.pick(h.give.length)]!, get: h.get[pk.pick(h.get.length)]! } });
      }
    }
    if (L.buyCard.enabled) {
      const ks = L.buyCard.value.kinds;
      moves.push({ actor: a, cmd: { t: "buyCard", kind: ks[pk.pick(ks.length)]! } });
    }
    if (L.buyProduct.enabled) {
      const ps = L.buyProduct.value.products;
      moves.push({ actor: a, cmd: { t: "buyProduct", product: ps[pk.pick(ps.length)]! } });
    }
    // 交換の申し出（持っている物から1つ出し、相手の持ち物から1つ求める）
    for (const to of L.tradePartners) {
      const give = someGoods(pk, s, me);
      const get = someGoods(pk, s, to);
      if (give && get) moves.push({ actor: a, cmd: { t: "proposeTrade", to, give, get } });
    }
    for (const tr of s.trades) {
      if (tr.to === me) moves.push({ actor: a, cmd: { t: "respondTrade", id: tr.id, accept: pk.pick(2) === 0 } });
      if (tr.from === me && pk.pick(4) === 0) moves.push({ actor: a, cmd: { t: "withdrawTrade", id: tr.id } });
    }
    for (const kind of ["word", "talk"] as const) {
      for (const h of L.japanese[kind]) {
        if (h.enabled && pk.pick(8) === 0) moves.push({ actor: a, cmd: { t: "payJapanese", kind, method: h.value } });
      }
    }
    if (L.japanese.undeclared.enabled && pk.pick(16) === 0) moves.push({ actor: a, cmd: { t: "payJapanese", kind: "undeclared", method: "coin" } });
    if (L.endTurn?.enabled) {
      // 手番の終わりを選びやすくし、ゲームが上限の操作数までに終わるようにする
      const end: Move = { actor: a, cmd: { t: "endTurn" } };
      const k = Math.max(1, Math.ceil(moves.length / 2));
      for (let i = 0; i < k; i++) moves.push(end);
    }
  }
  return moves;
}

function someGoods(pk: Picker, s: GameState, st: Seat) {
  const p = s.players[st]!;
  const opts: (() => { cards: Bag<WordCard>; products: Bag<Product>; coins: number })[] = [];
  const cardKeys = bagKeys(p.hand);
  if (cardKeys.length) opts.push(() => ({ cards: { [cardKeys[pk.pick(cardKeys.length)]!]: 1 }, products: {}, coins: 0 }));
  const prodKeys = PRODUCTS.filter((x) => bagGet(p.products, x) > 0);
  if (prodKeys.length) opts.push(() => ({ cards: {}, products: { [prodKeys[pk.pick(prodKeys.length)]!]: 1 }, coins: 0 }));
  if (p.coins > 0) opts.push(() => ({ cards: {}, products: {}, coins: 1 }));
  if (!opts.length) return null;
  return opts[pk.pick(opts.length)]!();
}
