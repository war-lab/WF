// 乱数生成器（BD02 4章）。xoshiro128**。状態は32ビットの整数4つで、JSON にそのまま保存できる。
// 関数は状態を書き換える。エンジンは apply の初めに状態を写してから使うため、元の状態は変わらない。
import type { RngState } from "./types.ts";

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** 32ビットの符号なし整数を1つ引く */
export function nextU32(r: RngState): number {
  const s = r.s;
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** 0以上 k 未満の整数。棄却法で偏りなく引く（BD02 4.2） */
export function intBelow(r: RngState, k: number): number {
  if (!Number.isInteger(k) || k <= 0 || k > 2 ** 32) throw new Error(`intBelow: k が不正 ${k}`);
  const limit = Math.floor(2 ** 32 / k) * k;
  for (;;) {
    const x = nextU32(r);
    if (x < limit) return x % k;
  }
}

/** lo 以上 hi 以下の整数 */
export function intBetween(r: RngState, lo: number, hi: number): number {
  return lo + intBelow(r, hi - lo + 1);
}

/** 0以上1未満の実数（53ビット） */
export function nextFloat(r: RngState): number {
  const a = nextU32(r) >>> 5; // 27ビット
  const b = nextU32(r) >>> 6; // 26ビット
  return (a * 67108864 + b) / 9007199254740992;
}

export function choice<T>(r: RngState, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error("choice: 空の列");
  return xs[intBelow(r, xs.length)]!;
}

/** Fisher-Yates。元の配列を並べ替える */
export function shuffle<T>(r: RngState, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = intBelow(r, i + 1);
    const tmp = xs[i]!;
    xs[i] = xs[j]!;
    xs[j] = tmp;
  }
  return xs;
}

/** 重複なしに k 個を選ぶ */
export function sample<T>(r: RngState, xs: readonly T[], k: number): T[] {
  return shuffle(r, [...xs]).slice(0, k);
}

/** 状態が全部0だと列が0のままになるため避ける */
function fixZero(s: [number, number, number, number]): RngState {
  if (s.every((x) => x === 0)) s[0] = 1;
  return { s };
}

/**
 * 種の文字列から乱数の状態を作る。
 * 32文字の16進（サーバーが作る128ビットの種。BD02 4.1）はそのまま4つの整数にする。
 * それ以外の文字列（テストで使う読みやすい種）は cyrb128 で128ビットにする。
 */
export function seedRng(seed: string): RngState {
  if (/^[0-9a-f]{32}$/i.test(seed)) {
    const s: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) s[i] = Number.parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0;
    return fixZero(s);
  }
  return fixZero(cyrb128(seed));
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** 子の生成器を作る（BD02 4.3）。親から32ビットを4回引いて種にする */
export function childRng(r: RngState): RngState {
  return fixZero([nextU32(r), nextU32(r), nextU32(r), nextU32(r)]);
}

/** 子の生成器の種を、記録に残せる16進の文字列にする */
export function rngToHex(r: RngState): string {
  return r.s.map((x) => x.toString(16).padStart(8, "0")).join("");
}
