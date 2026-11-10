// 演出の録画用（テストではない）。大画面のコマを Chromium の画面転送で取り、GIF にする材料を書き出す。
//   REC_OUT=<書き出し先> npx playwright test --project=chromium e2e/record.spec.ts
// 場面ごとに <書き出し先>/<場面>/ に JPEG と ffconcat の list.txt ができる。GIF にするには、場面のフォルダごとに
//   ffmpeg -f concat -safe 0 -i list.txt -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" out.gif
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { answerAnyPrompt, closeTable, setupTable, turnPhone } from "./helpers.ts";
import { give, readState, startAndReachRound3 } from "./hooks.ts";

test.skip(!process.env.REC_OUT, "REC_OUT を指定したときだけ流す");
const OUT = process.env.REC_OUT ?? "";
const boardData = JSON.parse(readFileSync("packages/engine/src/data/board.json", "utf-8")) as { tiles: { id: number; vertices: number[] }[] };

async function record(page: Page, name: string, ms: number, action: () => Promise<void>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const frames: { data: string; t: number }[] = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await action();
  await page.waitForTimeout(ms);
  await cdp.send("Page.stopScreencast");
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const file = `${String(i).padStart(4, "0")}.jpg`;
    writeFileSync(`${dir}/${file}`, Buffer.from(f.data, "base64"));
    const next = frames[i + 1]?.t ?? f.t + 0.1;
    lines.push(`file '${file}'`, `duration ${Math.max(0.02, next - f.t).toFixed(3)}`);
  });
  lines.push(`file '${String(frames.length - 1).padStart(4, "0")}.jpg'`);
  writeFileSync(`${dir}/list.txt`, lines.join("\n"));
}

test("rec", async ({ browser }) => {
  test.setTimeout(240_000);
  const t = await setupTable(browser, 4, { dice: "manual" });
  await startAndReachRound3(t);
  await t.board.waitForTimeout(3000);
  // 問いが出ず、タイルからカードがもらえる出目を選ぶ
  const st = await readState(t);
  const houses = new Set(Object.keys(st.board.houses).map(Number));
  const near = (tileId: number) => boardData.tiles.find((x) => x.id === tileId)!.vertices.filter((v) => houses.has(v)).length;
  let best = 0;
  let bestN = 6;
  for (let n = 2; n <= 12; n++) {
    if (n === 7) continue;
    const tiles = st.board.tiles.filter((x) => x.number === n);
    if (tiles.some((x) => (x.kind === "seed" || x.kind === "animal") && near(x.id) > 0)) continue;
    const c = tiles.reduce((a, x) => a + near(x.id), 0);
    if (c > best) [best, bestN] = [c, n];
  }
  const a = Math.min(6, bestN - 1);
  const b = bestN - a;
  const p = await turnPhone(t);
  const seat = st.turn!.seat;
  const sel = p.locator(".dice-input select");
  await sel.nth(0).selectOption(String(a));
  await sel.nth(1).selectOption(String(b));
  await record(t.board, "1-dice", 3800, async () => {
    await p.getByRole("button", { name: "入れる" }).click();
  });
  // 何ももらえなかった人への問い（relief）などに答えてから進む
  for (let g = 0; g < 40 && !(await p.getByRole("button", { name: "植える" }).isVisible()); g++) {
    await answerAnyPrompt(t).catch(() => false);
    await t.board.waitForTimeout(200);
  }

  // 売る
  await give(t, seat, { products: { egg: 3 } }).catch(() => {});
  const s2 = await readState(t);
  const need: Record<string, number> = {};
  for (const [k, want] of [["sell", 2], ["grow", 1], ["potato", 1], ["buy", 1], ["chicken", 1]] as const) {
    const n = Math.min(Math.max(0, want - (s2.players[seat]!.hand[k] ?? 0)), s2.piles[k] ?? 0);
    if (n) need[k] = n;
  }
  await give(t, seat, { cards: need, coins: 6 }).catch(() => {});
  await t.board.waitForTimeout(2000);
  await p.getByRole("button", { name: "市場で売る" }).click();
  await p.locator(".pick button", { hasText: "egg" }).first().click();
  await p.getByRole("button", { name: "＋" }).first().click().catch(() => {});
  await p.getByRole("button", { name: "次へ" }).click();
  await record(t.board, "2-sell", 2200, async () => {
    await p.getByRole("button", { name: "宣言" }).click();
  });

  // 植える
  if (await p.getByRole("button", { name: "植える" }).isEnabled()) {
    await p.getByRole("button", { name: "植える" }).click();
    await p.locator(".pick button", { hasText: "potato" }).click();
    await record(t.board, "3-plant", 1800, async () => {
      await p.getByRole("button", { name: "宣言" }).click();
    });
  }
  // 動物を買う
  await t.board.waitForTimeout(800);
  if (await p.getByRole("button", { name: "動物を買う" }).isEnabled()) {
    await p.getByRole("button", { name: "動物を買う" }).click();
    await p.locator(".pick button", { hasText: "chicken" }).click();
    await record(t.board, "4-animal", 1800, async () => {
      await p.getByRole("button", { name: "宣言" }).click();
    });
  }

  // 注文の成立
  await t.board.waitForTimeout(800);
  const s3 = await readState(t);
  const f = s3.orders.faceUp.find((x) => x.order.cond.k === "exact");
  if (f) {
    const items = (f.order.cond as { items: Record<string, number> }).items;
    await give(t, seat, { cards: (s3.piles.sell ?? 0) > 0 ? { sell: 1 } : {}, products: items }).catch(() => {});
    await t.board.waitForTimeout(1500);
    await p.getByRole("button", { name: "注文" }).click();
    await p.locator(`.order[data-order="${f.order.id}"]`).getByRole("button", { name: "届ける" }).click();
    for (const [k, n] of Object.entries(items)) for (let i = 0; i < n; i++) await p.locator(".pick .row", { hasText: k }).getByRole("button", { name: "増やす" }).click();
    await p.getByRole("button", { name: "次へ" }).click();
    await record(t.board, "5-order", 6200, async () => {
      await p.getByRole("button", { name: "宣言" }).click();
    });
  }
  await closeTable(t);
});
