// ブラウザの WebSocket と保存を、接続の部品（connection.ts）の形に合わせる。
import type { KeyValue, NetDeps, SocketLike } from "./connection.ts";

/** localStorage、sessionStorage、メモリの順に使えるものを使う（BD03 3.5 の手順1） */
function store(kind: "local" | "session"): KeyValue {
  const mem = new Map<string, string>();
  const pick = (): Storage | null => {
    try {
      const s = kind === "local" ? window.localStorage : window.sessionStorage;
      const k = "__wf_probe__";
      s.setItem(k, "1");
      s.removeItem(k);
      return s;
    } catch {
      return null;
    }
  };
  const primary = pick();
  const fallback = kind === "local" ? store("session") : null;
  return {
    get: (k) => (primary ? primary.getItem(k) : fallback ? fallback.get(k) : (mem.get(k) ?? null)),
    set: (k, v) => (primary ? primary.setItem(k, v) : fallback ? fallback.set(k, v) : void mem.set(k, v)),
    remove: (k) => (primary ? primary.removeItem(k) : fallback ? fallback.remove(k) : void mem.delete(k)),
  };
}

export const durable = store("local");

function openSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const s: SocketLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => s.onopen?.();
  ws.onmessage = (e) => s.onmessage?.(String(e.data));
  ws.onclose = () => s.onclose?.();
  return s;
}

export function randomHex(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function browserDeps(): NetDeps {
  return {
    open: openSocket,
    durable,
    session: store("session"),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
    randomHex,
  };
}

export function wsUrl(roomId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/rooms/${roomId}/ws`;
}
