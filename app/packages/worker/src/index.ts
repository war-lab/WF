// 入口の Worker と部屋の Durable Object（BD05 1章）。部屋の処理の本体は room.ts にある。
import { DurableObject } from "cloudflare:workers";
import { hex32 } from "@word-farm/protocol";
import { ENGINE_VERSION } from "./engine-version.ts";
import { RoomCore, safeEqual, type Attachment, type Conn, type Deps } from "./room.ts";

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace<Room>;
  /** ホストの鍵（BD05 1.2）。wrangler secret put HOST_KEY で設定する */
  HOST_KEY?: string;
  /** "1" のときだけ試験用の口（障害注入、状態の読み込み、版の差し替え）を開く（BD06 TC-SRV-17）。本番では設定しない */
  TEST_HOOKS?: string;
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(): string {
  return hexOf(crypto.getRandomValues(new Uint8Array(16)));
}

async function sha256(text: string): Promise<string> {
  return hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export class Room extends DurableObject<Env> {
  private core!: RoomCore;
  private conns = new WeakMap<WebSocket, Conn>();
  /** 試験用：次の書き込みの確定の直後に作り直させる */
  private crashNext = false;
  /** 試験用：エンジンの版を差し替える（TC-SRV-04c、21） */
  private versionOverride: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 読み込みの途中に要求が割り込まないようにする（BD05 2.7）
    void ctx.blockConcurrencyWhile(async () => {
      this.versionOverride = env.TEST_HOOKS === "1" ? ((await ctx.storage.get<string>("test:version")) ?? null) : null;
      this.core = new RoomCore(this.deps());
    });
  }

  private conn(ws: WebSocket): Conn {
    let c = this.conns.get(ws);
    if (!c) {
      c = {
        send: (d) => ws.send(d),
        close: (code, reason) => ws.close(code, reason),
        getAttachment: () => (ws.deserializeAttachment() as Attachment | null) ?? null,
        setAttachment: (a) => ws.serializeAttachment(a),
      };
      this.conns.set(ws, c);
    }
    return c;
  }

  private deps(): Deps {
    const sql = this.ctx.storage.sql;
    return {
      sql: {
        exec: (q, ...b) => sql.exec(q, ...b).toArray() as Record<string, unknown>[],
        transaction: (fn) => this.ctx.storage.transactionSync(fn),
      },
      conns: () => this.ctx.getWebSockets().map((ws) => this.conn(ws)),
      now: () => Date.now(),
      randomHex,
      sha256,
      engineVersion: this.versionOverride ?? ENGINE_VERSION,
      hostKey: this.env.HOST_KEY ?? "",
      log: (line) => console.log(`[room] ${line}`),
      afterCommit: () => {
        if (this.crashNext) {
          this.crashNext = false;
          // 書き込みの確定の直後、ack の前に作り直させる（BD06 TC-SRV-03、20）
          this.ctx.abort("test: crash after commit");
        }
      },
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/rooms\/[0-9a-f]{32}/, "");
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      // 休止できる WebSocket（BD05 1.1）
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/init" && request.method === "POST") {
      this.core.init(url.searchParams.get("room") ?? "");
      return Response.json({ ok: true });
    }
    if (path === "/record" && request.method === "GET") {
      const r = this.core.record(url.searchParams.get("states") === "1");
      return r.ok ? Response.json(r.body) : Response.json({ error: r.error }, { status: r.status });
    }
    if (path === "" && request.method === "DELETE") {
      if (!this.core.isInitialized) return Response.json({ error: "ROOM" }, { status: 404 });
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "deleted");
      await this.ctx.storage.deleteAll();
      this.core = new RoomCore(this.deps());
      return Response.json({ ok: true });
    }
    if (this.env.TEST_HOOKS === "1") {
      if (path === "/test/state") return Response.json(this.core.debugState());
      if (path === "/test/crashNext") {
        this.crashNext = true;
        return Response.json({ ok: true });
      }
      if (path === "/test/version") {
        await this.ctx.storage.put("test:version", url.searchParams.get("v") ?? "");
        return Response.json({ ok: true });
      }
      if (path === "/test/restart") this.ctx.abort("test: restart");
      if (path === "/test/tables") return Response.json(this.ctx.storage.sql.exec("SELECT name FROM sqlite_master").toArray());
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.core.onMessage(this.conn(ws), message);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.core.onClose(this.conn(ws));
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.core.onClose(this.conn(ws));
  }
}

function authorized(request: Request, env: Env): boolean {
  const h = request.headers.get("Authorization") ?? "";
  const key = h.startsWith("Bearer ") ? h.slice(7) : "";
  return env.HOST_KEY !== undefined && env.HOST_KEY !== "" && safeEqual(key, env.HOST_KEY);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // 部屋の作成（BD05 2.11）
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!authorized(request, env)) return Response.json({ error: "NOT_ADMIN" }, { status: 401 });
      const roomId = randomHex();
      await env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(`https://room/init?room=${roomId}`, { method: "POST" });
      console.log("[worker] room created");
      return Response.json({ roomId });
    }
    const m = /^\/api\/rooms\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m || !hex32.safeParse(m[1]).success) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1]!));
    const rest = m[2] ?? "";
    if (rest === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return stub.fetch(request);
    }
    if (rest.startsWith("/test/")) {
      if (env.TEST_HOOKS !== "1") return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      return stub.fetch(request);
    }
    // 記録の取り出しと部屋の削除は、ホストの鍵を示した要求だけ（BD05 1.2）
    if (!authorized(request, env)) return Response.json({ error: "NOT_ADMIN" }, { status: 401 });
    if (rest === "/record" && request.method === "GET") return stub.fetch(request);
    if (rest === "" && request.method === "DELETE") return stub.fetch(request);
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
