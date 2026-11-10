// 大画面とスマホで共通の部品（BD04 7.3 の色と形、3.8 と 3.9 の重ね表示）
import type { ReactNode } from "react";
import type { Color } from "@word-farm/engine";
import type { NetState } from "../net/connection.ts";

/** プレイヤーの色には、必ず形の記号を添える（BD04 7.3） */
export const COLOR_INFO: Record<Color, { name: string; mark: string; hex: string }> = {
  red: { name: "赤", mark: "●", hex: "#D64545" },
  blue: { name: "青", mark: "■", hex: "#2F6FD6" },
  green: { name: "緑", mark: "▲", hex: "#2E9E5B" },
  yellow: { name: "黄", mark: "◆", hex: "#E0B000" },
};

export function Mark({ color, size }: { color: Color; size?: number }) {
  const c = COLOR_INFO[color];
  return (
    <span aria-label={c.name} style={{ color: c.hex, fontSize: size, lineHeight: 1 }}>
      {c.mark}
    </span>
  );
}

/**
 * 素材の絵（art/final から書き出した public/art/*.webp）。文字の名前は消さず、横に添えて使う。
 * 英語の名前は交渉で使う言葉なので、画面からなくさない（BD04 8章）
 */
export function Icon({ name, size = 28, title }: { name: string; size?: number; title?: string }) {
  return <img className="icon" src={`/art/${name}.webp`} alt={title ?? ""} width={size} height={size} draggable={false} />;
}

/** 単語カードが出るタイル。枠の色をそのタイルの色に合わせる（作物は seed、動物は animal のタイルから出る） */
const CARD_TILE: Record<string, string> = {
  grow: "grow",
  buy: "buy",
  feed: "feed",
  sell: "sell",
  carrot: "seed",
  potato: "seed",
  wheat: "seed",
  cow: "animal",
  chicken: "animal",
};

/**
 * 単語カードを、縦長のカードの形で描く。絵の下に英語の単語を出し、n を渡すと右上に枚数の札を付ける。
 * 2枚以上は後ろに重なったカードを描き、0枚は灰色にする（枠と文字はゲーム側で描く。素材仕様書 1章）
 */
export function WordCardView({ kind, n, w = 68 }: { kind: string; n?: number; w?: number }) {
  const stack = n === undefined ? 0 : Math.min(Math.max(n - 1, 0), 2);
  return (
    <span className={`wcard t-${CARD_TILE[kind] ?? "grow"}${n === 0 ? " zero" : ""}`} data-stack={stack} style={{ ["--w" as string]: `${w}px` }}>
      <span className="face">
        <img src={`/art/card-${kind}.webp`} alt="" draggable={false} />
      </span>
      <span className="word">{kind}</span>
      {n !== undefined && n > 0 && <span className="count">{n}</span>}
    </span>
  );
}

/** 単語カードの裏面。ほかの人の手札の枚数を示す（中身は見せない） */
export function CardBack({ n, w = 34 }: { n: number; w?: number }) {
  return (
    <span className="wcard back" data-stack={Math.min(Math.max(n - 1, 0), 2)} style={{ ["--w" as string]: `${w}px` }}>
      <span className="face" />
      <span className="count">{n}</span>
    </span>
  );
}

/** 産物の札。カードではないので、丸い札に絵と数を出す */
export function ProductToken({ kind, n, size = 52 }: { kind: string; n: number; size?: number }) {
  return (
    <span className={`ptoken${n ? "" : " zero"}`} style={{ ["--s" as string]: `${size}px` }}>
      <span className="disc">
        <img src={`/art/product-${kind}.webp`} alt="" draggable={false} />
      </span>
      <span className="word">{kind}</span>
      {n > 0 && <span className="count">{n}</span>}
    </span>
  );
}

/** 点の内訳の出どころ（BD01 2.3 の PointEntry.src）の日本語 */
export const SRC_LABEL: Record<string, string> = {
  order: "注文",
  bonus: "ボーナス注文",
  jointRow: "共同注文の行",
  jointFinish: "共同注文の完成",
  jointHalf: "共同注文の半分の点",
};

/** 点の内訳を、出どころごとの合計にまとめる */
export function ledgerSummary(ledger: { src: string; hp: number }[]): { label: string; points: number; count: number }[] {
  const m = new Map<string, { points: number; count: number }>();
  for (const e of ledger) {
    const x = m.get(e.src) ?? { points: 0, count: 0 };
    x.points += e.hp / 2;
    x.count += 1;
    m.set(e.src, x);
  }
  return Object.keys(SRC_LABEL)
    .filter((k) => m.has(k))
    .map((k) => ({ label: SRC_LABEL[k]!, ...m.get(k)! }));
}

/** 画面全体を薄く覆う重ね表示。操作をすべて止める */
export function Cover({ children }: { children: ReactNode }) {
  return (
    <div className="cover" role="alertdialog">
      <div className="cover-box">{children}</div>
    </div>
  );
}

/** 通信の状態ごとの重ね表示（BD04 3.8）。表示すべきものがなければ null */
export function NetCover({ state, since }: { state: NetState; since: number | null }) {
  const long = since !== null && Date.now() - since > 10_000;
  switch (state.status) {
    case "connecting":
    case "closed":
      if (!state.welcome) return <Cover>接続しています</Cover>;
      return (
        <Cover>
          <p>再接続しています</p>
          {long && <p>電波の届く場所か、モバイル通信がオンかを確かめてください。戻らない場合はホストに伝えてください</p>}
        </Cover>
      );
    case "replaced":
      return <Cover>別の画面で開かれています</Cover>;
    case "engineChanged":
      return (
        <Cover>
          <p>エンジンの版が違うため、部屋を止めています。ホストに知らせてください</p>
          <p>{state.lastError?.message}</p>
          <p>対処：記録を作った版に戻してデプロイし直してください（wrangler rollback）。戻すと、この画面は自動でつながり直します（BD05 2.10）</p>
        </Cover>
      );
    case "fatal":
      return <Cover>{state.lastError?.code === "ROOM" ? "部屋が見つかりません。大画面のQRコードを読み直してください" : "画面を読み込み直してください"}</Cover>;
    default:
      return null;
  }
}
