// E2E-02 拠点の配置、E2E-03 3人戦の準備（BD06 7章）
import { expect, test } from "@playwright/test";
import { answerPromptOn, closeTable, completeSetup, setupTable } from "./helpers.ts";

test("E2E-02 スマホで選んだ交点が大画面でも光り、「ここに置く」と確認を押すまで置かれない。2個目のあとにカードの問いが出る", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await t.board.getByRole("button", { name: "ゲームを始める" }).click();
  const placer = t.phones.find(async () => true)!;
  // 席0（開始プレイヤー）のスマホを探す
  let p = placer;
  for (const ph of t.phones) if (await ph.getByText("拠点を置く交点を選んでください").isVisible({ timeout: 3000 }).catch(() => false)) p = ph;
  await expect(p.getByText("拠点を置く交点を選んでください")).toBeVisible();
  const cand = p.locator("circle[data-candidate]").first();
  const vid = await cand.getAttribute("data-candidate");
  await cand.click({ force: true });
  await expect(t.board.locator(`circle[data-selected="${vid}"]`)).toBeVisible();
  await expect(t.board.locator("[data-house]")).toHaveCount(0);
  await p.getByRole("button", { name: "ここに置く" }).click();
  await expect(t.board.locator("[data-house]")).toHaveCount(0);
  await p.screenshot({ path: "e2e/.out/p03-place.png" });
  await p.getByRole("button", { name: "置く", exact: true }).click();
  await expect(t.board.locator(`[data-house="${vid}"]`)).toBeVisible();
  await completeSetup(t);
  await expect(t.board.locator("[data-house]")).toHaveCount(8);
  await expect(t.board.locator(".order.joint")).toHaveCount(2);
  await t.board.screenshot({ path: "e2e/.out/h04-start.png" });
  await closeTable(t);
});

test("E2E-03 3人戦では、追加の1枚の問いが3人に同時に出る", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await t.board.getByRole("button", { name: "ゲームを始める" }).click();
  // 拠点を6個置き、2個目のカードの問いに答えたところで、3人の追加の問いが同時に出る
  for (let guard = 0; guard < 60; guard++) {
    const heads = await Promise.all(t.phones.map((p) => p.getByText("好きなカードを1枚もらえます（3人戦）").isVisible()));
    if (heads.every(Boolean)) break;
    let acted = false;
    for (const p of t.phones) {
      if (await p.getByText("拠点を置く交点を選んでください").isVisible()) {
        // 見出しを確かめてから押すまでの間に、画面が次の段階へ切り替わることがある。そのときは次の繰り返しでやり直す
        try {
          await p.locator("circle[data-candidate]").first().click({ force: true, timeout: 2000 });
          await p.getByRole("button", { name: "ここに置く" }).click({ timeout: 2000 });
          await p.getByRole("button", { name: "置く", exact: true }).click({ timeout: 2000 });
        } catch {
          continue;
        }
        acted = true;
        break;
      }
      if (!(await p.getByText("好きなカードを1枚もらえます（3人戦）").isVisible()) && (await answerPromptOn(p))) {
        acted = true;
        break;
      }
    }
    if (!acted) await t.board.waitForTimeout(150);
  }
  for (const p of t.phones) await expect(p.getByText("好きなカードを1枚もらえます（3人戦）")).toBeVisible();
  await closeTable(t);
});
