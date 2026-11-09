// 部屋の処理の本体（BD05 1〜3章、BD03 3章）。
// 保存（SQL）、接続、時刻、乱数、ハッシュ、エンジンの版を外から受け取る。Durable Object（index.ts）と単体テストで同じコードを動かすためである。
// コマンドの処理の途中では await しない（BD05 1.3）。await するのは hello のトークンのハッシュだけで、そのあとで状態を読み直す。
import {
  apply,
  createGame,
  defaultConfig,
  viewFor,
  type Actor,
  type Color,
  type Command,
  type EngineEvent,
  type GameState,
  type PromptAnswer,
  type WordCard,
  type RejectCode,
  type RuleConfig,
  type Seat,
} from "@word-farm/engine";
import {
  MAX_CLIENT_BYTES,
  MAX_SERVER_BYTES,
  PROTOCOL_VERSION,
  clientMsgSchema,
  hex32,
  type AdminOp,
  type BoardView,
  type ClientMsg,
  type ClockView,
  type EventBody,
  type GameEvent,
  type LobbyView,
  type PlayerView,
  type ProtocolErrorCode,
  type ServerMsg,
} from "@word-farm/protocol";

// ---------- 外から受け取るもの ----------

export type Row = Record<string, unknown>;

/** SQLite。Durable Object では ctx.storage.sql と transactionSync、テストでは node:sqlite で作る */
export interface Sql {
  exec(query: string, ...binds: unknown[]): Row[];
  transaction<T>(fn: () => T): T;
}

/** 接続の付箋（BD05 2.7）。休止の間も残る。16KB 以内 */
export interface Attachment {
  role: "player" | "board";
  /** 参加者の識別子。ロビーで join する前は、hello で作った識別子 */
  pid: string | null;
  /** join する前のトークンのハッシュ。join で参加者の表に移す */
  pendingTokenHash: string | null;
  admin: boolean;
  /** 席の再発行の合言葉で入った接続（BD03 3.6） */
  claim: { code: string; seat: Seat; confirmed: boolean } | null;
}

export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  getAttachment(): Attachment | null;
  setAttachment(a: Attachment): void;
}

export interface Deps {
  sql: Sql;
  /** 今つながっている接続（Durable Object では ctx.getWebSockets()） */
  conns(): Conn[];
  now(): number;
  /** 128ビットの乱数の16進表記（32文字） */
  randomHex(): string;
  sha256(text: string): Promise<string>;
  /** 今のコードのエンジンの版（BD05 2.2） */
  engineVersion: string;
  /** ホストの鍵（BD05 1.2）。未設定なら空文字で、管理は誰にも許さない */
  hostKey: string;
  log(line: string): void;
  /** 試験用の障害注入の口（BD06 6章 TC-SRV-03、20）。書き込みの確定の直後、ack の前に呼ぶ。本番では渡さない */
  afterCommit?: () => void;
}

// ---------- 定数 ----------

const COLORS: Color[] = ["red", "blue", "green", "yellow"];
const RECENT_MAX = 30;
const STALE_MS = 30_000;
const CLAIM_MS = 5 * 60_000;
const BAD_LIMIT = 10;
const BAD_WINDOW_MS = 10_000;

interface RoomRow {
  phase: "lobby" | "game" | "over";
  rev: number;
  startedAt: number | null;
  pausedTotalMs: number;
  pausedSince: number | null;
  eventSeq: number;
  recent: GameEvent[];
}

interface Participant {
  participantId: string;
  name: string;
  ord: number;
  seat: Seat | null;
  color: Color;
  rate: 1 | 2;
  tokenHash: string;
}

export interface Meta {
  format: 1;
  roomId: string;
  createdAt: string;
  engineVersion: string;
  rulesVersion: string;
  config: RuleConfig;
  seed: string;
  n: number;
}

type RejectAny = RejectCode;

/** 鍵の比較。長さによらず一定の時間で比べる（BD05 1.2） */
export function safeEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  return diff === 0 && a.length > 0;
}

/** 代わりに答えるときの既定の答え（BD04 2.5）。種類の選択は既定の種類か最初の選択肢、捨て札は多く持つ種類から */
export function defaultAnswer(s: GameState, promptId: string): PromptAnswer | null {
  const p = s.prompts.find((x) => x.id === promptId);
  if (!p) return null;
  if (p.k === "chooseKind") return { k: "chooseKind", kinds: Array<WordCard>(p.count).fill(p.preset ?? p.options[0]!) };
  const hand = Object.entries(s.players[p.seat]!.hand).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const cards: Partial<Record<WordCard, number>> = {};
  let left = p.count;
  for (let progress = true; left > 0 && progress; ) {
    progress = false;
    for (const [k, v] of hand) {
      const have = (v ?? 0) - (cards[k as WordCard] ?? 0);
      if (left > 0 && have > 0) {
        cards[k as WordCard] = (cards[k as WordCard] ?? 0) + 1;
        left -= 1;
        progress = true;
      }
    }
  }
  return { k: "discard", cards };
}

/** 準備の拠点の配置で、今置く席（BD01 6.2。蛇の順） */
function setupSeat(s: GameState): Seat | null {
  if (s.phase.k !== "setupPlace") return null;
  const step = s.phase.step;
  return step < s.n ? step : 2 * s.n - 1 - step;
}

/** 取り消しの確認に出す、人が読める説明（BD05 2.9 の手順1）。文言は BD04 で整える */
export function summarize(cmd: Command | { t: string }, who: string): string {
  const c = cmd as Record<string, unknown>;
  const detail = Object.entries(c)
    .filter(([k]) => k !== "t")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  return `${who}：${String(c.t)}${detail ? ` ${detail}` : ""}`;
}

export class RoomCore {
  private d: Deps;
  /** 初期化されていない部屋（BD05 2.11）。表がない */
  private initialized = false;
  /** 記録を作ったエンジンと今のエンジンの版が違い、止めた部屋（BD05 2.10） */
  private stopped: { recorded: string; current: string } | null = null;
  private room!: RoomRow;
  private meta: Meta | null = null;
  private state: GameState | null = null;
  /** 拒否の表（BD05 1.3 の手順3）。メモリにだけ持つ */
  private rejects = new Map<string, { code: RejectAny; detail?: string }>();
  /** 接続ごとの最後に受け取った時刻（BD03 3.7）。メモリにだけ持つ */
  private lastSeen = new Map<Conn, number>();
  /** 接続ごとの形の誤りの時刻（BD03 3.8） */
  private bad = new Map<Conn, number[]>();
  /** 席の再発行の合言葉（BD03 3.6）。メモリにだけ持つ。作り直しで消えたら、ホストがもう一度押す */
  private claims = new Map<string, { seat: Seat; expires: number; used: boolean }>();

  constructor(deps: Deps) {
    this.d = deps;
    this.load();
  }

  // ---------- 読み込み（BD05 2.7） ----------

  private load(): void {
    const t = this.d.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room'");
    if (t.length === 0) {
      this.initialized = false;
      return;
    }
    this.initialized = true;
    const r = this.d.sql.exec("SELECT * FROM room WHERE id = 1")[0]!;
    this.room = {
      phase: r.phase as RoomRow["phase"],
      rev: Number(r.rev),
      startedAt: r.startedAt === null ? null : Number(r.startedAt),
      pausedTotalMs: Number(r.pausedTotalMs),
      pausedSince: r.pausedSince === null ? null : Number(r.pausedSince),
      eventSeq: Number(r.eventSeq),
      recent: JSON.parse(String(r.recent)) as GameEvent[],
    };
    const m = this.d.sql.exec("SELECT json FROM meta WHERE id = 1")[0];
    this.meta = m ? (JSON.parse(String(m.json)) as Meta) : null;
    if (this.meta && this.meta.engineVersion !== this.d.engineVersion) {
      // 例外を投げない。コンストラクタで投げると作り直しを繰り返すため（BD05 2.7 の手順3）
      this.stopped = { recorded: this.meta.engineVersion, current: this.d.engineVersion };
      this.d.log(`engine changed: recorded=${this.meta.engineVersion} current=${this.d.engineVersion}`);
    }
    const last = this.d.sql.exec("SELECT state FROM commands ORDER BY seq DESC LIMIT 1")[0];
    this.state = last ? (JSON.parse(String(last.state)) as GameState) : null;
    // 休止から戻ったときは、すべての接続の時刻を戻った時点とみなす（BD05 2.7）
    const now = this.d.now();
    for (const c of this.d.conns()) this.lastSeen.set(c, now);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** 部屋の作成（BD05 2.11 の手順2）。表を作るのはここだけ */
  init(roomId: string): void {
    if (this.initialized) return;
    const sql = this.d.sql;
    sql.transaction(() => {
      sql.exec("CREATE TABLE room (id INTEGER PRIMARY KEY CHECK (id = 1), roomId TEXT NOT NULL, phase TEXT NOT NULL, rev INTEGER NOT NULL, startedAt INTEGER, pausedTotalMs INTEGER NOT NULL, pausedSince INTEGER, eventSeq INTEGER NOT NULL, recent TEXT NOT NULL)");
      sql.exec("CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)");
      sql.exec("CREATE TABLE participants (participantId TEXT PRIMARY KEY, name TEXT NOT NULL, ord INTEGER NOT NULL, seat INTEGER, color TEXT NOT NULL, rate INTEGER NOT NULL, tokenHash TEXT NOT NULL)");
      sql.exec(
        "CREATE TABLE commands (seq INTEGER PRIMARY KEY, rev INTEGER NOT NULL, at TEXT NOT NULL, elapsedMs INTEGER NOT NULL, id TEXT NOT NULL, actor TEXT NOT NULL, cmd TEXT NOT NULL, meta TEXT, undo TEXT, state TEXT NOT NULL)",
      );
      sql.exec("CREATE UNIQUE INDEX commands_id ON commands (id)");
      sql.exec("INSERT INTO room (id, roomId, phase, rev, startedAt, pausedTotalMs, pausedSince, eventSeq, recent) VALUES (1, ?, 'lobby', 0, NULL, 0, NULL, 0, '[]')", roomId);
    });
    this.load();
    this.d.log("room initialized");
  }

  get roomId(): string | null {
    if (!this.initialized) return null;
    return String(this.d.sql.exec("SELECT roomId FROM room WHERE id = 1")[0]!.roomId);
  }

  // ---------- 保存の補助 ----------

  private saveRoom(): void {
    const r = this.room;
    this.d.sql.exec(
      "UPDATE room SET phase = ?, rev = ?, startedAt = ?, pausedTotalMs = ?, pausedSince = ?, eventSeq = ?, recent = ? WHERE id = 1",
      r.phase,
      r.rev,
      r.startedAt,
      r.pausedTotalMs,
      r.pausedSince,
      r.eventSeq,
      JSON.stringify(r.recent),
    );
  }

  private participants(): Participant[] {
    return this.d.sql.exec("SELECT * FROM participants ORDER BY ord").map((r) => ({
      participantId: String(r.participantId),
      name: String(r.name),
      ord: Number(r.ord),
      seat: r.seat === null ? null : Number(r.seat),
      color: r.color as Color,
      rate: Number(r.rate) as 1 | 2,
      tokenHash: String(r.tokenHash),
    }));
  }

  private elapsedMs(now: number): number {
    const r = this.room;
    if (r.startedAt === null) return 0;
    return now - r.startedAt - r.pausedTotalMs - (r.pausedSince !== null ? now - r.pausedSince : 0);
  }

  private clock(now: number): ClockView {
    return { startedAt: this.room.startedAt, elapsedMs: this.elapsedMs(now), serverNow: now };
  }

  // ---------- 送信 ----------

  private send(c: Conn, m: ServerMsg): void {
    const s = JSON.stringify(m);
    if (s.length > MAX_SERVER_BYTES) {
      // 設計の誤りとして記録に残し、送らない（BD03 3.8）
      this.d.log(`message too large: t=${m.t} bytes=${s.length}`);
      return;
    }
    try {
      c.send(s);
    } catch {
      // 切れた接続への送信は捨てる
    }
  }

  private error(c: Conn, code: ProtocolErrorCode, message: string, close = false): void {
    this.send(c, { t: "error", code, message });
    if (close) c.close(1008, code);
  }

  /** 閉じた接続。Durable Object では、閉じた知らせを処理している間は、まだ getWebSockets() に残るため、明示的に除く */
  private closed = new WeakSet<Conn>();

  private live(): Conn[] {
    return this.d.conns().filter((c) => !this.closed.has(c));
  }

  private connectedPids(): Set<string> {
    const out = new Set<string>();
    for (const c of this.live()) {
      const a = c.getAttachment();
      if (a?.role === "player" && a.pid && !a.pendingTokenHash) out.add(a.pid);
    }
    return out;
  }

  private lobbyView(): LobbyView {
    const on = this.connectedPids();
    const ps = this.participants();
    return {
      roomId: this.roomId ?? "",
      rev: this.room.rev,
      participants: ps.map((p) => ({ id: p.participantId, name: p.name, color: p.color, rate: p.rate, order: p.ord, connected: on.has(p.participantId) })),
      canStart: (ps.length === 3 || ps.length === 4) && ps.every((p) => on.has(p.participantId)),
      gameStarted: this.room.phase !== "lobby",
    };
  }

  /** 最後の有効な行（BD05 2.9）。取り消しの行と、取り消された行を除く */
  private lastValid(): { seq: number; actor: string; cmd: string; state: string } | null {
    const undone = new Set<number>();
    for (const r of this.d.sql.exec("SELECT undo FROM commands WHERE undo IS NOT NULL")) {
      for (const s of (JSON.parse(String(r.undo)) as { seqs: number[] }).seqs) undone.add(s);
    }
    for (const r of this.d.sql.exec("SELECT seq, actor, cmd, state FROM commands WHERE undo IS NULL ORDER BY seq DESC")) {
      const seq = Number(r.seq);
      if (!undone.has(seq)) return { seq, actor: String(r.actor), cmd: String(r.cmd), state: String(r.state) };
    }
    return null;
  }

  private whoName(actor: Actor | { k: "server" }): string {
    if (actor.k === "admin") return "ホスト";
    if (actor.k === "server") return "サーバー";
    const p = this.participants().find((x) => x.seat === actor.seat);
    return p ? p.name : `席${actor.seat}`;
  }

  private lastCommand(): { seq: number; summary: string } | null {
    const l = this.lastValid();
    if (!l) return null;
    const actor = JSON.parse(l.actor) as Actor | { k: "server" };
    if (actor.k === "server") return null;
    return { seq: l.seq, summary: summarize(JSON.parse(l.cmd) as Command, this.whoName(actor)) };
  }

  private viewFor(a: Attachment, now: number): BoardView | PlayerView {
    const s = this.state!;
    const on = this.connectedPids();
    const ps = this.participants();
    const seatOf = a.role === "player" && a.pid ? ps.find((p) => p.participantId === a.pid)?.seat ?? null : null;
    const base = seatOf === null ? viewFor(s, "board") : viewFor(s, seatOf);
    const players = base.players.map((pl) => {
      const p = ps.find((x) => x.participantId === pl.participantId);
      return { ...pl, name: p?.name ?? pl.participantId, connected: p ? on.has(p.participantId) : false };
    });
    return {
      ...base,
      players,
      rev: this.room.rev,
      paused: this.room.pausedSince !== null,
      clock: this.clock(now),
      lastCommand: a.role === "board" && a.admin ? this.lastCommand() : null,
    } as BoardView | PlayerView;
  }

  /** 状態か参加者が変わったあと、全端末に今の表示を送る（BD03 3.3） */
  private broadcast(events: GameEvent[]): void {
    const now = this.d.now();
    for (const c of this.live()) {
      const a = c.getAttachment();
      if (!a) continue;
      this.sendCurrent(c, a, now, events);
    }
  }

  private sendCurrent(c: Conn, a: Attachment, now: number, events: GameEvent[]): void {
    if (this.room.phase === "lobby" || !this.state) {
      this.send(c, { t: "lobby", lobby: this.lobbyView() });
      return;
    }
    this.send(c, { t: "view", view: this.viewFor(a, now), events, recent: this.room.recent });
  }

  private stamp(bodies: EventBody[], now: number): GameEvent[] {
    const turn = this.state?.turn?.serial ?? null;
    const out = bodies.map((b) => ({ ...b, eventSeq: ++this.room.eventSeq, rev: this.room.rev, turn, at: now }) as GameEvent);
    this.room.recent = [...this.room.recent, ...out].slice(-RECENT_MAX);
    return out;
  }

  // ---------- 入口 ----------

  /** WebSocket のメッセージ1件（BD05 1.3） */
  async onMessage(c: Conn, raw: string | ArrayBuffer): Promise<void> {
    const now = this.d.now();
    this.lastSeen.set(c, now);
    this.sweep(c, now);
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    if (new TextEncoder().encode(text).length > MAX_CLIENT_BYTES) return this.error(c, "TOO_LARGE", "メッセージが大きすぎます", true);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return this.badMessage(c, now, null);
    }
    const parsed = clientMsgSchema.safeParse(json);
    if (!parsed.success) {
      const j = json as { t?: unknown; id?: unknown };
      const id = (j?.t === "cmd" || j?.t === "admin") && hex32.safeParse(j.id).success ? String(j.id) : null;
      return this.badMessage(c, now, id);
    }
    const m = parsed.data;
    if (!this.initialized) return this.error(c, "ROOM", "部屋がありません", true);
    if (this.stopped) return this.error(c, "ENGINE_CHANGED", `記録の版 ${this.stopped.recorded}、今の版 ${this.stopped.current}`);
    if (m.t === "hello") return this.hello(c, m);
    if (m.t === "ping") return this.send(c, { t: "pong", n: m.n });
    const a = c.getAttachment();
    if (!a) return this.error(c, "BAD_MESSAGE", "先に hello を送ってください");
    switch (m.t) {
      case "join":
        return this.join(c, a, m.name);
      case "rename":
        return this.rename(c, a, m.name);
      case "leave":
        return this.leave(c, a);
      case "cmd":
        return this.cmd(c, a, m.id, m.cmd as Command, m.meta ?? null);
      case "admin":
        return this.admin(c, a, m.id, m.op);
      case "pointer":
        return this.pointer(a, m.vertex);
      case "claimConfirm":
        return this.claimConfirm(c, a);
    }
  }

  onClose(c: Conn): void {
    this.closed.add(c);
    this.lastSeen.delete(c);
    this.bad.delete(c);
    if (!this.initialized || this.stopped) return;
    // 接続の状態の変化では rev を上げない（BD05 2.8）。表示だけを送り直す
    this.broadcastExcept(c);
  }

  private broadcastExcept(gone: Conn): void {
    const now = this.d.now();
    for (const c of this.live()) {
      if (c === gone) continue;
      const a = c.getAttachment();
      if (a) this.sendCurrent(c, a, now, []);
    }
  }

  /** 30秒何も受け取っていない接続を切る（BD03 3.7） */
  private sweep(current: Conn, now: number): void {
    let changed = false;
    for (const c of this.d.conns()) {
      if (c === current) continue;
      const t = this.lastSeen.get(c);
      if (t === undefined) {
        this.lastSeen.set(c, now);
        continue;
      }
      if (now - t > STALE_MS) {
        this.d.log("closing stale connection");
        this.lastSeen.delete(c);
        c.setAttachment({ ...(c.getAttachment() ?? { role: "player", pid: null, pendingTokenHash: null, admin: false, claim: null }), pid: null, admin: false });
        c.close(1001, "stale");
        changed = true;
      }
    }
    if (changed && this.initialized && !this.stopped) this.broadcast([]);
  }

  private badMessage(c: Conn, now: number, id: string | null): void {
    const list = (this.bad.get(c) ?? []).filter((t) => now - t < BAD_WINDOW_MS);
    list.push(now);
    this.bad.set(c, list);
    this.d.log("bad message");
    if (id) this.send(c, { t: "reject", id, code: "BAD_MESSAGE" });
    else this.send(c, { t: "error", code: "BAD_MESSAGE", message: "メッセージの形が正しくありません" });
    if (list.length > BAD_LIMIT) c.close(1008, "BAD_MESSAGE");
  }

  // ---------- hello（BD03 3.4〜3.6） ----------

  private async hello(c: Conn, m: Extract<ClientMsg, { t: "hello" }>): Promise<void> {
    if (m.v !== PROTOCOL_VERSION) return this.error(c, "VERSION", `プロトコルの版が違います（サーバー ${PROTOCOL_VERSION}）`, true);
    if (m.roomId !== this.roomId) return this.error(c, "ROOM", "部屋がありません", true);
    const admin = m.role === "board" && m.hostKey !== undefined && this.d.hostKey !== "" && safeEqual(m.hostKey, this.d.hostKey);
    if (m.role === "board") {
      if (m.hostKey !== undefined && !admin) this.d.log("board hello with wrong host key");
      c.setAttachment({ role: "board", pid: null, pendingTokenHash: null, admin, claim: null });
      this.send(c, { t: "welcome", participantId: null, token: null, role: "board", admin, serverNow: this.d.now(), seat: null });
      this.sendCurrent(c, c.getAttachment()!, this.d.now(), []);
      return;
    }
    if (m.token) {
      const h = await this.d.sha256(m.token);
      // await のあいだに別のメッセージが割り込みうるため、参加者と接続を読み直してから判定する（BD05 1.3）
      const p = this.participants().find((x) => x.tokenHash === h);
      if (!p) return this.error(c, "TOKEN", "席が見つかりません");
      this.takeSeat(c, p.participantId);
      this.send(c, { t: "welcome", participantId: p.participantId, token: m.token, role: "player", admin: false, serverNow: this.d.now(), seat: p.seat });
      this.broadcast([]);
      return;
    }
    if (m.claim) return this.claimHello(c, m.claim);
    // 新しい端末。参加者としてはまだ登録しない（join で登録する。BD03 3.4 の手順1）
    const token = this.d.randomHex();
    const h = await this.d.sha256(token);
    const pid = `p${this.d.randomHex().slice(0, 8)}`;
    c.setAttachment({ role: "player", pid, pendingTokenHash: h, admin: false, claim: null });
    this.send(c, { t: "welcome", participantId: pid, token, role: "player", admin: false, serverNow: this.d.now(), seat: null });
    this.sendCurrent(c, c.getAttachment()!, this.d.now(), []);
  }

  /** 席を持つ接続を1本にする。古い接続には replaced を送って切る（BD03 3.5 の手順5） */
  private takeSeat(c: Conn, pid: string): void {
    for (const o of this.d.conns()) {
      if (o === c) continue;
      const a = o.getAttachment();
      if (a?.role === "player" && a.pid === pid && !a.pendingTokenHash) {
        o.setAttachment({ ...a, pid: null });
        this.send(o, { t: "replaced" });
        o.close(1000, "replaced");
      }
    }
    c.setAttachment({ role: "player", pid, pendingTokenHash: null, admin: false, claim: null });
  }

  // ---------- ロビー ----------

  private rev(): void {
    this.room.rev += 1;
  }

  private join(c: Conn, a: Attachment, name: string): void {
    if (this.room.phase !== "lobby") return this.error(c, "GAME_STARTED", "ゲームはもう始まっています");
    if (a.role !== "player" || !a.pid || !a.pendingTokenHash) return this.error(c, "BAD_MESSAGE", "参加できる接続ではありません");
    const ps = this.participants();
    if (ps.length >= 4) return this.error(c, "LOBBY_FULL", "4人まで参加できます");
    if (ps.some((p) => p.name === name)) return this.error(c, "NAME_TAKEN", "同じ名前の人がいます");
    const color = COLORS.find((k) => !ps.some((p) => p.color === k))!;
    this.rev();
    this.d.sql.transaction(() => {
      this.d.sql.exec(
        "INSERT INTO participants (participantId, name, ord, seat, color, rate, tokenHash) VALUES (?, ?, ?, NULL, ?, 1, ?)",
        a.pid,
        name,
        ps.length,
        color,
        a.pendingTokenHash,
      );
      this.saveRoom();
    });
    c.setAttachment({ ...a, pendingTokenHash: null });
    this.d.log("joined");
    this.broadcast([]);
  }

  private rename(c: Conn, a: Attachment, name: string): void {
    if (this.room.phase !== "lobby") return this.error(c, "GAME_STARTED", "ゲームはもう始まっています");
    const ps = this.participants();
    if (!a.pid || !ps.some((p) => p.participantId === a.pid)) return this.error(c, "BAD_MESSAGE", "参加していません");
    if (ps.some((p) => p.name === name && p.participantId !== a.pid)) return this.error(c, "NAME_TAKEN", "同じ名前の人がいます");
    this.rev();
    this.d.sql.transaction(() => {
      this.d.sql.exec("UPDATE participants SET name = ? WHERE participantId = ?", name, a.pid);
      this.saveRoom();
    });
    this.broadcast([]);
  }

  private removeParticipant(pid: string): void {
    const rest = this.participants().filter((p) => p.participantId !== pid);
    this.rev();
    this.d.sql.transaction(() => {
      this.d.sql.exec("DELETE FROM participants WHERE participantId = ?", pid);
      rest.forEach((p, i) => this.d.sql.exec("UPDATE participants SET ord = ? WHERE participantId = ?", i, p.participantId));
      this.saveRoom();
    });
  }

  private leave(c: Conn, a: Attachment): void {
    if (this.room.phase !== "lobby") return this.error(c, "GAME_STARTED", "ゲームはもう始まっています");
    if (!a.pid || !this.participants().some((p) => p.participantId === a.pid)) return this.error(c, "BAD_MESSAGE", "参加していません");
    this.removeParticipant(a.pid);
    c.setAttachment({ ...a, pid: null });
    this.broadcast([]);
  }

  // ---------- コマンド（BD05 1.3） ----------

  private reject(c: Conn, id: string, code: RejectAny, detail?: string): void {
    this.send(c, detail === undefined ? { t: "reject", id, code } : { t: "reject", id, code, detail });
  }

  /** 処理済みの id なら前回の結果を返して true（BD05 1.3 の手順3） */
  private replay(c: Conn, id: string): boolean {
    const done = this.d.sql.exec("SELECT rev FROM commands WHERE id = ?", id)[0];
    if (done) {
      this.send(c, { t: "ack", id, rev: Number(done.rev) });
      return true;
    }
    const r = this.rejects.get(id);
    if (r) {
      this.reject(c, id, r.code, r.detail);
      return true;
    }
    return false;
  }

  private cmd(c: Conn, a: Attachment, id: string, cmd: Command, meta: { sentenceShown?: boolean | undefined } | null): void {
    if (this.room.phase === "lobby" || !this.state) return this.reject(c, id, "WRONG_PHASE");
    const seat = a.role === "player" && a.pid ? this.participants().find((p) => p.participantId === a.pid)?.seat ?? null : null;
    if (seat === null) return this.reject(c, id, "BAD_MESSAGE", "席のない接続です");
    if (this.replay(c, id)) return;
    if (this.room.pausedSince !== null) return this.reject(c, id, "PAUSED");
    this.applyAndCommit(c, id, { k: "seat", seat }, cmd, meta);
  }

  private applyAndCommit(c: Conn, id: string, actor: Actor, cmd: Command, meta: { sentenceShown?: boolean | undefined } | null): void {
    const r = apply(this.state!, actor, cmd);
    if (!r.ok) {
      this.rejects.set(id, { code: r.code });
      return this.reject(c, id, r.code);
    }
    const now = this.d.now();
    const wasStarted = this.room.startedAt !== null;
    this.state = r.state;
    if (!wasStarted && r.state.turn !== null) this.room.startedAt = now; // 準備の完了から数える（BD05 3.1）
    if (r.state.phase.k === "over") this.room.phase = "over";
    this.rev();
    const events = this.stamp(r.events as EngineEvent[], now);
    this.writeRow(now, id, actor, cmd, meta, null, r.state);
    this.d.afterCommit?.();
    this.send(c, { t: "ack", id, rev: this.room.rev });
    this.broadcast(events);
  }

  /** 記録の1行と room の表を、1つのトランザクションで書く（BD05 1.3 の手順5） */
  private writeRow(now: number, id: string, actor: Actor | { k: "server" }, cmd: unknown, meta: unknown, undo: unknown, state: GameState): void {
    this.d.sql.transaction(() => {
      this.insertRow(now, id, actor, cmd, meta, undo, state);
      this.saveRoom();
    });
  }

  private insertRow(now: number, id: string, actor: Actor | { k: "server" }, cmd: unknown, meta: unknown, undo: unknown, state: GameState): void {
    {
      this.d.sql.exec(
        "INSERT INTO commands (seq, rev, at, elapsedMs, id, actor, cmd, meta, undo, state) VALUES ((SELECT COALESCE(MAX(seq), 0) + 1 FROM commands), ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        this.room.rev,
        new Date(now).toISOString(),
        this.elapsedMs(now),
        id,
        JSON.stringify(actor),
        JSON.stringify(cmd),
        meta === null ? null : JSON.stringify(meta),
        undo === null ? null : JSON.stringify(undo),
        JSON.stringify(state),
      );
    }
  }

  // ---------- 管理操作 ----------

  private admin(c: Conn, a: Attachment, id: string, op: AdminOp): void | Promise<void> {
    if (a.role !== "board" || !a.admin) return this.error(c, "NOT_ADMIN", "管理の操作はホストの大画面からだけ行えます");
    switch (op.k) {
      case "reorder":
      case "setColor":
      case "setRate":
      case "kick":
        return this.lobbyAdmin(c, id, op);
      case "startGame":
        return this.startGame(c, id, op.options);
      case "pause":
      case "resume":
        return this.pauseResume(c, id, op.k);
      case "undoLast":
        return this.undoLast(c, id, op.seq);
      case "reissueSeat":
        return this.reissueSeat(c, id, op.seat);
      case "approveClaim":
        return this.approveClaim(c, id, op.seat, op.approve);
      case "answerFor":
      case "endTurnFor":
      case "callLastRound":
      case "abortGame": {
        if (!this.state || this.room.phase === "lobby") return this.reject(c, id, "WRONG_PHASE");
        if (this.replay(c, id)) return;
        let answer: PromptAnswer | null = null;
        if (op.k === "answerFor") {
          answer = op.answer ?? defaultAnswer(this.state, op.promptId);
          if (!answer) return this.reject(c, id, "NOT_PROMPTED");
        }
        const cmd = (op.k === "answerFor"
          ? { t: "answerFor", promptId: op.promptId, answer }
          : op.k === "endTurnFor"
            ? { t: "endTurnFor", turnSerial: op.turnSerial }
            : { t: op.k }) as Command;
        return this.applyAndCommit(c, id, { k: "admin" }, cmd, null);
      }
    }
  }

  private ack(c: Conn, id: string): void {
    this.send(c, { t: "ack", id, rev: this.room.rev });
  }

  private lobbyAdmin(c: Conn, id: string, op: Extract<AdminOp, { k: "reorder" | "setColor" | "setRate" | "kick" }>): void {
    if (this.room.phase !== "lobby") return this.reject(c, id, "WRONG_PHASE");
    const ps = this.participants();
    const sql = this.d.sql;
    if (op.k === "kick") {
      if (!ps.some((p) => p.participantId === op.participantId)) return this.reject(c, id, "BAD_MESSAGE", "その参加者はいません");
      this.removeParticipant(op.participantId);
      for (const o of this.d.conns()) {
        const at = o.getAttachment();
        if (at?.pid === op.participantId) o.setAttachment({ ...at, pid: null });
      }
      this.ack(c, id);
      return this.broadcast([]);
    }
    if (op.k === "reorder") {
      const ids = op.participantIds;
      if (ids.length !== ps.length || new Set(ids).size !== ids.length || !ids.every((x) => ps.some((p) => p.participantId === x))) {
        return this.reject(c, id, "BAD_MESSAGE", "並びが参加者と合いません");
      }
      this.rev();
      sql.transaction(() => {
        ids.forEach((pid, i) => sql.exec("UPDATE participants SET ord = ? WHERE participantId = ?", i, pid));
        this.saveRoom();
      });
    } else if (op.k === "setColor") {
      if (!ps.some((p) => p.participantId === op.participantId)) return this.reject(c, id, "BAD_MESSAGE", "その参加者はいません");
      const holder = ps.find((p) => p.color === op.color && p.participantId !== op.participantId);
      const mine = ps.find((p) => p.participantId === op.participantId)!.color;
      this.rev();
      sql.transaction(() => {
        // 同じ色の人がいれば入れ替える
        if (holder) sql.exec("UPDATE participants SET color = ? WHERE participantId = ?", mine, holder.participantId);
        sql.exec("UPDATE participants SET color = ? WHERE participantId = ?", op.color, op.participantId);
        this.saveRoom();
      });
    } else {
      if (!ps.some((p) => p.participantId === op.participantId)) return this.reject(c, id, "BAD_MESSAGE", "その参加者はいません");
      this.rev();
      sql.transaction(() => {
        sql.exec("UPDATE participants SET rate = ? WHERE participantId = ?", op.rate, op.participantId);
        this.saveRoom();
      });
    }
    this.ack(c, id);
    this.broadcast([]);
  }

  private startGame(c: Conn, id: string, options: { orderDeck: "generated" | "fixed"; dice: "server" | "manual"; animalInclude: boolean }): void {
    if (this.room.phase !== "lobby") return this.reject(c, id, "WRONG_PHASE");
    const lobby = this.lobbyView();
    if (!lobby.canStart) return this.reject(c, id, "WRONG_PHASE", "3人か4人がそろい、全員がつながっている必要があります");
    const ps = this.participants();
    const config: RuleConfig = { ...defaultConfig(), ...options };
    const seed = this.d.randomHex();
    const setup = { participants: ps.map((p) => ({ participantId: p.participantId, color: p.color, japaneseRate: p.rate })) };
    const state = createGame(config, setup, seed);
    const now = this.d.now();
    const meta: Meta = {
      format: 1,
      roomId: this.roomId!,
      createdAt: new Date(now).toISOString(),
      engineVersion: this.d.engineVersion,
      rulesVersion: config.rulesVersion,
      config,
      seed,
      n: ps.length,
    };
    this.state = state;
    this.meta = meta;
    this.room.phase = "game";
    this.rev();
    const seats = state.players.map((pl) => ({ participantId: pl.participantId, seat: pl.seat, color: pl.color }));
    const events = this.stamp([{ k: "seatsAssigned", seats }, { k: "gameCreated", orderDeckCount: state.orders.deck.length, jointDeckCount: state.joint.deck.length }], now);
    this.d.sql.transaction(() => {
      this.d.sql.exec("INSERT INTO meta (id, json) VALUES (1, ?)", JSON.stringify(meta));
      for (const s of seats) this.d.sql.exec("UPDATE participants SET seat = ? WHERE participantId = ?", s.seat, s.participantId);
      // ゲームの作成も1行目のコマンドとして残す（BD05 2.3）。名前は書かない（BD05 5.3）
      this.insertRow(now, id, { k: "server" }, { t: "createGame", config, setup, seed }, null, null, state);
      this.saveRoom();
    });
    this.d.log(`game started n=${ps.length}`);
    this.ack(c, id);
    this.broadcast(events);
  }

  private pauseResume(c: Conn, id: string, k: "pause" | "resume"): void {
    if (this.room.phase !== "game") return this.reject(c, id, "WRONG_PHASE");
    const now = this.d.now();
    if (k === "pause") {
      if (this.room.pausedSince !== null) return this.ack(c, id);
      this.room.pausedSince = now;
    } else {
      if (this.room.pausedSince === null) return this.ack(c, id);
      this.room.pausedTotalMs += now - this.room.pausedSince;
      this.room.pausedSince = null;
    }
    // 一時停止と再開は commands に行を作らない（BD05 3.3）
    this.rev();
    const events = this.stamp([{ k: k === "pause" ? "paused" : "resumed" }], now);
    this.saveRoom();
    this.ack(c, id);
    this.broadcast(events);
  }

  private undoLast(c: Conn, id: string, seq: number): void {
    if (!this.state || this.room.phase === "lobby") return this.reject(c, id, "WRONG_PHASE");
    if (this.replay(c, id)) return;
    const last = this.lastValid();
    if (!last || last.seq !== seq) return this.reject(c, id, "STALE_TARGET");
    const actor = JSON.parse(last.actor) as Actor | { k: "server" };
    if (actor.k === "server") return this.reject(c, id, "NOTHING_TO_UNDO");
    // ゲームを終わらせた行は取り消せない（BD05 2.9 の手順3）
    if ((JSON.parse(last.state) as GameState).phase.k === "over") return this.reject(c, id, "GAME_OVER");
    const summary = summarize(JSON.parse(last.cmd) as Command, this.whoName(actor));
    // 直前の有効な行の写しを読む。先頭からの再適用はしない（BD05 2.9 の手順4）
    const undone = new Set<number>([seq]);
    for (const r of this.d.sql.exec("SELECT undo FROM commands WHERE undo IS NOT NULL")) {
      for (const s of (JSON.parse(String(r.undo)) as { seqs: number[] }).seqs) undone.add(s);
    }
    const prev = this.d.sql
      .exec("SELECT seq, state FROM commands WHERE undo IS NULL AND seq < ? ORDER BY seq DESC", seq)
      .find((r) => !undone.has(Number(r.seq)))!;
    const state = JSON.parse(String(prev.state)) as GameState;
    const now = this.d.now();
    this.state = state;
    this.room.phase = state.phase.k === "over" ? "over" : "game";
    if (state.turn === null) this.room.startedAt = null;
    this.rev();
    const events = this.stamp([{ k: "undone", seq, summary }], now);
    this.writeRow(now, id, { k: "admin" }, { t: "undoLast", seq }, null, { seqs: [seq] }, state);
    this.d.log(`undo seq=${seq}`);
    this.ack(c, id);
    this.broadcast(events);
  }

  // ---------- 席の再発行（BD03 3.6） ----------

  private reissueSeat(c: Conn, id: string, seat: Seat): void {
    if (this.room.phase === "lobby") return this.reject(c, id, "WRONG_PHASE");
    if (!this.participants().some((p) => p.seat === seat)) return this.reject(c, id, "BAD_MESSAGE", "その席はありません");
    const code = this.d.randomHex();
    this.claims.set(code, { seat, expires: this.d.now() + CLAIM_MS, used: false });
    // 合言葉は大画面にだけ返す。QRコードは大画面が作る（BD05 4.6）
    this.send(c, { t: "ack", id, rev: this.room.rev });
    this.send(c, { t: "claimCode", seat, code, expiresAt: this.claims.get(code)!.expires });
  }

  private claimHello(c: Conn, code: string): void {
    const cl = this.claims.get(code);
    if (!cl || cl.used || this.d.now() > cl.expires) return this.error(c, "TOKEN", "席の作り直しの合言葉が無効です");
    const p = this.participants().find((x) => x.seat === cl.seat)!;
    c.setAttachment({ role: "player", pid: null, pendingTokenHash: null, admin: false, claim: { code, seat: cl.seat, confirmed: false } });
    this.send(c, { t: "welcome", participantId: null, token: null, role: "player", admin: false, serverNow: this.d.now(), seat: null });
    this.send(c, { t: "claimPending", seat: cl.seat, seatName: p.name });
  }

  private claimConfirm(c: Conn, a: Attachment): void {
    if (!a.claim) return this.error(c, "BAD_MESSAGE", "席の作り直しの申請がありません");
    const cl = this.claims.get(a.claim.code);
    if (!cl || cl.used || this.d.now() > cl.expires) return this.error(c, "TOKEN", "席の作り直しの合言葉が無効です");
    c.setAttachment({ ...a, claim: { ...a.claim, confirmed: true } });
    for (const b of this.d.conns()) {
      const ba = b.getAttachment();
      if (ba?.role === "board" && ba.admin) this.send(b, { t: "claimRequest", seat: a.claim.seat });
    }
  }

  private async approveClaimAsync(target: Conn, seat: Seat, code: string): Promise<void> {
    const token = this.d.randomHex();
    const h = await this.d.sha256(token);
    // await のあとで読み直す
    const cl = this.claims.get(code);
    const p = this.participants().find((x) => x.seat === seat);
    if (!cl || cl.used || !p) return;
    cl.used = true;
    this.rev();
    this.d.sql.transaction(() => {
      this.d.sql.exec("UPDATE participants SET tokenHash = ? WHERE participantId = ?", h, p.participantId);
      this.saveRoom();
    });
    this.takeSeat(target, p.participantId);
    this.send(target, { t: "welcome", participantId: p.participantId, token, role: "player", admin: false, serverNow: this.d.now(), seat });
    this.d.log(`seat reissued seat=${seat}`);
    this.broadcast([]);
  }

  private approveClaim(c: Conn, id: string, seat: Seat, approve: boolean): Promise<void> | void {
    const target = this.d.conns().find((o) => {
      const a = o.getAttachment();
      return a?.claim?.seat === seat && a.claim.confirmed;
    });
    if (!target) return this.reject(c, id, "STALE_TARGET", "承認を待つ端末がありません");
    const code = target.getAttachment()!.claim!.code;
    this.ack(c, id);
    if (!approve) {
      target.setAttachment({ ...target.getAttachment()!, claim: null });
      this.error(target, "CLAIM", "ホストが承認しませんでした");
      return;
    }
    return this.approveClaimAsync(target, seat, code);
  }

  // ---------- pointer（BD03 3.2） ----------

  private pointer(a: Attachment, vertex: number | null): void {
    if (!this.state || a.role !== "player" || !a.pid) return;
    const seat = this.participants().find((p) => p.participantId === a.pid)?.seat;
    if (seat === undefined || seat === null) return;
    const s = this.state;
    const placing = setupSeat(s) === seat || (s.phase.k === "main" && s.turn?.seat === seat);
    if (!placing) return;
    for (const b of this.d.conns()) if (b.getAttachment()?.role === "board") this.send(b, { t: "pointer", seat, vertex });
  }

  // ---------- HTTP（BD05 5.1、2.11） ----------

  /** 記録の取り出し。ゲームが終わったあとだけ（BD05 2.2、5.1） */
  record(states: boolean): { ok: true; body: unknown } | { ok: false; status: number; error: string } {
    if (!this.initialized) return { ok: false, status: 404, error: "ROOM" };
    if (this.room.phase !== "over") return { ok: false, status: 409, error: "NOT_OVER" };
    const participants = this.participants().map(({ tokenHash: _t, ...p }) => p);
    const commands = this.d.sql.exec("SELECT * FROM commands ORDER BY seq").map((r) => {
      const row: Row = {
        seq: r.seq,
        rev: r.rev,
        at: r.at,
        elapsedMs: r.elapsedMs,
        id: r.id,
        actor: JSON.parse(String(r.actor)),
        cmd: JSON.parse(String(r.cmd)),
        meta: r.meta === null ? null : JSON.parse(String(r.meta)),
        undo: r.undo === null ? null : JSON.parse(String(r.undo)),
      };
      if (states) row.state = JSON.parse(String(r.state));
      return row;
    });
    return { ok: true, body: { meta: this.meta, participants, commands } };
  }

  /**
   * 試験用：席にカード、産物、コインを渡す（E2E で注文を届ける状態を作るため。本番では呼ばない。BD06 TC-SRV-17）。
   * カードは山から渡し、総数を保つ。最後の行の写しも書き換えるため、記録の検証では食い違いになる
   */
  debugGive(seat: number, g: { cards?: Partial<Record<WordCard, number>>; products?: Record<string, number>; coins?: number }): string | null {
    const s = this.state;
    if (!s || !s.players[seat]) return "NO_GAME";
    const p = s.players[seat]!;
    for (const [k, n] of Object.entries(g.cards ?? {})) {
      const kind = k as WordCard;
      if ((s.piles[kind] ?? 0) < (n ?? 0)) return "PILE_EMPTY";
      s.piles[kind] -= n ?? 0;
      p.hand[kind] = (p.hand[kind] ?? 0) + (n ?? 0);
    }
    for (const [k, n] of Object.entries(g.products ?? {})) {
      const prod = k as keyof typeof p.products;
      p.products[prod] = (p.products[prod] ?? 0) + n;
    }
    p.coins += g.coins ?? 0;
    this.rev();
    this.d.sql.transaction(() => {
      this.d.sql.exec("UPDATE commands SET state = ? WHERE seq = (SELECT MAX(seq) FROM commands)", JSON.stringify(s));
      this.saveRoom();
    });
    this.broadcast([]);
    return null;
  }

  /** 試験用：今の状態とメモリ上の値（本番では呼ばない。BD06 TC-SRV-17） */
  debugState(): { state: GameState | null; rev: number; phase: string; stopped: boolean } {
    return { state: this.state, rev: this.initialized ? this.room.rev : 0, phase: this.initialized ? this.room.phase : "none", stopped: this.stopped !== null };
  }
}
