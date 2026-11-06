// 産地マップの描画（BD04、アプリ設計書 4章「盤面の描画は SVG」）。
// 位置と数字は盤面データ（@word-farm/engine の board）から、種類と拠点はゲームの状態から受け取る。
// M0 では図形と文字だけで描く。絵は M7 で差し替える。
import { board } from "@word-farm/engine";

export type TileKind = "grow" | "buy" | "feed" | "sell" | "seed" | "animal";
export type HarborKind = "any" | TileKind;

export interface BoardMapProps {
  /** タイルの id → 種類。省略したタイルは種類を描かない */
  tileKinds?: Partial<Record<number, TileKind>>;
  /** 港の交点 → 種類。省略した専門港は「2:1」だけ描く */
  harborKinds?: Partial<Record<number, HarborKind>>;
  /** 交点 → 席の番号 */
  houses?: Partial<Record<number, number>>;
  /** 確認用に交点の番号を出す */
  showVertexIds?: boolean;
}

// 中段の5枚が幅960pxに収まるよう、六角の幅を180pxにする（BD04 5.1）。座標の単位は外接円の半径
const R = 180 / Math.sqrt(3);
const PIER = 0.85; // 桟橋の長さ（外接円の半径に対する比。ルールブックの図と同じ）
const PAD = 60;

const SEAT_COLOR = ["#d9534f", "#3a7bd5", "#e0a020", "#3c9d5d"];

const vertexById = new Map(board.vertices.map((v) => [v.id, v]));
const vtx = (id: number) => {
  const v = vertexById.get(id);
  if (!v) throw new Error(`盤面データに交点${id}がない`);
  return v;
};

// 描く範囲：交点と桟橋の先端を含む矩形
const xs = [...board.vertices.map((v) => v.x), ...board.harbors.map((h) => vtx(h.vertex).x + h.pier[0] * PIER)];
const ys = [...board.vertices.map((v) => v.y), ...board.harbors.map((h) => vtx(h.vertex).y + h.pier[1] * PIER)];
const minX = Math.min(...xs);
const minY = Math.min(...ys);
const W = (Math.max(...xs) - minX) * R + PAD * 2;
const H = (Math.max(...ys) - minY) * R + PAD * 2;
const px = (x: number) => (x - minX) * R + PAD;
const py = (y: number) => (y - minY) * R + PAD;

/** 6と8は出やすい数字として赤で示す（ルールブックの図と同じ） */
const isRed = (n: number) => n === 6 || n === 8;
/** 数字の出やすさを点の数で示す（2と12が1つ、6と8が5つ） */
const pips = (n: number) => 6 - Math.abs(7 - n);

export function BoardMap({ tileKinds = {}, harborKinds = {}, houses = {}, showVertexIds = false }: BoardMapProps) {
  return (
    <svg className="board-map" viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`} role="img" aria-label="産地マップ">
      <rect x={0} y={0} width={W} height={H} rx={24} fill="var(--sea)" />

      {board.harbors.map((h) => {
        const v = vtx(h.vertex);
        const bx = px(v.x + h.pier[0] * PIER);
        const by = py(v.y + h.pier[1] * PIER);
        const kind = h.kind === "any" ? "any" : harborKinds[h.vertex];
        return (
          <g key={`h${h.vertex}`} data-harbor={h.vertex}>
            <line x1={px(v.x)} y1={py(v.y)} x2={bx} y2={by} stroke="var(--soil)" strokeWidth={10} strokeLinecap="round" />
            <circle cx={bx} cy={by} r={34} fill="var(--paper)" stroke="var(--line)" strokeWidth={3} />
            {kind === "any" ? (
              <text x={bx} y={by + 9} textAnchor="middle" fontSize={26} fontWeight={700}>
                3:1
              </text>
            ) : kind ? (
              <>
                <text x={bx} y={by - 2} textAnchor="middle" fontSize={17} fontWeight={700}>
                  {kind}
                </text>
                <text x={bx} y={by + 20} textAnchor="middle" fontSize={16} fontWeight={700}>
                  2:1
                </text>
              </>
            ) : (
              <text x={bx} y={by + 9} textAnchor="middle" fontSize={26} fontWeight={700}>
                2:1
              </text>
            )}
          </g>
        );
      })}

      {board.tiles.map((t) => {
        const pts = t.vertices
          .map((id) => {
            const v = vtx(id);
            return `${px(v.x).toFixed(1)},${py(v.y).toFixed(1)}`;
          })
          .join(" ");
        const cx = px(t.center[0]);
        const cy = py(t.center[1]);
        if (t.number === null) {
          return (
            <g key={`t${t.id}`} data-tile={t.id}>
              <polygon points={pts} fill="var(--wheat)" stroke="var(--line)" strokeWidth={3} />
              <text x={cx} y={cy} textAnchor="middle" fontSize={30} fontWeight={700} style={{ fill: "var(--wheat-ink)" }}>
                Market
              </text>
              <text x={cx} y={cy + 30} textAnchor="middle" fontSize={18} style={{ fill: "var(--wheat-ink)" }}>
                7＝全員1枚
              </text>
            </g>
          );
        }
        const kind = tileKinds[t.id];
        const n = t.number;
        const k = pips(n);
        return (
          <g key={`t${t.id}`} data-tile={t.id}>
            <polygon points={pts} fill="var(--paper)" stroke="var(--leaf)" strokeWidth={4} />
            {kind && (
              <text x={cx} y={cy - 22} textAnchor="middle" fontSize={28} fontWeight={700}>
                {kind}
              </text>
            )}
            <circle cx={cx} cy={cy + 18} r={27} fill="var(--wheat)" stroke="var(--line)" strokeWidth={2} />
            <text
              x={cx}
              y={cy + 28}
              textAnchor="middle"
              fontSize={28}
              fontWeight={700}
              style={{ fill: isRed(n) ? "var(--warn)" : "var(--wheat-ink)" }}
            >
              {n}
            </text>
            {Array.from({ length: k }, (_, i) => (
              <circle key={i} cx={cx - (k - 1) * 5 + i * 10} cy={cy + 58} r={3.2} fill="var(--muted)" />
            ))}
          </g>
        );
      })}

      {Object.entries(houses).map(([vid, seat]) => {
        if (seat === undefined) return null;
        const v = vtx(Number(vid));
        return (
          <path
            key={`b${vid}`}
            transform={`translate(${px(v.x).toFixed(1)} ${py(v.y).toFixed(1)})`}
            d="M-16 8 L-16 -7 L0 -20 L16 -7 L16 8 Z"
            fill={SEAT_COLOR[seat] ?? "#888"}
            stroke="var(--line)"
            strokeWidth={3}
          />
        );
      })}

      {showVertexIds &&
        board.vertices.map((v) => (
          <text key={`v${v.id}`} x={px(v.x)} y={py(v.y) - 6} textAnchor="middle" fontSize={14} style={{ fill: "#c00" }}>
            {v.id}
          </text>
        ))}
    </svg>
  );
}
