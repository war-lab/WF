// 宣言の英文（BD02 7章）。数は英語の数詞で書き、99まで対応する。
import { bagGet } from "../bag.ts";
import type { Animal, Bag, Crop, Product } from "../types.ts";
import { PRODUCTS } from "../types.ts";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0〜99 の数詞。21 は twenty-one */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`numberWord: 範囲外 ${n}`);
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]}`;
}

/** 産物と数の名詞句。1は冠詞にし、小麦とミルクは単位を付ける（BD02 7.1） */
export function noun(p: Product, n: number): string {
  switch (p) {
    case "carrot":
      return n === 1 ? "a carrot" : `${numberWord(n)} carrots`;
    case "potato":
      return n === 1 ? "a potato" : `${numberWord(n)} potatoes`;
    case "egg":
      return n === 1 ? "an egg" : `${numberWord(n)} eggs`;
    case "wheat":
      return n === 1 ? "a bag of wheat" : `${numberWord(n)} bags of wheat`;
    case "milk":
      return n === 1 ? "a bottle of milk" : `${numberWord(n)} bottles of milk`;
  }
}

/** 数を付けない複数形（of each、Anything but の型に使う） */
export function plural(p: Product): string {
  return { carrot: "carrots", potato: "potatoes", wheat: "wheat", egg: "eggs", milk: "milk" }[p];
}

/** A、A and B、A, B and C */
export function joinAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** 英文の中で産物が最初に出てくる位置。出てこなければ -1 */
function mentionAt(text: string, p: Product): number {
  return text.toLowerCase().indexOf(p);
}

/**
 * 出す産物を並べる。並びは注文の英文に出てくる順。英文に出てこない産物は、基準の順で後ろに足す（BD02 7.1）
 */
export function itemsPhrase(items: Bag<Product>, orderText: string | null): string {
  const ps = PRODUCTS.filter((p) => bagGet(items, p) > 0);
  const text = orderText ?? "";
  const inText = ps.filter((p) => mentionAt(text, p) >= 0).sort((a, b) => mentionAt(text, a) - mentionAt(text, b));
  const rest = ps.filter((p) => mentionAt(text, p) < 0);
  return joinAnd([...inText, ...rest].map((p) => noun(p, bagGet(items, p))));
}

// ---------- 行動ごとの英文（BD02 7.2） ----------

export function sentencePlant(crop: Crop): string {
  if (crop === "carrot") return "I grow carrots and feed the soil.";
  return `I grow ${plural(crop)}.`;
}

export function sentenceBuyAnimal(a: Animal): string {
  return a === "cow" ? "I buy a cow and grow grass." : "I buy a chicken.";
}

export function sentenceFeed(a: Animal): string {
  return `I feed the ${a}.`;
}

export function sentenceSellProducts(p: Product, n: number): string {
  return `I sell ${noun(p, n)}.`;
}

export function sentenceSellAnimal(a: Animal): string {
  return `I sell the ${a}.`;
}

export function sentenceDeliver(items: Bag<Product>, orderText: string, to: string | null): string {
  const what = itemsPhrase(items, orderText);
  return to ? `I sell ${what} to ${to}.` : `I sell ${what}.`;
}

export function sentenceBonus(p: Product, n: number): string {
  return `I sell ${noun(p, n)} to the farmers' market.`;
}

/** 頭数は実際の数。1頭なら I have one animal.、0頭なら I have no animals. */
export function sentenceAnimals(n: number): string {
  if (n === 0) return "I have no animals.";
  if (n === 1) return "I have one animal.";
  return `I have ${numberWord(n)} animals.`;
}

export function sentenceJoint(p: Product, n: number, to: string): string {
  return `I bring ${noun(p, n)} to ${to}.`;
}

export function sentenceBuildHouse(): string {
  return "I build a farmhouse.";
}
