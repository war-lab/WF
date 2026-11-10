// 大画面の演出（BD04 6章）。演出が出て、決めた時間のうちに消えることを確かめ、見え方をスクリーンショットに残す
import { expect, test } from "@playwright/test";
import { closeTable, completeSetup, setupTable, turnPhone } from "./helpers.ts";
import { deliverOrder, give, readState, rollToMain, startAndReachRound3 } from "./hooks.ts";

test("演出：開始プレイヤーの名前、サイコロ、カードの受け取りが出て消える", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await t.board.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(t.board.locator(".fx-banner")).toContainText("開始プレイヤーです");
  await t.board.waitForTimeout(500);
  await t.board.screenshot({ path: "e2e/.out/fx-start.png" });
  await expect(t.board.locator(".fx-banner")).toHaveCount(0, { timeout: 4000 });
  await completeSetup(t);
  const p = await turnPhone(t);
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption("5");
  await sel.nth(1).selectOption("3");
  await p.getByRole("button", { name: "入れる" }).click();
  await expect(t.board.locator(".fx-dice")).toBeVisible();
  await t.board.screenshot({ path: "e2e/.out/fx-dice.png" });
  await expect(t.board.locator(".fx-dice")).toHaveCount(0, { timeout: 4000 });
  await closeTable(t);
});

test("演出：宣言した注文のカードが手前に出て、約3秒後に条件が開き、成立が出る", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startAndReachRound3(t);
  const p = await rollToMain(t, [2, 3]);
  const st = await readState(t);
  const f = st.orders.faceUp.find((x) => x.order.cond.k === "exact")!;
  const items = (f.order.cond as { items: Record<string, number> }).items;
  await give(t, st.turn!.seat, { cards: { sell: 1 }, products: items });
  const pts = t.board.locator(`.pp[data-seat="${st.turn!.seat}"] .pts`);
  const before = await pts.textContent();
  await deliverOrder(p, f.order.id, items);
  await expect(t.board.locator(".fx-focus .focus-card")).toContainText(f.order.text);
  // 待っている間は、点も注文の欄も宣言の前のまま
  await t.board.waitForTimeout(1500);
  expect(await pts.textContent()).toBe(before);
  await expect(t.board.locator(`.orders .order[data-order="${f.order.id}"]`)).toBeVisible();
  await expect(t.board.locator(".fx-focus .verdict")).toHaveCount(0);
  await t.board.screenshot({ path: "e2e/.out/fx-declared.png" });
  await expect(t.board.locator(".fx-focus .verdict")).toHaveText("成立", { timeout: 5000 });
  await t.board.waitForTimeout(700);
  await t.board.screenshot({ path: "e2e/.out/fx-reveal.png" });
  await expect(t.board.locator(".fx-focus")).toHaveCount(0, { timeout: 5000 });
  await expect(pts).not.toHaveText(before!);
  await closeTable(t);
});
