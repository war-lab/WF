import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 入口は大画面（board.html、/board）とスマホ（p.html、/p）の2つ（アプリ設計書 付録 A、BD05 4.6）。
// Workers の静的ファイルの配信は /board と /p を board.html と p.html に対応づける。
// 開発サーバー（npm run dev:client）では、/api を wrangler dev（8787）に中継する。WebSocket も通す
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        board: resolve(import.meta.dirname, "board.html"),
        p: resolve(import.meta.dirname, "p.html"),
      },
    },
  },
});
