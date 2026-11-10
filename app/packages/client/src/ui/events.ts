// 出来事を、大画面の下の帯とスマホの短い表示に出す文にする（BD04 6章）。
import type { GameEvent } from "@word-farm/protocol";

type Names = (seat: number) => string;

const bag = (b: Record<string, number | undefined>) =>
  Object.entries(b)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`)
    .join("、");

const goods = (g: { cards: Record<string, number | undefined>; products: Record<string, number | undefined>; coins: number }) =>
  [bag(g.cards), bag(g.products), g.coins ? `コイン ${g.coins}` : ""].filter(Boolean).join("、") || "なし";

/** 下の帯に出す文。出さない出来事は null */
export function eventText(e: GameEvent, name: Names): string | null {
  switch (e.k) {
    case "seatsAssigned":
      return null;
    case "housePlaced":
      return `${name(e.seat)} が拠点を置きました`;
    case "cardsGranted":
      return null;
    case "diceRolled":
      return `${name(e.seat)} の出目 ${e.dice[0]} ＋ ${e.dice[1]} ＝ ${e.dice[0] + e.dice[1]}${e.dice[0] + e.dice[1] === 7 ? "　Market day" : ""}`;
    case "cardsDiscarded":
      return `${name(e.seat)} が捨てました：${bag(e.cards)}`;
    case "planted":
    case "animalBought":
    case "fed":
    case "productsSold":
    case "animalSold":
    case "houseBuilt":
    case "jointRowFilled":
    case "orderDeclared":
      return `${name(e.seat)}：${e.sentence}`;
    case "orderSucceeded":
      return `${name(e.seat)} の注文が成立しました（${e.hp / 2}点）`;
    case "orderFailed":
      return `${name(e.seat)} の注文は不成立でした`;
    case "ordersRevealed":
      return e.reason === "round3" ? "注文を3枚表にしました" : "注文を補充しました";
    case "orderExpired":
      return "注文が時間切れで流れました";
    case "jointCompleted":
      return `共同注文が完成しました（${name(e.finisher)} が完成させました）`;
    case "jointExpired":
      return "共同注文が時間切れで流れました";
    case "bankTraded":
      return `${name(e.seat)} が銀行で交換しました：${e.give} ${e.n} → ${e.get}`;
    case "harborTraded":
      return `${name(e.seat)} が港で交換しました：${e.give} ${e.n} → ${e.get}`;
    case "cardBought":
      return `${name(e.seat)} が ${e.kind} を買いました（${e.coins}コイン）`;
    case "productBought":
      return `${name(e.seat)} が ${e.product} を買いました（${e.coins}コイン）`;
    case "tradeProposed":
      return `${name(e.offer.from)} → ${name(e.offer.to)}：${goods(e.offer.give)} ⇄ ${goods(e.offer.get)}`;
    case "tradeAccepted":
      return `交換が成立しました：${name(e.from)} ${goods(e.give)} ⇄ ${name(e.to)} ${goods(e.get)}`;
    case "tradeDeclined":
      return "交換の申し出は断られました";
    case "japanesePaid":
      return `${name(e.seat)}：日本語（${{ word: "単語", talk: "交渉", undeclared: "言ってしまった" }[e.kind]}）${e.method === "ticket" ? "無料券" : `${e.coins}コイン`}`;
    case "turnStarted":
      return `${name(e.seat)} の手番です（ラウンド ${e.round}）`;
    case "endFlagged":
      return e.reason === "host" ? "最終ラウンドです（ホストの宣言）" : "最終ラウンドです（注文切れ）";
    case "paused":
      return "一時停止中です";
    case "resumed":
      return "再開しました";
    case "undone":
      return `ホストが取り消しました：${e.summary}`;
    case "gameOver":
      return "ゲームが終わりました";
    default:
      return null;
  }
}
