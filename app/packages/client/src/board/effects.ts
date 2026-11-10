// 大画面の演出（BD04 6章）。届いた出来事から、短い間だけ出す見た目の状態を作る。
// 演出は1つ1.5秒以内（宣言の結果を待つ約3秒を除く）で、演出の間も操作を止めない。
import { useEffect, useRef, useState } from "react";
import type { BoardView, GameEvent } from "@word-farm/protocol";
import type { OrderCondition } from "@word-farm/engine";
import type { Net } from "../net/useNet.ts";

export interface Ghost {
  id: string;
  key: string;
  text: string;
  label: string;
  kind: "expired" | "done";
}

export interface Fx {
  banner: { text: string; sub?: string } | null;
  dice: { a: number; b: number; spin: boolean } | null;
  floats: Record<number, { key: string; text: string }[]>;
  glowHand: number[];
  pulseSeat: number | null;
  flashPlots: Record<number, number[]>;
  bounceVertex: number | null;
  /** 宣言した注文のカード。手前に大きく出す（BD04 6章 orderDeclared） */
  declared: { orderId: string; text: string } | null;
  reveal: { orderId: string; text: string; ok: boolean; cond: string; points: string } | null;
  flipIn: string[];
  ghosts: Ghost[];
  jointPop: { jointId: string; row: number } | null;
  /** ゲームの終わりの演出の間は、結果の画面に切り替えずに勝者の名前を出す */
  holdResult: boolean;
}

const EMPTY: Fx = {
  banner: null,
  dice: null,
  floats: {},
  glowHand: [],
  pulseSeat: null,
  flashPlots: {},
  bounceVertex: null,
  declared: null,
  reveal: null,
  flipIn: [],
  ghosts: [],
  jointPop: null,
  holdResult: false,
};

/** 宣言のあとに開く条件の文（BD02 1章の条件を、人が読める形にする） */
export function condText(c: OrderCondition): string {
  const bag = (b: Record<string, number | undefined>) =>
    Object.entries(b)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k} ${n}`)
      .join("、");
  switch (c.k) {
    case "exact":
      return bag(c.items);
    case "total":
      return `${c.allowed.join("・")} を合わせて ${c.total}`;
    case "same":
      return `${c.pair.join(" と ")} を同じ数（${c.min}以上）`;
    case "animals":
      return `動物 ${c.min}頭以上${c.include ? `（${c.include} を含む）` : ""}`;
    case "bonus":
      return `${c.accepted.join("・")} のどれか1種類`;
  }
}

let seq = 0;
const key = () => `fx${++seq}`;

export function useBoardFx(net: Net, view: BoardView): Fx {
  const [fx, setFx] = useState<Fx>(EMPTY);
  // 消えた注文の英文を、ゴーストとして出すために覚えておく
  const texts = useRef(new Map<string, string>());
  for (const o of view.orders.faceUp) texts.current.set(o.id, o.text);
  for (const j of view.joint.faceUp) texts.current.set(j.id, j.text);
  const name = (s: number) => view.players[s]?.name ?? `席${s}`;
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const m = net.last;
    if (m?.t !== "view" || m.events.length === 0) return;
    const later = (ms: number, f: (x: Fx) => Fx) => window.setTimeout(() => setFx(f), ms);
    for (const e of m.events) apply(e);

    function apply(e: GameEvent): void {
      switch (e.k) {
        case "seatsAssigned": {
          const start = e.seats.find((s) => s.seat === 0);
          const text = start ? `${nameRef.current(0)} が開始プレイヤーです` : "ゲームを始めます";
          setFx((x) => ({ ...x, banner: { text } }));
          later(2500, (x) => ({ ...x, banner: null }));
          return;
        }
        case "housePlaced":
        case "houseBuilt":
          setFx((x) => ({ ...x, bounceVertex: e.vertex }));
          later(900, (x) => ({ ...x, bounceVertex: null }));
          return;
        case "cardsGranted": {
          const k = key();
          const text = `＋${Object.entries(e.cards)
            .map(([c, n]) => (n === 1 ? c : `${c}×${n}`))
            .join(" ")}`;
          setFx((x) => ({ ...x, floats: addFloat(x.floats, e.seat, k, text), glowHand: [...x.glowHand, e.seat] }));
          later(1500, (x) => ({ ...x, floats: dropFloat(x.floats, e.seat, k), glowHand: x.glowHand.filter((s) => s !== e.seat) }));
          return;
        }
        case "diceRolled": {
          const [a, b] = e.dice;
          setFx((x) => ({ ...x, dice: { a, b, spin: true } }));
          later(700, (x) => ({ ...x, dice: x.dice ? { ...x.dice, spin: false } : null }));
          later(2200, (x) => ({ ...x, dice: null }));
          if (a + b === 7) {
            setFx((x) => ({ ...x, banner: { text: "Market day", sub: "全員が好きなカードを1枚もらえます" } }));
            later(1500, (x) => ({ ...x, banner: null }));
          }
          return;
        }
        case "harvested":
        case "fed": {
          const k = key();
          const text = e.k === "harvested" ? `＋${e.crop}×${e.n}` : `＋${e.product}×${e.n}`;
          setFx((x) => ({ ...x, floats: addFloat(x.floats, e.seat, k, text), flashPlots: addPlot(x.flashPlots, e.seat, e.plot) }));
          later(1500, (x) => ({ ...x, floats: dropFloat(x.floats, e.seat, k), flashPlots: dropPlot(x.flashPlots, e.seat, e.plot) }));
          return;
        }
        case "planted":
        case "animalBought":
        case "animalSold":
          setFx((x) => ({ ...x, flashPlots: addPlot(x.flashPlots, e.seat, e.plot) }));
          later(1200, (x) => ({ ...x, flashPlots: dropPlot(x.flashPlots, e.seat, e.plot) }));
          return;
        case "orderDeclared":
          setFx((x) => ({ ...x, declared: { orderId: e.orderId, text: texts.current.get(e.orderId) ?? "" } }));
          return;
        case "orderSucceeded":
        case "orderFailed": {
          const ok = e.k === "orderSucceeded";
          const reveal = { orderId: e.orderId, text: texts.current.get(e.orderId) ?? "", ok, cond: condText(e.cond), points: e.hp === null ? "ボーナス" : `${e.hp / 2}点` };
          // 宣言の英文を聞く間をとり、約3秒後に条件を開く。不成立なら開いたあとで閉じる（BD04 2.4、6章）
          later(3000, (x) => ({ ...x, reveal, declared: null }));
          later(3000 + 2500, (x) => ({ ...x, reveal: x.reveal?.orderId === e.orderId ? null : x.reveal }));
          return;
        }
        case "ordersRevealed": {
          const ids = e.orders.map((o) => o.id);
          setFx((x) => ({ ...x, flipIn: [...x.flipIn, ...ids] }));
          later(1500, (x) => ({ ...x, flipIn: x.flipIn.filter((i) => !ids.includes(i)) }));
          return;
        }
        case "jointRevealed":
          setFx((x) => ({ ...x, flipIn: [...x.flipIn, e.jointId] }));
          later(1500, (x) => ({ ...x, flipIn: x.flipIn.filter((i) => i !== e.jointId) }));
          return;
        case "orderExpired":
        case "jointExpired": {
          const id = e.k === "orderExpired" ? e.orderId : e.jointId;
          const g: Ghost = { id, key: key(), text: texts.current.get(id) ?? "", label: "時間切れ", kind: "expired" };
          setFx((x) => ({ ...x, ghosts: [...x.ghosts, g] }));
          later(1500, (x) => ({ ...x, ghosts: x.ghosts.filter((y) => y.key !== g.key) }));
          return;
        }
        case "jointRowFilled":
          setFx((x) => ({ ...x, jointPop: { jointId: e.jointId, row: e.row } }));
          later(900, (x) => ({ ...x, jointPop: null }));
          return;
        case "jointCompleted": {
          const pts = e.rows.map((r) => `${nameRef.current(r.seat)} ＋${r.hp / 2}`).join("　");
          const g: Ghost = { id: e.jointId, key: key(), text: texts.current.get(e.jointId) ?? "", label: `完成！ ${pts}　${nameRef.current(e.finisher)} ＋${e.finishHp / 2}`, kind: "done" };
          setFx((x) => ({ ...x, ghosts: [...x.ghosts, g] }));
          later(2500, (x) => ({ ...x, ghosts: x.ghosts.filter((y) => y.key !== g.key) }));
          return;
        }
        case "turnStarted":
          setFx((x) => ({ ...x, pulseSeat: e.seat }));
          later(1500, (x) => ({ ...x, pulseSeat: null }));
          return;
        case "gameOver": {
          const r = e.result;
          const text = r.reason === "target" && r.winnerSeat !== null ? `${nameRef.current(r.winnerSeat)} の勝ち！` : "ゲーム終了";
          setFx((x) => ({ ...x, banner: { text }, holdResult: true }));
          later(2500, (x) => ({ ...x, banner: null, holdResult: false }));
          return;
        }
        default:
          return;
      }
    }
  }, [net.last]);

  return fx;
}

function addFloat(f: Fx["floats"], seat: number, key: string, text: string): Fx["floats"] {
  return { ...f, [seat]: [...(f[seat] ?? []), { key, text }] };
}
function dropFloat(f: Fx["floats"], seat: number, key: string): Fx["floats"] {
  return { ...f, [seat]: (f[seat] ?? []).filter((x) => x.key !== key) };
}
function addPlot(f: Fx["flashPlots"], seat: number, plot: number): Fx["flashPlots"] {
  return { ...f, [seat]: [...(f[seat] ?? []), plot] };
}
function dropPlot(f: Fx["flashPlots"], seat: number, plot: number): Fx["flashPlots"] {
  return { ...f, [seat]: (f[seat] ?? []).filter((x) => x !== plot) };
}

/** 数が変わったとき、前の値から数え上げる（コインの演出） */
export function useCountUp(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value) return;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setShown(Math.round(a + (value - a) * k));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}
