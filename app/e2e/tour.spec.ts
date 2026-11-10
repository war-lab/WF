// 見た目の確認用に、主な画面を撮る（テストではない。npx playwright test e2e/tour.spec.ts で手で流す）
import { test } from "@playwright/test";
import { closeTable, setupTable } from "./helpers.ts";
import { advance, give, phoneOfSeat, readState, rollToMain, startAndReachRound3 } from "./hooks.ts";

test.skip(!process.env.TOUR, "TOUR=1 のときだけ流す");

test("tour", async ({ browser }) => {
  const s = (p: import("@playwright/test").Page, n: string) => p.screenshot({ path: `e2e/.out/tour-${n}.png`, fullPage: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const start = await ctx.newPage();
  await start.goto("/board");
  await s(start, "h01");
  await ctx.close();
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startAndReachRound3(t);
  const p = await rollToMain(t, [2, 3]);
  const st = await readState(t);
  const seat = st.turn!.seat;
  await give(t, seat, { cards: { sell: 2, feed: 1 }, products: { egg: 3, milk: 2, carrot: 2 }, coins: 6 });
  await t.board.waitForTimeout(800);
  await s(t.board, "h04");
  await s(p, "p04-hand");
  // 植えると動物を買うのに要る札を、手札に足りない分だけ山から渡す（局面によって山が尽きているため）
  const st2 = await readState(t);
  const need: Record<string, number> = {};
  for (const k of ["grow", "potato", "buy", "chicken"] as const) {
    const n = Math.min(Math.max(0, 1 - (st2.players[seat]!.hand[k] ?? 0)), st2.piles[k] ?? 0);
    if (n) need[k] = n;
  }
  await give(t, seat, { cards: need, coins: 2 });
  await p.getByRole("button", { name: "植える" }).click();
  await p.locator(".pick button", { hasText: "potato" }).click();
  await p.getByRole("button", { name: "宣言" }).click();
  // chicken が山にも手札にもない局面では買えないので飛ばす
  const buy = p.getByRole("button", { name: "動物を買う" });
  await p.waitForTimeout(500);
  if (await buy.isEnabled()) {
    await buy.click();
    await p.locator(".pick button", { hasText: "chicken" }).click();
    await p.getByRole("button", { name: "宣言" }).click();
  }
  await t.board.waitForTimeout(1500);
  await s(t.board, "h04-farm");
  await p.getByRole("button", { name: "農場" }).click();
  await s(p, "p04-farm");
  await p.getByRole("button", { name: "注文" }).click();
  await s(p, "p04-orders");
  await p.getByRole("button", { name: "交換" }).click();
  await s(p, "p04-trade");
  await p.getByRole("button", { name: "新しい申し出" }).click();
  await s(p, "p04-offer");
  const other = await phoneOfSeat(t, (seat + 1) % 4);
  await s(other, "p04-other");
  void advance;
  await t.board.getByRole("button", { name: "管理" }).click();
  await s(t.board, "h05");
  await t.board.getByRole("button", { name: "ゲームを打ち切る" }).click();
  await t.board.getByRole("button", { name: "実行" }).click();
  await t.board.getByRole("button", { name: "実行" }).click();
  await t.board.waitForTimeout(3000);
  await s(t.board, "h07");
  await s(p, "p07");
  await closeTable(t);
});
