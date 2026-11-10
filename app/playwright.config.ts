// E2E（BD06 7章）。手元の wrangler dev（127.0.0.1:8787）に、大画面1つとスマホ4つを別のブラウザのコンテキストとしてつなぐ。
// wrangler dev は先に起動しておく（npm run dev）。ホストの鍵は app/packages/worker/.dev.vars の HOST_KEY と合わせる
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  // テストごとに部屋が別なので並列に流せる。1本でブラウザを5つ開くため、メモリを見て2本にする
  workers: 2,
  reporter: [["list"]],
  // 操作ごとの待ちに上限を置く。画面が切り替わって要素が消えたときに、テストの時間切れまで待ち続けないため
  use: { baseURL: process.env.E2E_BASE ?? "http://127.0.0.1:8787", trace: "retain-on-failure", actionTimeout: 5000 },
  outputDir: "e2e/.out",
  // chromium：全部を Chromium で流す（コミットの前）。
  // mixed：大画面と Android 役は Chromium、iPhone 役は WebKit（実際の端末の組み合わせ。M4 の出口と毎晩。BD06 10.1）
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // Windows の WebKit は Chromium より大幅に遅いため、上限を延ばす（2026-11-10 の実測で、WebKit だけの1局の通しが約5分）
    { name: "mixed", use: { browserName: "chromium" }, timeout: 600_000, expect: { timeout: 15_000 } },
  ],
});
