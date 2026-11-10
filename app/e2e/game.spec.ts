// E2E-16 最終ラウンドの宣言、E2E-19 記録の書き出し、E2E-23 1局を通す（BD06 7章）
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { HOST_KEY, closeTable, completeSetup, playEmptyTurn, setupTable } from "./helpers.ts";

test("E2E-23、16、19 ロビーから結果と書き出しまで1局を通す。最終ラウンドの宣言でラウンドの最後の人の手番の終わりに終わる", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await t.board.getByRole("button", { name: "ゲームを始める" }).click();
  await completeSetup(t);
  // 7を避けた出目で2ラウンド回す
  const rolls: [number, number][] = [[2, 3], [4, 4], [5, 1], [3, 3], [6, 4], [2, 2], [5, 3], [6, 6]];
  for (const d of rolls) await playEmptyTurn(t, d);
  // ラウンド3の初めに注文が3枚表になっている
  await expect(t.board.locator(".orders .order:not(.joint)")).toHaveCount(3);
  // 記録の書き出しは、ゲームの途中ではできない（E2E-19）
  const roomId = t.roomId;
  const early = await t.board.request.get(`/api/rooms/${roomId}/record`, { headers: { Authorization: `Bearer ${HOST_KEY}` } });
  expect(early.status()).toBe(409);
  // 席0の手番中にホストが最終ラウンドにする → 席3の手番の終わりで終わる（E2E-16）
  await t.board.getByRole("button", { name: "管理" }).click();
  await t.board.getByRole("button", { name: "最終ラウンドにする" }).click();
  await t.board.getByRole("button", { name: "実行" }).click();
  await t.board.getByRole("button", { name: "閉じる" }).click();
  await expect(t.board.getByText("最終ラウンドです（ホストの宣言）").first()).toBeVisible();
  for (const d of [[2, 3], [4, 4], [5, 1]] as [number, number][]) await playEmptyTurn(t, d);
  await expect(t.board.locator(".h-result")).toHaveCount(0);
  await playEmptyTurn(t, [3, 3]);
  await expect(t.board.locator(".h-result")).toBeVisible();
  await expect(t.board.getByText("終わり方：最終ラウンドの宣言")).toBeVisible();
  await expect(t.board.locator("tr[data-rank]")).toHaveCount(4);
  for (const p of t.phones) await expect(p.locator(".my-rank")).toContainText("位");
  await t.board.screenshot({ path: "e2e/.out/h07-result.png" });
  // 記録を保存すると zip がダウンロードされ、方式設計10章の項目がある（E2E-19）
  await t.board.getByRole("button", { name: "記録の書き出し" }).click();
  // H08 の集計の表（BD04 2.8）
  await expect(t.board.locator(".export .stats")).toContainText("手番の時間の平均");
  const [dl] = await Promise.all([t.board.waitForEvent("download"), t.board.getByRole("button", { name: "記録を保存" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^wordfarm_\d{8}T\d{4}\.zip$/);
  const files = unzipSync(readFileSync((await dl.path())!));
  for (const f of ["record.json", "summary.json", "turns.csv", "points.csv", "actions.csv", "orders.csv", "farms.csv", "summary_named.json", "turns_named.csv"]) expect(Object.keys(files)).toContain(f);
  const turns = strFromU8(files["turns.csv"]!).trim().split("\n");
  expect(turns).toHaveLength(1 + 12);
  expect(strFromU8(files["turns.csv"]!)).not.toMatch(/Aki|Ben|Chika|Dan/);
  expect(JSON.parse(strFromU8(files["summary.json"]!)).reason).toBe("host");
  await closeTable(t);
});
