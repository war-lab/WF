// 大画面の H03 準備、H04 対戦、H05 管理パネル、H06 取り消しの確認、H07 結果、H08 記録の書き出し（BD04 2.3〜2.8、5章）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import QRCode from "qrcode";
import type { BoardView, GameEvent, PublicPlayerView } from "@word-farm/protocol";
import { buildExport, type RecordFile } from "@word-farm/protocol/record";
import type { Color, Product } from "@word-farm/engine";
import { BoardMap, type HarborKind, type TileKind } from "../BoardMap.tsx";
import { durable } from "../net/browser.ts";
import type { Net } from "../net/useNet.ts";
import { CardBack, Icon, Mark, ledgerSummary } from "../ui/common.tsx";
import { burst, useShown } from "../ui/fly.ts";
import { eventText } from "../ui/events.ts";
import { rejectText } from "../ui/messages.ts";
import { useSounds } from "./sound.ts";
import { releaseHeld } from "./choreo.ts";
import { condText, useBoardFx, useCountUp, type Fx } from "./effects.ts";

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

/**
 * 宣言の結果を含む表示が届いたら、約3秒は宣言の前の表示を出し続ける（BD04 6章）。
 * 結果を遅らせても、点やコインの数、注文の補充が先に変わると、聞き手が英文を聞く前に結果が分かってしまうため
 */
export function BoardGame({ net, view }: { net: Net; view: BoardView }) {
  const prev = useRef(view);
  const handled = useRef<unknown>(null);
  const held = useRef<{ view: BoardView; until: number } | null>(null);
  const [, force] = useState(0);
  const m = net.last;
  if (m !== handled.current && m?.t === "view" && m.events.some((e) => e.k === "orderSucceeded" || e.k === "orderFailed")) {
    handled.current = m;
    held.current = { view: prev.current, until: Date.now() + 3000 };
  }
  const holding = held.current !== null && Date.now() < held.current.until;
  const shown = holding ? held.current!.view : view;
  if (!holding) prev.current = view;
  useEffect(() => {
    if (!holding) return;
    const id = window.setTimeout(() => force((n) => n + 1), held.current!.until - Date.now() + 20);
    return () => window.clearTimeout(id);
  }, [holding, m]);
  // 留めを解いた描画の直後に、ためておいた物の動きを流す（choreo.ts）。画面に出す前なので、新しい数字は一瞬も見えない
  const wasHolding = useRef(false);
  useLayoutEffect(() => {
    if (wasHolding.current && !holding) releaseHeld();
    wasHolding.current = holding;
  });
  return <BoardGameView net={net} view={shown} />;
}

function BoardGameView({ net, view }: { net: Net; view: BoardView }) {
  const admin = net.state.welcome?.admin ?? false;
  const now = useNow();
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [pointer, setPointer] = useState<{ seat: number; vertex: number | null } | null>(null);
  const [panel, setPanel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [delayed, setDelayed] = useState<GameEvent | null>(null);
  const play = useSounds();
  const fx = useBoardFx(net, view);

  const name = (seat: number) => view.players[seat]?.name ?? `席${seat}`;
  const colorOf = (seat: number): Color => view.players[seat]?.color ?? "red";

  // 経過時間は「届いた elapsedMs＋届いてからの時間」で出す。届くたびに受け取った時刻を更新する。
  // rev が変わったときだけ更新すると、再接続で同じ rev の状態が届いたときに、切れていた間を二重に数える
  // （2026-11-10、本番の DEV-05 でデプロイ後に 0:04→1:12→0:39 と出た）
  useEffect(() => setReceivedAt(Date.now()), [view]);
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

  // 終わりの演出（勝者の名前）を出し終えてから、結果の画面に切り替える
  if (view.phase.k === "over" && !fx.holdResult) return <Result net={net} view={view} admin={admin} />;

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
          <PlayerPanel key={p.seat} p={p} fx={fx} turn={view.turn?.seat === p.seat || placing === p.seat} choosing={view.promptStatus.some((x) => x.seat === p.seat && !x.answered)} />
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
          bounce={fx.bounceVertex}
        />

        {fx.dice && (
          <div className={`fx-dice${fx.dice.spin ? " spin" : ""}`} aria-hidden>
            <Die n={fx.dice.a} spin={fx.dice.spin} i={0} />
            <Die n={fx.dice.b} spin={fx.dice.spin} i={1} />
            {!fx.dice.spin && <span className="dice-sum">＝{fx.dice.a + fx.dice.b}</span>}
          </div>
        )}
      </section>

      <aside className="orders">
        {fx.ghosts.map((g) => (
          <div key={g.key} className={`order ghost ${g.kind}`}>
            <p className="text">{g.text}</p>
            <p className="ghost-label">{g.label}</p>
          </div>
        ))}
        {!view.orders.revealed ? (
          <p className="note">ラウンド3の初めに3枚を表にします</p>
        ) : (
          view.orders.faceUp.map((o) => (
            <div key={o.id} className={`order${o.isBonus ? " bonus" : ""}${fx.flipIn.includes(o.id) ? " flip-in" : ""}${fx.declared?.orderId === o.id ? " declared" : ""}`} data-order={o.id}>
              <p className="text">{o.text}</p>
              <div className="order-foot">
                {/* 易の注文の絵。MVP は産物の名前の札で代える（BD04 2.4） */}
                {o.picture && (
                  <span className="pic">
                    <Icon name={`product-${o.picture}`} size={52} title={o.picture} />
                  </span>
                )}
                <span className="left">
                  残り
                  {Array.from({ length: o.remaining }, (_, i) => (
                    <Mark key={i} color={colorOf(o.counterSeat)} />
                  ))}
                </span>
              </div>
            </div>
          ))
        )}
        {view.joint.faceUp.map((j) => (
          <div key={j.id} className={`order joint${fx.flipIn.includes(j.id) ? " flip-in" : ""}`} data-joint={j.id}>
            <p className="text">{j.text}</p>
            <ol className="rows">
              {j.rows.map((r, i) => (
                <li key={i} className={fx.jointPop?.jointId === j.id && fx.jointPop.row === i ? "pop" : ""}>
                  {j.rowPoints[i]! / 2}点 {r ? <><Mark color={colorOf(r.seat)} /> {name(r.seat)}</> : "空き"}
                </li>
              ))}
            </ol>
            {j.counter && (
              <span className="left">
                残り
                {Array.from({ length: j.counter.remaining }, (_, i) => (
                  <Mark key={i} color={colorOf(j.counter!.seat)} />
                ))}
              </span>
            )}
          </div>
        ))}
        <div className="pile-row">
          {/* 単語カードの山。山から配るカードは、ここから生まれて飛ぶ（ui/fly.ts） */}
          <div className="deck" data-deck>
            <CardBack n={Object.values(view.piles).reduce((a, b) => a + b, 0)} w={34} />
          </div>
          <p className="piles">山：{Object.entries(view.piles).map(([k, v]) => `${k} ${v}`).join("　")}</p>
        </div>
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

      {(fx.declared || fx.reveal) && <FocusCard fx={fx} />}
      {fx.banner && (
        <div className="fx-banner" role="status">
          <p>{fx.banner.text}</p>
          {fx.banner.sub && <p className="sub">{fx.banner.sub}</p>}
        </div>
      )}
      {view.paused && <div className="paused-badge">一時停止中</div>}
      {panel && admin && <AdminPanel net={net} view={view} onClose={() => setPanel(false)} name={name} />}
    </main>
  );
}

/** 宣言した注文のカードを手前に大きく出し、約3秒後に条件を開いて結果を出す（BD04 6章） */
function FocusCard({ fx }: { fx: Fx }) {
  const r = fx.reveal;
  const text = r ? r.text : fx.declared!.text;
  return (
    <div className="fx-focus" aria-hidden>
      <div className={`focus-card${r ? (r.ok ? " ok" : " ng") : ""}`}>
        <p className="text">{text}</p>
        {r && (
          <div className="fold">
            <p className="cond">{r.cond}（{r.points}）</p>
            <p className="verdict">{r.ok ? "成立" : "不成立"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

/** サイコロ。回っている間は目を変え続ける */
/**
 * サイコロ1個。盤面の右下から投げ込まれ、3回弾みながら転がって中央で止まる（約1秒。止める時刻は effects.ts）。
 * 転がる間は目を切り替え続け、止まったら出目を出して土煙を立てる
 */
function Die({ n, spin, i }: { n: number; spin: boolean; i: number }) {
  const [face, setFace] = useState(n);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!spin) {
      setFace(n);
      if (ref.current) burst(ref.current, "puff", { n: 5, spread: 70, size: 40 });
      return;
    }
    const id = window.setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    return () => window.clearInterval(id);
  }, [spin, n]);
  useEffect(() => {
    if (!spin || !ref.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 出発点は2個で少しずらす。x は進んだ割合、y は弾みの高さ（負で上）
    const sx = 560 + i * 70;
    const sy = 300 - i * 60;
    const r0 = 900 + i * 180;
    const path: [number, number, number][] = [
      [0, 0, 0],
      [0.3, 0.45, 0],
      [0.42, 0.6, -70],
      [0.56, 0.78, 0],
      [0.66, 0.88, -28],
      [0.76, 0.95, 0],
      [0.84, 0.985, -8],
      [0.92, 1, 0],
      [1, 1, 0],
    ];
    ref.current.animate(
      path.map(([t, p, h]) => {
        const rot = r0 * (1 - p) * (1 - p);
        const squash = h === 0 && t > 0 && t < 1 ? "scale(1.08, 0.92)" : "scale(1)";
        return { offset: t, opacity: t === 0 ? 0.2 : 1, transform: `translate(${sx * (1 - p)}px, ${sy * (1 - p) + h}px) rotate(${rot}deg) ${squash}` };
      }),
      { duration: 1000, easing: "cubic-bezier(.25,.6,.4,1)" },
    );
  }, [spin, i]);
  return (
    <svg ref={ref} className="die" viewBox="0 0 100 100" width={120} height={120}>
      <rect x={4} y={4} width={92} height={92} rx={18} fill="#fffdf6" stroke="#4a4036" strokeWidth={5} />
      {PIPS[face]!.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9} fill={face === 1 ? "#c0392b" : "#2a2620"} />
      ))}
    </svg>
  );
}

/** プレイヤー欄の産物1種類。飛んでいる途中の数は、届くまで出さない */
function ProdCount({ seat, k, n }: { seat: number; k: string; n: number }) {
  const shown = useShown(seat, `product:${k}`, n);
  return (
    <span className={shown ? "" : "zero"} data-product={k}>
      <Icon name={`product-${k}`} size={30} title={k} />
      {shown}
    </span>
  );
}

function PlayerPanel({ p, turn, choosing, fx }: { p: PublicPlayerView; turn: boolean; choosing: boolean; fx: Fx }) {
  // 物が飛んでいる間は、届くまで前の値を出す（ui/fly.ts）
  const coins = useCountUp(useShown(p.seat, "coins", p.coins));
  const hand = useShown(p.seat, "hand", p.handCount);
  const hp = useShown(p.seat, "pts", p.halfPoints);
  const floats = fx.floats[p.seat] ?? [];
  const flash = fx.flashPlots[p.seat] ?? [];
  return (
    <div className={`pp${turn ? " turn" : ""}${p.connected ? "" : " off"}${fx.pulseSeat === p.seat ? " pulse" : ""}`} data-seat={p.seat}>
      <div className="floats" aria-hidden>
        {floats.map((f) => (
          <span key={f.key} className="float">
            {f.text}
          </span>
        ))}
      </div>
      <div className="head">
        <Mark color={p.color} size={32} /> <span className="name">{p.name}</span>
        <span className="pts">{hp / 2}点</span>
        <span className={`coins${coins !== p.coins ? " counting" : ""}`}>
          <Icon name="ui-coin" size={30} title="コイン" /> {coins}
        </span>
      </div>
      <div>
        <span className={`hand${fx.glowHand.includes(p.seat) ? " glow" : ""}`} title={`手札 ${p.handCount}枚`}>
          <CardBack n={hand} />
        </span>
        　無料券 {p.freeTickets}　拠点 {p.houses.length}
        {choosing && <span className="tag">選択中</span>}
        {!p.connected && <span className="tag">切断中</span>}
      </div>
      <div className="prod">
        {PRODUCTS.map((k) => (
          <ProdCount key={k} seat={p.seat} k={k} n={p.products[k] ?? 0} />
        ))}
      </div>
      <div className="plots">
        {p.plots.map((x, i) => (
          <span key={i} data-plot={i} className={`plot ${x.t}${flash.includes(i) ? " flash" : ""}`} title={x.t === "empty" ? "空き" : x.t === "crop" ? x.crop : x.animal}>
            {x.t !== "empty" && <Icon name={`farm-${x.t === "crop" ? x.crop : x.animal}`} size={38} title={x.t === "crop" ? x.crop : x.animal} />}
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
          <div className="admin-groups">
            <section>
              <h3>進行</h3>
              <button onClick={() => net.conn.admin({ k: view.paused ? "resume" : "pause" })}>{view.paused ? "再開" : "一時停止"}</button>
              <button
                disabled={!lc}
                onClick={() =>
                  ask(`次の操作を取り消します。\n${lc!.summary}\nすでに見えた情報（開いた注文の条件など）は、見えたままになります。`, () => net.conn.admin({ k: "undoLast", seq: lc!.seq }))
                }
              >
                1つ取り消す
              </button>
              {view.turn && view.phase.k === "main" && (
                <button onClick={() => ask(`${name(view.turn!.seat)} の手番を終えますか？`, () => net.conn.admin({ k: "endTurnFor", turnSerial: view.turn!.serial }))}>
                  手番を終える
                </button>
              )}
              {open.map((p) => (
                <button key={p.promptId} onClick={() => ask(`${name(p.seat)} の代わりに答えますか？`, () => answerFor(net, p.promptId))}>
                  {name(p.seat)} の代わりに答える
                </button>
              ))}
            </section>
            <section>
              <h3>席の再発行</h3>
              {view.players.map((p) => (
                <button key={p.seat} onClick={() => ask(`${p.name} の席を作り直しますか？`, () => (setClaimFor(p.seat), net.conn.admin({ k: "reissueSeat", seat: p.seat })))}>
                  <Mark color={p.color} /> {p.name}
                </button>
              ))}
            </section>
            <section>
              <h3>終わり</h3>
              <button disabled={view.endFlag !== null} onClick={() => ask("最終ラウンドにしますか？", () => net.conn.admin({ k: "callLastRound" }))}>
                最終ラウンドにする
              </button>
              <button className="danger" onClick={() => ask("ゲームを打ち切りますか？", () => net.conn.admin({ k: "abortGame" }), true)}>
                ゲームを打ち切る
              </button>
            </section>
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
  const [exporting, setExporting] = useState(false);
  const reason = { target: "8点到達", orders: "注文切れ", host: "最終ラウンドの宣言", aborted: "打ち切り" }[r.reason];
  const top = r.ranking.filter((x) => x.rank === 1).map((x) => name(x.seat));
  void net;
  return (
    <main className="h-result">
      <header className="result-head">
        <p className="winner">{r.reason === "target" ? `${name(r.winnerSeat!)} の勝ち` : `1位：${top.join("、")}`}</p>
        <p className="reason">終わり方：{reason}</p>
      </header>
      <table className="result-table">
        <thead>
          <tr>
            <th>順位</th>
            <th>名前</th>
            <th>点</th>
            <th>コイン</th>
            <th>点の内訳</th>
          </tr>
        </thead>
        <tbody>
          {r.ranking.map((x) => (
            <tr key={x.seat} data-rank={x.rank} className={x.rank === 1 ? "first" : ""}>
              <td className="rank">{x.rank}</td>
              <td>
                <Mark color={view.players[x.seat]!.color} /> {name(x.seat)}
              </td>
              <td className="num">{x.halfPoints / 2}</td>
              <td className="num">{x.coins}</td>
              <td className="ledger">
                {ledgerSummary(view.players[x.seat]!.ledger).map((l) => (
                  <span key={l.label}>
                    {l.label} {l.points}点（{l.count}）
                  </span>
                ))}
                {view.players[x.seat]!.ledger.length === 0 && <span>なし</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.finalReveal && (
        <details className="reveal">
          <summary>注文の条件をすべて見る</summary>
          <ul>
            {view.finalReveal.orders.map((o) => (
              <li key={o.id}>
                <span className="text">{o.text}</span>
                <span className="cond">
                  {condText(o.cond)}（{o.hp === null ? "ボーナス" : `${o.hp / 2}点`}）
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {admin && !exporting && (
        <div className="row">
          <button className="primary big" onClick={() => setExporting(true)}>
            記録の書き出し
          </button>
        </div>
      )}
      {admin && exporting && <Export onClose={() => setExporting(false)} />}
      <footer className="credit">{CREDIT}</footer>
    </main>
  );
}

/** H08 記録の書き出し（BD04 2.8）。記録を取り出して集計の表を出し、zip を保存させる */
function Export({ onClose }: { onClose: () => void }) {
  const roomId = new URLSearchParams(location.search).get("room")!;
  const key = durable.get("wf:hostKey") ?? "";
  const [rec, setRec] = useState<RecordFile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void fetch(`/api/rooms/${roomId}/record`, { headers: { Authorization: `Bearer ${key}` } }).then(async (res) => {
      if (!res.ok) return setMsg("記録を取り出せませんでした");
      setRec((await res.json()) as RecordFile);
    });
  }, [roomId, key]);
  const files = useMemo(() => (rec ? buildExport(rec) : null), [rec]);
  const stats = useMemo(() => (files ? exportStats(files) : null), [files]);
  const save = () => {
    if (!rec || !files) return;
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
    const res = await fetch(`/api/rooms/${roomId}`, { method: "DELETE", headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      durable.remove("wf:boardRoom");
      location.href = "/board";
    } else setMsg("削除できませんでした");
  };
  return (
    <section className="export">
      <h2>記録の書き出し</h2>
      {!stats && !msg && <p>記録を取り出しています</p>}
      {stats && (
        <table className="stats">
          <tbody>
            {stats.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button className="primary" disabled={!files} onClick={save}>
          記録を保存
        </button>
        <button disabled={!saved} onClick={del}>
          部屋を削除
        </button>
        <button onClick={onClose}>閉じる</button>
      </div>
      {msg && <p className="err">{msg}</p>}
    </section>
  );
}

/** 書き出しのファイルから、方式設計10章の集計の一部を表にする（BD04 2.8） */
function exportStats(files: Record<string, string>): [string, string][] {
  const rows = (name: string) => {
    const [head, ...lines] = files[name]!.trim().split("\n");
    const cols = head!.split(",");
    return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])) as Record<string, string>);
  };
  const turns = rows("turns.csv");
  const actions = rows("actions.csv");
  const summary = JSON.parse(files["summary.json"]!) as { elapsedMs: number; setupMs: number | null; rounds: number | null };
  const dur = turns.map((t) => Number(t.durationMs)).filter((n) => Number.isFinite(n));
  const avg = dur.length ? dur.reduce((a, b) => a + b, 0) / dur.length : 0;
  const count = (ev: string) => actions.filter((a) => a.event === ev).length;
  return [
    ["1局の時間", fmt(summary.elapsedMs)],
    ["準備の時間", summary.setupMs === null ? "—" : fmt(summary.setupMs)],
    ["手番の数", `${turns.length}（${summary.rounds ?? "—"}ラウンド）`],
    ["手番の時間の平均", fmt(avg)],
    ["手番の時間の最長", fmt(dur.length ? Math.max(...dur) : 0)],
    ["日本語の支払い", `${count("japanesePaid")}回`],
    ["注文の成立", `${count("orderSucceeded")}回`],
    ["注文の不成立", `${count("orderFailed")}回`],
    ["交換の成立", `${count("tradeAccepted")}回`],
  ];
}
