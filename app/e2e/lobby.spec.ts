// E2E-01 参加、E2E-15 管理操作の制限、E2E-24 鍵がURLに出ない（BD06 7章）
import { expect, test } from "@playwright/test";
import { HOST_KEY, closeTable, setupTable } from "./helpers.ts";

test("E2E-01 4人が参加し、ホストが時計回りに並べ替えてから始めると、席が並びのとおりに振られる", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  const urls: string[] = [];
  for (const p of [t.board, ...t.phones]) p.on("request", (r) => urls.push(r.url()));
  const board = t.board;
  for (const nm of t.names) await expect(board.locator(`[data-participant="${nm}"]`)).toBeVisible();
  // Dan を先頭へ（▲を3回）
  for (let i = 0; i < 3; i++) await board.locator('[data-participant="Dan"] button[aria-label="上へ"]').click();
  await expect(board.locator(".people li").first()).toHaveAttribute("data-participant", "Dan");
  await board.screenshot({ path: "e2e/.out/h02-lobby.png" });
  await board.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(board.locator(".h-game")).toBeVisible();
  await board.screenshot({ path: "e2e/.out/h03-setup.png" });
  // 席は、並び（Dan, Aki, Ben, Chika）を開始プレイヤーから時計回りに振る（BD01 1.1）
  const order = ["Dan", "Aki", "Ben", "Chika"];
  const seats = await board.locator(".pp .name").allTextContents();
  const start = order.indexOf(seats[0]!);
  expect(seats).toEqual(order.slice(start).concat(order.slice(0, start)));
  await t.phones[0]!.screenshot({ path: "e2e/.out/p02-wait.png" });
  // E2E-24：鍵が URL に出ない
  expect(urls.some((u) => u.includes(HOST_KEY))).toBe(false);
  await closeTable(t);
});

test("E2E-15 スマホのコンテキストで大画面のURLを開いても、管理操作ができない", async ({ browser }) => {
  const t = await setupTable(browser, 3);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/board?room=${t.roomId}`);
  await expect(p.getByText("ホストの鍵がないため、閲覧だけです")).toBeVisible();
  await expect(p.getByRole("button", { name: "ゲームを始める" })).toHaveCount(0);
  await ctx.close();
  await closeTable(t);
});
