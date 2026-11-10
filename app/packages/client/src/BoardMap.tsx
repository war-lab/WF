// 産地マップの描画（BD04 2.4、3.3、5.1。アプリ設計書 4章「盤面の描画は SVG」）。
// 位置は盤面データ（@word-farm/engine の board）から、種類、数字、拠点、港はゲームの状態から受け取る。
// タイルの絵は art/final から書き出した public/art/tile-*.webp を六角に切り抜いて描く（素材仕様書 1章）。
// タイルの中の配置は、絵が上部、数字のトークンが中央、種類の単語が下部（素材仕様書 1章）。
import { board } from "@word-farm/engine";
import type { Color } from "@word-farm/engine";
import { COLOR_INFO } from "./ui/common.tsx";

export type TileKind = "grow" | "buy" | "feed" | "sell" | "seed" | "animal";
export type HarborKind = "any" | TileKind;

export interface BoardMapProps {
  /** タイルの id → 種類。省略したタイルは種類を描かない */
  tileKinds?: Partial<Record<number, TileKind>>;
  /** 港の交点 → 種類。省略した専門港は「2:1」だけ描く */
  harborKinds?: Partial<Record<number, HarborKind>>;
  /** 交点 → 拠点の持ち主の色 */
  houses?: Partial<Record<number, Color>>;
  /** 置ける交点（拠点の配置の画面で丸を出す） */
  candidates?: number[];
  /** 選んでいる交点（点滅させる） */
  selected?: number | null;
  /** 選んでいる人の色（大画面で、スマホで選んでいる交点を光らせるとき） */
  selectedColor?: Color | null;
  /** 光らせるタイル（出目のタイル） */
  litTiles?: number[];
  /** 交点を選んだとき。タップした位置に最も近い置ける交点を返す（BD04 3.3） */
  onSelect?: (vertex: number) => void;
  /** 置いたばかりの拠点（一度跳ねさせる。BD04 6章） */
  bounce?: number | null;
  /** 確認用に交点の番号を出す */
  showVertexIds?: boolean;
  /** 絵を使わず図形と文字で描く（M0 の確認用） */
  plain?: boolean;
}

// 中段の5枚が幅960pxに収まるよう、六角の幅を180pxにする（BD04 5.1）。座標の単位は外接円の半径
const R = 180 / Math.sqrt(3);
const PIER = 0.85; // 桟橋の長さ（外接円の半径に対する比。ルールブックの図と同じ）
const PAD = 60;

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

function hexPoints(ids: number[]): string {
  return ids.map((id) => `${px(vtx(id).x).toFixed(1)},${py(vtx(id).y).toFixed(1)}`).join(" ");
}

export function BoardMap({
  tileKinds = {},
  harborKinds = {},
  houses = {},
  candidates = [],
  selected = null,
  selectedColor = null,
  litTiles = [],
  onSelect,
  bounce = null,
  showVertexIds = false,
  plain = false,
}: BoardMapProps) {
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onSelect || candidates.length === 0) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    let best = candidates[0]!;
    let bd = Infinity;
    for (const id of candidates) {
      const v = vtx(id);
      const d = (px(v.x) - p.x) ** 2 + (py(v.y) - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    onSelect(best);
  };
  return (
    <svg className="board-map" viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`} role="img" aria-label="産地マップ" onClick={pick}>
      <defs>
        {/* 拠点の駒の絵（白）を、持ち主の色で染める（乗算）。色だけで人を見分けさせず、形の記号を重ねる（BD04 7.3） */}
        {Object.entries(COLOR_INFO).map(([k, c]) => (
          <filter key={k} id={`tint-${k}`} colorInterpolationFilters="sRGB">
            <feFlood floodColor={c.hex} result="f" />
            <feComposite in="f" in2="SourceAlpha" operator="in" result="c" />
            <feBlend in="SourceGraphic" in2="c" mode="multiply" />
          </filter>
        ))}
        {board.tiles.map((t) => (
          <clipPath key={t.id} id={`clip-t${t.id}`}>
            <polygon points={hexPoints(t.vertices)} />
          </clipPath>
        ))}
      </defs>
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
        const pts = hexPoints(t.vertices);
        const cx = px(t.center[0]);
        const cy = py(t.center[1]);
        const kind = t.number === null ? "market" : tileKinds[t.id];
        // 絵は、六角の外接する正方形（幅 2R）に置いて切り抜く。素材の正方形の中央に、先端が上の六角を当てている
        const art = !plain && kind ? (
          <image href={`/art/tile-${kind}.webp`} x={cx - R} y={cy - R} width={2 * R} height={2 * R} clipPath={`url(#clip-t${t.id})`} preserveAspectRatio="xMidYMid slice" />
        ) : null;
        const lit = litTiles.includes(t.id);
        const label = (text: string) => {
          const w = text.length * 15 + 16;
          return (
            <g>
              <rect x={cx - w / 2} y={cy + 49} width={w} height={28} rx={7} fill="rgba(255,250,235,0.9)" />
              <text x={cx} y={cy + 70} textAnchor="middle" fontSize={22} fontWeight={700} style={{ fill: "#46301a" }}>
                {text}
              </text>
            </g>
          );
        };
        if (t.number === null) {
          return (
            <g key={`t${t.id}`} data-tile={t.id}>
              <polygon points={pts} fill="var(--wheat)" />
              {art}
              <polygon points={pts} fill="none" stroke="var(--line)" strokeWidth={3} />
              {label("Market")}
            </g>
          );
        }
        const n = t.number;
        const k = pips(n);
        return (
          <g key={`t${t.id}`} data-tile={t.id} data-kind={kind}>
            <polygon points={pts} fill="var(--paper)" />
            {art}
            <polygon points={pts} fill="none" stroke={lit ? "#ffd84a" : "var(--line)"} strokeWidth={lit ? 10 : 3} />
            <circle cx={cx} cy={cy + 10} r={27} fill="var(--wheat)" stroke="var(--line)" strokeWidth={2} />
            <text x={cx} y={cy + 20} textAnchor="middle" fontSize={28} fontWeight={700} style={{ fill: isRed(n) ? "var(--warn)" : "var(--wheat-ink)" }}>
              {n}
            </text>
            {Array.from({ length: k }, (_, i) => (
              <circle key={i} cx={cx - (k - 1) * 4 + i * 8} cy={cy + 31} r={2.4} fill="var(--muted)" />
            ))}
            {kind && label(kind)}
          </g>
        );
      })}

      {candidates.map((id) => {
        const v = vtx(id);
        return <circle key={`c${id}`} data-candidate={id} cx={px(v.x)} cy={py(v.y)} r={11} fill="rgba(255,255,255,0.85)" stroke="var(--line)" strokeWidth={2} />;
      })}

      {Object.entries(houses).map(([vid, color]) => {
        if (!color) return null;
        const v = vtx(Number(vid));
        const c = COLOR_INFO[color];
        return (
          <g key={`b${vid}`} data-house={vid} transform={`translate(${px(v.x).toFixed(1)} ${py(v.y).toFixed(1)})`}>
            <g className={Number(vid) === bounce ? "bounce" : undefined}>
              {plain ? (
                <path d="M-19 10 L-19 -8 L0 -24 L19 -8 L19 10 Z" fill={c.hex} stroke="var(--line)" strokeWidth={3} />
              ) : (
                <image href="/art/piece-house.webp" x={-26} y={-34} width={52} height={52} filter={`url(#tint-${color})`} />
              )}
              <text x={0} y={plain ? 7 : 8} textAnchor="middle" fontSize={plain ? 16 : 18} fontWeight={700} style={{ fill: "#fff", paintOrder: "stroke", stroke: "#3a2a18", strokeWidth: 3 }}>
                {c.mark}
              </text>
            </g>
          </g>
        );
      })}

      {selected !== null && (
        <circle
          className="blink"
          data-selected={selected}
          cx={px(vtx(selected).x)}
          cy={py(vtx(selected).y)}
          r={24}
          fill="none"
          stroke={selectedColor ? COLOR_INFO[selectedColor].hex : "#ffd84a"}
          strokeWidth={7}
        />
      )}

      {showVertexIds &&
        board.vertices.map((v) => (
          <text key={`v${v.id}`} x={px(v.x)} y={py(v.y) - 6} textAnchor="middle" fontSize={14} style={{ fill: "#c00" }}>
            {v.id}
          </text>
        ))}
    </svg>
  );
}
