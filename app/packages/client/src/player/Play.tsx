// スマホの P04 対戦、P05 行動の確認、交換の窓（BD04 3.4、3.5、4章）。
// 操作の可否は legalActions（view.legal）に従い、最終の判定はサーバーが行う。押せないボタンには理由を添える。
import { useEffect, useState, type ReactNode } from "react";
import type { PlayerView } from "@word-farm/protocol";
import {
  sentenceAnimals,
  sentenceBonus,
  sentenceBuildHouse,
  sentenceBuyAnimal,
  sentenceDeliver,
  sentenceFeed,
  sentenceJoint,
  sentencePlant,
  sentenceSellAnimal,
  sentenceSellProducts,
  type Bag,
  type Command,
  type Goods,
  type Product,
  type WordCard,
} from "@word-farm/engine";
import { BoardMap } from "../BoardMap.tsx";
import type { Net } from "../net/useNet.ts";
import { Cover, Icon, Mark } from "../ui/common.tsx";
import { rejectText } from "../ui/messages.ts";
import { Notice, Phrases, useMapProps, vertexInfo } from "./App.tsx";

const PRODUCTS: Product[] = ["carrot", "potato", "wheat", "egg", "milk"];
const CARDS: WordCard[][] = [
  ["grow", "buy", "feed", "sell"],
  ["carrot", "potato", "wheat"],
  ["cow", "chicken"],
];
const ALL_CARDS = CARDS.flat();

/** P05 で確かめる行動 */
interface Pending {
  title: string;
  target?: string;
  uses: string;
  sentence: string;
  cmd: Command;
}

type Tab = "hand" | "farm" | "orders" | "trade";

// 「自分の手番ではありません」は各ボタンに繰り返さず、タブの上に1回だけ出す
const why = (reason?: string) => (reason && reason !== "NOT_YOUR_TURN" ? rejectText(reason) : "");
const bagText = (b: Bag<string>) =>
  Object.entries(b)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`)
    .join("、");

export function Play({ net, view }: { net: Net; view: PlayerView }) {
  const [tab, setTab] = useState<Tab>("hand");
  const [pending, setPending] = useState<Pending | null>(null);
  const [build, setBuild] = useState(false);
  const [japanese, setJapanese] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const me = view.me.seat;
  const L = view.legal;
  const myTurn = view.turn?.seat === me;
  const busy = net.state.pending.length > 0 || view.paused;
  const self = view.players[me]!;
  const cfg = view.config;

  // 宣言の結果を短く出す（BD04 3.5）
  useEffect(() => {
    const m = net.last;
    if (m?.t !== "view") return;
    for (const e of m.events) {
      if (e.k === "orderSucceeded" && e.seat === me) setResult(`成立しました（${e.hp / 2}点）`);
      if (e.k === "orderFailed" && e.seat === me) setResult("不成立でした");
      if (e.k === "undone") setResult(`ホストが取り消しました：${e.summary}`);
      // 自分の手番になったら振動で知らせる（補助。BD04 3.4）。振動できない端末では何もしない
      if (e.k === "turnStarted" && e.seat === me) navigator.vibrate?.(200);
    }
  }, [net.last, me]);
  useEffect(() => {
    if (!result) return;
    const id = window.setTimeout(() => setResult(null), 4000);
    return () => window.clearTimeout(id);
  }, [result]);

  const send = (cmd: Command) => {
    net.conn.command(cmd);
    setPending(null);
  };

  if (build) {
    return (
      <BuildHouse
        view={view}
        onCancel={() => setBuild(false)}
        onPick={(vx) => {
          setBuild(false);
          setPending({ title: "拠点を足す", uses: `${cfg.houseCost}コイン`, sentence: sentenceBuildHouse(), cmd: { t: "buildHouse", vertex: vx }, target: vertexInfo(view, vx) });
        }}
      />
    );
  }

  const offerToMe = view.trades.find((t) => t.to === me);

  return (
    <main className={`p p-play${myTurn ? " my-turn" : ""}`}>
      <header className="p-top">
        <span>{myTurn ? "あなたの番です" : `${view.players[view.turn?.seat ?? 0]!.name} の番`}</span>
        <span>
          {self.halfPoints / 2}点　コイン {self.coins}
        </span>
        <button onClick={() => setJapanese(true)} disabled={busy}>
          日本語
        </button>
      </header>

      <section className="p-body">
        {!myTurn && (tab === "hand" || tab === "farm" || tab === "orders") && <p className="not-turn">自分の手番ではありません。行動は自分の手番にできます</p>}
        {tab === "hand" && <HandTab view={view} busy={busy} setPending={setPending} onBuild={() => setBuild(true)} />}
        {tab === "farm" && <FarmTab view={view} busy={busy} setPending={setPending} />}
        {tab === "orders" && <OrdersTab view={view} busy={busy} setPending={setPending} />}
        {tab === "trade" && <TradeTab net={net} view={view} busy={busy} />}
      </section>

      {myTurn && (
        <div className="p-actions">
          {view.phase.k === "roll" && L.rollDice && (
            <button className="primary" disabled={busy || !L.rollDice.enabled} onClick={() => net.conn.command({ t: "rollDice" })}>
              サイコロを振る
            </button>
          )}
          {view.phase.k === "roll" && L.inputDice && <DiceInput disabled={busy} onSend={(a, b) => net.conn.command({ t: "inputDice", a, b })} />}
          {view.phase.k === "main" && (
            <button className="primary" disabled={busy || !L.endTurn?.enabled} onClick={() => setEndConfirm(true)}>
              手番終了
            </button>
          )}
        </div>
      )}

      <nav className="p-tabs">
        {(["hand", "farm", "orders", "trade"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {{ hand: "手札", farm: "農場", orders: "注文", trade: "交換" }[t]}
            {t === "trade" && view.trades.length > 0 && <span className="badge">{view.trades.length}</span>}
          </button>
        ))}
      </nav>

      {pending && <Confirm net={net} pending={pending} busy={busy} onCancel={() => setPending(null)} onSend={(cmd, shown) => (net.conn.commandWithMeta(cmd, { sentenceShown: shown }), setPending(null))} />}
      {endConfirm && (
        <Cover>
          <p>手番を終えますか？ 交換の申し出はすべて消えます</p>
          <button onClick={() => setEndConfirm(false)}>やめる</button>
          <button className="primary" onClick={() => (send({ t: "endTurn" }), setEndConfirm(false))}>
            終える
          </button>
        </Cover>
      )}
      {japanese && <Japanese view={view} onClose={() => setJapanese(false)} onPay={(kind, method) => (send({ t: "payJapanese", kind, method }), setJapanese(false))} />}
      {offerToMe && <OfferWindow net={net} view={view} offer={offerToMe} />}
      {view.paused && <div className="paused-badge">一時停止中です</div>}
      {result && <div className="toast">{result}</div>}
      <Notice net={net} />
    </main>
  );
}

function DiceInput({ disabled, onSend }: { disabled: boolean; onSend: (a: number, b: number) => void }) {
  const [a, setA] = useState(1);
  const [b, setB] = useState(1);
  const sel = (v: number, set: (n: number) => void) => (
    <select value={v} onChange={(e) => set(Number(e.target.value))}>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <option key={n}>{n}</option>
      ))}
    </select>
  );
  return (
    <span className="dice-input">
      出目 {sel(a, setA)} ＋ {sel(b, setB)}
      <button className="primary" disabled={disabled} onClick={() => onSend(a, b)}>
        入れる
      </button>
    </span>
  );
}

/** 3.4.1 手札のタブ */
function HandTab({ view, busy, setPending, onBuild }: { view: PlayerView; busy: boolean; setPending: (p: Pending) => void; onBuild: () => void }) {
  const L = view.legal;
  const me = view.players[view.me.seat]!;
  const cfg = view.config;
  const [mode, setMode] = useState<null | "plant" | "animal" | "sell">(null);
  const [sellP, setSellP] = useState<Product | null>(null);
  const [sellN, setSellN] = useState(1);
  const anyPlant = L.plant.find((h) => h.enabled);
  const anyAnimal = L.buyAnimal.find((h) => h.enabled);
  return (
    <div>
      <h4 className="group">単語カード</h4>
      {CARDS.map((row, i) => (
        <div key={i} className={`cards ${["action", "crop", "animal"][i]}`}>
          {row.map((k) => {
            const n = view.me.hand[k] ?? 0;
            return (
              <span key={k} className={`card${n ? "" : " zero"}`} data-card={k}>
                <Icon name={`card-${k}`} size={28} /> {k} <b>{n}</b>
              </span>
            );
          })}
        </div>
      ))}
      <h4 className="group">産物</h4>
      <div className="cards products">
        {PRODUCTS.map((p) => (
          <span key={p} className={`card${me.products[p] ? "" : " zero"}`} data-product={p}>
            <Icon name={`product-${p}`} size={26} /> {p} <b>{me.products[p] ?? 0}</b>
          </span>
        ))}
      </div>
      <p className="money">
        <Icon name="ui-coin" size={22} title="コイン" /> コイン <b>{me.coins}</b>　無料券 <b>{me.freeTickets}</b>　<b>{me.halfPoints / 2}</b>点
      </p>
      <div className="acts">
        <Act label="植える" ok={!!anyPlant && !busy} reason={anyPlant ? "" : why(L.plant[0]?.reason)} onClick={() => setMode("plant")} />
        <Act label="動物を買う" ok={!!anyAnimal && !busy} reason={anyAnimal ? "" : why(L.buyAnimal[0]?.reason)} onClick={() => setMode("animal")} />
        <Act label="市場で売る" ok={L.sellProducts.length > 0 && !busy} reason={L.sellProducts.length ? "" : "売れる産物がありません"} onClick={() => setMode("sell")} />
        <Act label="拠点を足す" ok={L.buildHouse.enabled && !busy} reason={why(L.buildHouse.reason)} onClick={onBuild} />
      </div>
      {mode === "plant" && (
        <Pick title="作物を選んでください" onClose={() => setMode(null)}>
          {L.plant.map((h) => (
            <Act
              key={h.value}
              label={h.value}
              ok={h.enabled}
              reason={why(h.reason)}
              onClick={() => {
                setMode(null);
                const extra = h.value === "carrot" ? `、${cfg.carrotExtraCard} 1` : "";
                setPending({ title: "植える", uses: `grow 1、${h.value} 1${extra}`, sentence: sentencePlant(h.value), cmd: { t: "plant", crop: h.value } });
              }}
            />
          ))}
        </Pick>
      )}
      {mode === "animal" && (
        <Pick title="動物を選んでください" onClose={() => setMode(null)}>
          {L.buyAnimal.map((h) => {
            const extra = cfg.animalExtraCard[h.value];
            const uses = `buy 1、${h.value} 1${extra ? `、${extra} 1` : ""}、${cfg.animalCost[h.value]}コイン`;
            return (
              <Act
                key={h.value}
                label={`${h.value}（${uses}）`}
                ok={h.enabled}
                reason={why(h.reason)}
                onClick={() => {
                  setMode(null);
                  setPending({ title: "動物を買う", uses, sentence: sentenceBuyAnimal(h.value), cmd: { t: "buyAnimal", animal: h.value } });
                }}
              />
            );
          })}
        </Pick>
      )}
      {mode === "sell" && (
        <Pick title="売る産物と数を選んでください" onClose={() => setMode(null)}>
          {L.sellProducts.map((s) => (
            <button key={s.product} className={sellP === s.product ? "on" : ""} onClick={() => (setSellP(s.product), setSellN(1))}>
              {s.product}（{s.max}）
            </button>
          ))}
          {sellP && (
            <>
              <Counter n={sellN} min={1} max={L.sellProducts.find((s) => s.product === sellP)!.max} set={setSellN} />
              <span>{sellN * cfg.marketPrice[sellP]}コイン</span>
              <button
                className="primary"
                onClick={() => {
                  setMode(null);
                  setPending({ title: "市場で売る", uses: `sell 1、${sellP} ${sellN}`, sentence: sentenceSellProducts(sellP, sellN), cmd: { t: "sellProducts", product: sellP, n: sellN } });
                }}
              >
                次へ
              </button>
            </>
          )}
        </Pick>
      )}
      <Phrases />
    </div>
  );
}

/** 3.4.2 農場のタブ */
function FarmTab({ view, busy, setPending }: { view: PlayerView; busy: boolean; setPending: (p: Pending) => void }) {
  const me = view.players[view.me.seat]!;
  const cfg = view.config;
  return (
    <div className="farm">
      {me.plots.map((p, i) => {
        const feed = view.legal.feed.find((h) => h.value === i);
        const sell = view.legal.sellAnimal.find((h) => h.value === i);
        return (
          <div key={i} className={`plot ${p.t}`} data-plot={i}>
            {p.t === "empty" && <span className="plot-label">空き</span>}
            {p.t === "crop" && (
              <>
                <Icon name={`farm-${p.crop}`} size={84} title={p.crop} />
                <span className="plot-label">
                  {p.crop}
                  <br />
                  次の自分の番に収穫
                </span>
              </>
            )}
            {p.t === "animal" && (
              <>
                <Icon name={`farm-${p.animal}`} size={84} title={p.animal} />
                <span className="plot-label">{p.animal === "cow" ? "牛" : "ニワトリ"}</span>
                <Act
                  label={`餌をやる（${cfg.feedYield[p.animal].product} ${cfg.feedYield[p.animal].n}）`}
                  ok={!!feed?.enabled && !busy}
                  reason={view.turn?.fedPlots.includes(i) ? "この手番は餌をやりました" : why(feed?.reason)}
                  onClick={() => setPending({ title: "餌をやる", uses: "feed 1", sentence: sentenceFeed(p.animal), cmd: { t: "feed", plot: i } })}
                />
                <Act
                  label={`手放す（${cfg.animalSellPrice[p.animal]}コイン）`}
                  ok={!!sell?.enabled && !busy}
                  reason={why(sell?.reason)}
                  onClick={() => setPending({ title: "動物を手放す", uses: "sell 1", sentence: sentenceSellAnimal(p.animal), cmd: { t: "sellAnimal", plot: i } })}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 3.4.3 注文のタブ */
function OrdersTab({ view, busy, setPending }: { view: PlayerView; busy: boolean; setPending: (p: Pending) => void }) {
  const me = view.players[view.me.seat]!;
  const [deliver, setDeliver] = useState<null | { id: string; kind: "normal" | "bonus" | "joint" }>(null);
  if (!view.orders.revealed && view.joint.faceUp.length === 0) return <p>ラウンド3の初めに3枚を表にします</p>;
  const animals = me.plots.filter((p) => p.t === "animal").length;
  return (
    <div>
      {!view.orders.revealed && <p>ラウンド3の初めに3枚を表にします</p>}
      {view.orders.faceUp.map((o) => {
        const h = view.legal.deliver.find((d) => d.value.orderId === o.id);
        return (
          <div key={o.id} className={`order${o.isBonus ? " bonus" : ""}`} data-order={o.id}>
            <p className="text">{o.text}</p>
            <Act
              label="届ける"
              ok={!!h?.enabled && !busy}
              reason={why(h?.reason)}
              onClick={() => {
                if (h!.value.kind === "animals") {
                  setPending({ title: "動物の頭数の注文", target: o.text, uses: "なし", sentence: sentenceAnimals(animals), cmd: { t: "claimAnimalOrder", orderId: o.id } });
                } else setDeliver({ id: o.id, kind: h!.value.kind === "bonus" ? "bonus" : "normal" });
              }}
            />
          </div>
        );
      })}
      {view.joint.faceUp.map((j) => {
        const h = view.legal.contributeJoint.find((d) => d.value.jointId === j.id);
        return (
          <div key={j.id} className="order joint" data-joint={j.id}>
            <p className="text">{j.text}</p>
            <ol className="rows">
              {j.rows.map((r, i) => (
                <li key={i}>
                  {j.rowPoints[i]! / 2}点　{r ? <><Mark color={view.players[r.seat]!.color} /> {view.players[r.seat]!.name}</> : "空き"}
                </li>
              ))}
            </ol>
            <Act label="出す" ok={!!h?.enabled && !busy} reason={why(h?.reason)} onClick={() => setDeliver({ id: j.id, kind: "joint" })} />
          </div>
        );
      })}
      {deliver && <DeliverPick view={view} target={deliver} onClose={() => setDeliver(null)} setPending={setPending} />}
    </div>
  );
}

/** 4.6、4.7、4.9 の産物と数の選択。条件に合うかどうかは示さない（方式設計9.3） */
function DeliverPick({ view, target, onClose, setPending }: { view: PlayerView; target: { id: string; kind: "normal" | "bonus" | "joint" }; onClose: () => void; setPending: (p: Pending) => void }) {
  const me = view.players[view.me.seat]!;
  const have = PRODUCTS.filter((p) => (me.products[p] ?? 0) > 0);
  const [items, setItems] = useState<Bag<Product>>({});
  const [one, setOne] = useState<Product | null>(null);
  const [n, setN] = useState(1);
  if (target.kind === "normal") {
    const o = view.orders.faceUp.find((x) => x.id === target.id)!;
    const total = Object.values(items).reduce((a, b) => a + (b ?? 0), 0);
    return (
      <Pick title="出す産物と数を選んでください" onClose={onClose}>
        {have.map((p) => (
          <span key={p} className="row">
            {p}（{me.products[p]}）
            <Counter n={items[p] ?? 0} min={0} max={me.products[p] ?? 0} set={(v) => setItems({ ...items, [p]: v })} />
          </span>
        ))}
        <button
          className="primary"
          disabled={total === 0}
          onClick={() => {
            const clean = Object.fromEntries(Object.entries(items).filter(([, v]) => v)) as Bag<Product>;
            onClose();
            setPending({ title: "注文を届ける", target: o.to ? `${o.to} の注文` : o.text, uses: `sell 1、${bagText(clean)}`, sentence: sentenceDeliver(clean, o.text, o.to), cmd: { t: "deliverOrder", orderId: o.id, items: clean } });
          }}
        >
          次へ
        </button>
      </Pick>
    );
  }
  const joint = target.kind === "joint" ? view.joint.faceUp.find((x) => x.id === target.id)! : null;
  return (
    <Pick title={target.kind === "bonus" ? "産物を1種類選び、数を選んでください" : "出す産物を1種類選び、数を選んでください"} onClose={onClose}>
      {have.map((p) => (
        <button key={p} className={one === p ? "on" : ""} onClick={() => (setOne(p), setN(1))}>
          {p}（{me.products[p]}）
        </button>
      ))}
      {one && (
        <>
          <Counter n={n} min={1} max={me.products[one] ?? 1} set={setN} />
          <button
            className="primary"
            onClick={() => {
              onClose();
              if (joint) setPending({ title: "共同注文に出す", target: joint.text, uses: `sell 1、${one} ${n}`, sentence: sentenceJoint(one, n, joint.to), cmd: { t: "contributeJoint", jointId: joint.id, product: one, n } });
              else setPending({ title: "ボーナス注文", target: "the farmers' market", uses: `sell 1、${one} ${n}`, sentence: sentenceBonus(one, n), cmd: { t: "deliverBonus", orderId: target.id, product: one, n } });
            }}
          >
            次へ
          </button>
        </>
      )}
    </Pick>
  );
}

/** 3.4.4 交換のタブ、4.11 銀行、4.12 交換の申し出 */
function TradeTab({ net, view, busy }: { net: Net; view: PlayerView; busy: boolean }) {
  const me = view.me.seat;
  const L = view.legal;
  const [making, setMaking] = useState(false);
  const mine = view.trades.filter((t) => t.from === me);
  const [give, setGive] = useState<WordCard | null>(null);
  const [harbor, setHarbor] = useState<number | null>(null);
  if (making) return <OfferForm net={net} view={view} onClose={() => setMaking(false)} />;
  const h = harbor === null ? null : L.harborTrade.find((x) => x.vertex === harbor) ?? null;
  return (
    <div>
      <h3>出した申し出</h3>
      {mine.length === 0 && <p>なし</p>}
      {mine.map((t) => (
        <p key={t.id}>
          {view.players[t.to]!.name} へ：渡す {goodsText(t.give)} ／ 欲しい {goodsText(t.get)}
          <button disabled={busy} onClick={() => net.conn.command({ t: "withdrawTrade", id: t.id })}>
            取り下げ
          </button>
        </p>
      ))}
      <button disabled={busy || L.tradePartners.length === 0} onClick={() => setMaking(true)}>
        新しい申し出
      </button>
      <h3>銀行（自分の手番だけ）</h3>
      <p>4枚で1枚：</p>
      <div className="row">
        {L.bankTrade.give.map((k) => (
          <button key={k} className={give === k && harbor === null ? "on" : ""} disabled={busy} onClick={() => (setGive(k), setHarbor(null))}>
            {k} {view.config.bankRatio}
          </button>
        ))}
      </div>
      {give && harbor === null && (
        <div className="row">
          {L.bankTrade.get
            .filter((k) => k !== give)
            .map((k) => (
              <button key={k} disabled={busy} onClick={() => (net.conn.command({ t: "bankTrade", give, get: k }), setGive(null))}>
                {give} {view.config.bankRatio} → {k} 1
              </button>
            ))}
        </div>
      )}
      {L.harborTrade.map((x) => (
        <button key={x.vertex} className={harbor === x.vertex ? "on" : ""} disabled={busy || x.give.length === 0} onClick={() => (setHarbor(x.vertex), setGive(null))}>
          港（{x.kind === "any" ? "3:1" : `${x.kind} 2:1`}）
        </button>
      ))}
      {h && (
        <div className="row">
          {h.give.map((g) => (
            <button key={g} className={give === g ? "on" : ""} onClick={() => setGive(g)}>
              {g}
            </button>
          ))}
          {give &&
            h.get
              .filter((k) => k !== give)
              .map((k) => (
                <button key={k} disabled={busy} onClick={() => (net.conn.command({ t: "harborTrade", vertex: h.vertex, give, get: k }), setGive(null), setHarbor(null))}>
                  {give} {h.kind === "any" ? view.config.genericHarborRatio : view.config.specialHarborRatio} → {k} 1
                </button>
              ))}
        </div>
      )}
      <p>カードを買う（{view.config.cardBuyPrice}コイン）：</p>
      <div className="row">
        {(L.buyCard.enabled ? L.buyCard.value.kinds : []).map((k) => (
          <button key={k} disabled={busy} onClick={() => net.conn.command({ t: "buyCard", kind: k })}>
            {k}
          </button>
        ))}
        {!L.buyCard.enabled && <span className="why">{why(L.buyCard.reason)}</span>}
      </div>
      <p>産物を買う：</p>
      <div className="row">
        {(L.buyProduct.enabled ? L.buyProduct.value.products : []).map((p) => (
          <button key={p} disabled={busy} onClick={() => net.conn.command({ t: "buyProduct", product: p })}>
            {p}（{view.config.productBuyPrice[p]}コイン）
          </button>
        ))}
        {!L.buyProduct.enabled && <span className="why">{why(L.buyProduct.reason)}</span>}
      </div>
    </div>
  );
}

function goodsText(g: Goods): string {
  return [bagText(g.cards), bagText(g.products), g.coins ? `コイン ${g.coins}` : ""].filter(Boolean).join("、") || "なし";
}

/** 4.12 交換の申し出。手番でない人は相手を選ぶ手順を省く */
function OfferForm({ net, view, onClose }: { net: Net; view: PlayerView; onClose: () => void }) {
  const partners = view.legal.tradePartners;
  const [to, setTo] = useState<number | null>(partners.length === 1 ? partners[0]! : null);
  const empty = (): Goods => ({ cards: {}, products: {}, coins: 0 });
  const [give, setGive] = useState<Goods>(empty());
  const [get, setGet] = useState<Goods>(empty());
  const me = view.players[view.me.seat]!;
  const count = (g: Goods) => Object.values(g.cards).reduce((a, b) => a + (b ?? 0), 0) + Object.values(g.products).reduce((a, b) => a + (b ?? 0), 0) + g.coins;
  const side = (g: Goods, set: (g: Goods) => void, mine: boolean) => (
    <div className="offer-side">
      <span className="sub">カード</span>
      {ALL_CARDS.filter((k) => !mine || (view.me.hand[k] ?? 0) > 0).map((k) => (
        <span key={k} className="row">
          <span>
            <Icon name={`card-${k}`} size={22} /> {k}
          </span>
          <Counter n={g.cards[k] ?? 0} min={0} max={mine ? (view.me.hand[k] ?? 0) : 9} set={(v) => set({ ...g, cards: { ...g.cards, [k]: v } })} />
        </span>
      ))}
      <span className="sub">産物とコイン</span>
      {PRODUCTS.filter((p) => !mine || (me.products[p] ?? 0) > 0).map((p) => (
        <span key={p} className="row">
          <span>
            <Icon name={`product-${p}`} size={22} /> {p}
          </span>
          <Counter n={g.products[p] ?? 0} min={0} max={mine ? (me.products[p] ?? 0) : 20} set={(v) => set({ ...g, products: { ...g.products, [p]: v } })} />
        </span>
      ))}
      {(!mine || me.coins > 0) && (
        <span className="row">
          コイン
          <Counter n={g.coins} min={0} max={mine ? me.coins : 30} set={(v) => set({ ...g, coins: v })} />
        </span>
      )}
    </div>
  );
  const clean = (g: Goods): Goods => ({
    cards: Object.fromEntries(Object.entries(g.cards).filter(([, v]) => v)) as Bag<WordCard>,
    products: Object.fromEntries(Object.entries(g.products).filter(([, v]) => v)) as Bag<Product>,
    coins: g.coins,
  });
  return (
    <div className="offer-form">
      <h3>新しい申し出</h3>
      {partners.length > 1 && (
        <div className="row">
          {partners.map((s) => (
            <button key={s} className={to === s ? "on" : ""} onClick={() => setTo(s)}>
              {view.players[s]!.name}
            </button>
          ))}
        </div>
      )}
      {to !== null && <p>相手：{view.players[to]!.name}</p>}
      <h4>渡す（持っている物だけ）</h4>
      {side(give, setGive, true)}
      <h4>欲しい</h4>
      {side(get, setGet, false)}
      <div className="offer-bar">
      <button onClick={onClose}>やめる</button>
      <button
        className="primary"
        disabled={to === null || count(give) === 0 || count(get) === 0}
        onClick={() => {
          net.conn.command({ t: "proposeTrade", to: to!, give: clean(give), get: clean(get) });
          onClose();
        }}
      >
        送る
      </button>
      </div>
    </div>
  );
}

/** 4.13 交換への応答。どのタブを開いていても前面に出す。中身を写して返すボタンは作らない */
function OfferWindow({ net, view, offer }: { net: Net; view: PlayerView; offer: PlayerView["trades"][number] }) {
  return (
    <Cover>
      <p className="big">{view.players[offer.from]!.name} からの申し出</p>
      <p>あなたがもらう：{goodsText(offer.give)}</p>
      <p>あなたが渡す：{goodsText(offer.get)}</p>
      <button onClick={() => net.conn.command({ t: "respondTrade", id: offer.id, accept: false })}>断る</button>
      <button className="primary" onClick={() => net.conn.command({ t: "respondTrade", id: offer.id, accept: true })}>
        承諾
      </button>
    </Cover>
  );
}

/** 4.14 日本語の支払い */
function Japanese({ view, onClose, onPay }: { view: PlayerView; onClose: () => void; onPay: (kind: "word" | "talk" | "undeclared", method: "coin" | "ticket") => void }) {
  const j = view.legal.japanese;
  const rate = view.players[view.me.seat]!.japaneseRate;
  const cost = view.config.japaneseCost;
  const row = (label: string, kind: "word" | "talk", hints: { value: "coin" | "ticket"; enabled: boolean; reason?: string }[]) => (
    <div className="row">
      {label}
      {hints.map((h) => (
        <button key={h.value} disabled={!h.enabled} onClick={() => onPay(kind, h.value)}>
          {h.value === "coin" ? `${cost[kind] * rate}コイン` : "無料券"}
        </button>
      ))}
    </div>
  );
  return (
    <Cover>
      <p className="big">日本語の支払い</p>
      {row("単語を1つ", "word", j.word)}
      {row("交渉1件", "talk", j.talk)}
      <div className="row">
        言ってしまった
        <button disabled={!j.undeclared.enabled} onClick={() => onPay("undeclared", "coin")}>
          {cost.undeclared * rate}コイン
        </button>
      </div>
      {!j.undeclared.enabled && <p className="why">{why(j.undeclared.reason)}</p>}
      <button onClick={onClose}>やめる</button>
    </Cover>
  );
}

/** P05 行動の確認（BD04 3.5）。既定では英文を伏せる */
function Confirm({ pending, busy, onCancel, onSend }: { net: Net; pending: Pending; busy: boolean; onCancel: () => void; onSend: (cmd: Command, shown: boolean) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <Cover>
      <p className="big">{pending.title}</p>
      {pending.target && <p>届け先：{pending.target}</p>}
      <p>使う物：{pending.uses}</p>
      <div className="sentence-box">
        {shown ? <p className="sentence">{pending.sentence}</p> : <p>英文を自分で作って、声に出して言ってください</p>}
        {!shown && <button onClick={() => setShown(true)}>英文を見る</button>}
      </div>
      <div className="row split">
        <button onClick={onCancel}>やめる</button>
        <button className="primary" disabled={busy} onClick={() => onSend(pending.cmd, shown)}>
          宣言
        </button>
      </div>
    </Cover>
  );
}

/** 4.10 拠点を足す（P03 を対戦中に使う） */
function BuildHouse({ view, onCancel, onPick }: { view: PlayerView; onCancel: () => void; onPick: (v: number) => void }) {
  const mp = useMapProps(view);
  const cands = view.legal.buildHouse.enabled ? view.legal.buildHouse.value.vertices : [];
  const [sel, setSel] = useState<number | null>(null);
  return (
    <main className="p p-place">
      <p className="big">拠点を置く交点を選んでください</p>
      <BoardMap {...mp} candidates={cands} selected={sel} onSelect={setSel} />
      {sel !== null && <p>{vertexInfo(view, sel)}</p>}
      <button onClick={onCancel}>やめる</button>
      <button className="primary" disabled={sel === null} onClick={() => onPick(sel!)}>
        ここに置く
      </button>
    </main>
  );
}

function Act({ label, ok, reason, onClick }: { label: string; ok: boolean; reason?: string; onClick: () => void }) {
  return (
    <span className="act">
      <button disabled={!ok} onClick={onClick}>
        {label}
      </button>
      {!ok && reason && <small className="why">{reason}</small>}
    </span>
  );
}

function Pick({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Cover>
      <p className="big">{title}</p>
      <div className="pick">{children}</div>
      <button onClick={onClose}>やめる</button>
    </Cover>
  );
}

function Counter({ n, min, max, set }: { n: number; min: number; max: number; set: (n: number) => void }) {
  return (
    <span className="counter">
      <button disabled={n <= min} onClick={() => set(n - 1)} aria-label="減らす">
        −
      </button>
      <b>{n}</b>
      <button disabled={n >= max} onClick={() => set(n + 1)} aria-label="増やす">
        ＋
      </button>
    </span>
  );
}
