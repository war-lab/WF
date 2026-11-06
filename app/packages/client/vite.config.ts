import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 入口は大画面（board.html）とスマホ（player.html）の2つ（アプリ設計書 付録 A）
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        board: resolve(import.meta.dirname, "board.html"),
        player: resolve(import.meta.dirname, "player.html"),
      },
    },
  },
});
