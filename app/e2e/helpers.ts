// E2E の補助。大画面1つとスマホ n 台を、記憶を分けたブラウザのコンテキストで開く
import { expect, type Browser, type BrowserContext, type Page, devices } from "@playwright/test";

export const HOST_KEY = process.env.E2E_HOST_KEY ?? "local-dev-host-key";

export interface Table {
  board: Page;
  boardCtx: BrowserContext;
  phones: Page[];
  phoneCtx: BrowserContext[];
  roomId: string;
  names: string[];
}

export async function openBoard(browser: Browser, opts: { dice?: "server" | "manual"; orderDeck?: "generated" | "fixed" } = {}): Promise<{ page: Page; ctx: BrowserContext; roomId: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto("/board");
  await page.getByLabel("ホストの鍵").fill(HOST_KEY);
  if (opts.dice) await page.getByLabel("サイコロ").selectOption(opts.dice);
  if (opts.orderDeck) await page.getByLabel("注文の山").selectOption(opts.orderDeck);
  await page.getByRole("button", { name: "部屋を開く" }).click();
  await page.waitForURL(/\/board\?room=/);
  const roomId = new URL(page.url()).searchParams.get("room")!;
  await expect(page.getByAltText("参加のQRコード")).toBeVisible();
  return { page, ctx, roomId };
}

export async function joinPhone(browser: Browser, roomId: string, name: string, i: number): Promise<{ page: Page; ctx: BrowserContext }> {
  const dev = i % 2 === 0 ? devices["iPhone 13"] : devices["Pixel 7"];
  const ctx = await browser.newContext({ ...dev, defaultBrowserType: undefined } as never);
  const page = await ctx.newPage();
  await page.goto(`/p?room=${roomId}`);
  await page.getByLabel("名前").fill(name);
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page.getByText("ホストがゲームを始めるのを待っています")).toBeVisible();
  return { page, ctx };
}

export async function setupTable(browser: Browser, n = 4, opts: { dice?: "server" | "manual"; orderDeck?: "generated" | "fixed" } = {}): Promise<Table> {
  const b = await openBoard(browser, opts);
  const names = ["Aki", "Ben", "Chika", "Dan"].slice(0, n);
  const phones: Page[] = [];
  const phoneCtx: BrowserContext[] = [];
  for (const [i, nm] of names.entries()) {
    const p = await joinPhone(browser, b.roomId, nm, i);
    phones.push(p.page);
    phoneCtx.push(p.ctx);
  }
  return { board: b.page, boardCtx: b.ctx, phones, phoneCtx, roomId: b.roomId, names };
}

export async function closeTable(t: Table): Promise<void> {
  for (const c of [t.boardCtx, ...t.phoneCtx]) await c.close();
}
