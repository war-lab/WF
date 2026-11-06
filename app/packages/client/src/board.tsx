// 大画面ビューの入口（BD04）。M0 は産地マップの描画だけ。
// ?sample=rulebook で、ルールブックの産地マップの図と同じ種類を置いて描く（BD06 TC-BRD-07 の確認用）。?ids で交点の番号を出す。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BoardMap, type BoardMapProps } from "./BoardMap.tsx";
import "./theme.css";

// ルールブックの図（sim/gen_map_svg.py の種5）と同じタイルと港の種類。拠点は描かない
const RULEBOOK_SAMPLE: BoardMapProps = {
  tileKinds: { 0: "buy", 1: "seed", 2: "grow", 3: "feed", 4: "sell", 5: "animal", 7: "seed", 8: "animal", 9: "grow", 10: "feed", 11: "buy", 12: "sell" },
  harborKinds: { 17: "grow", 38: "seed", 33: "sell", 8: "animal" },
};

const params = new URLSearchParams(location.search);
const props: BoardMapProps = {
  ...(params.get("sample") === "rulebook" ? RULEBOOK_SAMPLE : {}),
  showVertexIds: params.has("ids"),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ width: 960, margin: "0 auto", padding: 16 }}>
      <BoardMap {...props} />
    </main>
  </StrictMode>,
);
