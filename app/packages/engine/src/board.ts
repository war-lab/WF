// 盤面データ（アプリ設計書 5.4）。src/data/board.json は sim/export_board.py が書き出す正本で、手で直さない。
// タイルの種類と港の種類はゲームごとに変わるため、ここには持たない（BD01 2.2 の BoardState が持つ）。
import raw from "./data/board.json" with { type: "json" };

export type TileId = number;
export type VertexId = number;

export interface BoardTile {
  id: TileId;
  /** 中心の座標。単位は六角の外接円の半径、y は下向き */
  center: [number, number];
  /** 多角形の頂点の順に並べた交点 */
  vertices: VertexId[];
  /** Market だけ null */
  number: number | null;
  market: boolean;
}

export interface BoardVertex {
  id: VertexId;
  x: number;
  y: number;
  neighbors: VertexId[];
  /** その交点に接するタイル（Market を含む） */
  tiles: TileId[];
}

export interface BoardHarbor {
  vertex: VertexId;
  /** any は汎用港（位置が固定）。specialized の種類はゲームごとに割り当てる（BD01 5章） */
  kind: "any" | "specialized";
  /** 桟橋を描く向き（盤面の重心から外向きの単位ベクトル） */
  pier: [number, number];
}

export interface BoardData {
  layout: string;
  tiles: BoardTile[];
  vertices: BoardVertex[];
  harbors: BoardHarbor[];
}

// JSON の型推論では center と pier が number[] になるため、unknown を経て BoardData にする。
// 形は export_board.py の assert と test/board.test.ts（TC-BRD）で確かめている
export const board: BoardData = raw as unknown as BoardData;
