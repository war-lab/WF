// 端末の側の接続の単体テスト（BD06 TC-SRV-13、13c と BD03 3.5、3.7）
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@word-farm/protocol";
import { Connection, RETRY_MS, type KeyValue, type NetDeps, type SocketLike } from "../src/net/connection.ts";

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  send(d: string): void {
    this.sent.push(JSON.parse(d) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  recv(m: ServerMsg): void {
    this.onmessage?.(JSON.stringify(m));
  }
}

class Mem implements KeyValue {
  m = new Map<string, string>();
  get(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string): void {
    this.m.set(k, v);
  }
  remove(k: string): void {
    this.m.delete(k);
  }
}

class Env implements NetDeps {
  sockets: FakeSocket[] = [];
  durable = new Mem();
  session = new Mem();
  now = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  next = 1;
  n = 0;
  open(): SocketLike {
    const s = new FakeSocket();
    this.sockets.push(s);
    return s;
  }
  setTimer(fn: () => void, ms: number): number {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimer(id: number): void {
    this.timers.delete(id);
  }
  randomHex(): string {
    this.n += 1;
    return this.n.toString(16).padStart(32, "0");
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.now = due[1].at;
      this.timers.delete(due[0]);
      due[1].fn();
    }
    this.now = end;
  }
  get last(): FakeSocket {
    return this.sockets.at(-1)!;
  }
}

const ROOM = "0".repeat(32);
const welcome = (token = "t".repeat(32)): ServerMsg => ({ t: "welcome", participantId: "p1", token, role: "player", admin: false, serverNow: 0, seat: 0 });
const view = (rev: number): ServerMsg => ({ t: "view", view: { rev } as never, events: [], recent: [] });

function setup(): { env: Env; c: Connection } {
  const env = new Env();
  const c = new Connection(env, { url: "ws://x", roomId: ROOM, role: "player" });
  env.last.onopen!();
  return { env, c };
}

describe("表示の受け入れ（TC-SRV-13）", () => {
  it("古い rev の表示が届いても、新しい表示を上書きしない", () => {
    const { env, c } = setup();
    env.last.recv(welcome());
    env.last.recv(view(5));
    env.last.recv(view(7));
    env.last.recv(view(6));
    expect(c.state.rev).toBe(7);
    env.last.recv(view(7));
    expect(c.state.rev).toBe(7);
  });

  it("welcome の直後の最初の表示は、rev が手元より小さくても受け入れる", () => {
    const { env, c } = setup();
    env.last.recv(welcome());
    env.last.recv(view(9));
    env.last.onclose!();
    env.advance(RETRY_MS[0]!);
    env.last.onopen!();
    env.last.recv(welcome());
    env.last.recv(view(3));
    expect(c.state.rev).toBe(3);
  });

  it("今の接続以外（古い接続）から届いたメッセージは、replaced も含めて無視する", () => {
    const { env, c } = setup();
    const old = env.last;
    old.recv(welcome());
    old.onclose!();
    env.advance(RETRY_MS[0]!);
    env.last.onopen!();
    env.last.recv(welcome());
    old.recv({ t: "replaced" });
    old.recv(view(99));
    expect(c.state.status).toBe("open");
    expect(c.state.rev).toBe(-1);
  });
});

describe("未確定のコマンドの送り直し（TC-SRV-13c）", () => {
  it("ack が届く前に切れたコマンドを、再接続の welcome のあとに同じ id で送り直し、ack で消す", () => {
    const { env, c } = setup();
    env.last.recv(welcome());
    const id = c.command({ t: "endTurn" });
    expect(c.state.pending).toEqual([id]);
    expect(env.last.sent.at(-1)).toMatchObject({ t: "cmd", id });
    env.last.onclose!();
    env.advance(RETRY_MS[0]!);
    env.last.onopen!();
    expect(env.last.sent[0]).toMatchObject({ t: "hello", token: "t".repeat(32) });
    env.last.recv(welcome());
    expect(env.last.sent.filter((m) => m.t === "cmd")).toEqual([{ t: "cmd", id, cmd: { t: "endTurn" } }]);
    env.last.recv({ t: "ack", id, rev: 3 });
    expect(c.state.pending).toEqual([]);
  });

  it("画面を読み込み直しても（新しい Connection でも）、sessionStorage の未確定のコマンドを送り直す", () => {
    const { env, c } = setup();
    env.last.recv(welcome());
    const id = c.command({ t: "endTurn" });
    c.stop();
    const c2 = new Connection(env, { url: "ws://x", roomId: ROOM, role: "player" });
    expect(c2.state.pending).toEqual([id]);
    env.last.onopen!();
    env.last.recv(welcome());
    expect(env.last.sent.some((m) => m.t === "cmd" && m.id === id)).toBe(true);
    env.last.recv({ t: "reject", id, code: "NOT_YOUR_TURN" });
    expect(c2.state.pending).toEqual([]);
  });
});

describe("再接続と生存確認（BD03 3.5、3.7）", () => {
  it("1秒、2秒、4秒、以後は5秒おきに再接続を試みる", () => {
    const { env } = setup();
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = env.sockets.length;
      env.last.onclose!();
      const t0 = env.now;
      while (env.sockets.length === before) env.advance(500);
      times.push(env.now - t0);
    }
    expect(times).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it("ping を送ってから10秒 pong が来なければつなぎ直す。pong が来れば続ける", () => {
    const { env } = setup();
    env.last.recv(welcome());
    env.advance(10_000);
    expect(env.last.sent.at(-1)).toMatchObject({ t: "ping" });
    env.last.recv({ t: "pong", n: 1 });
    env.advance(10_000);
    const n = env.sockets.length;
    env.advance(10_000); // 2回目の ping に pong が来ない
    expect(env.sockets.length).toBe(n);
    env.advance(1000); // 再接続の1秒
    expect(env.sockets.length).toBe(n + 1);
  });

  it("画面が見えるようになったら ping を送り、3秒で pong が返らなければつなぎ直す", () => {
    const { env, c } = setup();
    env.last.recv(welcome());
    const n = env.sockets.length;
    c.onVisible();
    expect(env.last.sent.at(-1)).toMatchObject({ t: "ping" });
    env.advance(3000);
    env.advance(1000);
    expect(env.sockets.length).toBe(n + 1);
  });

  it("replaced を受けたら再接続しない。TOKEN ならトークンを消して参加の画面に戻す", () => {
    const a = setup();
    a.env.last.recv(welcome());
    a.env.last.recv({ t: "replaced" });
    expect(a.c.state.status).toBe("replaced");
    a.env.advance(60_000);
    expect(a.env.sockets).toHaveLength(1);
    const b = setup();
    b.env.last.recv(welcome());
    b.env.last.recv({ t: "error", code: "TOKEN", message: "" });
    expect(b.c.state.status).toBe("needJoin");
    expect(b.env.durable.get(`wf:token:${ROOM}`)).toBeNull();
  });
});
