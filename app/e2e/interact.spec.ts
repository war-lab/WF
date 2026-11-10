// E2E-04 7の同時の入力、E2E-06、06b、06c 交換、E2E-09 共同注文（BD06 7章）
import { expect, test } from "@playwright/test";
import { closeTable, setupTable, turnPhone } from "./helpers.ts";
import { give, phoneOfSeat, readState, rollToMain, startFast } from "./hooks.ts";

test("E2E-04 7で2人が同時に捨てるカードを選ぶ。片方が答えても進まず、両方が答えると好きな1枚の問いに移る", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startFast(t);
  const st = await readState(t);
  const turn = st.turn!.seat;
  const a = (turn + 1) % 4;
  const b = (turn + 2) % 4;
  await give(t, a, { cards: { grow: 3, sell: 3 } });
  await give(t, b, { cards: { feed: 3, sell: 3 } });
  const p = await turnPhone(t);
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption("3");
  await sel.nth(1).selectOption("4");
  await p.getByRole("button", { name: "入れる" }).click();
  const pa = await phoneOfSeat(t, a);
  const pb = await phoneOfSeat(t, b);
  await expect(pa.getByText(/単語カードを\d+枚捨ててください/)).toBeVisible();
  await expect(pb.getByText(/単語カードを\d+枚捨ててください/)).toBeVisible();
  const discard = async (ph: typeof pa) => {
    while (await ph.getByRole("button", { name: "捨てる" }).isDisabled()) await ph.locator(".discard button:not([disabled])", { hasText: "＋" }).first().click();
    await ph.getByRole("button", { name: "捨てる" }).click();
    await ph.getByRole("button", { name: "捨てる" }).click();
  };
  await discard(pa);
  await expect(pa.getByText("ほかの人の選択を待っています")).toBeVisible();
  // 片方が答えただけでは、好きな1枚の問いは出ない
  await expect(p.getByText("Market day：好きなカードを1枚もらえます")).toHaveCount(0);
  await discard(pb);
  for (const ph of t.phones) await expect(ph.getByText("Market day：好きなカードを1枚もらえます")).toBeVisible();
  await closeTable(t);
});

test("E2E-06、06b、06c 手番でない人の申し出が大画面にも出る。相手を選ぶ手順はなく、持っていない品目は出ない。手番の人は別のタブでも窓が出て、承諾1回で成立する", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startFast(t);
  const tp = await rollToMain(t, [2, 3]);
  const st = await readState(t);
  const turn = st.turn!.seat;
  const other = (turn + 1) % 4;
  const po = await phoneOfSeat(t, other);
  await give(t, other, { coins: 3 });
  await tp.getByRole("button", { name: "農場" }).click();
  await po.getByRole("button", { name: "交換" }).click();
  await po.getByRole("button", { name: "新しい申し出" }).click();
  // 06b：手番でない人には相手を選ぶ手順がない（相手は手番の人に決まっている）
  await expect(po.locator(".offer-form > .row button")).toHaveCount(0);
  await expect(po.getByText(`相手：${st.players[turn] ? await t.board.locator(`.pp[data-seat="${turn}"] .name`).textContent() : ""}`)).toBeVisible();
  // 渡す欄には持っている品目だけ。コインの＋は持っている数で止まる
  const giveSide = po.locator(".offer-side").first();
  await expect(giveSide.locator(".row", { hasText: "milk" })).toHaveCount(0);
  const coins = giveSide.locator(".row", { hasText: "コイン" });
  const have = (await readState(t)).players[other]!.coins;
  for (let i = 0; i < have; i++) await coins.getByRole("button", { name: "増やす" }).click();
  await expect(coins.getByRole("button", { name: "増やす" })).toBeDisabled();
  // 片方の欄が空なら送れない
  await expect(po.getByRole("button", { name: "送る" })).toBeDisabled();
  await po.locator(".offer-side").nth(1).locator(".row", { hasText: "grow" }).getByRole("button", { name: "増やす" }).click();
  await po.getByRole("button", { name: "送る" }).click();
  // 06：大画面の下の帯にも出る
  await expect(t.board.locator(".band .trade")).toBeVisible();
  // 06c：手番の人は農場のタブを開いていても窓が出る。写して返すボタンはない
  await expect(tp.getByText("からの申し出")).toBeVisible();
  await expect(tp.getByRole("button", { name: /写して|そのまま返す/ })).toHaveCount(0);
  const before = (await readState(t)).players[turn]!.coins;
  await tp.getByRole("button", { name: "承諾" }).click();
  await expect(t.board.locator(".band")).toContainText("交換が成立しました");
  expect((await readState(t)).players[turn]!.coins).toBe(before + have);
  await closeTable(t);
});

test("E2E-09 共同注文：行の産物と数は画面に出ない。合わない物は受け付けず sell も減らない。3人が1行ずつ出して完成し、点が大画面に出る", async ({ browser }) => {
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startFast(t);
  const st0 = await readState(t);
  const joint = st0.joint.faceUp[0]!.joint;
  // 大画面とスマホに、行の産物と数が出ていない
  const lineWords = joint.lines.map((l) => `${l.product} ${l.n}`);
  for (const w of lineWords) await expect(t.board.locator(`.order.joint[data-joint="${joint.id}"]`)).not.toContainText(w);
  for (let row = 0; row < 3; row++) {
    const p = await rollToMain(t, [2, 3]);
    const seat = (await readState(t)).turn!.seat;
    const line = joint.lines[row]!;
    await give(t, seat, { cards: { sell: 1 }, products: { [line.product]: line.n + 1 } });
    // 別の行が同じ産物で数が1つ多いときは、「合わない」を作れないので確かめない
    const ambiguous = joint.lines.some((l, i) => i !== row && l.product === line.product && l.n === line.n + 1);
    if (row === 0 && !ambiguous) {
      // 数が合わない（1つ多い）と受け付けない
      const before = await readState(t);
      await p.getByRole("button", { name: "注文" }).click();
      await p.locator(`.order.joint[data-joint="${joint.id}"]`).getByRole("button", { name: "出す" }).click();
      await p.locator(".pick button", { hasText: line.product }).click();
      for (let i = 1; i < line.n + 1; i++) await p.getByRole("button", { name: "増やす" }).click();
      await p.getByRole("button", { name: "次へ" }).click();
      await p.getByRole("button", { name: "宣言" }).click();
      await expect(p.getByText("その産物と数の行はありません")).toBeVisible();
      const after = await readState(t);
      expect(after.players[seat]!.hand.sell).toBe(before.players[seat]!.hand.sell);
      expect(after.players[seat]!.products).toEqual(before.players[seat]!.products);
    }
    await p.getByRole("button", { name: "注文" }).click();
    await p.locator(`.order.joint[data-joint="${joint.id}"]`).getByRole("button", { name: "出す" }).click();
    await p.locator(".pick button", { hasText: line.product }).click();
    for (let i = 1; i < line.n; i++) await p.getByRole("button", { name: "増やす" }).click();
    await p.getByRole("button", { name: "次へ" }).click();
    await p.getByRole("button", { name: "宣言" }).click();
    if (row < 2) {
      await expect(t.board.locator(`.order.joint[data-joint="${joint.id}"] .rows li`).filter({ hasNotText: "空き" })).toHaveCount(row + 1);
      await p.getByRole("button", { name: "手番終了" }).click();
      await p.getByRole("button", { name: "終える" }).click();
    }
  }
  await expect(t.board.locator(".band")).toContainText("共同注文が完成しました");
  const fin = await readState(t);
  expect(fin.players.some((p) => p.ledger.some((e) => e.src === "jointFinish"))).toBe(true);
  await closeTable(t);
});
