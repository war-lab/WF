// 大画面（BD04 2章）。H01 起動、H02 ロビー、H03 準備と H04 対戦（Game.tsx）を、サーバーから届いた状態で切り替える。
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { BoardView, LobbyView } from "@word-farm/protocol";
import type { Color } from "@word-farm/engine";
import { durable } from "../net/browser.ts";
import { useNet, type Net } from "../net/useNet.ts";
import { COLOR_INFO, Mark, NetCover } from "../ui/common.tsx";
import { BoardGame } from "./Game.tsx";

const KEY = "wf:hostKey";
const ROOM = "wf:boardRoom";
const OPTS = "wf:startOptions";

export interface StartOptions {
  orderDeck: "generated" | "fixed";
  dice: "server" | "manual";
  animalInclude: boolean;
}
const DEFAULT_OPTS: StartOptions = { orderDeck: "generated", dice: "server", animalInclude: false };

function loadOpts(): StartOptions {
  try {
    return { ...DEFAULT_OPTS, ...(JSON.parse(durable.get(OPTS) ?? "{}") as Partial<StartOptions>) };
  } catch {
    return DEFAULT_OPTS;
  }
}

const CREDIT = "音楽：魔王魂（https://maou.audio/）　効果音：効果音ラボ、Pixabay";

export function BoardApp() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  if (!roomId) return <Start />;
  return <Room roomId={roomId} />;
}

/** H01 起動（BD04 2.1） */
function Start() {
  const [key, setKey] = useState(durable.get(KEY) ?? "");
  const [opts, setOpts] = useState<StartOptions>(loadOpts());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = durable.get(ROOM);
  const open = async () => {
    setBusy(true);
    setErr(null);
    durable.set(KEY, key);
    durable.set(OPTS, JSON.stringify(opts));
    try {
      // 鍵はURLに入れず、ヘッダで送る（BD05 1.2）
      const r = await fetch("/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401) throw new Error("ホストの鍵が違います");
      if (!r.ok) throw new Error("サーバーの上限に達した可能性があります");
      const { roomId } = (await r.json()) as { roomId: string };
      durable.set(ROOM, roomId);
      location.href = `/board?room=${roomId}`;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="h-start">
      <h1>WORD FARM</h1>
      <label>
        ホストの鍵
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
      </label>
      <fieldset>
        <legend>ルール設定</legend>
        <label>
          注文の山
          <select value={opts.orderDeck} onChange={(e) => setOpts({ ...opts, orderDeck: e.target.value as StartOptions["orderDeck"] })}>
            <option value="generated">自動生成</option>
            <option value="fixed">印刷用</option>
          </select>
        </label>
        <label>
          サイコロ
          <select value={opts.dice} onChange={(e) => setOpts({ ...opts, dice: e.target.value as StartOptions["dice"] })}>
            <option value="server">サーバー</option>
            <option value="manual">本物（出目を入れる）</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={opts.animalInclude} onChange={(e) => setOpts({ ...opts, animalInclude: e.target.checked })} />
          動物の頭数の注文に指定を付ける
        </label>
      </fieldset>
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button className="primary" disabled={!key || busy} onClick={open}>
          部屋を開く
        </button>
        {last && (
          <button onClick={() => (location.href = `/board?room=${last}`)} disabled={busy}>
            続きを開く
          </button>
        )}
      </div>
      <footer className="credit">{CREDIT}</footer>
    </main>
  );
}

function Room({ roomId }: { roomId: string }) {
  const hostKey = durable.get(KEY) ?? undefined;
  const net = useNet({ roomId, role: "board", ...(hostKey ? { hostKey } : {}) });
  const [since, setSince] = useState<number | null>(null);
  const status = net?.state.status;
  useEffect(() => {
    if (status === "open") setSince(null);
    else setSince((s) => s ?? Date.now());
  }, [status]);
  useEffect(() => {
    durable.set(ROOM, roomId);
  }, [roomId]);
  if (!net) return null;
  const s = net.state;
  return (
    <>
      {s.lobby && <Lobby net={net} lobby={s.lobby} />}
      {s.view && <BoardGame net={net} view={s.view as BoardView} />}
      <NetCover state={s} since={since} />
    </>
  );
}

/** H02 ロビー（BD04 2.2） */
function Lobby({ net, lobby }: { net: Net; lobby: LobbyView }) {
  const admin = net.state.welcome?.admin ?? false;
  const [qr, setQr] = useState<string>("");
  const joinUrl = `${location.origin}/p?room=${lobby.roomId}`;
  const boardUrl = `${location.origin}/board?room=${lobby.roomId}`;
  useEffect(() => {
    // QRコードは大画面のブラウザで作る。部屋の ID を外部のサービスに送らない（BD05 4.6）
    void QRCode.toDataURL(joinUrl, { width: 440, margin: 1 }).then(setQr);
  }, [joinUrl]);
  const ps = [...lobby.participants].sort((a, b) => a.order - b.order);
  const move = (i: number, d: number) => {
    const ids = ps.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    net.conn.admin({ k: "reorder", participantIds: ids });
  };
  const opts = loadOpts();
  return (
    <main className="h-lobby">
      <section className="qr">
        {qr && <img src={qr} alt="参加のQRコード" width={440} height={440} />}
        <p className="big">モバイル通信のまま読んでください</p>
      </section>
      <section className="people">
        <h2>テーブルを時計回りに並べてください</h2>
        <ol>
          {ps.map((p, i) => (
            <li key={p.id} className={p.connected ? "" : "off"} data-participant={p.name}>
              <Mark color={p.color} size={40} />
              <span className="name">{p.name}</span>
              {!p.connected && <span className="tag">切断中</span>}
              {admin && (
                <span className="ctl">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                    ▲
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === ps.length - 1} aria-label="下へ">
                    ▼
                  </button>
                  <select value={p.color} onChange={(e) => net.conn.admin({ k: "setColor", participantId: p.id, color: e.target.value as Color })} aria-label="色">
                    {(Object.keys(COLOR_INFO) as Color[]).map((c) => (
                      <option key={c} value={c}>
                        {COLOR_INFO[c].mark} {COLOR_INFO[c].name}
                      </option>
                    ))}
                  </select>
                  <label>
                    <input type="checkbox" checked={p.rate === 2} onChange={(e) => net.conn.admin({ k: "setRate", participantId: p.id, rate: e.target.checked ? 2 : 1 })} />
                    上級者
                  </label>
                  <button onClick={() => net.conn.admin({ k: "kick", participantId: p.id })}>外す</button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {ps.length === 0 && <p>参加者を待っています</p>}
        {admin && (
          <button className="primary big" disabled={!lobby.canStart} onClick={() => net.conn.admin({ k: "startGame", options: opts })}>
            ゲームを始める
          </button>
        )}
        {!admin && <p>ホストの鍵がないため、閲覧だけです</p>}
      </section>
      <footer className="url">
        大画面のURL（ブックマークしてください）：{boardUrl}
      </footer>
    </main>
  );
}
