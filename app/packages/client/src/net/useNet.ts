// React から接続を使う。状態が変わるたびに描き直す
import { useEffect, useRef, useState } from "react";
import type { ServerMsg } from "@word-farm/protocol";
import { Connection, type NetState } from "./connection.ts";
import { browserDeps, wsUrl } from "./browser.ts";

export interface Net {
  conn: Connection;
  state: NetState;
  /** 直前に届いたメッセージ（拒否の文言や出来事の演出に使う） */
  last: ServerMsg | null;
}

export function useNet(opts: { roomId: string; role: "player" | "board"; hostKey?: string; claim?: string } | null): Net | null {
  const ref = useRef<Connection | null>(null);
  const [, setTick] = useState(0);
  const lastRef = useRef<ServerMsg | null>(null);
  const key = opts ? `${opts.roomId}|${opts.role}|${opts.hostKey ?? ""}|${opts.claim ?? ""}` : "";
  useEffect(() => {
    if (!opts) return;
    const c = new Connection(browserDeps(), { url: wsUrl(opts.roomId), ...opts });
    ref.current = c;
    const off = c.subscribe((_s, m) => {
      lastRef.current = m;
      setTick((n) => n + 1);
    });
    const vis = () => {
      if (document.visibilityState === "visible") c.onVisible();
    };
    document.addEventListener("visibilitychange", vis);
    setTick((n) => n + 1);
    return () => {
      off();
      document.removeEventListener("visibilitychange", vis);
      c.stop();
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const c = ref.current;
  return c ? { conn: c, state: c.state, last: lastRef.current } : null;
}
