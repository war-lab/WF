// Bag（0の項目を持たない数の入れ物。BD01 2.1）の操作
import type { Bag } from "./types.ts";

export function bagGet<K extends string>(b: Bag<K>, k: K): number {
  return b[k] ?? 0;
}

/** 数を足す。0になった項目は消す */
export function bagAdd<K extends string>(b: Bag<K>, k: K, n: number): void {
  const v = (b[k] ?? 0) + n;
  if (v < 0) throw new Error(`bagAdd: ${k} が負になる`);
  if (v === 0) delete b[k];
  else b[k] = v;
}

export function bagTotal<K extends string>(b: Bag<K>): number {
  let t = 0;
  for (const k in b) t += b[k] ?? 0;
  return t;
}

/** a が b を含むか（各項目で a ≥ b） */
export function bagContains<K extends string>(a: Bag<K>, b: Bag<K>): boolean {
  for (const k in b) if ((a[k] ?? 0) < (b[k] ?? 0)) return false;
  return true;
}

export function bagKeys<K extends string>(b: Bag<K>): K[] {
  return (Object.keys(b) as K[]).filter((k) => (b[k] ?? 0) > 0);
}

/** 値がすべて0以上の整数で、鍵が許す一覧に含まれるか。0の項目は許し、保存する前に bagNormalize で除く */
export function bagValid<K extends string>(b: unknown, keys: readonly K[]): b is Bag<K> {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  for (const [k, v] of Object.entries(b)) {
    if (!(keys as readonly string[]).includes(k)) return false;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return false;
  }
  return true;
}

/** 0の項目を除いた写し */
export function bagNormalize<K extends string>(b: Bag<K>): Bag<K> {
  const out: Bag<K> = {};
  for (const k in b) if ((b[k] ?? 0) > 0) out[k] = b[k];
  return out;
}
