// 部屋の処理（room.ts）を Node.js で動かすための補助。保存は node:sqlite、接続は偽物、時計は手で進める。
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_VERSION, type AdminOp, type ServerMsg } from "@word-farm/protocol";
import type { Command } from "@word-farm/engine";
import { RoomCore, type Attachment, type Conn, type Deps, type Sql } from "../src/room.ts";

export const HOST_KEY = "host-key-for-test-0123456789";
export const ROOM_ID = "0123456789abcdef0123456789abcdef";
export const VERSION = "0.1.0+testtest";

export function nodeSql(db: DatabaseSync): Sql {
  let depth = 0;
  return {
    exec(q, ...b) {
      const st = db.prepare(q);
      const args = b as (string | number | null)[];
      if (st.columns().length > 0) return st.all(...args) as Record<string, unknown>[];
      st.run(...args);
      return [];
    },
    transaction(fn) {
      if (depth > 0) throw new Error("入れ子のトランザクション（Durable Object の transactionSync では使えない形）");
      depth += 1;
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth -= 1;
      }
    },
  };
}

export class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  closeCode: number | undefined;
  private att: Attachment | null = null;
  private server: Server;
  constructor(server: Server) {
    this.server = server;
  }
  send(d: string): void {
    if (this.closed) throw new Error("closed");
    this.server.bytesSent.push(d);
    this.msgs.push(JSON.parse(d) as ServerMsg);
  }
  close(code?: number): void {
    this.closed = true;
    this.closeCode = code;
    this.server.open.delete(this);
  }
  getAttachment(): Attachment | null {
    return this.att === null ? null : structuredClone(this.att);
  }
  setAttachment(a: Attachment): void {
    // 付箋は直列化して持つ（serializeAttachment と同じく、写しを持つ）
    this.att = JSON.parse(JSON.stringify(a)) as Attachment;
  }
  /** 最後に届いた、種類 t のメッセージ */
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> {
    const m = [...this.msgs].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`${t} が届いていない。届いたもの: ${this.msgs.map((x) => x.t).join(",")}`);
    return m as Extract<ServerMsg, { t: T }>;
  }
  all<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.filter((x) => x.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  clear(): void {
    this.msgs = [];
  }
}

let counter = 0;
/** 決まった順の「乱数」。テストを決定的にする */
export function seqHex(): string {
  counter += 1;
  return createHash("md5").update(`hex-${counter}`).digest("hex");
}

export class Server {
  db = new DatabaseSync(":memory:");
  open = new Set<FakeConn>();
  logs: string[] = [];
  bytesSent: string[] = [];
  time = 1_000_000;
  version = VERSION;
  crashNext = false;
  core: RoomCore;

  constructor(init = true) {
    this.core = this.boot();
    if (init) this.core.init(ROOM_ID);
  }

  deps(): Deps {
    return {
      sql: nodeSql(this.db),
      conns: () => [...this.open],
      now: () => this.time,
      randomHex: seqHex,
      sha256: async (t) => createHash("sha256").update(t).digest("hex"),
      engineVersion: this.version,
      hostKey: HOST_KEY,
      log: (l) => this.logs.push(l),
      afterCommit: () => {
        if (this.crashNext) {
          this.crashNext = false;
          throw new Crash();
        }
      },
    };
  }

  boot(): RoomCore {
    return new RoomCore(this.deps());
  }

  /** Durable Object の作り直し。保存と接続（休止できる WebSocket）は残り、メモリは消える */
  restart(): void {
    this.core = this.boot();
  }

  connect(): FakeConn {
    const c = new FakeConn(this);
    this.open.add(c);
    return c;
  }

  /**
   * 端末の側から接続が切れたときの Durable Object の振る舞いを再現する。
   * 閉じた知らせ（webSocketClose）を処理している間は、閉じた接続がまだ getWebSockets() に残っている
   */
  drop(c: FakeConn): void {
    c.closed = true;
    this.core.onClose(c);
    this.open.delete(c);
  }

  async send(c: FakeConn, m: unknown): Promise<void> {
    try {
      await this.core.onMessage(c, typeof m === "string" ? m : JSON.stringify(m));
    } catch (e) {
      if (e instanceof Crash) {
        this.restart();
        return;
      }
      throw e;
    }
  }

  async hello(c: FakeConn, extra: Record<string, unknown> = {}): Promise<void> {
    await this.send(c, { t: "hello", v: PROTOCOL_VERSION, roomId: ROOM_ID, role: "player", ...extra });
  }

  async board(admin = true): Promise<FakeConn> {
    const c = this.connect();
    await this.send(c, { t: "hello", v: PROTOCOL_VERSION, roomId: ROOM_ID, role: "board", ...(admin ? { hostKey: HOST_KEY } : {}) });
    return c;
  }

  async admin(b: FakeConn, op: AdminOp, id = seqHex()): Promise<string> {
    await this.send(b, { t: "admin", id, op });
    return id;
  }

  async cmd(c: FakeConn, cmd: Command, id = seqHex()): Promise<string> {
    await this.send(c, { t: "cmd", id, cmd });
    return id;
  }

  /** 時計を進める。端末は10秒おきに ping を送るので（BD03 3.7）、開いている接続から ping を送りながら進める */
  async tick(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      const step = Math.min(10_000, left);
      this.time += step;
      left -= step;
      for (const c of [...this.open]) await this.send(c, { t: "ping", n: this.time });
    }
  }

  rows(): Record<string, unknown>[] {
    return this.db.prepare("SELECT * FROM commands ORDER BY seq").all() as Record<string, unknown>[];
  }
}

export class Crash extends Error {}

/** 席の接続と大画面 */
export interface Table {
  srv: Server;
  board: FakeConn;
  /** 席の順の接続 */
  seats: FakeConn[];
  tokens: string[];
}

/** n 人がロビーに入り、ゲームを始めるまで進める */
export async function startTable(n = 4, dice: "server" | "manual" = "manual"): Promise<Table> {
  const srv = new Server();
  const board = await srv.board();
  const players: FakeConn[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = srv.connect();
    await srv.hello(c);
    tokens.push(c.last("welcome").token!);
    await srv.send(c, { t: "join", name: `N${i}` });
    players.push(c);
  }
  await srv.admin(board, { k: "startGame", options: { orderDeck: "generated", dice, animalInclude: false } });
  const seats: FakeConn[] = [];
  const st = srv.core.debugState().state!;
  const ws: string[] = [];
  for (const pl of st.players) {
    const pidIdx = players.findIndex((c) => c.getAttachment()?.pid === pl.participantId);
    seats.push(players[pidIdx]!);
    ws.push(tokens[pidIdx]!);
  }
  return { srv, board, seats, tokens: ws };
}

/** 準備（拠点の配置と問い）を、正しい操作で進める */
export async function finishSetup(t: Table): Promise<void> {
  const { legalActions } = await import("@word-farm/engine");
  for (let guard = 0; guard < 100; guard++) {
    const s = t.srv.core.debugState().state!;
    if (s.turn !== null) return;
    const open = s.prompts.find((p) => !s.answers[p.id]);
    if (open && open.k === "chooseKind") {
      await t.srv.cmd(t.seats[open.seat]!, { t: "answerPrompt", promptId: open.id, answer: { k: "chooseKind", kinds: Array(open.count).fill(open.options[0]) } });
      continue;
    }
    if (s.phase.k === "setupPlace") {
      const step = s.phase.step;
      const seat = step < s.n ? step : 2 * s.n - 1 - step;
      const v = legalActions(s, seat).placeHouse!.vertices[0]!;
      await t.srv.cmd(t.seats[seat]!, { t: "placeHouse", vertex: v });
      continue;
    }
    throw new Error(`準備が進まない ${JSON.stringify(s.phase)}`);
  }
}
