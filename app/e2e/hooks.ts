// E2E の補助のうち、試験用の口（TEST_HOOKS=1 の wrangler dev だけ）を使うものと、対戦中の操作。
import { expect, type Page } from "@playwright/test";
import type { GameState } from "@word-farm/engine";
import { answerAnyPrompt, completeSetup, playEmptyTurn, turnPhone, type Table } from "./helpers.ts";

/** 今の状態を読む（伏せた注文の条件を含む） */
export async function readState(t: Table): Promise<GameState> {
  const r = await t.board.request.get(`/api/rooms/${t.roomId}/test/state`);
  expect(r.status(), "TEST_HOOKS=1 で wrangler dev を起動しているか").toBe(200);
  return ((await r.json()) as { state: GameState }).state;
}

/** 席にカード、産物、コインを渡す */
export async function give(t: Table, seat: number, g: { cards?: Record<string, number>; products?: Record<string, number>; coins?: number }): Promise<void> {
  const r = await t.board.request.post(`/api/rooms/${t.roomId}/test/give`, { data: { seat, ...g } });
  expect(r.status()).toBe(200);
}

/** 席の番号のスマホ。大画面の席の欄の名前と、参加した順の名前を突き合わせる */
export async function phoneOfSeat(t: Table, seat: number): Promise<Page> {
  const name = (await t.board.locator(`.pp[data-seat="${seat}"] .name`).textContent())!;
  return t.phones[t.names.indexOf(name.trim())]!;
}

/** ゲームを始めて準備を終え、ラウンド3の初め（注文が表になる）まで回す */
export async function startAndReachRound3(t: Table): Promise<void> {
  await t.board.getByRole("button", { name: "ゲームを始める" }).click();
  await completeSetup(t);
  const rolls: [number, number][] = [[2, 3], [4, 4], [5, 1], [3, 3], [6, 4], [2, 2], [5, 3], [6, 6]];
  for (const d of rolls.slice(0, t.names.length * 2)) await playEmptyTurn(t, d);
  await expect(t.board.locator(".orders .order:not(.joint)")).toHaveCount(3);
}

/** 手番の人のスマホで出目を入れ、問いに答えて、行動できる段階にする */
export async function rollToMain(t: Table, dice: [number, number]): Promise<Page> {
  const p = await turnPhone(t);
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption(String(dice[0]));
  await sel.nth(1).selectOption(String(dice[1]));
  await p.getByRole("button", { name: "入れる" }).click();
  for (let g = 0; g < 60; g++) {
    if (await answerAnyPrompt(t)) continue;
    if (await p.getByRole("button", { name: "手番終了" }).isEnabled({ timeout: 200 }).catch(() => false)) return p;
    await t.board.waitForTimeout(100);
  }
  throw new Error("行動の段階にならない");
}

/** 注文のタブから、通常の注文に産物を出して宣言する */
export async function deliverOrder(p: Page, orderId: string, items: Record<string, number>, showSentence = false): Promise<void> {
  await p.getByRole("button", { name: "注文" }).click();
  await p.locator(`.order[data-order="${orderId}"]`).getByRole("button", { name: "届ける" }).click();
  for (const [k, n] of Object.entries(items)) {
    const row = p.locator(".pick .row", { hasText: k });
    for (let i = 0; i < n; i++) await row.getByRole("button", { name: "増やす" }).click();
  }
  await p.getByRole("button", { name: "次へ" }).click();
  if (showSentence) await p.getByRole("button", { name: "英文を見る" }).click();
  await p.getByRole("button", { name: "宣言" }).click();
}

/** 管理パネルの操作。確認が2回ある操作は twice */
export async function adminOp(t: Table, label: string, twice = false): Promise<void> {
  await t.board.getByRole("button", { name: "管理" }).click();
  await t.board.getByRole("button", { name: label }).click();
  await t.board.getByRole("button", { name: "実行" }).click();
  if (twice) await t.board.getByRole("button", { name: "実行" }).click();
  await t.board.getByRole("button", { name: "閉じる" }).click().catch(() => undefined);
}
