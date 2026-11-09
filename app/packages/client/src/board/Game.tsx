// 大画面の H03 準備、H04 対戦、H05 管理パネル、H06 取り消しの確認、H07 結果、H08 記録の書き出し（BD04 2.3〜2.8、5章）。
import { useEffect, useMemo, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import QRCode from "qrcode";
import type { BoardView, GameEvent, PublicPlayerView } from "@word-farm/protocol";
import { buildExport, type RecordFile } from "@word-farm/protocol/record";
import type { Color, Product } from "@word-farm/engine";
import { BoardMap, type HarborKind, type TileKind } from "../BoardMap.tsx";
import { durable } from "../net/browser.ts";
import type { Net } from "../net/useNet.ts";
import { Mark } from "../ui/common.tsx";
import { eventText } from "../ui/events.ts";
import { rejectText } from "../ui/messages.ts";
import { useSounds } from "./sound.ts";

const PRODUCTS: Product[] = ["carrot", "potato", "wheat", "egg", "milk"];
const CREDIT = "音楽：魔王魂（https://maou.audio/）　効果音：効果音ラボ、Pixabay";

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const setupSeat = (v: BoardView) => {
  if (v.phase.k !== "setupPlace") return null;
  const step = v.phase.step;
  return step < v.n ? step : 2 * v.n - 1 - step;
};

const DECL = new Set(["orderDeclared", "jointRowFilled", "planted", "animalBought", "fed", "productsSold", "animalSold", "houseBuilt"]);

export function BoardGame({ net, view }: { net: Net; view: BoardView }) {
  const admin = net.state.welcome?.admin ?? false;
  const now = useNow();
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [pointer, setPointer] = useState<{ seat: number; vertex: number | null } | null>(null);
  const [panel, setPanel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [delayed, setDelayed] = useState<GameEvent | null>(null);
  const play = useSounds();

  const name = (seat: number) => view.players[seat]?.name ?? `席${seat}`;
  const colorOf = (seat: number): Color => view.players[seat]?.color ?? "red";

  useEffect(() => setReceivedAt(Date.now()), [view.rev]);
  // 届いたメッセージ：pointer、拒否、出来事の音
  useEffect(() => {
    const m = net.last;
    if (!m) return;
    if (m.t === "pointer") setPointer({ seat: m.seat, vertex: m.vertex });
    if (m.t === "reject") setNotice(m.code === "STALE_TARGET" ? "表示が古くなっていました。もう一度確かめてください" : rejectText(m.code));
    if (m.t === "view") {
      for (const e of m.events) play(e);
      // 宣言の結果は、英文を出してから約3秒おいて出す（BD04 6章）
      const result = m.events.find((e) => e.k === "orderSucceeded" || e.k === "orderFailed");
      if (result) {
        // 聞き手が本人の声と英文を照らし合わせる間を作るため、結果は約3秒おいてから出し、しばらく出しておく
        window.setTimeout(() => setDelayed(result), 3000);
        window.setTimeout(() => setDelayed((d) => (d === result ? null : d)), 3000 + 5000);
      }
      if (m.events.some((e) => e.k === "housePlaced" || e.k === "turnStarted")) setPointer(null);
    }
  }, [net.last, play]);

  const houses = useMemo(() => {
    const h: Partial<Record<number, Color>> = {};
    for (const p of view.players) for (const v of p.houses) h[v] = p.color;
    return h;
  }, [view.players]);
  const tileKinds = useMemo(() => {
    const k: Partial<Record<number, TileKind>> = {};
    for (const t of view.board.tiles) if (t.kind !== "market") k[t.id] = t.kind as TileKind;
    return k;
  }, [view.board.tiles]);
  const harborKinds = useMemo(() => {
    const k: Partial<Record<number, HarborKind>> = {};
    for (const h of view.board.harbors) k[h.vertex] = h.kind as HarborKind;
    return k;
  }, [view.board.harbors]);
  const dice = view.turn?.dice ?? null;
  const lit = dice ? view.board.tiles.filter((t) => t.number === dice[0] + dice[1]).map((t) => t.id) : [];

  const elapsed = view.clock.startedAt === null ? 0 : view.clock.elapsedMs + (view.paused ? 0 : now - receivedAt);
  const placing = setupSeat(view);
  const recent = net.state.recent;
  // 成立と不成立は、約3秒おいてから別に出す（delayed）。それまでは宣言の英文を出し続ける。
  // 同じ処理で出た出来事（同じ rev）に宣言があれば、その英文を優先する。成立と同時に出る補充の文で、英文が消えないため
  const lastRev = recent.at(-1)?.rev;
  const decl = [...recent].reverse().find((e) => e.rev === lastRev && DECL.has(e.k));
  // 同じ処理で起きた完成、時間切れ、最終ラウンドの知らせは、英文の下に別の行で出す（BD04 6章）
  const notes = decl
    ? recent.filter((e) => e.rev === lastRev && ["jointCompleted", "jointExpired", "orderExpired", "endFlagged"].includes(e.k)).map((e) => eventText(e, name))
    : [];
  const lastText = decl
    ? { e: decl, t: eventText(decl, name) }
    : [...recent]
        .reverse()
        .filter((e) => e.k !== "orderSucceeded" && e.k !== "orderFailed")
        .map((e) => ({ e, t: eventText(e, name) }))
        .find((x) => x.t !== null);
  // 読み上げの促し（BD04 2.4）：表にした注文があり、そのあとに宣言も手番の交代もない間
  const revealIdx = recent.findLastIndex((e) => e.k === "ordersRevealed" || e.k === "jointRevealed");
  const readAloud =
    revealIdx >= 0 &&
    !recent.slice(revealIdx + 1).some((e) => DECL.has(e.k) || (e.k === "turnStarted" && e.rev > recent[revealIdx]!.rev))
      ? name(view.turn?.seat ?? 0)
      : null;

  if (view.phase.k === "over") return <Result net={net} view={view} admin={admin} />;

  const phaseText =
    view.phase.k === "setupPlace"
      ? `${name(placing!)} が拠点を置いています（${view.phase.step < view.n ? 1 : 2}個目）`
      : view.phase.k === "setupPrompt" || view.phase.k === "income"
        ? "カードを選んでいます"
        : view.phase.k === "roll"
          ? "サイコロ"
          : view.phase.k === "main"
            ? "交渉と行動"
            : "";

  return (
    <main className="h-game">
      <header className="top">
        <span>ラウンド {view.turn?.round ?? 0}</span>
        <span className="who">{view.turn ? <><Mark color={colorOf(view.turn.seat)} /> {name(view.turn.seat)} の手番</> : "準備"}</span>
        <span>{phaseText}</span>
        <span className="dice">{dice ? `${dice[0]}＋${dice[1]}＝${dice[0] + dice[1]}` : ""}</span>
        <span className="clock">{fmt(elapsed)}</span>
        <span>注文の山 {view.orders.deckCount}</span>
        {view.endFlag && <span className="warn">{view.endFlag.reason === "host" ? "最終ラウンドです（ホストの宣言）" : "最終ラウンドです（注文切れ）"}</span>}
        {admin && (
          <button className="admin-open" onClick={() => setPanel(true)}>
            管理
          </button>
        )}
      </header>

      <aside className="players">
        {view.players.map((p) => (
          <PlayerPanel key={p.seat} p={p} turn={view.turn?.seat === p.seat || placing === p.seat} choosing={view.promptStatus.some((x) => x.seat === p.seat && !x.answered)} />
        ))}
      </aside>

      <section className="map">
        <BoardMap
          tileKinds={tileKinds}
          harborKinds={harborKinds}
          houses={houses}
          litTiles={lit}
          selected={pointer?.vertex ?? null}
          selectedColor={pointer ? colorOf(pointer.seat) : null}
        />
      </section>

      <aside className="orders">
        {!view.orders.revealed ? (
          <p className="note">ラウンド3の初めに3枚を表にします</p>
        ) : (
          view.orders.faceUp.map((o) => (
            <div key={o.id} className={`order${o.isBonus ? " bonus" : ""}`} data-order={o.id}>
              <p className="text">{o.text}</p>
              {o.picture && <span className="pic">{o.picture}</span>}
              <span className="left">
                {Array.from({ length: o.remaining }, (_, i) => (
                  <Mark key={i} color={colorOf(o.counterSeat)} />
                ))}
              </span>
            </div>
          ))
        )}
        {view.joint.faceUp.map((j) => (
          <div key={j.id} className="order joint" data-joint={j.id}>
            <p className="text">{j.text}</p>
            <ol className="rows">
              {j.rows.map((r, i) => (
                <li key={i}>
                  {j.rowPoints[i]! / 2}点 {r ? <><Mark color={colorOf(r.seat)} /> {name(r.seat)}</> : "空き"}
                </li>
              ))}
            </ol>
            {j.counter && (
              <span className="left">
                {Array.from({ length: j.counter.remaining }, (_, i) => (
                  <Mark key={i} color={colorOf(j.counter!.seat)} />
                ))}
              </span>
            )}
          </div>
        ))}
        <p className="piles">山：{Object.entries(view.piles).map(([k, v]) => `${k} ${v}`).join("　")}</p>
      </aside>

      <footer className="band">
        {delayed ? (
          <p className={`result ${delayed.k === "orderSucceeded" ? "ok" : "ng"}`}>{eventText(delayed, name)}</p>
        ) : (
          lastText && <p className="sentence">{lastText.t}</p>
        )}
        {notes.map((n, i) => (
          <p key={i} className="note-line">
            {n}
          </p>
        ))}
        {readAloud && <p className="read">{readAloud} さん、新しい注文を読み上げてください（Read the new orders aloud）</p>}
        {view.trades.map((t) => (
          <p key={t.id} className="trade">
            申し出：{name(t.from)} → {name(t.to)}
          </p>
        ))}
        {notice && (
          <p className="err" onClick={() => setNotice(null)}>
            {notice}
          </p>
        )}
      </footer>

      {view.paused && <div className="paused-badge">一時停止中</div>}
      {panel && admin && <AdminPanel net={net} view={view} onClose={() => setPanel(false)} name={name} />}
    </main>
  );
}

function PlayerPanel({ p, turn, choosing }: { p: PublicPlayerView; turn: boolean; choosing: boolean }) {
  return (
    <div className={`pp${turn ? " turn" : ""}${p.connected ? "" : " off"}`} data-seat={p.seat}>
      <div className="head">
        <Mark color={p.color} size={32} /> <span className="name">{p.name}</span>
        <span className="pts">{p.halfPoints / 2}点</span>
        <span className="coins">コイン {p.coins}</span>
      </div>
      <div>
        手札 {p.handCount}枚　無料券 {p.freeTickets}　拠点 {p.houses.length}
        {choosing && <span className="tag">選択中</span>}
        {!p.connected && <span className="tag">切断中</span>}
      </div>
      <div className="prod">{PRODUCTS.map((k) => `${k} ${p.products[k] ?? 0}`).join("  ")}</div>
      <div className="plots">
        {p.plots.map((x, i) => (
          <span key={i} className="plot">
            {x.t === "empty" ? "空き" : x.t === "crop" ? x.crop : x.animal}
          </span>
        ))}
      </div>
    </div>
  );
}

/** H05 管理パネルと H06 取り消しの確認（BD04 2.5、2.6） */
function AdminPanel({ net, view, onClose, name }: { net: Net; view: BoardView; onClose: () => void; name: (s: number) => string }) {
  const [confirm, setConfirm] = useState<null | { text: string; run: () => void; twice?: boolean; step?: number }>(null);
  const [claimFor, setClaimFor] = useState<number | null>(null);
  const claimCode = net.last?.t === "claimCode" ? net.last : null;
  const claimReq = net.last?.t === "claimRequest" ? net.last : null;
  const ask = (text: string, run: () => void, twice = false) => setConfirm({ text, run, twice, step: 0 });
  const lc = view.lastCommand;
  const open = view.promptStatus.filter((p) => !p.answered);
  return (
    <div className="cover">
      <div className="cover-box admin">
        <h2>管理</h2>
        {confirm ? (
          <>
            <p>{confirm.twice && confirm.step === 1 ? `本当に${confirm.text}` : confirm.text}</p>
            <button
              className="primary"
              onClick={() => {
                if (confirm.twice && confirm.step === 0) return setConfirm({ ...confirm, step: 1 });
                confirm.run();
                setConfirm(null);
              }}
            >
              実行
            </button>
            <button onClick={() => setConfirm(null)}>やめる</button>
          </>
        ) : (
          <div className="grid">
            <button onClick={() => net.conn.admin({ k: view.paused ? "resume" : "pause" })}>{view.paused ? "再開" : "一時停止"}</button>
            <button
              disabled={!lc}
              onClick={() =>
                ask(`次の操作を取り消します。\n${lc!.summary}\nすでに見えた情報（開いた注文の条件など）は、見えたままになります。`, () => net.conn.admin({ k: "undoLast", seq: lc!.seq }))
              }
            >
              1つ取り消す
            </button>
            {open.map((p) => (
              <button key={p.promptId} onClick={() => ask(`${name(p.seat)} の代わりに答えますか？`, () => answerFor(net, p.promptId))}>
                {name(p.seat)} の代わりに答える
              </button>
            ))}
            {view.turn && view.phase.k === "main" && (
              <button onClick={() => ask(`${name(view.turn!.seat)} の手番を終えますか？`, () => net.conn.admin({ k: "endTurnFor", turnSerial: view.turn!.serial }))}>
                手番を終える
              </button>
            )}
            <span>
              席の再発行：
              {view.players.map((p) => (
                <button key={p.seat} onClick={() => ask(`${p.name} の席を作り直しますか？`, () => (setClaimFor(p.seat), net.conn.admin({ k: "reissueSeat", seat: p.seat })))}>
                  {p.name}
                </button>
              ))}
            </span>
            <button disabled={view.endFlag !== null} onClick={() => ask("最終ラウンドにしますか？", () => net.conn.admin({ k: "callLastRound" }))}>
              最終ラウンドにする
            </button>
            <button onClick={() => ask("ゲームを打ち切りますか？", () => net.conn.admin({ k: "abortGame" }), true)}>ゲームを打ち切る</button>
          </div>
        )}
        {claimFor !== null && claimCode && <ClaimQr code={claimCode.code} roomId={new URLSearchParams(location.search).get("room")!} />}
        {claimReq && (
          <p>
            {name(claimReq.seat)} の席に新しい端末がつながろうとしています。承認しますか？
            <button className="primary" onClick={() => net.conn.admin({ k: "approveClaim", seat: claimReq.seat, approve: true })}>
              承認
            </button>
            <button onClick={() => net.conn.admin({ k: "approveClaim", seat: claimReq.seat, approve: false })}>承認しない</button>
          </p>
        )}
        <button className="close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

function answerFor(net: Net, promptId: string): void {
  // 答えを省くと、サーバーが既定の答えを作る（BD04 2.5。大画面は問いの選択肢を知らないため）
  net.conn.admin({ k: "answerFor", promptId });
}

function ClaimQr({ code, roomId }: { code: string; roomId: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(`${location.origin}/p?room=${roomId}&claim=${code}`, { width: 320, margin: 1 }).then(setSrc);
  }, [code, roomId]);
  return src ? <img src={src} alt="席の再発行のQRコード" width={320} height={320} /> : null;
}

/** H07 結果と H08 記録の書き出し（BD04 2.7、2.8） */
function Result({ net, view, admin }: { net: Net; view: BoardView; admin: boolean }) {
  const r = view.result!;
  const name = (seat: number) => view.players[seat]?.name ?? `席${seat}`;
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const reason = { target: "8点到達", orders: "注文切れ", host: "最終ラウンドの宣言", aborted: "打ち切り" }[r.reason];
  const top = r.ranking.filter((x) => x.rank === 1).map((x) => name(x.seat));
  const save = async () => {
    const roomId = new URLSearchParams(location.search).get("room")!;
    const key = durable.get("wf:hostKey") ?? "";
    const res = await fetch(`/api/rooms/${roomId}/record`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return setMsg("記録を取り出せませんでした");
    const rec = (await res.json()) as RecordFile;
    const files = buildExport(rec);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const a = document.createElement("a");
    const stamp = rec.meta.createdAt.replace(/[-:]/g, "").slice(0, 13);
    a.href = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: "application/zip" }));
    a.download = `wordfarm_${stamp}.zip`;
    a.click();
    setSaved(true);
  };
  const del = async () => {
    if (!confirm("部屋を削除しますか？ 記録はサーバーから消え、戻せません") || !confirm("本当に削除しますか？")) return;
    const roomId = new URLSearchParams(location.search).get("room")!;
    const key = durable.get("wf:hostKey") ?? "";
    const res = await fetch(`/api/rooms/${roomId}`, { method: "DELETE", headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      durable.remove("wf:boardRoom");
      location.href = "/board";
    } else setMsg("削除できませんでした");
  };
  void net;
  return (
    <main className="h-result">
      <h1>{r.reason === "target" ? `${name(r.winnerSeat!)} の勝ち` : `1位：${top.join("、")}`}</h1>
      <p className="big">終わり方：{reason}</p>
      <table>
        <thead>
          <tr>
            <th>順位</th>
            <th>名前</th>
            <th>点</th>
            <th>コイン</th>
            <th>内訳</th>
          </tr>
        </thead>
        <tbody>
          {r.ranking.map((x) => (
            <tr key={x.seat} data-rank={x.rank}>
              <td>{x.rank}</td>
              <td>
                <Mark color={view.players[x.seat]!.color} /> {name(x.seat)}
              </td>
              <td>{x.halfPoints / 2}</td>
              <td>{x.coins}</td>
              <td>{view.players[x.seat]!.ledger.map((e) => `${e.src} ${e.hp / 2}`).join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.finalReveal && (
        <details>
          <summary>注文の条件をすべて見る</summary>
          <ul>
            {view.finalReveal.orders.map((o) => (
              <li key={o.id}>
                {o.text}（{o.hp === null ? "ボーナス" : `${o.hp / 2}点`}）
              </li>
            ))}
          </ul>
        </details>
      )}
      {admin && (
        <div className="row">
          <button className="primary" onClick={save}>
            記録を保存
          </button>
          <button disabled={!saved} onClick={del}>
            部屋を削除
          </button>
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
      <footer className="credit">{CREDIT}</footer>
    </main>
  );
}
