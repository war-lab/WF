// スマホの演出（BD04 6章。音は鳴らさない）。自分の手札、産物、コイン、農場の変化を、物の動きで見せる。
// 増えた物は画面の上から飛んできて収まり、減った物は上へ飛んで消える。表示中のタブにない物は飛ばさない。
import { useEffect, useRef } from "react";
import type { PlayerView } from "@word-farm/protocol";
import { bump, burst, fly } from "../ui/fly.ts";

const top = () => ({ x: window.innerWidth / 2, y: -50 });

export function usePhoneFx(view: PlayerView): void {
  const me = view.players[view.me.seat];
  const prev = useRef<{ hand: Record<string, number>; prod: Record<string, number>; coins: number; plots: string[] } | null>(null);
  const hand = view.me.hand as Record<string, number | undefined>;
  const prod = (me?.products ?? {}) as Record<string, number | undefined>;
  const plots = (me?.plots ?? []).map((p) => (p.t === "empty" ? "" : p.t === "crop" ? p.crop : p.animal));
  const sig = JSON.stringify([hand, prod, me?.coins, plots]);
  useEffect(() => {
    const now = {
      hand: Object.fromEntries(Object.entries(hand).map(([k, n]) => [k, n ?? 0])),
      prod: Object.fromEntries(Object.entries(prod).map(([k, n]) => [k, n ?? 0])),
      coins: me?.coins ?? 0,
      plots,
    };
    const was = prev.current;
    prev.current = now;
    if (!was) return; // 最初の表示では動かさない
    let i = 0;
    for (const k of new Set([...Object.keys(now.hand), ...Object.keys(was.hand)])) {
      const d = (now.hand[k] ?? 0) - (was.hand[k] ?? 0);
      const slot = `.cards [data-card="${k}"] .wcard`;
      for (let j = 0; j < Math.min(Math.abs(d), 4); j++, i++) {
        if (d > 0) fly({ k: "card", kind: k, w: 60 }, top(), slot, { delay: i * 110, ms: 560, bump: slot });
        else fly({ k: "card", kind: k, w: 60 }, slot, top(), { delay: i * 90, ms: 480, shrink: true });
      }
    }
    for (const k of new Set([...Object.keys(now.prod), ...Object.keys(was.prod)])) {
      const d = (now.prod[k] ?? 0) - (was.prod[k] ?? 0);
      const slot = `.cards [data-product="${k}"] .disc`;
      for (let j = 0; j < Math.min(Math.abs(d), 4); j++, i++) {
        const sp = { k: "img" as const, src: `/art/product-${k}.webp`, size: 44 };
        if (d > 0) fly(sp, top(), slot, { delay: i * 110, ms: 560, bump: slot });
        else fly(sp, slot, top(), { delay: i * 90, ms: 480, shrink: true });
      }
    }
    if (now.coins !== was.coins) bump(".money img");
    now.plots.forEach((p, idx) => {
      if (p !== was.plots[idx]) {
        const el = `.farm [data-plot="${idx}"]`;
        burst(el, p ? "puff" : "sparkle", { n: 6, spread: 50 });
        bump(`${el} img`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
