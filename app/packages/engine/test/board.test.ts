// 盤面データのテスト（BD06 3章 TC-BRD-01〜06）。
// エンジンの全テストの前提になる盤面が、模擬の正本（sim/fixed_layout.json）と一致し、形として矛盾しないことを確かめる。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { board } from "../src/board.ts";

const fixed = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../sim/fixed_layout.json", import.meta.url)), "utf8"),
) as { num: (number | null)[]; harbors: number[]; anyHarbors: number[] };

const tileById = new Map(board.tiles.map((t) => [t.id, t]));
const vertexById = new Map(board.vertices.map((v) => [v.id, v]));

describe("盤面データ", () => {
  it("TC-BRD-01 タイル13枚、数字12個が fixed_layout.json の num と同じ並びで、中央が Market", () => {
    expect(board.tiles).toHaveLength(13);
    expect(board.tiles.map((t) => t.id)).toEqual([...Array(13).keys()]);
    expect(board.tiles.map((t) => t.number)).toEqual(fixed.num);
    expect(board.tiles.filter((t) => t.number !== null)).toHaveLength(12);

    const markets = board.tiles.filter((t) => t.market);
    expect(markets).toHaveLength(1);
    // 中央 = タイルの中心の重心に最も近いタイル
    const cx = board.tiles.reduce((s, t) => s + t.center[0], 0) / board.tiles.length;
    const cy = board.tiles.reduce((s, t) => s + t.center[1], 0) / board.tiles.length;
    const dist = (t: (typeof board.tiles)[number]) => Math.hypot(t.center[0] - cx, t.center[1] - cy);
    const nearest = [...board.tiles].sort((a, b) => dist(a) - dist(b))[0]!;
    expect(nearest.market).toBe(true);
    expect(nearest.number).toBeNull();
  });

  it("TC-BRD-02 港6つの交点が fixed_layout.json の harbors と同じ並びで、汎用港が交点37と3", () => {
    expect(board.harbors.map((h) => h.vertex)).toEqual(fixed.harbors);
    expect(board.harbors.filter((h) => h.kind === "any").map((h) => h.vertex).sort((a, b) => a - b)).toEqual([3, 37]);
    expect([...fixed.anyHarbors].sort((a, b) => a - b)).toEqual([3, 37]);
    expect(board.harbors.filter((h) => h.kind === "specialized")).toHaveLength(4);
  });

  it("TC-BRD-03 港の交点は、それぞれタイル1枚だけに接する", () => {
    for (const h of board.harbors) {
      expect(vertexById.get(h.vertex)?.tiles, `交点${h.vertex}`).toHaveLength(1);
    }
  });

  it("TC-BRD-04 港の交点が接するタイルの数字に、6と8がない", () => {
    for (const h of board.harbors) {
      for (const t of vertexById.get(h.vertex)!.tiles) {
        expect([6, 8], `交点${h.vertex}のタイル${t}`).not.toContain(tileById.get(t)!.number);
      }
    }
  });

  it("TC-BRD-05 交点の隣接が対称", () => {
    for (const v of board.vertices) {
      expect(v.neighbors.length).toBeGreaterThan(0);
      for (const n of v.neighbors) {
        expect(vertexById.get(n)?.neighbors, `${v.id}→${n}`).toContain(v.id);
      }
    }
  });

  it("TC-BRD-06 各タイルが6つの交点を持つ", () => {
    for (const t of board.tiles) {
      expect(new Set(t.vertices).size, `タイル${t.id}`).toBe(6);
    }
  });

  // 以下は TC-BRD の前提が崩れていないかを見る整合の確認（描画とエンジンが頼る性質）
  it("交点の id は0からの連番で、タイルと交点の対応が両方向で一致する", () => {
    expect(board.vertices.map((v) => v.id)).toEqual([...Array(board.vertices.length).keys()]);
    for (const t of board.tiles) {
      for (const v of t.vertices) expect(vertexById.get(v)!.tiles).toContain(t.id);
    }
    for (const v of board.vertices) {
      for (const t of v.tiles) expect(tileById.get(t)!.vertices).toContain(v.id);
    }
  });

  it("桟橋の向きは単位ベクトルで、盤面の外を向く", () => {
    const cx = board.vertices.reduce((s, v) => s + v.x, 0) / board.vertices.length;
    const cy = board.vertices.reduce((s, v) => s + v.y, 0) / board.vertices.length;
    for (const h of board.harbors) {
      const v = vertexById.get(h.vertex)!;
      expect(Math.hypot(...h.pier)).toBeCloseTo(1, 3);
      expect((v.x - cx) * h.pier[0] + (v.y - cy) * h.pier[1]).toBeGreaterThan(0);
    }
  });
});
