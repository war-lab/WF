// E2E の補助。大画面1つとスマホ n 台を、記憶を分けたブラウザのコンテキストで開く
import { expect, test, webkit, type Browser, type BrowserContext, type Page, devices } from "@playwright/test";

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

let webkitBrowser: Promise<Browser> | null = null;

/**
 * スマホのブラウザ。構成 mixed では、実際の端末に合わせて iPhone 役（偶数番目）を WebKit で開く（BD06 7章）。
 * 大画面と Android 役は Chromium のまま（ホストPCは Chrome か Edge）
 */
async function phoneBrowser(browser: Browser, i: number): Promise<Browser> {
  if (test.info().project.name !== "mixed" || i % 2 !== 0) return browser;
  webkitBrowser ??= webkit.launch();
  return webkitBrowser;
}

export async function joinPhone(browser: Browser, roomId: string, name: string, i: number): Promise<{ page: Page; ctx: BrowserContext }> {
  const dev = i % 2 === 0 ? devices["iPhone 13"] : devices["Pixel 7"];
  const b = await phoneBrowser(browser, i);
  const { defaultBrowserType: _d, ...devOpts } = dev;
  // WebKit は isMobile に対応しない端末の設定があるため、Chromium 以外では外す
  const opts = b === browser ? devOpts : { ...devOpts, isMobile: false };
  const ctx = await b.newContext(opts);
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

/** 準備を最後まで進める。拠点を置く番のスマホで最初の候補を選んで置き、問いには最初の選択肢で答える */
export async function completeSetup(t: Table): Promise<void> {
  for (let guard = 0; guard < 80; guard++) {
    if (await t.board.locator(".h-game .top .who").filter({ hasText: "の手番" }).count()) return;
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
      const choice = p.locator(".choices button[data-kind]:not([disabled])");
      if (await choice.count()) {
        const need = await p.getByText(/あと\d+枚選んでください/).count();
        await choice.first().click();
        if (need) while (await p.getByRole("button", { name: "決める" }).isDisabled()) await choice.first().click();
        await p.getByRole("button", { name: "決める" }).click();
        acted = true;
        break;
      }
    }
    if (!acted) await t.board.waitForTimeout(150);
  }
  for (const [i, p] of t.phones.entries()) await p.screenshot({ path: `e2e/.out/stuck-phone${i}.png` });
  throw new Error("準備が終わらない");
}

/** 1台のスマホに出ている問いに、最初の選択肢で答える。答えたら true */
export async function answerPromptOn(p: Page): Promise<boolean> {
  const choice = p.locator(".choices button[data-kind]:not([disabled])");
  const decide = p.getByRole("button", { name: "決める" });
  if (await decide.count()) {
    // 収入の問いは、前回の種類を選んだ状態で出る（BD04 3.6.1）。そのときはすぐに決められる
    for (let k = 0; k < 6 && (await decide.isDisabled({ timeout: 500 }).catch(() => false)); k++) {
      if (!(await choice.count())) break;
      await choice.first().click();
      // 遅い端末（WebKit）では、押してから選んだものの表示が変わるまで間がある
      await expect(p.getByText("選んだもの：なし")).toHaveCount(0, { timeout: 3000 }).catch(() => undefined);
    }
    if (await decide.isDisabled({ timeout: 500 }).catch(() => false)) {
      await p.screenshot({ path: "e2e/.out/prompt-stuck.png" });
      throw new Error("問いに答えられない");
    }
    // 押す直前に問いが閉じることがある（ほかの人の答えで処理が進んだとき）
    await decide.click({ timeout: 2000 }).catch(() => undefined);
    return true;
  }
  const plus = p.locator(".discard button", { hasText: "＋" });
  if (await plus.count()) {
    while (await p.getByRole("button", { name: "捨てる" }).isDisabled()) {
      const btn = p.locator(".discard button:not([disabled])", { hasText: "＋" }).first();
      await btn.click();
    }
    await p.getByRole("button", { name: "捨てる" }).click();
    await p.getByRole("button", { name: "捨てる" }).click();
    return true;
  }
  return false;
}

/** 開いている問いに、どのスマホでも最初の選択肢で答える。答えたら true */
export async function answerAnyPrompt(t: Table): Promise<boolean> {
  for (const p of t.phones) if (await answerPromptOn(p)) return true;
  return false;
}

/** 手番の人のスマホ */
export async function turnPhone(t: Table): Promise<import("@playwright/test").Page> {
  // 画面の「あなたの番です」だけで探すと、手番を終えた直後の人のスマホ（表示が古いまま）を拾うことがある。
  // サーバーの状態から手番の席を取り、その席のスマホに「あなたの番です」が出るまで待つ
  for (let g = 0; g < 50; g++) {
    const r = await t.board.request.get(`/api/rooms/${t.roomId}/test/state`);
    const seat = r.ok() ? ((await r.json()) as { state: { turn: { seat: number } | null } }).state.turn?.seat : undefined;
    if (seat !== undefined) {
      const name = (await t.board.locator(`.pp[data-seat="${seat}"] .name`).textContent())?.trim();
      const p = name ? t.phones[t.names.indexOf(name)] : undefined;
      if (p && (await p.getByText("あなたの番です").isVisible())) return p;
    }
    await t.board.waitForTimeout(100);
  }
  throw new Error("手番の人のスマホが見つからない");
}

/** 1手番を、出目を入れて問いに答え、何もせずに終える */
export async function playEmptyTurn(t: Table, dice: [number, number]): Promise<void> {
  const p = await turnPhone(t);
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption(String(dice[0]));
  await sel.nth(1).selectOption(String(dice[1]));
  await p.getByRole("button", { name: "入れる" }).click();
  let ready = false;
  for (let g = 0; g < 60 && !ready; g++) {
    if (await answerAnyPrompt(t)) continue;
    ready = await p.getByRole("button", { name: "手番終了" }).isEnabled({ timeout: 200 }).catch(() => false);
    if (!ready) await t.board.waitForTimeout(100);
  }
  if (!ready) {
    for (const [i, ph] of t.phones.entries()) await ph.screenshot({ path: `e2e/.out/turn-stuck-${i}.png` });
    throw new Error("手番終了を押せる状態にならない");
  }
  await p.getByRole("button", { name: "手番終了" }).click();
  await p.getByRole("button", { name: "終える" }).click();
  await expect(p.getByText("あなたの番です")).toHaveCount(0);
}
