// E2E（BD06 7章）。手元の wrangler dev（127.0.0.1:8787）に、大画面1つとスマホ4つを別のブラウザのコンテキストとしてつなぐ。
// wrangler dev は先に起動しておく（npm run dev）。ホストの鍵は app/packages/worker/.dev.vars の HOST_KEY と合わせる
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE ?? "http://127.0.0.1:8787", trace: "retain-on-failure" },
  outputDir: "e2e/.out",
});
