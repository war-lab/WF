// 結合テスト：実際の Durable Object（Miniflare、手元の workerd）で、HTTP の入口、WebSocket、保存、作り直し、試験用の口を確かめる（BD06 6章）。
// 部屋の処理の細かな規則は room.test.ts で確かめる。ここは、Durable Object の包み（index.ts）と Cloudflare の API の使い方を確かめる。
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type PlayerView, type ServerMsg } from "@word-farm/protocol";
import { legalActions, type GameState } from "@word-farm/engine";
import { HOST_KEY, seqHex } from "./harness.ts";

const here = import.meta.dirname;
// 一時フォルダ（%TEMP%）は Windows の短い形式の名前（S25FE~1.AKA など）になり、workerd が起動できなかった。パッケージの中に作る
const work = mkdtempSync(join(resolve(here, ".."), ".mf-test-"));
const script = join(work, "worker.js");

beforeAll(async () => {
  await build({
    entryPoints: [resolve(here, "../src/index.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers"],
    outfile: script,
    logLevel: "silent",
  });
}, 60_000);

afterAll(() => rmSync(work, { recursive: true, force: true }));

async function start(testHooks: boolean, persist = join(work, "do")): Promise<Miniflare> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: script,
      compatibilityDate: "2026-10-27",
      durableObjects: { ROOM: { className: "Room", useSQLite: true } },
      resourcePersistencePath: persist,
      bindings: { HOST_KEY, ...(testHooks ? { TEST_HOOKS: "1" } : {}) },
      serviceBindings: { ASSETS: () => new Response("asset") },
    } as never),
  );
  await mf.ready;
  return mf;
}

const auth = { Authorization: `Bearer ${HOST_KEY}` };

class Client {
  msgs: ServerMsg[] = [];
  ws: WebSocket;
  open: Promise<void>;
  closed = false;
  constructor(base: URL, roomId: string) {
    const u = new URL(`/api/rooms/${roomId}/ws`, base);
    u.protocol = "ws:";
    this.ws = new WebSocket(u);
    this.ws.addEventListener("message", (e) => this.msgs.push(JSON.parse(String(e.data)) as ServerMsg));
    this.ws.addEventListener("close", () => (this.closed = true));
    this.open = new Promise((ok, ng) => {
      this.ws.addEventListener("open", () => ok());
      this.ws.addEventListener("error", () => ng(new Error("ws error")));
    });
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  /** 条件に合うメッセージが届くまで待つ */
  async wait<T extends ServerMsg["t"]>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const t0 = Date.now();
    for (;;) {
      const m = this.msgs.find((x) => x.t === t && pred(x as Extract<ServerMsg, { t: T }>));
      if (m) return m as Extract<ServerMsg, { t: T }>;
      if (Date.now() - t0 > ms) throw new Error(`${t} が来ない。届いたもの: ${this.msgs.map((x) => x.t).join(",")}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async waitClosed(ms = 5000): Promise<void> {
    const t0 = Date.now();
    while (!this.closed) {
      if (Date.now() - t0 > ms) throw new Error("切れない");
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  close(): void {
    this.ws.close();
  }
}

async function createRoom(mf: Miniflare): Promise<string> {
  const r = await mf.dispatchFetch("http://x/api/rooms", { method: "POST", headers: auth });
  expect(r.status).toBe(200);
  return ((await r.json()) as { roomId: string }).roomId;
}

async function hello(c: Client, roomId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await c.open;
  c.send({ t: "hello", v: PROTOCOL_VERSION, roomId, role: "player", ...extra });
}

async function debug(mf: Miniflare, roomId: string): Promise<{ state: GameState | null; rev: number; phase: string; stopped: boolean }> {
  return (await (await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/state`)).json()) as never;
}

describe("Durable Object での結合（TC-SRV）", () => {
  it("TC-SRV-08b 部屋の作成、記録の取り出し、部屋の削除は、鍵のない要求と誤った鍵の要求を拒否する", async () => {
    const mf = await start(true, join(work, "a"));
    try {
      for (const h of [{}, { Authorization: "Bearer wrong" }]) {
        expect((await mf.dispatchFetch("http://x/api/rooms", { method: "POST", headers: h })).status).toBe(401);
      }
      const roomId = await createRoom(mf);
      for (const h of [{}, { Authorization: "Bearer wrong" }]) {
        expect((await mf.dispatchFetch(`http://x/api/rooms/${roomId}/record`, { headers: h })).status).toBe(401);
        expect((await mf.dispatchFetch(`http://x/api/rooms/${roomId}`, { method: "DELETE", headers: h })).status).toBe(401);
      }
      // 鍵があっても、ゲームが終わる前の記録は取り出せない（TC-SRV-08d）
      expect((await mf.dispatchFetch(`http://x/api/rooms/${roomId}/record`, { headers: auth })).status).toBe(409);
      // 画面のファイルは Worker のコードを通さない
      expect(await (await mf.dispatchFetch("http://x/board")).text()).toBe("asset");
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("TC-SRV-08c、08g 作成していない部屋への hello に ROOM を返し、表を作らない。削除した部屋も ROOM", async () => {
    const mf = await start(true, join(work, "b"));
    try {
      const base = await mf.ready;
      const ghost = "1".repeat(32);
      const c = new Client(base, ghost);
      await hello(c, ghost);
      expect((await c.wait("error")).code).toBe("ROOM");
      const tables = (await (await mf.dispatchFetch(`http://x/api/rooms/${ghost}/test/tables`)).json()) as unknown[];
      expect(tables).toEqual([]);

      const roomId = await createRoom(mf);
      expect((await mf.dispatchFetch(`http://x/api/rooms/${roomId}`, { method: "DELETE", headers: auth })).status).toBe(200);
      const d = new Client(base, roomId);
      await hello(d, roomId);
      expect((await d.wait("error")).code).toBe("ROOM");
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("TC-SRV-01〜04、20 実際の Durable Object で、ack、記録、作り直し、障害注入のあとの送り直し", async () => {
    const mf = await start(true, join(work, "c"));
    try {
      const base = await mf.ready;
      const { roomId, seats, tokens } = await playToMainFixed(mf);
      const before = await debug(mf, roomId);
      const seat = before.state!.turn!.seat;
      const c = seats[seat]!;
      // 書き込みの直後、ack の前に作り直させる
      await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/crashNext`);
      const id = seqHex();
      c.send({ t: "cmd", id, cmd: { t: "inputDice", a: 2, b: 2 } });
      await c.waitClosed();
      expect(c.msgs.some((m) => m.t === "ack" && m.id === id)).toBe(false);
      // 作り直しで、確定していない書き込みが残るか消えるかは決まっていない（BD05 2.5）。
      // Miniflare では消えた（2026-11-06）。どちらでも、送り直しで1回だけ適用されればよい
      const after = await debug(mf, roomId);
      expect([before.rev, before.rev + 1]).toContain(after.rev);
      // 再接続して同じ id で送り直すと、1回だけ適用される
      const n = new Client(base, roomId);
      await hello(n, roomId, { token: tokens[seat] });
      expect((await n.wait("welcome")).seat).toBe(seat);
      n.send({ t: "cmd", id, cmd: { t: "inputDice", a: 2, b: 2 } });
      expect((await n.wait("ack", (m) => m.id === id)).rev).toBe(before.rev + 1);
      const fin = await debug(mf, roomId);
      expect(fin.rev).toBe(before.rev + 1);
      expect(fin.state!.turn!.dice).toEqual([2, 2]);
      n.send({ t: "cmd", id, cmd: { t: "inputDice", a: 2, b: 2 } });
      await n.wait("ack", (m) => m.id === id && n.msgs.filter((x) => x.t === "ack" && x.id === id).length === 2);
      expect((await debug(mf, roomId)).rev).toBe(before.rev + 1);
      // 作り直しのあと、表示を受け取れる（TC-SRV-04）
      const v = (await n.wait("view")).view as PlayerView;
      expect(v.me.seat).toBe(seat);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("TC-SRV-04、13b Miniflare を止めて起動し直しても、状態と rev とトークンが残る", async () => {
    const dir = join(work, "d");
    let mf = await start(true, dir);
    let roomId = "";
    let token = "";
    let rev = 0;
    try {
      const r = await playToMainFixed(mf);
      roomId = r.roomId;
      token = r.tokens[1]!;
      rev = (await debug(mf, roomId)).rev;
    } finally {
      await mf.dispose();
    }
    mf = await start(true, dir);
    try {
      expect((await debug(mf, roomId)).rev).toBe(rev);
      const c = new Client(await mf.ready, roomId);
      await hello(c, roomId, { token });
      expect((await c.wait("welcome")).seat).toBe(1);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("TC-SRV-04c、21 エンジンの版を差し替えて作り直すと ENGINE_CHANGED。同じ版なら止まらない", async () => {
    const mf = await start(true, join(work, "e"));
    try {
      const base = await mf.ready;
      const { roomId, tokens } = await playToMainFixed(mf);
      await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/restart`).catch(() => undefined);
      expect((await debug(mf, roomId)).stopped).toBe(false);
      await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/version?v=0.0.0%2Bother000`);
      await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/restart`).catch(() => undefined);
      expect((await debug(mf, roomId)).stopped).toBe(true);
      const c = new Client(base, roomId);
      await hello(c, roomId, { token: tokens[0] });
      expect((await c.wait("error")).code).toBe("ENGINE_CHANGED");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("TC-SRV-17 試験用の設定がなければ、障害注入と状態の読み込みの口は無効", async () => {
    const mf = await start(false, join(work, "f"));
    try {
      const roomId = await createRoom(mf);
      for (const p of ["state", "crashNext", "version", "restart", "tables", "give", "advance"]) {
        expect((await mf.dispatchFetch(`http://x/api/rooms/${roomId}/test/${p}`)).status).toBe(404);
      }
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

/** 4人で部屋に入り、ゲームを始めて、準備を終える。席と接続は participantId で対応づける */
async function playToMainFixed(mf: Miniflare): Promise<{ roomId: string; board: Client; seats: Client[]; tokens: string[] }> {
  const base = await mf.ready;
  const roomId = await createRoom(mf);
  const board = new Client(base, roomId);
  await board.open;
  board.send({ t: "hello", v: PROTOCOL_VERSION, roomId, role: "board", hostKey: HOST_KEY });
  await board.wait("welcome");
  const ps: { c: Client; pid: string; token: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const c = new Client(base, roomId);
    await hello(c, roomId);
    const w = await c.wait("welcome");
    c.send({ t: "join", name: `M${i}` });
    ps.push({ c, pid: w.participantId!, token: w.token! });
  }
  await board.wait("lobby", (m) => m.lobby.canStart);
  board.send({ t: "admin", id: seqHex(), op: { k: "startGame", options: { orderDeck: "fixed", dice: "manual", animalInclude: false } } });
  await board.wait("view");
  const st0 = (await debug(mf, roomId)).state!;
  const bySeat = st0.players.map((pl) => ps.find((p) => p.pid === pl.participantId)!);
  const seats = bySeat.map((p) => p.c);
  for (let g = 0; g < 60; g++) {
    const s = (await debug(mf, roomId)).state!;
    if (s.turn !== null) break;
    const p = s.prompts.find((x) => !s.answers[x.id]);
    const id = seqHex();
    if (p && p.k === "chooseKind") {
      seats[p.seat]!.send({ t: "cmd", id, cmd: { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array(p.count).fill(p.options[0]) } } });
      await seats[p.seat]!.wait("ack", (m) => m.id === id);
      continue;
    }
    if (s.phase.k === "setupPlace") {
      const step = s.phase.step;
      const seat = step < s.n ? step : 2 * s.n - 1 - step;
      seats[seat]!.send({ t: "cmd", id, cmd: { t: "placeHouse", vertex: legalActions(s, seat).placeHouse!.vertices[0]! } });
      await seats[seat]!.wait("ack", (m) => m.id === id);
    }
  }
  return { roomId, board, seats, tokens: bySeat.map((p) => p.token) };
}
