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
        </Cover>
      );
    case "fatal":
      return <Cover>{state.lastError?.code === "ROOM" ? "部屋が見つかりません。大画面のQRコードを読み直してください" : "画面を読み込み直してください"}</Cover>;
    default:
      return null;
  }
}
