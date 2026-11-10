// 物が飛ぶ演出（BD04 6章）。カード、産物、コインの絵を、出どころの要素から行き先の要素へ弧を描いて動かす。
// React の描画とは別に、画面の最前面の層へ DOM を直接置いて Web Animations API で動かし、終わったら消す。
// 行き先の数字は、届くまで前の値のままにする（incoming）。数字が先に変わると、何が増えたのか目で追えないため。
import { useSyncExternalStore } from "react";

// ---------- 届くまで据え置く数 ----------

/** 席ごとの「飛んでいる途中の数」。キーは hand、coins、pts、product:<名前> */
type Incoming = Record<number, Record<string, number>>;
let incoming: Incoming = {};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function addIncoming(seat: number, key: string, n: number): void {
  const cur = incoming[seat] ?? {};
  incoming = { ...incoming, [seat]: { ...cur, [key]: (cur[key] ?? 0) + n } };
  emit();
}

/** 飛んでいる途中の数を引いた、画面に出す値 */
export function useShown(seat: number, key: string, actual: number): number {
  const inc = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => incoming,
  );
  return actual - (inc[seat]?.[key] ?? 0);
}

// ---------- 飛ばす ----------

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let layer: HTMLDivElement | null = null;
function getLayer(): HTMLDivElement {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement("div");
  layer.className = "fly-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  return layer;
}

export type Where = string | Element | DOMRect | { x: number; y: number } | null | undefined;

/** 要素（またはセレクタ）の中心の位置。見つからなければ null */
export function centerOf(w: Where): { x: number; y: number } | null {
  if (!w) return null;
  if (typeof w === "object" && "x" in w && !(w instanceof Element) && !("width" in w)) return w;
  const r = w instanceof DOMRect ? w : (typeof w === "string" ? document.querySelector(w) : w)?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 飛ばす物の見た目 */
export type Sprite =
  | { k: "card"; kind: string; w?: number }
  | { k: "back"; w?: number }
  | { k: "img"; src: string; size?: number }
  | { k: "coin"; size?: number }
  | { k: "star"; size?: number };

const CARD_TILE: Record<string, string> = { grow: "grow", buy: "buy", feed: "feed", sell: "sell", carrot: "seed", potato: "seed", wheat: "seed", cow: "animal", chicken: "animal" };

function makeSprite(s: Sprite): HTMLElement {
  const el = document.createElement("div");
  if (s.k === "card" || s.k === "back") {
    const w = s.w ?? 54;
    el.className = s.k === "card" ? `wcard t-${CARD_TILE[s.kind] ?? "grow"} fly-card` : "wcard back fly-card";
    el.style.setProperty("--w", `${w}px`);
    const face = document.createElement("span");
    face.className = "face";
    if (s.k === "card") {
      const img = document.createElement("img");
      img.src = `/art/card-${s.kind}.webp`;
      img.alt = "";
      face.appendChild(img);
    }
    el.appendChild(face);
    if (s.k === "card") {
      const word = document.createElement("span");
      word.className = "word";
      word.textContent = s.kind;
      el.appendChild(word);
    }
    return el;
  }
  const size = (s.k === "img" ? s.size : s.size) ?? 44;
  const src = s.k === "img" ? s.src : s.k === "coin" ? "/art/ui-coin.webp" : "/art/fx-star.webp";
  el.className = "fly-img";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.width = size;
  img.height = size;
  el.appendChild(img);
  return el;
}

export interface FlyOpts {
  /** 始めるまでの間（ミリ秒） */
  delay?: number | undefined;
  /** 飛ぶ時間（ミリ秒）。出てくる膨らみを含まない */
  ms?: number | undefined;
  /** 弧の高さ（画面のピクセル）。負で上へふくらむ */
  arc?: number | undefined;
  /** 出どころで膨らんでから飛ぶ（生まれる演出） */
  spawn?: boolean | undefined;
  /** 生まれたあと、出どころに留まる時間（ミリ秒）。どこから出たかを見せる */
  linger?: number | undefined;
  /** 着いたら小さくして消す（行き先に吸い込まれる） */
  shrink?: boolean | undefined;
  /** 行き先で据え置く数（届いた時に外す） */
  hold?: { seat: number; key: string; n: number } | undefined;
  /** 届いた時に呼ぶ */
  onLand?: (() => void) | undefined;
  /** 届いた行き先の要素を跳ねさせる */
  bump?: Where | undefined;
}

/** 1つ飛ばす。位置が取れなければ何もせず、据え置きもしない */
export function fly(sprite: Sprite, from: Where, to: Where, o: FlyOpts = {}): void {
  const a = centerOf(from);
  const b = centerOf(to);
  if (!a || !b) return;
  const land = () => {
    if (o.hold) addIncoming(o.hold.seat, o.hold.key, -o.hold.n);
    if (o.bump) bump(o.bump);
    o.onLand?.();
  };
  if (o.hold) addIncoming(o.hold.seat, o.hold.key, o.hold.n);
  if (reduced()) {
    window.setTimeout(land, o.delay ?? 0);
    return;
  }
  const el = makeSprite(sprite);
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.opacity = "0";
  getLayer().appendChild(el);
  const ms = o.ms ?? 650;
  const popMs = o.spawn ? 220 : 0;
  const spawnMs = popMs + (o.spawn ? (o.linger ?? 0) : 0);
  const arc = o.arc ?? -Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
  // 2次ベジェの制御点は、2点の中点から、進む向きに垂直な向きへ arc だけずらす（上へふくらむ向きにそろえる）
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + arc;
  const rot = (Math.random() - 0.5) * 30;
  const frames: Keyframe[] = [];
  const total = spawnMs + ms;
  const at = (t: number, x: number, y: number, s: number, r: number, op = 1) =>
    frames.push({ offset: t, opacity: op, transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${r}deg) scale(${s})` });
  if (o.spawn) {
    at(0, a.x, a.y, 0.2, 0, 0);
    at((popMs * 0.6) / total, a.x, a.y, 1.25, 0);
    at(popMs / total, a.x, a.y, 1, 0);
    if (spawnMs > popMs) at(spawnMs / total, a.x, a.y, 1, 0);
  } else {
    at(0, a.x, a.y, 0.9, 0, 0);
  }
  const N = 14;
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    // 出だしは速く、着く前に少しゆるめる
    const e = 1 - (1 - u) * (1 - u);
    const x = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * mx + e * e * b.x;
    const y = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * my + e * e * b.y;
    // 吸い込まれる物も、縮むのは終わりの4割だけにする。途中で小さくなると何が飛んでいるか追えない
    const s = o.shrink ? (u < 0.6 ? 1 + 0.1 * Math.sin((Math.PI * u) / 0.6) : 1 - 0.45 * ((u - 0.6) / 0.4)) : 1 + 0.15 * Math.sin(Math.PI * e);
    at((spawnMs + ms * u) / total, x, y, s, rot * Math.sin(Math.PI * e), o.shrink && u === 1 ? 0.2 : 1);
  }
  const anim = el.animate(frames, { duration: total, delay: o.delay ?? 0, easing: "linear", fill: "both" });
  anim.onfinish = () => {
    el.remove();
    land();
  };
  anim.oncancel = () => {
    el.remove();
    land();
  };
}

/** 同じ物を n 個、少しずつずらして飛ばす（多すぎるときは max 個にまとめる） */
export function flyMany(n: number, sprite: (i: number) => Sprite, from: Where, to: Where, o: FlyOpts & { gap?: number | undefined; max?: number | undefined } = {}): void {
  const count = Math.min(n, o.max ?? 6);
  if (count <= 0) return;
  // 据え置く数は、まとめた分も含めて全部を最後の1個に持たせる
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const hold = o.hold ? { ...o.hold, n: last ? o.hold.n - Math.floor(o.hold.n / count) * (count - 1) : Math.floor(o.hold.n / count) } : undefined;
    fly(sprite(i), from, to, { ...o, delay: (o.delay ?? 0) + i * (o.gap ?? 90), hold, onLand: last ? o.onLand : undefined });
  }
}

/** 要素を一度跳ねさせる */
export function bump(w: Where): void {
  const el = typeof w === "string" ? document.querySelector(w) : w instanceof Element ? w : null;
  if (!el || reduced()) return;
  (el as HTMLElement).animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(.3,1.6,.6,1)" });
}

/** 要素を左右に揺らす（不成立） */
export function shake(w: Where): void {
  const el = typeof w === "string" ? document.querySelector(w) : w instanceof Element ? w : null;
  if (!el || reduced()) return;
  (el as HTMLElement).animate(
    [0, -10, 10, -8, 8, -4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 500, easing: "ease-out" },
  );
}

/** 粒子をその場に散らす。kind は fx-sparkle（きらめき）、fx-puff（土煙）、fx-star（星）。confetti は紙吹雪 */
export function burst(w: Where, kind: "sparkle" | "puff" | "star" | "confetti", o: { n?: number; delay?: number; spread?: number; size?: number } = {}): void {
  const c = centerOf(w);
  if (!c || reduced()) return;
  const n = o.n ?? (kind === "confetti" ? 28 : 8);
  const spread = o.spread ?? (kind === "puff" ? 50 : kind === "confetti" ? 220 : 80);
  const colors = ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#457b9d", "#8ab17d"];
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    let size = o.size ?? (kind === "puff" ? 46 : kind === "star" ? 30 : 26);
    if (kind === "confetti") {
      el.className = "fly-confetti";
      el.style.background = colors[i % colors.length]!;
      size = 12;
    } else {
      el.className = "fly-img";
      const img = document.createElement("img");
      img.src = `/art/fx-${kind}.webp`;
      img.alt = "";
      img.width = size * (0.7 + Math.random() * 0.6);
      img.height = img.width;
      el.appendChild(img);
    }
    el.style.opacity = "0";
    getLayer().appendChild(el);
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const dist = spread * (0.5 + Math.random() * 0.5);
    const dx = Math.cos(ang) * dist;
    // 土煙は横へ広がり、紙吹雪は上へ跳ねてから落ちる
    const dy = kind === "puff" ? Math.sin(ang) * dist * 0.35 : Math.sin(ang) * dist;
    const fall = kind === "confetti" ? 180 + Math.random() * 120 : 0;
    const spin = (Math.random() - 0.5) * (kind === "confetti" ? 720 : 180);
    const ms = kind === "confetti" ? 1400 : kind === "puff" ? 700 : 800;
    const tf = (x: number, y: number, s: number, r: number) => `translate(${c.x + x}px, ${c.y + y}px) translate(-50%, -50%) rotate(${r}deg) scale(${s})`;
    const anim = el.animate(
      [
        { offset: 0, opacity: 0, transform: tf(0, 0, 0.3, 0) },
        { offset: 0.15, opacity: 1, transform: tf(dx * 0.4, dy * 0.4 - (kind === "confetti" ? 60 : 0), 1, spin * 0.2) },
        { offset: 1, opacity: 0, transform: tf(dx, dy + fall, kind === "puff" ? 1.4 : 0.8, spin) },
      ],
      { duration: ms, delay: (o.delay ?? 0) + Math.random() * 80, easing: "cubic-bezier(.2,.7,.4,1)", fill: "both" },
    );
    anim.onfinish = () => el.remove();
  }
}
