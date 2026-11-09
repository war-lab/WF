// E2E（BD06 7章）。手元の wrangler dev（127.0.0.1:8787）に、大画面1つとスマホ4つを別のブラウザのコンテキストとしてつなぐ。
// wrangler dev は先に起動しておく（npm run dev）。ホストの鍵は app/packages/worker/.dev.vars の HOST_KEY と合わせる
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  // 操作ごとの待ちに上限を置く。画面が切り替わって要素が消えたときに、テストの時間切れまで待ち続けないため
  use: { baseURL: process.env.E2E_BASE ?? "http://127.0.0.1:8787", trace: "retain-on-failure", actionTimeout: 5000 },
  outputDir: "e2e/.out",
  // コミットの前は Chromium、毎晩は WebKit も回す。M4 の出口では両方の合格を確かめる（BD06 10.1）
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
