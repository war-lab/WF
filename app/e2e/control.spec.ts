// E2E-05 問いの出し直し、E2E-11 再接続、E2E-12 2つ目のタブ、E2E-13 サーバーの作り直し、E2E-14 取り消し、
// E2E-18 一時停止、E2E-20 読み上げの促し、E2E-21 席の再発行、E2E-22 代わりに手番を終える、E2E-24 鍵がURLとQRに出ない（BD06 7章）
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { expect, test, type Page } from "@playwright/test";
import { HOST_KEY, closeTable, setupTable, turnPhone } from "./helpers.ts";
import { give, phoneOfSeat, readState, rollToMain, startFast } from "./hooks.ts";

async function openAdmin(board: Page): Promise<void> {
  await board.getByRole("button", { name: "管理" }).click();
}

async function decodeQr(img: ReturnType<Page["locator"]>): Promise<string> {
  const buf = await img.screenshot();
  const png = PNG.sync.read(buf);
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!r) throw new Error("QRコードを読めない");
  return r.data;
}

test("E2E-24、11、12 QRコードと全リクエストに鍵が出ない。閉じて開き直すと同じ席に戻り、同じ席の2つ目のタブは古いほうが切られる", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  const urls: string[] = [];
  t.board.on("request", (r) => urls.push(r.url()));
  const qr = await decodeQr(t.board.getByAltText("参加のQRコード"));
  expect(qr).toBe(`http://127.0.0.1:8787/p?room=${t.roomId}`);
  expect(qr).not.toContain(HOST_KEY);
  await startFast(t);
  await rollToMain(t, [2, 3]);
  // 11：手番の人のコンテキストを閉じ、保存した記憶で開き直すと、同じ席に戻り、手番を続けられる
  const st = await readState(t);
  const seat = st.turn!.seat;
  const p = await phoneOfSeat(t, seat);
  const idx = t.phones.indexOf(p);
  const storage = await t.phoneCtx[idx]!.storageState();
  await t.phoneCtx[idx]!.close();
  await expect(t.board.locator(`.pp[data-seat="${seat}"]`)).toContainText("切断中");
  const ctx2 = await browser.newContext({ storageState: storage, viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`/p?room=${t.roomId}`);
  await expect(p2.getByText("あなたの番です")).toBeVisible();
  await expect(t.board.locator(`.pp[data-seat="${seat}"]`)).not.toContainText("切断中");
  t.phones[idx] = p2;
  t.phoneCtx[idx] = ctx2;
  // 12：同じ記憶の2つ目のタブを開くと、古いタブが切られる
  const p3 = await ctx2.newPage();
  await p3.goto(`/p?room=${t.roomId}`);
  await expect(p3.getByText("あなたの番です")).toBeVisible();
  await expect(p2.getByText("別の画面で開かれています")).toBeVisible();
  t.phones[idx] = p3;
  expect(urls.some((u) => u.includes(HOST_KEY))).toBe(false);
  await closeTable(t);
});

test("E2E-14、18 取り消しの確認に最後の操作が出る。続けて押すと1つ前が出る。一時停止中はスマホの操作が止まり、ホストは取り消せる", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  const p = await rollToMain(t, [2, 3]);
  const seat = (await readState(t)).turn!.seat;
  await give(t, seat, { cards: { sell: 1 }, products: { egg: 2 } });
  await p.getByRole("button", { name: "市場で売る" }).click();
  await p.locator(".pick button", { hasText: "egg" }).click();
  await p.getByRole("button", { name: "次へ" }).click();
  await p.getByRole("button", { name: "宣言" }).click();
  await expect(t.board.locator(".band")).toContainText("I sell an egg");
  // 18：一時停止中はスマホの操作が止まり、時計が止まる
  await openAdmin(t.board);
  await t.board.getByRole("button", { name: "一時停止" }).click();
  await expect(p.getByText("一時停止中です")).toBeVisible();
  await expect(p.getByRole("button", { name: "手番終了" })).toBeDisabled();
  const c1 = await t.board.locator(".top .clock").textContent();
  await t.board.waitForTimeout(2200);
  expect(await t.board.locator(".top .clock").textContent()).toBe(c1);
  // 14：一時停止中も取り消せる。確認に最後の操作が出る
  await t.board.getByRole("button", { name: "1つ取り消す" }).click();
  await expect(t.board.locator(".cover-box.admin")).toContainText("sellProducts");
  await t.board.getByRole("button", { name: "実行" }).click();
  await expect(t.board.locator(".band")).toContainText("ホストが取り消しました");
  await expect(p.getByText(/ホストが取り消しました/)).toBeVisible();
  // 続けて押すと1つ前の操作（問いの答えか出目）が出る
  await t.board.getByRole("button", { name: "1つ取り消す" }).click();
  await expect(t.board.locator(".cover-box.admin")).not.toContainText("sellProducts");
  await t.board.getByRole("button", { name: "やめる" }).click();
  await t.board.getByRole("button", { name: "再開" }).click();
  await t.board.getByRole("button", { name: "閉じる" }).click();
  await expect(p.getByText("一時停止中です")).toHaveCount(0);
  await closeTable(t);
});

test("E2E-22 ホストの確認の間に手番が移ると、STALE_TARGET の文言が出て、次の人の手番は終わらない", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  const p = await rollToMain(t, [2, 3]);
  await openAdmin(t.board);
  await t.board.getByRole("button", { name: "手番を終える" }).click();
  // 確認を出したまま、本人が手番を終える
  await p.getByRole("button", { name: "手番終了" }).click();
  await p.getByRole("button", { name: "終える" }).click();
  const serial = (await readState(t)).turn!.serial;
  await t.board.getByRole("button", { name: "実行" }).click();
  await t.board.getByRole("button", { name: "閉じる" }).click();
  await expect(t.board.getByText("表示が古くなっていました。もう一度確かめてください")).toBeVisible();
  expect((await readState(t)).turn!.serial).toBe(serial);
  await closeTable(t);
});

test("E2E-21 席の再発行のQRを別の端末で読んでも、ホストが承認するまで席が移らない", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  const name = t.names[1]!;
  await openAdmin(t.board);
  await t.board.locator(".cover-box.admin span", { hasText: "席の再発行" }).getByRole("button", { name }).click();
  await t.board.getByRole("button", { name: "実行" }).click();
  const url = await decodeQr(t.board.getByAltText("席の再発行のQRコード"));
  expect(url).toMatch(/\/p\?room=[0-9a-f]{32}&claim=[0-9a-f]{32}$/);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const np = await ctx.newPage();
  await np.goto(url.replace("http://127.0.0.1:8787", ""));
  await expect(np.getByText(`${name} の席に戻りますか？`)).toBeVisible();
  await np.getByRole("button", { name: "戻る" }).click();
  await expect(np.getByText("ホストの承認を待っています")).toBeVisible();
  // 承認の前は、旧端末が席を持ったまま
  const old = t.phones[1]!;
  await expect(old.getByText("別の画面で開かれています")).toHaveCount(0);
  await expect(t.board.getByText(`${name} の席に新しい端末がつながろうとしています。承認しますか？`)).toBeVisible();
  await t.board.getByRole("button", { name: "承認", exact: true }).click();
  await expect(old.getByText("別の画面で開かれています")).toBeVisible();
  await expect(np.locator(".p-play, .cover")).toBeVisible();
  await ctx.close();
  await closeTable(t);
});

test("E2E-13 ゲームの途中でサーバー（Durable Object）を作り直すと、全員が自動で席に戻り、状態が元どおり", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  await rollToMain(t, [2, 3]);
  const before = await readState(t);
  // wrangler dev のプロセスを止める代わりに、試験用の口で Durable Object を作り直させる（保存から読み直す点は同じ）
  await t.board.request.get(`/api/rooms/${t.roomId}/test/restart`).catch(() => undefined);
  const p = await turnPhone(t);
  await expect(p.getByText("あなたの番です")).toBeVisible({ timeout: 15000 });
  await expect(p.getByRole("button", { name: "手番終了" })).toBeEnabled({ timeout: 15000 });
  expect(await readState(t)).toEqual(before);
  await p.getByRole("button", { name: "手番終了" }).click();
  await p.getByRole("button", { name: "終える" }).click();
  await expect.poll(async () => (await readState(t)).turn!.serial).toBe(before.turn!.serial + 1);
  await closeTable(t);
});

test("E2E-05 山が尽きる種類を2人が選ぶと、後の人にだけ問いが出直す", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  await startFast(t);
  const st = await readState(t);
  // cow の山を1枚にする（残りを席2に渡す）
  await give(t, 2, { cards: { cow: st.piles.cow - 1 } });
  const turn = st.turn!.seat;
  const p = await turnPhone(t);
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption("3");
  await sel.nth(1).selectOption("4");
  await p.getByRole("button", { name: "入れる" }).click();
  // 捨て札の問い（席2は手札が多い）に答える
  const p2 = await phoneOfSeat(t, 2);
  if (await p2.getByText(/単語カードを\d+枚捨ててください/).isVisible({ timeout: 2000 }).catch(() => false)) {
    while (await p2.getByRole("button", { name: "捨てる" }).isDisabled()) await p2.locator(".discard button:not([disabled])", { hasText: "＋" }).first().click();
    await p2.getByRole("button", { name: "捨てる" }).click();
    await p2.getByRole("button", { name: "捨てる" }).click();
  }
  // 手番の人と次の人が cow を選ぶ。配る順は手番の人から時計回り
  const first = await phoneOfSeat(t, turn);
  const second = await phoneOfSeat(t, (turn + 1) % 3);
  for (const ph of [first, second]) {
    await expect(ph.getByText("Market day：好きなカードを1枚もらえます")).toBeVisible();
    await ph.locator('.choices button[data-kind="cow"]').click();
    await ph.getByRole("button", { name: "決める" }).click();
  }
  const third = t.phones.find((ph) => ph !== first && ph !== second)!;
  await third.locator(".choices button[data-kind]").first().click();
  await third.getByRole("button", { name: "決める" }).click();
  await expect(second.getByText("選んだカードがなくなりました。選び直してください")).toBeVisible();
  await expect(first.getByText("選んだカードがなくなりました")).toHaveCount(0);
  await closeTable(t);
});

test("E2E-20 ラウンド3の初めに、読み上げる人の名前が大画面に出る", async ({ browser }) => {
  const t = await setupTable(browser, 3, { dice: "manual" });
  const { startAndReachRound3 } = await import("./hooks.ts");
  await startAndReachRound3(t);
  const st = await readState(t);
  const name = await t.board.locator(`.pp[data-seat="${st.turn!.seat}"] .name`).textContent();
  await expect(t.board.locator(".band .read")).toContainText(`${name} さん、新しい注文を読み上げてください`);
  await closeTable(t);
});
