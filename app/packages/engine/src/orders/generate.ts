// 注文の生成（BD02 5章）。sim/ordergen.py の gen_one、gen_bonus、gen_joint を移植した。
// 乱数の列は Python と違うため、1枚ずつの一致は求めない（BD02 4.1）。分岐の確率と型は同じにする。
import { choice, intBetween, nextFloat, sample, shuffle } from "../rng.ts";
import type { Animal, Bag, Crop, JointLine, JointOrder, Order, OrderCondition, Product, RngState } from "../types.ts";
import { CROP_CARDS, PRODUCTS } from "../types.ts";
import { joinAnd, joinOr, noun, numberWord, plural } from "./english.ts";
import { animalHalfPoints, conditionHalfPoints, jointLineHalfPoints } from "./points.ts";

/** 宛先（英文の先頭に置く形、文中の形） */
export const PLACES: readonly [string, string][] = [
  ["The cafe", "the cafe"],
  ["The bakery", "the bakery"],
  ["The school", "the school"],
  ["The pancake shop", "the pancake shop"],
  ["The hotel", "the hotel"],
  ["The hospital", "the hospital"],
  ["Grandma", "Grandma"],
  ["The soup kitchen", "the soup kitchen"],
];

/** 共同注文の催し（ordergen.py の EVENTS） */
export const EVENTS: readonly string[] = [
  "The village festival",
  "The school lunch",
  "The wedding party",
  "The harvest fair",
  "The football club",
  "The hospital kitchen",
  "The summer camp",
  "The town bakery contest",
];

/** 頭数の注文の指定の言い回し（ordergen.py の ANIMAL_HINT）。animalInclude のときだけ使う */
const ANIMAL_HINT: Record<Animal, string[]> = {
  chicken: [
    "At least one of them must lay eggs.",
    "At least one of them must have feathers.",
    "At least one of them must walk on two legs.",
    "At least one of them must be a bird.",
    "At least one of them must not be a mammal.",
    'The children want to hear an animal that says "cock-a-doodle-doo".',
    "At least one of them must not be a cow.",
    "At least one of them must be the animal that does not give milk.",
    "At least one of them must not have four legs.",
  ],
  cow: [
    "At least one of them must give milk.",
    "At least one of them must have four legs.",
    "At least one of them must be a mammal.",
    "At least one of them must not be a bird.",
    "At least one of them must not have feathers.",
    'The children want to hear an animal that says "moo".',
    "At least one of them must not be a chicken.",
    "At least one of them must be the animal that does not lay eggs.",
    "At least one of them must not walk on two legs.",
  ],
};

/** 指定の動物がニワトリになる確率（ordergen.py の ANIMALINCL の既定値） */
const INCLUDE_CHICKEN = 0.6;

/** 産物を選ぶときの重み（BD02 5.1。確定仕様の EGGW=1.8、MILKW=1.8） */
const ITEM_WEIGHT: readonly [Product, number][] = [
  ["carrot", 1.0],
  ["potato", 1.0],
  ["wheat", 1.0],
  ["egg", 1.8],
  ["milk", 1.8],
];

/** 共同注文の行の数の範囲（確定仕様の JQSMALL=1） */
const JOINT_QTY: Record<Product, [number, number]> = {
  carrot: [2, 4],
  potato: [2, 4],
  wheat: [2, 4],
  egg: [2, 4],
  milk: [2, 3],
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** 重み付きで重複なしに k 個を選ぶ（ordergen.py の pick） */
function pick(r: RngState, k: number): Product[] {
  const pool = [...ITEM_WEIGHT];
  const out: Product[] = [];
  for (let i = 0; i < k; i++) {
    const tot = pool.reduce((s, [, w]) => s + w, 0);
    let x = nextFloat(r) * tot;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      x -= pool[j]![1];
      if (x <= 0) {
        idx = j;
        break;
      }
    }
    out.push(pool[idx]![0]);
    pool.splice(idx, 1);
  }
  return out;
}

/** 生成した注文。id と source は山を作るときに付ける */
type Draft = Omit<Order, "id" | "source">;

function draft(text: string, level: Order["level"], cond: OrderCondition, hp: number | null, to: string | null, picture: Product | null): Draft {
  return { text, level, isBonus: level === "bonus", picture, to, cond, hp };
}

/** 通常の注文1枚（BD02 5.1） */
export function genOne(r: RngState, animalInclude: boolean): Draft {
  const t = nextFloat(r);
  const [place, placeL] = choice(r, PLACES);
  // 易：1種類
  if (t < 0.35) {
    const item = pick(r, 1)[0]!;
    const n = intBetween(r, 1, 4);
    const nn = noun(item, n);
    const forms: [string, string | null][] = [
      [`${place} needs ${nn}.`, placeL],
      [`Can you bring me ${nn}?`, null],
      [`${cap(nn)}, please.`, null],
    ];
    const [text, to] = choice(r, forms);
    const cond: OrderCondition = { k: "exact", items: { [item]: n } };
    return draft(text, "easy", cond, conditionHalfPoints(cond, false, animalInclude), to, item);
  }
  // 中：2種類
  if (t < 0.75) {
    const [a, b] = pick(r, 2) as [Product, Product];
    const eachOk = (p: Product) => p === "carrot" || p === "potato" || p === "egg";
    let text: string;
    let to: string | null;
    let items: Bag<Product>;
    if (nextFloat(r) < 0.4 && eachOk(a) && eachOk(b)) {
      const n = intBetween(r, 1, 3);
      items = { [a]: n, [b]: n };
      text = `${place} is looking for ${plural(a)} and ${plural(b)}, ${numberWord(n)} of each.`;
      to = placeL;
    } else if (nextFloat(r) < 0.5) {
      const n1 = intBetween(r, 1, 3);
      const n2 = intBetween(r, 1, 3);
      items = { [a]: n1, [b]: n2 };
      text = `${place} would like ${noun(a, n1)} and ${noun(b, n2)}.`;
      to = placeL;
    } else {
      // 否定の罠：送ってはいけない産物を先に書く
      const c = choice(r, PRODUCTS.filter((x) => x !== a && x !== b));
      const n1 = intBetween(r, 1, 3);
      const n2 = intBetween(r, 1, 3);
      items = { [a]: n1, [b]: n2 };
      text = `Please don’t send ${plural(c)}. We need ${noun(a, n1)} and ${noun(b, n2)}.`;
      to = null;
    }
    const cond: OrderCondition = { k: "exact", items };
    return draft(text, "medium", cond, conditionHalfPoints(cond, false, animalInclude), to, null);
  }
  // 難：言い換え、合計、同数、頭数
  const k = nextFloat(r);
  if (k < 0.3) {
    const text = choice(r, ["Half a dozen eggs, please.", "We need half a dozen eggs for the cake."]);
    const cond: OrderCondition = { k: "exact", items: { egg: 6 } };
    return draft(text, "hard", cond, conditionHalfPoints(cond, true, animalInclude), null, null);
  }
  if (k < 0.55) {
    const ex = choice(r, CROP_CARDS);
    const others = CROP_CARDS.filter((c) => c !== ex) as Crop[];
    const n = intBetween(r, 4, 5);
    const text = `We need ${numberWord(n)} crops in total. Anything but ${plural(ex)}!`;
    const cond: OrderCondition = { k: "total", allowed: others, total: n };
    return draft(text, "hard", cond, conditionHalfPoints(cond, true, animalInclude), null, null);
  }
  if (k < 0.8) {
    const text = "We want the same number of carrots and potatoes, at least two of each.";
    const cond: OrderCondition = { k: "same", pair: ["carrot", "potato"], min: 2 };
    return draft(text, "hard", cond, conditionHalfPoints(cond, true, animalInclude), null, null);
  }
  const n = choice(r, [2, 3]);
  let include: Animal | null = null;
  let text = `A school class wants to visit a farm with at least ${numberWord(n)} animals.`;
  if (animalInclude) {
    include = nextFloat(r) < INCLUDE_CHICKEN ? "chicken" : "cow";
    text += ` ${choice(r, ANIMAL_HINT[include])}`;
  }
  const cond: OrderCondition = { k: "animals", min: n, include };
  return draft(text, include ? "hard" : "medium", cond, animalHalfPoints(n, include !== null), null, null);
}

/** ボーナス注文1枚（BD02 5.2） */
export function genBonus(r: RngState): Draft {
  const chosen = sample(r, PRODUCTS, choice(r, [2, 3]));
  const accepted = PRODUCTS.filter((p) => chosen.includes(p));
  const rest = PRODUCTS.filter((p) => !chosen.includes(p));
  const text = `The farmers' market has enough ${joinAnd(rest.map(plural))}. Bring ${joinOr(accepted.map(plural))}, as many as you can!`;
  return draft(text, "bonus", { k: "bonus", accepted }, null, "the farmers' market", null);
}

/**
 * 通常の注文の山（BD02 5.1）。total 枚のうち bonus 枚をボーナス注文にする。
 * 同じ英文は1つの山に1枚まで。id は生成した順の番号で、山はそのあとにシャッフルする。
 */
export function genOrderDeck(r: RngState, seed: string, animalInclude: boolean, total = 36, bonus = 2): Order[] {
  const seen = new Set<string>();
  const drafts: Draft[] = [];
  while (drafts.length < total - bonus) {
    const d = genOne(r, animalInclude);
    if (seen.has(d.text)) continue;
    seen.add(d.text);
    drafts.push(d);
  }
  while (drafts.length < total) {
    const d = genBonus(r);
    if (seen.has(d.text)) continue;
    seen.add(d.text);
    drafts.push(d);
  }
  const deck: Order[] = drafts.map((d, i) => ({ ...d, id: `o${String(i + 1).padStart(2, "0")}`, source: { mode: "generated", seed } }));
  return shuffle(r, deck);
}

/** 共同注文1枚（BD02 5.3）。宛先の重なりは genJointDeck で付け替える */
function genJoint(r: RngState): { event: string; lines: [JointLine, JointLine, JointLine] } {
  const event = choice(r, EVENTS);
  const animals = sample(r, ["egg", "milk"] as Product[], choice(r, [1, 2]));
  const crops = sample(r, CROP_CARDS as readonly Product[], 3 - animals.length);
  const items = shuffle(r, [...animals, ...crops]);
  const lines = items.map((p) => {
    const [lo, hi] = JOINT_QTY[p];
    const n = intBetween(r, lo, hi);
    return { product: p, n, hp: jointLineHalfPoints(p, n) };
  }) as [JointLine, JointLine, JointLine];
  return { event, lines };
}

export function jointText(event: string, lines: readonly JointLine[]): string {
  return `${event} needs ${joinAnd(lines.map((l) => noun(l.product, l.n)))}.`;
}

/** 文中で使う宛先（The village festival → the village festival） */
export function eventTo(event: string): string {
  return event.charAt(0).toLowerCase() + event.slice(1);
}

/** 共同注文の山（BD02 5.3）。8枚、英文が重ならず、宛先の名前も重ならない（unique_events） */
export function genJointDeck(r: RngState, seed: string, total = 8): JointOrder[] {
  const seen = new Set<string>();
  const raw: { event: string; lines: [JointLine, JointLine, JointLine] }[] = [];
  while (raw.length < total) {
    const j = genJoint(r);
    const text = jointText(j.event, j.lines);
    if (seen.has(text)) continue;
    seen.add(text);
    raw.push(j);
  }
  const used = new Set<string>();
  return raw.map((j, i) => {
    let ev = j.event;
    if (used.has(ev)) ev = EVENTS.find((e) => !used.has(e))!;
    used.add(ev);
    return {
      id: `j${String(i + 1).padStart(2, "0")}`,
      text: jointText(ev, j.lines),
      to: eventTo(ev),
      lines: j.lines,
      source: { mode: "generated", seed },
    };
  });
}
