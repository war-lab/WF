// 印刷用の固定の山（BD02 5.4）。data/fixed_v0_9.json を読み、点は計算式で求める。
import raw from "../data/fixed_v0_9.json" with { type: "json" };
import type { JointLine, JointOrder, Order, OrderCondition, OrderLevel, Product } from "../types.ts";
import { conditionHalfPoints, jointLineHalfPoints } from "./points.ts";

export interface FixedOrderRow {
  no: number;
  text: string;
  level: OrderLevel;
  picture: Product | null;
  to: string | null;
  cond: OrderCondition;
  /** ルールブックに書かれた点。ボーナス注文は null */
  points: number | null;
}

export interface FixedJointRow {
  no: number;
  text: string;
  to: string;
  lines: { product: Product; n: number; points: number }[];
}

export const fixedData = raw as unknown as { orders: FixedOrderRow[]; joints: FixedJointRow[] };

/** 「難」として計算するか。半ダース、合計、同数（BD02 付録 A） */
function isHard(row: FixedOrderRow): boolean {
  return row.level === "hard";
}

export function fixedOrders(): Order[] {
  return fixedData.orders.map((row) => ({
    id: `o${String(row.no).padStart(2, "0")}`,
    text: row.text,
    level: row.level,
    isBonus: row.level === "bonus",
    picture: row.picture,
    to: row.to,
    cond: structuredClone(row.cond),
    // 印刷用の動物の注文には指定がないため、animalInclude によらず指定なしの点にする
    hp: conditionHalfPoints(row.cond, isHard(row), false),
    source: { mode: "fixed", printedNo: row.no },
  }));
}

export function fixedJoints(): JointOrder[] {
  return fixedData.joints.map((row) => ({
    id: `j${String(row.no).padStart(3, "0")}`,
    text: row.text,
    to: row.to,
    lines: row.lines.map((l) => ({ product: l.product, n: l.n, hp: jointLineHalfPoints(l.product, l.n) })) as [
      JointLine,
      JointLine,
      JointLine,
    ],
    source: { mode: "fixed", printedNo: row.no },
  }));
}
