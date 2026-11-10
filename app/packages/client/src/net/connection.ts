// 端末の側の接続（BD03 3.5、3.7）。画面（M4）はこの部品を通してサーバーと話す。
// WebSocket、保存（localStorage と sessionStorage）、時計、乱数を外から受け取る。単体テストで差し替えるためである。
import {
  PROTOCOL_VERSION,
  type AdminOp,
  type BoardView,
  type ClientMsg,
  type GameEvent,
  type LobbyView,
  type PlayerView,
  type ServerMsg,
} from "@word-farm/protocol";
import type { Command } from "@word-farm/engine";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface NetDeps {
  open(url: string): SocketLike;
  /** トークンを置く。localStorage が使えなければ sessionStorage、それも使えなければメモリ（BD03 3.5 の手順1） */
  durable: KeyValue;
  /** 未確定のコマンドを置く（BD03 3.5 の手順4） */
  session: KeyValue;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  randomHex(): string;
}

export type Status = "connecting" | "open" | "closed" | "replaced" | "needJoin" | "engineChanged" | "fatal";

export interface NetState {
  status: Status;
  welcome: Extract<ServerMsg, { t: "welcome" }> | null;
  lobby: LobbyView | null;
  view: BoardView | PlayerView | null;
  /** 直近の出来事（最大30件。BD03 3.3 の recent） */
  recent: GameEvent[];
  rev: number;
  /** ack も reject も受け取っていないコマンドの id */
  pending: string[];
  lastError: Extract<ServerMsg, { t: "error" }> | null;
}

/** 再接続の間隔（BD03 3.5 の手順2）。1秒、2秒、4秒、以後は5秒おき */
export const RETRY_MS = [1000, 2000, 4000, 5000];
/** エンジンの版が違って止まった部屋に、つなぎ直しを試す間隔。版を戻すデプロイ（rollback）のあと、読み込み直さずに再開するため（BD06 DEV-05b） */
export const ENGINE_RETRY_MS = 15_000;
const PING_MS = 10_000;
const PONG_WAIT_MS = 10_000;
const VISIBLE_PONG_WAIT_MS = 3000;

type Pending = { t: "cmd"; id: string; cmd: Command; meta?: { sentenceShown: boolean } } | { t: "admin"; id: string; op: AdminOp };

export class Connection {
  readonly state: NetState = { status: "connecting", welcome: null, lobby: null, view: null, recent: [], rev: -1, pending: [], lastError: null };
  private ws: SocketLike | null = null;
  private tries = 0;
  private firstViewAfterWelcome = false;
  private pingTimer: number | null = null;
  private pongTimer: number | null = null;
  private pingN = 0;
  private stopped = false;
  /** エンジンの版が違って止まった部屋を待っている間（表示は engineChanged のまま、つなぎ直しを試し続ける） */
  private engineWait = false;
  private listeners = new Set<(s: NetState, m: ServerMsg | null) => void>();

  private d: NetDeps;
  private opts: { url: string; roomId: string; role: "player" | "board"; hostKey?: string; claim?: string };

  constructor(d: NetDeps, opts: { url: string; roomId: string; role: "player" | "board"; hostKey?: string; claim?: string }) {
    this.d = d;
    this.opts = opts;
    this.state.pending = this.loadPending().map((p) => p.id);
    this.connect();
  }

  private get tokenKey(): string {
    return `wf:token:${this.opts.roomId}`;
  }
  private get pendingKey(): string {
    return `wf:pending:${this.opts.roomId}:${this.opts.role}`;
  }

  subscribe(fn: (s: NetState, m: ServerMsg | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ServerMsg | null): void {
    for (const f of this.listeners) f(this.state, m);
  }

  // ---------- 接続 ----------

  private connect(): void {
    if (this.stopped) return;
    if (!this.engineWait) this.state.status = "connecting";
    const ws = this.d.open(this.opts.url);
    this.ws = ws;
    // 今の接続以外から届いたメッセージは無視する（BD03 3.5 の手順6）
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.tries = 0;
      const token = this.d.durable.get(this.tokenKey);
      const hello: ClientMsg = {
        t: "hello",
        v: PROTOCOL_VERSION,
        roomId: this.opts.roomId,
        role: this.opts.role,
        ...(token && this.opts.role === "player" ? { token } : {}),
        ...(this.opts.claim && !token ? { claim: this.opts.claim } : {}),
        ...(this.opts.hostKey ? { hostKey: this.opts.hostKey } : {}),
      };
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (data) => {
      if (this.ws !== ws) return;
      this.onMessage(JSON.parse(data) as ServerMsg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.stopped) return;
      if (this.engineWait) {
        this.d.setTimer(() => this.connect(), ENGINE_RETRY_MS);
        return;
      }
      this.state.status = "closed";
      this.emit(null);
      const wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)]!;
      this.tries += 1;
      this.d.setTimer(() => this.connect(), wait);
    };
  }

  /** 接続を切ってつなぎ直す（生存確認の失敗、画面の復帰） */
  private reconnect(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onclose?.();
    try {
      ws.close();
    } catch {
      // すでに切れている
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  // ---------- 受信 ----------

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.engineWait = false;
        this.state.status = "open";
        this.state.welcome = m;
        if (m.token) this.d.durable.set(this.tokenKey, m.token);
        // welcome の直後の最初の view は rev によらず受け入れる（BD03 3.3）
        this.firstViewAfterWelcome = true;
        this.startPing();
        // ack も reject も受け取っていないコマンドを、同じ id で送り直す（BD03 3.5 の手順4）
        for (const p of this.loadPending()) this.ws?.send(JSON.stringify(p));
        break;
      case "view":
        if (this.firstViewAfterWelcome || m.view.rev >= this.state.rev) {
          this.state.view = m.view;
          this.state.recent = m.recent;
          this.state.rev = m.view.rev;
          this.state.lobby = null;
          this.firstViewAfterWelcome = false;
        }
        break;
      case "lobby":
        if (this.firstViewAfterWelcome || m.lobby.rev >= this.state.rev) {
          this.state.lobby = m.lobby;
          this.state.rev = m.lobby.rev;
          this.firstViewAfterWelcome = false;
        }
        break;
      case "ack":
      case "reject":
        this.removePending(m.id);
        break;
      case "pong":
        if (this.pongTimer !== null) {
          this.d.clearTimer(this.pongTimer);
          this.pongTimer = null;
        }
        break;
      case "replaced":
        // 再接続を試みず、「別の画面で開かれています」と出す（BD03 3.5 の手順5）
        this.state.status = "replaced";
        this.stop();
        break;
      case "error":
        this.state.lastError = m;
        if (m.code === "TOKEN") {
          this.d.durable.remove(this.tokenKey);
          this.state.status = "needJoin";
          this.stop();
        } else if (m.code === "ENGINE_CHANGED") {
          // 止めたままにせず、間をおいてつなぎ直しを試す。版を戻すと、そのまま続きから再開する
          this.state.status = "engineChanged";
          this.engineWait = true;
          const ws = this.ws;
          this.ws = null;
          this.stopPing();
          try {
            ws?.close();
          } catch {
            // すでに切れている
          }
          this.d.setTimer(() => this.connect(), ENGINE_RETRY_MS);
        } else if (m.code === "VERSION" || m.code === "ROOM") {
          this.state.status = "fatal";
          this.stop();
        }
        break;
      default:
        break;
    }
    this.emit(m);
  }

  // ---------- 送信 ----------

  private loadPending(): Pending[] {
    const raw = this.d.session.get(this.pendingKey);
    return raw ? (JSON.parse(raw) as Pending[]) : [];
  }

  private savePending(list: Pending[]): void {
    if (list.length) this.d.session.set(this.pendingKey, JSON.stringify(list));
    else this.d.session.remove(this.pendingKey);
    this.state.pending = list.map((p) => p.id);
  }

  private removePending(id: string): void {
    this.savePending(this.loadPending().filter((p) => p.id !== id));
  }

  private sendPending(p: Pending): string {
    this.savePending([...this.loadPending(), p]);
    if (this.state.status === "open") this.ws?.send(JSON.stringify(p));
    this.emit(null);
    return p.id;
  }

  /** ゲームのコマンドを送る。返した id の ack か reject が届くまで、ボタンを「処理中」にする */
  command(cmd: Command): string {
    return this.sendPending({ t: "cmd", id: this.d.randomHex(), cmd });
  }

  /** 宣言のコマンド。meta はエンジンに渡さず記録だけに残す（BD03 3.2、BD04 3.5 の「英文を見る」） */
  commandWithMeta(cmd: Command, meta: { sentenceShown: boolean }): string {
    return this.sendPending({ t: "cmd", id: this.d.randomHex(), cmd, meta });
  }

  admin(op: AdminOp): string {
    return this.sendPending({ t: "admin", id: this.d.randomHex(), op });
  }

  /** 確かめのいらないメッセージ（join、rename、leave、pointer、claimConfirm） */
  post(m: Exclude<ClientMsg, { t: "hello" | "cmd" | "admin" | "ping" }>): void {
    if (this.state.status === "open") this.ws?.send(JSON.stringify(m));
  }

  // ---------- 生存確認（BD03 3.7） ----------

  private startPing(): void {
    this.stopPing();
    this.pingTimer = this.d.setTimer(() => this.ping(PONG_WAIT_MS), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) this.d.clearTimer(this.pingTimer);
    if (this.pongTimer !== null) this.d.clearTimer(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private ping(wait: number): void {
    if (!this.ws || this.state.status !== "open") return;
    this.pingN += 1;
    this.ws.send(JSON.stringify({ t: "ping", n: this.pingN }));
    if (this.pongTimer === null) {
      this.pongTimer = this.d.setTimer(() => {
        this.pongTimer = null;
        this.reconnect();
      }, wait);
    }
    this.pingTimer = this.d.setTimer(() => this.ping(PONG_WAIT_MS), PING_MS);
  }

  /** 画面が見えるようになったとき（visibilitychange）。2〜3秒で pong が返らなければつなぎ直す（BD03 3.5） */
  onVisible(): void {
    if (this.pingTimer !== null) this.d.clearTimer(this.pingTimer);
    if (this.pongTimer !== null) this.d.clearTimer(this.pongTimer);
    this.pongTimer = null;
    this.ping(VISIBLE_PONG_WAIT_MS);
  }
}
