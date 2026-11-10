// 大画面で、出来事ごとに物を飛ばす振り付け（BD04 6章の表を、物の動きで補う）。
// 出どころと行き先は画面の要素から取る。要素が見つからない（画面の外、結果の画面など）ときは飛ばさない。
// 1つの演出は1.5秒以内に収める。宣言の結果を含むメッセージは、画面を宣言の前に留める約3秒が明けてから
// まとめて始める（呼ぶ側の useBoardFx が遅らせる。BD04 6章）。
import { board } from "@word-farm/engine";
import type { GameEvent } from "@word-farm/protocol";
import { burst, bump, fly, flyMany, shake, type Sprite } from "../ui/fly.ts";

const MARKET_TILE = board.tiles.find((t) => t.number === null)?.id;

const $ = {
  tile: (id: number | null | undefined) => (id === null || id === undefined ? null : `.board-map [data-tile="${id}"]`),
  market: () => `.board-map [data-tile="${MARKET_TILE}"]`,
  deck: () => "[data-deck] .wcard",
  harbor: (v: number) => `.board-map [data-harbor="${v}"]`,
  house: (v: number) => `.board-map [data-house="${v}"]`,
  hand: (s: number) => `.pp[data-seat="${s}"] .hand .wcard`,
  coins: (s: number) => `.pp[data-seat="${s}"] .coins img`,
  prod: (s: number, k: string) => `.pp[data-seat="${s}"] .prod [data-product="${k}"] img`,
  plot: (s: number, i: number) => `.pp[data-seat="${s}"] .plots [data-plot="${i}"]`,
  pts: (s: number) => `.pp[data-seat="${s}"] .pts`,
  // 成立した注文は、結果を出す時にはもう列にない（補充で入れ替わる）。そのときは中央に出した結果のカードを使う
  order: (id: string) => (document.querySelector(`[data-order="${id}"]`) ? `[data-order="${id}"]` : ".fx-focus"),
  joint: (id: string) => `[data-joint="${id}"]`,
};

const card = (kind: string): Sprite => ({ k: "card", kind, w: 64 });
const product = (k: string): Sprite => ({ k: "img", src: `/art/product-${k}.webp`, size: 58 });
const coin: Sprite = { k: "coin", size: 42 };
const later = (ms: number, f: () => void) => window.setTimeout(f, ms);

/** カードの袋を、1枚ずつの並びにする（多すぎるときは max 枚まで） */
function cardList(b: Partial<Record<string, number>>, max = 6): string[] {
  const out: string[] = [];
  for (const [k, n] of Object.entries(b)) for (let i = 0; i < (n ?? 0); i++) out.push(k);
  return out.slice(0, max);
}

/** カードを手札へ。出どころで生まれてから飛ぶ。手札の枚数は最後の1枚が届くまで据え置く */
function cardsTo(seat: number, kinds: string[], total: number, from: string | null, delay = 0): void {
  kinds.forEach((k, i) => {
    const last = i === kinds.length - 1;
    fly(card(k), from, $.hand(seat), {
      delay: delay + i * 110,
      ms: 750,
      spawn: true,
      linger: 350,
      shrink: true,
      hold: { seat, key: "hand", n: last ? total - (kinds.length - 1) : 1 },
      bump: last ? $.hand(seat) : undefined,
    });
  });
}

/** 手札からカードを出す（払う、捨てる）。手札の枚数はすでに減っているので据え置かない */
function cardsFrom(seat: number, kinds: string[], to: string | null, delay = 0, onLand?: () => void): void {
  kinds.forEach((k, i) => fly(card(k), $.hand(seat), to, { delay: delay + i * 90, ms: 520, shrink: true, onLand: i === kinds.length - 1 ? onLand : undefined }));
}

/** コインを n 枚ぶん（見た目は最大6枚）飛ばす。受け取る側なら届くまで据え置く */
function coinsMove(n: number, from: string | null, to: string | null, o: { delay?: number; recvSeat?: number } = {}): void {
  if (n <= 0) return;
  flyMany(n, () => coin, from, to, {
    delay: o.delay,
    gap: 70,
    max: 6,
    ms: 560,
    shrink: true,
    hold: o.recvSeat === undefined ? undefined : { seat: o.recvSeat, key: "coins", n },
    bump: to ?? undefined,
  });
}

/** 産物を n 個ぶん飛ばす。受け取る側なら届くまで据え置く */
function productsMove(k: string, n: number, from: string | null, to: string | null, o: { delay?: number; recvSeat?: number; spawn?: boolean } = {}): void {
  if (n <= 0) return;
  flyMany(n, () => product(k), from, to, {
    delay: o.delay,
    gap: 100,
    max: 5,
    ms: 620,
    spawn: o.spawn,
    shrink: true,
    hold: o.recvSeat === undefined ? undefined : { seat: o.recvSeat, key: `product:${k}`, n },
    bump: to ?? undefined,
  });
}

/** 点を星にして、出どころから点の欄へ飛ばす。点は届くまで据え置く */
function pointsTo(seat: number, hp: number, from: string | null, delay = 0): void {
  if (hp <= 0) return;
  const stars = Math.min(4, Math.max(1, Math.ceil(hp / 2)));
  flyMany(stars, () => ({ k: "star", size: 40 }), from, $.pts(seat), { delay, gap: 120, max: 4, ms: 700, spawn: true, shrink: true, hold: { seat, key: "pts", n: hp }, bump: $.pts(seat) });
}

// 宣言の結果を含むメッセージの出来事は、画面を宣言の前に留める間ためておき、留めを解く描画の直後に流す。
// 時計で合わせると、解く描画と飛ばし始めの間に新しい数字が一瞬見える（2026-11-10 の録画で、点が 1.5→0→1.5 とちらついた）
let held: GameEvent[] = [];
let heldTimer = 0;
export function holdUntilRelease(events: GameEvent[]): void {
  held.push(...events);
  // 解く描画が来なかったとき（画面を離れたなど）の保険
  window.clearTimeout(heldTimer);
  heldTimer = window.setTimeout(releaseHeld, 4000);
}
/** 留めを解いた描画の直後（画面に出す前）に呼ぶ。BoardGame の useLayoutEffect から */
export function releaseHeld(): void {
  window.clearTimeout(heldTimer);
  const evs = held;
  held = [];
  evs.forEach(choreograph);
}

/** 届いた出来事1つぶんの振り付け */
export function choreograph(e: GameEvent): void {
  switch (e.k) {
    case "housePlaced":
      later(80, () => burst($.house(e.vertex), "puff", { n: 7 }));
      return;
    case "houseBuilt":
      coinsMove(e.coins, $.coins(e.seat), $.house(e.vertex));
      later(500, () => burst($.house(e.vertex), "puff", { n: 7 }));
      return;
    case "cardsGranted": {
      const kinds = cardList(e.cards);
      const total = Object.values(e.cards).reduce<number>((a, b) => a + (b ?? 0), 0);
      // 収入はサイコロが止まってから、そのタイルから生まれる。ほかは山から
      const fromTile = e.tile !== null ? $.tile(e.tile) : null;
      cardsTo(e.seat, kinds, total, fromTile ?? $.deck(), e.reason === "income" ? 1100 : 0);
      if (fromTile && e.reason === "income") later(1060, () => burst(fromTile, "sparkle", { n: 8 }));
      return;
    }
    case "cardsDiscarded":
      cardsFrom(e.seat, cardList(e.cards), $.deck());
      return;
    case "harvested":
      burst($.plot(e.seat, e.plot), "sparkle", { n: 6, spread: 50 });
      productsMove(e.crop, e.n, $.plot(e.seat, e.plot), $.prod(e.seat, e.crop), { recvSeat: e.seat, spawn: true, delay: 150 });
      return;
    case "planted":
      cardsFrom(e.seat, ["grow", e.crop], $.plot(e.seat, e.plot), 0, () => {
        burst($.plot(e.seat, e.plot), "puff", { n: 6, spread: 40 });
        bump($.plot(e.seat, e.plot));
      });
      return;
    case "animalBought":
      cardsFrom(e.seat, ["buy", e.animal], $.plot(e.seat, e.plot), 0, () => {
        burst($.plot(e.seat, e.plot), "puff", { n: 6, spread: 40 });
        bump($.plot(e.seat, e.plot));
      });
      coinsMove(e.coins, $.coins(e.seat), $.market(), { delay: 200 });
      return;
    case "fed":
      cardsFrom(e.seat, ["feed"], $.plot(e.seat, e.plot), 0, () => burst($.plot(e.seat, e.plot), "sparkle", { n: 5, spread: 40 }));
      productsMove(e.product, e.n, $.plot(e.seat, e.plot), $.prod(e.seat, e.product), { recvSeat: e.seat, spawn: true, delay: 520 });
      return;
    case "productsSold":
      cardsFrom(e.seat, ["sell"], $.market());
      productsMove(e.product, e.n, $.prod(e.seat, e.product), $.market(), { delay: 120 });
      coinsMove(e.coins, $.market(), $.coins(e.seat), { delay: 650, recvSeat: e.seat });
      return;
    case "animalSold":
      cardsFrom(e.seat, ["sell"], $.market());
      fly({ k: "img", src: `/art/farm-${e.animal}.webp`, size: 60 }, $.plot(e.seat, e.plot), $.market(), { delay: 120, ms: 600, shrink: true });
      coinsMove(e.coins, $.market(), $.coins(e.seat), { delay: 650, recvSeat: e.seat });
      return;
    case "cardBought":
      coinsMove(e.coins, $.coins(e.seat), $.market());
      cardsTo(e.seat, [e.kind], 1, $.deck(), 450);
      return;
    case "productBought":
      coinsMove(e.coins, $.coins(e.seat), $.market());
      productsMove(e.product, 1, $.market(), $.prod(e.seat, e.product), { delay: 450, recvSeat: e.seat, spawn: true });
      return;
    case "bankTraded":
      cardsFrom(e.seat, cardList({ [e.give]: e.n }), $.market());
      cardsTo(e.seat, [e.get], 1, $.market(), 500);
      return;
    case "harborTraded":
      cardsFrom(e.seat, cardList({ [e.give]: e.n }), $.harbor(e.vertex));
      cardsTo(e.seat, [e.get], 1, $.harbor(e.vertex), 500);
      return;
    case "tradeAccepted": {
      // from が出す物（give）を to へ、to が出す物（get）を from へ。互いに行き違う
      const send = (g: typeof e.give, a: number, b: number, delay: number) => {
        const kinds = cardList(g.cards, 4);
        const total = Object.values(g.cards).reduce<number>((x, y) => x + (y ?? 0), 0);
        if (kinds.length) cardsTo(b, kinds, total, $.hand(a), delay);
        for (const [k, n] of Object.entries(g.products)) productsMove(k, n ?? 0, $.prod(a, k), $.prod(b, k), { delay, recvSeat: b });
        coinsMove(g.coins, $.coins(a), $.coins(b), { delay, recvSeat: b });
      };
      send(e.give, e.from, e.to, 0);
      send(e.get, e.to, e.from, 150);
      return;
    }
    case "japanesePaid":
      if (e.method === "coin") coinsMove(e.coins, $.coins(e.seat), $.market());
      return;
    case "orderSucceeded":
      // 産物を注文へ届け、点の星とコインを返す
      {
        // 点とコインの据え置きは今すぐ始め、飛ぶ物だけを遅らせる（遅らせて呼ぶと、その間に新しい数字が見える）
        const at = $.order(e.orderId);
        Object.entries(e.items).forEach(([k, n], i) => productsMove(k, n ?? 0, $.prod(e.seat, k), at, { delay: i * 120 }));
        later(550, () => {
          burst(at, "sparkle", { n: 12, spread: 120 });
          burst(at, "confetti", { n: 20, spread: 160 });
        });
        pointsTo(e.seat, e.hp, at, 700);
        coinsMove(e.coins, at, $.coins(e.seat), { delay: 850, recvSeat: e.seat });
      }
      return;
    case "orderFailed":
      shake($.order(e.orderId));
      return;
    case "ordersRevealed":
      e.orders.forEach((o, i) => later(i * 150, () => burst($.order(o.id), "sparkle", { n: 6, spread: 90 })));
      return;
    case "jointRevealed":
      burst($.joint(e.jointId), "sparkle", { n: 6, spread: 90 });
      return;
    case "orderExpired":
      burst($.order(e.orderId), "puff", { n: 8, spread: 90 });
      return;
    case "jointExpired":
      burst($.joint(e.jointId), "puff", { n: 8, spread: 90 });
      e.rows.forEach((r, i) => pointsTo(r.seat, r.hp, $.joint(e.jointId), 300 + i * 150));
      return;
    case "jointRowFilled":
      productsMove(e.product, e.n, $.prod(e.seat, e.product), $.joint(e.jointId));
      return;
    case "jointCompleted":
      burst($.joint(e.jointId), "sparkle", { n: 12, spread: 120 });
      burst($.joint(e.jointId), "confetti", { n: 20, spread: 160 });
      e.rows.forEach((r, i) => pointsTo(r.seat, r.hp, $.joint(e.jointId), 300 + i * 150));
      pointsTo(e.finisher, e.finishHp, $.joint(e.jointId), 300 + e.rows.length * 150);
      return;
    case "gameOver":
      for (let i = 0; i < 3; i++) later(i * 350, () => burst({ x: window.innerWidth * (0.25 + 0.25 * i), y: window.innerHeight * 0.35 }, "confetti", { n: 36, spread: 320 }));
      return;
    default:
      return;
  }
}
