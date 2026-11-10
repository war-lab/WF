// E2E-07 注文の成立、E2E-08 注文の不成立、E2E-10 日本語の支払い、E2E-17 8点での勝ち（BD06 7章）
// 試験用の口（TEST_HOOKS=1）で産物とカードを渡し、伏せた注文の条件を読んで、届ける物を決める
import { expect, test } from "@playwright/test";
import { HOST_KEY, closeTable, setupTable } from "./helpers.ts";
import { adminOp, deliverOrder, give, readState, rollToMain, startAndReachRound3, startFast } from "./hooks.ts";

test("E2E-07 注文の成立：英文は伏せてあり、「英文を見る」で開く。大画面は英文を先に出し、約3秒後に成立を出す。補充と読み上げの促しが出る", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startAndReachRound3(t);
  const p = await rollToMain(t, [2, 3]);
  const st = await readState(t);
  const seat = st.turn!.seat;
  const f = st.orders.faceUp.find((x) => x.order.cond.k === "exact")!;
  const items = (f.order.cond as { items: Record<string, number> }).items;
  await give(t, seat, { cards: { sell: 1 }, products: items });
  await p.getByRole("button", { name: "注文" }).click();
  await p.locator(`.order[data-order="${f.order.id}"]`).getByRole("button", { name: "届ける" }).click();
  for (const [k, n] of Object.entries(items)) for (let i = 0; i < n; i++) await p.locator(".pick .row", { hasText: k }).getByRole("button", { name: "増やす" }).click();
  await p.getByRole("button", { name: "次へ" }).click();
  await expect(p.getByText("英文を自分で作って、声に出して言ってください")).toBeVisible();
  await expect(p.locator(".sentence-box .sentence")).toHaveCount(0);
  await p.screenshot({ path: "e2e/.out/p05-confirm.png" });
  await p.getByRole("button", { name: "英文を見る" }).click();
  await expect(p.locator(".sentence-box .sentence")).toBeVisible();
  const t0 = Date.now();
  await p.getByRole("button", { name: "宣言" }).click();
  // 待っている間は、宣言の英文が出ていて、結果の文は出ていない
  await expect(t.board.locator(".band .sentence")).toContainText(f.order.to ?? "");
  await t.board.waitForTimeout(1500);
  await expect(t.board.locator(".band")).not.toContainText("成立しました");
  await expect(t.board.locator(".band .result.ok")).toBeVisible({ timeout: 6000 });
  expect(Date.now() - t0).toBeGreaterThan(2500);
  await expect(t.board.locator(".band .read")).toBeVisible();
  await expect(p.getByText(/成立しました/)).toBeVisible();
  const after = await readState(t);
  expect(after.orders.faceUp.some((x) => x.order.id === f.order.id)).toBe(false);
  expect(after.players[seat]!.halfPoints).toBe(f.order.hp);
  // sentenceShown が記録に残る（ゲームを打ち切ってから記録を取り出す）
  await adminOp(t, "ゲームを打ち切る", true);
  const rec = (await (await t.board.request.get(`/api/rooms/${t.roomId}/record`, { headers: { Authorization: `Bearer ${HOST_KEY}` } })).json()) as {
    commands: { cmd: { t: string }; meta: { sentenceShown?: boolean } | null }[];
  };
  expect(rec.commands.find((r) => r.cmd.t === "deliverOrder")!.meta).toEqual({ sentenceShown: true });
  await closeTable(t);
});

test("E2E-08 注文の不成立：大画面に不成立が出て、sell は減り産物は残る。同じ注文はこの手番に選べない", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startAndReachRound3(t);
  const p = await rollToMain(t, [2, 3]);
  const st = await readState(t);
  const seat = st.turn!.seat;
  const f = st.orders.faceUp.find((x) => x.order.cond.k === "exact")!;
  const items = (f.order.cond as { items: Record<string, number> }).items;
  const [k, n] = Object.entries(items)[0]!;
  // 数を1つ足りなくして出す（1つしか要らないなら別の種類で）
  const wrong = n > 1 ? { [k]: n - 1 } : { [k === "egg" ? "milk" : "egg"]: 1 };
  await give(t, seat, { cards: { sell: 2 }, products: wrong });
  const before = await readState(t);
  await deliverOrder(p, f.order.id, wrong);
  await expect(t.board.locator(".band .result.ng")).toBeVisible({ timeout: 6000 });
  const after = await readState(t);
  expect(after.players[seat]!.hand.sell).toBe((before.players[seat]!.hand.sell ?? 0) - 1);
  expect(after.players[seat]!.products).toEqual(before.players[seat]!.products);
  await p.getByRole("button", { name: "注文" }).click();
  await expect(p.locator(`.order[data-order="${f.order.id}"]`).getByRole("button", { name: "届ける" })).toBeDisabled();
  await expect(p.locator(`.order[data-order="${f.order.id}"]`).getByText("この注文はこの手番には届けられません")).toBeVisible();
  await closeTable(t);
});

test("E2E-10 日本語の支払い：手番でない人がボタンで払うと、大画面に短く出る", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  await rollToMain(t, [2, 3]);
  let paid = false;
  for (const ph of t.phones) {
    if (await ph.getByText("あなたの番です").isVisible()) continue;
    await ph.getByRole("button", { name: "日本語" }).click();
    await ph.locator(".row", { hasText: "単語を1つ" }).getByRole("button", { name: "無料券" }).click();
    paid = true;
    break;
  }
  expect(paid).toBe(true);
  await expect(t.board.locator(".band")).toContainText("日本語（単語）無料券");
  await closeTable(t);
});

test("E2E-17 8点での勝ち：注文の成立で目標の点に届くと、その場で結果の画面になる", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startAndReachRound3(t);
  const p = await rollToMain(t, [2, 3]);
  const seat = (await readState(t)).turn!.seat;
  for (let i = 0; i < 12; i++) {
    if (await t.board.locator(".h-result").isVisible()) break;
    const st = await readState(t);
    if (st.phase.k === "over") break;
    const f = st.orders.faceUp.find((x) => x.order.cond.k === "exact");
    if (!f) break;
    const items = (f.order.cond as { items: Record<string, number> }).items;
    await give(t, seat, { cards: { sell: 1 }, products: items });
    await deliverOrder(p, f.order.id, items);
    await expect(t.board.locator(".band .result.ok").or(t.board.locator(".h-result"))).toBeVisible({ timeout: 6000 });
  }
  await expect(t.board.locator(".h-result")).toBeVisible();
  await expect(t.board.locator(".result-head .winner")).toContainText("の勝ち");
  await expect(t.board.getByText("終わり方：8点到達")).toBeVisible();
  await closeTable(t);
});
