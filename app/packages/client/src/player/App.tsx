// スマホ（BD04 3章）。P01 参加、P02 待機、P03 拠点の配置、P06 問い、P07 結果を、サーバーから届いた状態で切り替える。
// スマホが自分で画面を進めることはない。再接続の直後に、正しい画面へ戻すためである（BD04 1.3）。
import { useEffect, useMemo, useState } from "react";
import type { LobbyView, PlayerView } from "@word-farm/protocol";
import { board, type Prompt, type PromptSource, type WordCard } from "@word-farm/engine";
import { BoardMap, type HarborKind, type TileKind } from "../BoardMap.tsx";
import { durable } from "../net/browser.ts";
import { useNet, type Net } from "../net/useNet.ts";
import { Cover, Mark, NetCover } from "../ui/common.tsx";
import { rejectText } from "../ui/messages.ts";
import { Play } from "./Play.tsx";

const NAME = "wf:name";

export function PlayerApp() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  const claim = params.get("claim") ?? undefined;
  const net = useNet(roomId ? { roomId, role: "player", ...(claim ? { claim } : {}) } : null);
  const [since, setSince] = useState<number | null>(null);
  const status = net?.state.status;
  useEffect(() => {
    if (status === "open") setSince(null);
    else setSince((s) => s ?? Date.now());
  }, [status]);
  if (!roomId) return <main className="p">部屋が見つかりません。大画面のQRコードを読み直してください</main>;
  if (!net) return null;
  const s = net.state;
  if (s.status === "needJoin") {
    // トークンが無効になった。参加の画面からやり直す
    return (
      <main className="p">
        <p>席が見つかりません。ゲームが始まっている場合は、ホストに席の作り直しを頼んでください</p>
        <button onClick={() => location.reload()}>やり直す</button>
      </main>
    );
  }
  return (
    <>
      <Screen net={net} />
      <NetCover state={s} since={since} />
    </>
  );
}

function Screen({ net }: { net: Net }) {
  const s = net.state;
  const last = net.last;
  if (last?.t === "claimPending" || (s.welcome && !s.welcome.participantId && !s.view && !s.lobby)) return <Claim net={net} />;
  if (s.lobby) return <Lobby net={net} lobby={s.lobby} />;
  const v = s.view as PlayerView | null;
  if (!v) return <main className="p">読み込んでいます</main>;
  if (!("me" in v)) return <main className="p">ゲームは始まっています。席を戻すときはホストに伝えてください</main>;
  if (v.phase.k === "over") return <Result view={v} />;
  const myPrompt = v.me.prompts.find((p) => !v.me.answers[p.id]);
  const answered = v.me.prompts.find((p) => v.me.answers[p.id]);
  // 問いごとに作り直す。前の問いで選んだ状態を次の問いに持ち越さないため
  if (myPrompt) return <Ask key={myPrompt.id} net={net} view={v} prompt={myPrompt} />;
  if (answered && v.promptStatus.some((p) => !p.answered)) return <Waiting key={answered.id} net={net} view={v} prompt={answered} />;
  if (v.phase.k === "setupPlace" || v.phase.k === "setupPrompt") return <Setup net={net} view={v} />;
  return <Play net={net} view={v} />;
}

/** 席の再発行の合言葉で入った端末（BD03 3.6、BD04 2.5） */
function Claim({ net }: { net: Net }) {
  const m = net.last?.t === "claimPending" ? net.last : null;
  const [sent, setSent] = useState(false);
  const err = net.state.lastError?.code === "CLAIM";
  if (err) return <main className="p">ホストが承認しませんでした</main>;
  if (!m) return <main className="p">確かめています</main>;
  return (
    <main className="p">
      <p className="big">{m.seatName} の席に戻りますか？</p>
      {sent ? (
        <p>ホストの承認を待っています</p>
      ) : (
        <button className="primary" onClick={() => (net.conn.post({ t: "claimConfirm" }), setSent(true))}>
          戻る
        </button>
      )}
    </main>
  );
}

/** P01 参加と P02 待機（BD04 3.1、3.2） */
function Lobby({ net, lobby }: { net: Net; lobby: LobbyView }) {
  const me = net.state.welcome?.participantId;
  const joined = lobby.participants.find((p) => p.id === me);
  const [name, setName] = useState(durable.get(NAME) ?? "");
  const err = net.last?.t === "error" ? net.last : null;
  if (!joined) {
    if (lobby.gameStarted) return <main className="p">ゲームは始まっています。席を戻すときはホストに伝えてください</main>;
    return (
      <main className="p p-join">
        <h1>WORD FARM</h1>
        <label>
          名前
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="hint">あだ名で入ってください（名前は外部のサーバーに保存されます）</p>
        {err?.code === "LOBBY_FULL" && <p className="err">満員です</p>}
        {err?.code === "NAME_TAKEN" && <p className="err">同じ名前の人がいます</p>}
        {lobby.participants.length >= 4 && <p className="err">満員です</p>}
        <button
          className="primary"
          disabled={name.trim().length === 0 || lobby.participants.length >= 4}
          onClick={() => {
            durable.set(NAME, name.trim());
            net.conn.post({ t: "join", name: name.trim() });
          }}
        >
          参加する
        </button>
      </main>
    );
  }
  return (
    <main className="p">
      <p className="big">
        <Mark color={joined.color} size={28} /> {joined.name}
      </p>
      <p>ホストがゲームを始めるのを待っています</p>
      <ul>
        {[...lobby.participants]
          .sort((a, b) => a.order - b.order)
          .map((p) => (
            <li key={p.id}>
              <Mark color={p.color} /> {p.name}
            </li>
          ))}
      </ul>
      <Phrases />
    </main>
  );
}

/** 待ち時間に読む例文（BD04 3.10）。正本はルールブック04章と07章 */
export function Phrases() {
  return (
    <details className="phrases">
      <summary>交渉の言い方</summary>
      <ul>
        <li>Can I have a carrot card?</li>
        <li>I'll give you two coins for a cow card.</li>
        <li>Do you have any eggs?</li>
        <li>How about one feed card for two sell cards?</li>
        <li>No, thank you. / Deal!</li>
      </ul>
    </details>
  );
}

const setupSeat = (v: PlayerView) => {
  if (v.phase.k !== "setupPlace") return null;
  const step = v.phase.step;
  return step < v.n ? step : 2 * v.n - 1 - step;
};

export function useMapProps(v: PlayerView) {
  return useMemo(() => {
    const houses: Record<number, PlayerView["players"][number]["color"]> = {};
    for (const p of v.players) for (const h of p.houses) houses[h] = p.color;
    const tileKinds: Partial<Record<number, TileKind>> = {};
    for (const t of v.board.tiles) if (t.kind !== "market") tileKinds[t.id] = t.kind as TileKind;
    const harborKinds: Partial<Record<number, HarborKind>> = {};
    for (const h of v.board.harbors) harborKinds[h.vertex] = h.kind as HarborKind;
    return { houses, tileKinds, harborKinds };
  }, [v.players, v.board]);
}

/** 交点に接するタイルの説明（BD04 3.3 の「選んだ交点」） */
export function vertexInfo(v: PlayerView, vertex: number): string {
  const tiles = board.vertices.find((x) => x.id === vertex)!.tiles.map((id) => v.board.tiles[id]!);
  const parts = tiles.map((t) => (t.kind === "market" ? "Market" : `${t.kind} ${t.number}`));
  const h = v.board.harbors.find((x) => x.vertex === vertex);
  return parts.join("、") + (h ? `、港（${h.kind === "any" ? "3:1" : `${h.kind} 2:1`}）` : "");
}

/** P02 の準備の間と、P03 拠点の配置（BD04 3.2、3.3） */
function Setup({ net, view }: { net: Net; view: PlayerView }) {
  const seat = setupSeat(view);
  const mine = seat === view.me.seat;
  const [sel, setSel] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const mp = useMapProps(view);
  const cands = mine ? (view.legal.placeHouse?.vertices ?? []) : [];
  const select = (vx: number) => {
    setSel(vx);
    setConfirm(false);
    // 選んでいる交点を大画面で光らせる（BD04 2.3）
    net.conn.post({ t: "pointer", vertex: vx });
  };
  if (!mine) {
    const who = seat === null ? "カードを選んでいる人" : view.players[seat]!.name;
    return (
      <main className="p">
        <p className="big">{who} が{seat === null ? "選んでいます" : "拠点を置いています"}</p>
        <p>大画面を見てください</p>
        <Phrases />
      </main>
    );
  }
  return (
    <main className="p p-place">
      <p className="big">拠点を置く交点を選んでください（{view.phase.k === "setupPlace" && view.phase.step < view.n ? 1 : 2}個目）</p>
      <BoardMap {...mp} candidates={cands} selected={sel} onSelect={select} />
      {sel !== null && (
        <div className="sheet">
          <p>{vertexInfo(view, sel)}</p>
          {!confirm ? (
            <button className="primary" onClick={() => setConfirm(true)}>
              ここに置く
            </button>
          ) : (
            <>
              <p>この交点に置きます。大画面で光った位置を確かめてください</p>
              <button
                className="primary"
                onClick={() => {
                  net.conn.command({ t: "placeHouse", vertex: sel });
                  setSel(null);
                  setConfirm(false);
                }}
              >
                置く
              </button>
              <button onClick={() => setConfirm(false)}>やめる</button>
            </>
          )}
        </div>
      )}
      <Notice net={net} />
    </main>
  );
}

/** 拒否の文言を短く出す */
export function Notice({ net }: { net: Net }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const m = net.last;
    if (m?.t === "reject") setText(rejectText(m.code));
  }, [net.last]);
  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(() => setText(null), 4000);
    return () => window.clearTimeout(id);
  }, [text]);
  return text ? <div className="toast err">{text}</div> : null;
}

const HEAD: Record<PromptSource, string> = {
  setupTile: "2個目の拠点のタイルからカードをもらえます",
  threePlayer: "好きなカードを1枚もらえます（3人戦）",
  income: "seed か animal のタイルからカードをもらえます",
  marketDay: "Market day：好きなカードを1枚もらえます",
  relief: "何ももらえなかったので、好きなカードを1枚もらえます",
};

/** P06 問い（BD04 3.6） */
function Ask({ net, view, prompt }: { net: Net; view: PlayerView; prompt: Prompt }) {
  const [picked, setPicked] = useState<WordCard[]>(prompt.k === "chooseKind" && prompt.preset ? Array(prompt.count).fill(prompt.preset) : []);
  const [disc, setDisc] = useState<Partial<Record<WordCard, number>>>({});
  const [confirm, setConfirm] = useState(false);
  if (prompt.k === "chooseKind") {
    const left = prompt.count - picked.length;
    return (
      <Cover>
        {prompt.reissued && <p className="err">選んだカードがなくなりました。選び直してください</p>}
        <p className="big">{HEAD[prompt.source]}</p>
        {prompt.count > 1 && <p>あと{left}枚選んでください</p>}
        <div className="choices">
          {prompt.options.map((k) => (
            <button key={k} disabled={left <= 0} onClick={() => setPicked([...picked, k])} data-kind={k}>
              {k}（残り {view.piles[k]}）
            </button>
          ))}
        </div>
        <p>選んだもの：{picked.join("、") || "なし"}</p>
        <button onClick={() => setPicked([])}>選び直す</button>
        <button className="primary" disabled={left !== 0} onClick={() => net.conn.command({ t: "answerPrompt", promptId: prompt.id, answer: { k: "chooseKind", kinds: picked } })}>
          決める
        </button>
      </Cover>
    );
  }
  const total = Object.values(disc).reduce((a, b) => a + (b ?? 0), 0);
  const left = prompt.count - total;
  const text = Object.entries(disc)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`)
    .join("、");
  return (
    <Cover>
      <p className="big">Market day：単語カードを{prompt.count}枚捨ててください</p>
      <ul className="discard">
        {Object.entries(view.me.hand).map(([k, have]) => {
          const n = disc[k as WordCard] ?? 0;
          return (
            <li key={k}>
              {k} {have}枚　捨てる {n}
              <button disabled={n <= 0} onClick={() => setDisc({ ...disc, [k]: n - 1 })}>
                −
              </button>
              <button disabled={n >= (have ?? 0) || left <= 0} onClick={() => setDisc({ ...disc, [k]: n + 1 })}>
                ＋
              </button>
            </li>
          );
        })}
      </ul>
      <p>あと{left}枚</p>
      {!confirm ? (
        <button className="primary" disabled={left !== 0} onClick={() => setConfirm(true)}>
          捨てる
        </button>
      ) : (
        <>
          <p>次のカードを捨てます：{text}</p>
          <button className="primary" onClick={() => net.conn.command({ t: "answerPrompt", promptId: prompt.id, answer: { k: "discard", cards: disc } })}>
            捨てる
          </button>
          <button onClick={() => setConfirm(false)}>やめる</button>
        </>
      )}
    </Cover>
  );
}

/** 答えたあと、ほかの人を待つ間（BD04 3.6.1）。全員がそろうまで選び直せる */
function Waiting({ net, view, prompt }: { net: Net; view: PlayerView; prompt: Prompt }) {
  const [again, setAgain] = useState(false);
  if (again) return <Ask net={net} view={view} prompt={prompt} />;
  const a = view.me.answers[prompt.id]!;
  return (
    <Cover>
      <p>ほかの人の選択を待っています</p>
      <p>あなたの答え：{a.k === "chooseKind" ? a.kinds.join("、") : Object.entries(a.cards).map(([k, n]) => `${k} ${n}`).join("、")}</p>
      <button onClick={() => setAgain(true)}>選び直す</button>
    </Cover>
  );
}

/** P07 結果（BD04 3.7） */
function Result({ view }: { view: PlayerView }) {
  const r = view.result!;
  const mine = r.ranking.find((x) => x.seat === view.me.seat)!;
  return (
    <main className="p">
      <p className="big">
        {mine.rank}位　{mine.halfPoints / 2}点
      </p>
      <table>
        <tbody>
          {r.ranking.map((x) => (
            <tr key={x.seat} className={x.seat === view.me.seat ? "me" : ""}>
              <td>{x.rank}</td>
              <td>{view.players[x.seat]!.name}</td>
              <td>{x.halfPoints / 2}点</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        {view.players[view.me.seat]!.ledger.map((e, i) => (
          <li key={i}>
            {e.src} {e.hp / 2}点
          </li>
        ))}
      </ul>
    </main>
  );
}
