// 点の計算（BD02 3章、2.3）。千分の一点の整数で計算し、半点の整数に丸める。
import { bagGet } from "../bag.ts";
import type { Bag, HalfPoints, OrderCondition, Product } from "../types.ts";
import { PRODUCTS } from "../types.ts";

/** 産物1つあたりの重み（千分の一点） */
const WEIGHT: Record<Product, number> = { carrot: 400, potato: 400, wheat: 400, milk: 400, egg: 450 };

/**
 * ルールブック08章の式。
 *   e = 300 + Σ(重み × 数) + 300 × (種類の数 − 1) + (難なら 500)
 *   半点 = floor((2e + 500) / 1000) を 1〜6 に収める
 */
export function orderHalfPoints(items: Bag<Product>, hard: boolean): HalfPoints {
  const kinds = PRODUCTS.filter((p) => bagGet(items, p) > 0);
  let e = 300 + 300 * (kinds.length - 1) + (hard ? 500 : 0);
  for (const p of kinds) e += WEIGHT[p] * bagGet(items, p);
  const hp = Math.floor((2 * e + 500) / 1000);
  return Math.min(6, Math.max(1, hp));
}

/** 条件の形ごとの点（BD02 3.1 の表）。ボーナス注文は null */
export function conditionHalfPoints(cond: OrderCondition, hard: boolean, animalInclude: boolean): HalfPoints | null {
  switch (cond.k) {
    case "exact":
      return orderHalfPoints(cond.items, hard);
    case "total":
      return orderHalfPoints({ [cond.allowed[0]!]: cond.total }, true);
    case "same":
      return orderHalfPoints({ [cond.pair[0]]: cond.min, [cond.pair[1]]: cond.min }, true);
    case "animals":
      return animalHalfPoints(cond.min, animalInclude && cond.include !== null);
    case "bonus":
      return null;
  }
}

/** 動物の頭数の注文。2頭以上1.5点、3頭以上2.5点。指定ありなら0.5点を足し、3点を上限とする */
export function animalHalfPoints(min: number, include: boolean): HalfPoints {
  const base = min >= 3 ? 5 : 3;
  return Math.min(6, base + (include ? 1 : 0));
}

/** ボーナス注文（BD02 2.3）。卵は floor(n/2)、そのほかは floor(2n/5) 半点。コインは n */
export function bonusHalfPoints(p: Product, n: number): HalfPoints {
  return p === "egg" ? Math.floor(n / 2) : Math.floor((2 * n) / 5);
}

/** 共同注文の行（BD02 3.2）。難の加算はない */
export function jointLineHalfPoints(p: Product, n: number): HalfPoints {
  return orderHalfPoints({ [p]: n }, false);
}
