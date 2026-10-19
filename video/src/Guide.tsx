// ルール説明動画（Aki が Chika に説明する）
import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, Img, staticFile } from 'remotion';
import { G, FPS } from './timeline';
import { DEFS } from './defs';
import { C, PCOL, VARS, JPF, ENF, ICON, PICON, Icon, Board, Die } from './Main';
import { GUIDE, CHAPTERS, GLine } from './guideScript';

// ---------- 時間割り ----------
// 台詞の長さで尺を決める（日本語は1文字0.11秒、英文の例があれば少し足す）
export function buildGuide() {
  let t = 0;
  const beats = GUIDE.map((l, i) => {
    const dur = Math.round(FPS * (1.3 + l.t.length * 0.11 + (l.en ? 0.8 : 0)));
    const b = { ...l, i, start: t, dur };
    t += dur;
    return b;
  });
  return { beats, total: t };
}
type GBeat = GLine & { i: number; start: number; dur: number };

const AKI = PCOL[0], CHIKA = PCOL[2];
const face = (l: GLine, who: 'a' | 'c') => who === l.w ? `faces/${who === 'a' ? 'aki' : 'chika'}_${l.f}.png` : (who === 'a' ? 'faces/aki_normal.png' : 'faces/chika_smile.png');

// ---------- 小さな部品 ----------
const Card: React.FC<{ on?: boolean; title: string; children?: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ on, title, children, color = C.leaf, style }) => (
  <div style={{ background: C.paper, borderRadius: 16, border: `3px solid ${on ? color : C.rule}`, boxShadow: on ? `0 0 0 6px ${color}33` : 'none', padding: '14px 20px', fontFamily: JPF, opacity: on === false ? 0.55 : 1, transition: 'none', ...style }}>
    <div style={{ fontSize: 28, fontWeight: 800, color: on ? color : C.ink }}>{title}</div>
    {children ? <div style={{ fontSize: 22, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{children}</div> : null}
  </div>
);
const Word: React.FC<{ w: string; icon?: string; bg?: string }> = ({ w, icon, bg = '#e9f1e6' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, border: `2px solid ${C.rule}`, borderRadius: 10, padding: '4px 12px', fontFamily: ENF, fontWeight: 700, fontSize: 24, color: C.ink }}>
    {icon ? <Icon id={icon} size={28} /> : null}{w}
  </span>
);
const Coin: React.FC<{ n: number | string }> = ({ n }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.wheat, color: C.wheatInk, borderRadius: 20, padding: '2px 12px', fontFamily: ENF, fontWeight: 800, fontSize: 22 }}>{n}<span style={{ fontFamily: JPF, fontSize: 18 }}>コイン</span></span>
);
const Area: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', left: 30, top: 96, width: 1860, height: 650 }}>{children}</div>
);
const Right: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', left: 1060, top: 96, width: 830, height: 650, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
);

// 盤面に渡すための形（拠点あり／なし、出目の光り）
const boardBeat = (withBases: boolean, roll?: number): any => {
  const st = G.timeline[0].state;
  const state = withBases ? st : { ...st, players: st.players.map((p: any) => ({ ...p, bases: [] })) };
  return { kind: roll ? 'roll' : 'step', state, placed: [], inSetup: false, turn: roll ? { roll, p: 0, round: 1, dice: [3, 5] } : undefined };
};

// ---------- 場面 ----------
const Scene: React.FC<{ b: GBeat; local: number }> = ({ b, local }) => {
  const h = b.h || '';
  switch (b.s) {
    case 'title': return (<Area><div style={{ textAlign: 'center', paddingTop: 120 }}>
      <div style={{ fontFamily: '"Arial Black",Impact,sans-serif', fontSize: 130, color: C.leaf, letterSpacing: 4 }}>WORD FARM</div>
      <div style={{ fontFamily: JPF, fontSize: 44, color: C.ink, marginTop: 10 }}>ルール説明　Aki お姉さん × Chika</div>
      <div style={{ display: 'flex', gap: 26, justifyContent: 'center', marginTop: 40 }}>{['carrot', 'potato', 'wheat', 'egg', 'milk'].map(k => <Icon key={k} id={PICON[k]} size={90} />)}</div>
      <div style={{ fontFamily: JPF, fontSize: 28, color: C.muted, marginTop: 30 }}>英語で交渉し、英文の注文を読んで、農場の産物を届ける　3〜4人・70〜90分</div>
    </div></Area>);
    case 'goal': return (<Area><div style={{ display: 'flex', gap: 40, alignItems: 'center', height: '100%' }}>
      <div style={{ width: 420, height: 420, borderRadius: 210, background: C.wheat, display: 'grid', placeItems: 'center', border: `6px solid ${C.wheatInk}`, flex: 'none' }}>
        <div style={{ textAlign: 'center', fontFamily: ENF, color: C.wheatInk }}><div style={{ fontSize: 170, fontWeight: 900, lineHeight: 1 }}>8</div><div style={{ fontFamily: JPF, fontSize: 40, fontWeight: 800 }}>勝利点</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
        <Card on={h === 'win' || !h} title="自分の手番中に8点 → その場で勝ち">注文を届けると、書かれた点がもらえる</Card>
        <Card on={h === 'offturn'} title="手番以外で8点を超えたら">共同注文の完成や時間切れで起きる。自分の手番が来た時点で8点以上なら勝ち</Card>
        <Card on={h === 'end'} title="注文の山が尽きたら">そのラウンドの最後まで遊んで、点の多い人の勝ち</Card>
      </div></div></Area>);
    case 'setup': {
      const withB = h === 'bases' || h === 'start';
      return (<><Board beat={boardBeat(withB)} local={local} /><Right>
        <Card on={h === 'tiles'} title="六角タイル13枚">まん中はMarket。ほかは6種類×2枚<div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>{Object.keys(ICON).map(k => <Word key={k} w={k} icon={ICON[k]} />)}</div></Card>
        <Card on={h === 'harbors'} title="数字と港の位置は固定">3:1の港が2つ（位置も固定）。2:1の港4つは、種類だけ毎回シャッフル</Card>
        <Card on={h === 'bases'} title="拠点はタイルの角に">隣の角には置けない。道はない。1人2個（順に置いて、逆順にもう1個）</Card>
        <Card on={h === 'start'} title="最初の持ち物"><Coin n={3} />　<Word w="grow" icon="i-grow" /> <Word w="sell" icon="i-sell" />　無料券2枚<br />注文3枚と共同注文2枚を表に</Card>
      </Right></>);
    }
    case 'flow': return (<Area><div style={{ display: 'flex', gap: 30, alignItems: 'center', height: '100%' }}>
      {[['1', '収入', 'サイコロを2個振る。数字のタイルの角に拠点がある人がカードをもらう', 'i-buy'], ['2', '収穫', '前の手番に植えた作物が実る。区画は空く', 'i-grow'], ['3', '交渉と行動', '英語で交換を持ちかけ、英文を宣言して行動する', 'i-sell']].map(([n, t, d, ic], k) => {
        const s = spring({ frame: local - k * 8, fps: FPS, config: { damping: 12 } });
        return (<div key={n} style={{ flex: 1, transform: `translateY(${(1 - s) * 40}px)`, opacity: s }}>
          <div style={{ background: C.paper, borderRadius: 24, border: `4px solid ${C.leaf}`, padding: 30, height: 420, boxSizing: 'border-box', fontFamily: JPF }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><div style={{ width: 70, height: 70, borderRadius: 35, background: C.leaf, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: ENF, fontWeight: 900, fontSize: 40 }}>{n}</div><span style={{ fontSize: 46, fontWeight: 800 }}>{t}</span></div>
            <div style={{ display: 'grid', placeItems: 'center', margin: '24px 0' }}><Icon id={ic} size={120} /></div>
            <div style={{ fontSize: 26, color: C.muted, lineHeight: 1.5 }}>{d}</div>
          </div></div>);
      })}</div></Area>);
    case 'income': return (<><Board beat={boardBeat(true, 8)} local={local} /><Right>
      <div style={{ position: 'relative', height: 150 }}><Die v={3} rot={-8} x={20} /><Die v={5} rot={10} x={110} /><div style={{ position: 'absolute', left: 220, top: 10, fontFamily: ENF, fontSize: 90, fontWeight: 900, color: C.warn }}>= 8</div></div>
      <Card on={h === 'roll' || !h} title="8のタイルの角に拠点 → カード1枚">手番の人だけでなく、全員がもらえる。1枚のタイルに拠点が2個なら2枚</Card>
      <Card title="出やすい数字">6と8がいちばん出やすい（赤い数字）。2と12は出にくい</Card>
      <Card title="救済">手番の人が何ももらえなかったら、好きなカードを1枚</Card>
    </Right></>);
    case 'seven': return (<Area><div style={{ display: 'flex', gap: 40, height: '100%', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 340, height: 200, flex: 'none' }}><Die v={3} rot={-10} x={30} /><Die v={4} rot={12} x={120} /><div style={{ position: 'absolute', left: 30, top: 100, fontFamily: ENF, fontSize: 80, fontWeight: 900, color: C.warn }}>7</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
        <Card on={h === 'discard'} color={C.warn} title="① 手札7枚以上の人は半分を捨てる">端数は切り捨て（7枚なら3枚、9枚なら4枚）。捨てるカードは自分で選ぶ</Card>
        <Card on={h === 'pick'} title="② 全員が好きなカードを1枚（Market day）">手番の人から時計回りに選ぶ</Card>
      </div></div></Area>);
    case 'cards': return (<Area><div style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingTop: 30 }}>
      <Card title="行動のカード"><div style={{ display: 'flex', gap: 12, marginTop: 6 }}>{['grow', 'buy', 'feed', 'sell'].map(k => <Word key={k} w={k} icon={ICON[k]} />)}</div></Card>
      <Card title="作物と動物のカード"><div style={{ display: 'flex', gap: 12, marginTop: 6 }}>{['carrot', 'potato', 'wheat'].map(k => <Word key={k} w={k} icon={PICON[k]} />)}<Word w="cow" icon="i-animal" /><Word w="chicken" icon="i-animal" /></div></Card>
      <div style={{ display: 'flex', gap: 30 }}>
        <Card on title="カード：a carrot card" style={{ flex: 1 }}>手札に持つ単語カード。手札の中身は秘密、枚数は公開</Card>
        <Card on color={C.warn} title="産物：a carrot" style={{ flex: 1 }}><span style={{ display: 'inline-flex', gap: 4 }}><Icon id="p-carrot" size={40} /><Icon id="p-carrot" size={40} /><Icon id="p-carrot" size={40} /></span>　収穫したもの。公開</Card>
      </div></div></Area>);
    case 'actions': {
      const rows: [string, string, string, string][] = [
        ['grow', 'I grow potatoes.', 'grow＋作物カード', '植える。次の自分の手番に3つ収穫'],
        ['carrot', 'I grow carrots and feed the soil.', 'grow＋carrot＋feed', 'ニンジンは肥料も要る'],
        ['buy', 'I buy a chicken.', 'buy＋chicken＋2コイン', 'ニワトリを置く'],
        ['feed', 'I feed the cow.', 'feed', '餌。1頭につき1手番1回'],
        ['sell', 'I sell four eggs.', 'sell', '市場で同じ種類をまとめて売る'],
        ['deliver', 'I sell three carrots to the cafe.', 'sell', '注文を届ける'],
        ['joint', 'I bring three eggs to the festival.', 'sell', '共同注文の1行を出す'],
        ['house', 'I build a farmhouse.', '5コイン', '拠点を足す（3個まで）'],
      ];
      return (<Area><div style={{ background: C.paper, borderRadius: 18, border: `2px solid ${C.rule}`, overflow: 'hidden' }}>
        {rows.map(([k, en, need, eff], j) => {
          const on = h === 'all' || h === k;
          return (<div key={k} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '12px 24px', background: on ? '#fff8e6' : j % 2 ? '#f7f9f5' : '#fff', borderLeft: `8px solid ${on ? C.wheatInk : 'transparent'}` }}>
            <span style={{ fontFamily: ENF, fontWeight: 700, fontSize: 30, width: 640, color: C.ink }}>{en}</span>
            <span style={{ fontFamily: JPF, fontSize: 22, width: 330, color: C.leaf, fontWeight: 700 }}>{need}</span>
            <span style={{ fontFamily: JPF, fontSize: 22, color: C.muted }}>{eff}</span></div>);
        })}
        <div style={{ fontFamily: JPF, fontSize: 22, color: C.muted, padding: '10px 24px' }}>回数の上限なし（例外：餌は1頭1回、共同注文は1行、産物の購入は1つ、注文を流すのは1回まで）</div>
      </div></Area>);
    }
    case 'farm': return (<Area><div style={{ display: 'flex', gap: 24, height: 470 }}>
      {([['carrot', 'ニンジン', ['grow', 'carrot', 'feed'], '', '植える → 次の手番に', 'p-carrot', 3], ['chicken', 'ニワトリ', ['buy', 'chicken'], '2', '餌をやると', 'p-egg', 2], ['cow', '牛', ['buy', 'cow', 'grow'], '4', '餌をやると、すぐに', 'p-milk', 3]] as any[]).map(([k, name, cards, coin, how, icon, n]) => (
        <Card key={k} on={h === k} title={name} style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 12px' }}>{cards.map((c: string) => <Word key={c} w={c} />)}{coin ? <Coin n={coin} /> : null}</div>
          {how}<div style={{ display: 'flex', gap: 6, marginTop: 10 }}>{Array.from({ length: n }).map((_, q) => <Icon key={q} id={icon} size={64} />)}</div>
        </Card>))}
    </div>
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Card on={h === 'fields'} title="農場は1人4区画" style={{ flex: 1 }}>1区画に作物か動物を1つ。収穫した産物は手元に置く</Card>
        <div style={{ display: 'flex', gap: 10 }}>{[0, 1, 2, 3].map(q => <div key={q} style={{ width: 90, height: 90, borderRadius: 12, border: `3px dashed ${C.rule}`, background: q < 2 ? '#e9ddd0' : 'transparent' }} />)}</div>
      </div></Area>);
    case 'market': return (<Area><div style={{ display: 'flex', gap: 40, paddingTop: 20 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card on={h === 'prices'} title="市場の値段（1つあたり）">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}><Icon id="p-carrot" size={50} /><Icon id="p-milk" size={50} /><Coin n={2} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}><Icon id="p-potato" size={50} /><Icon id="p-wheat" size={50} /><Icon id="p-egg" size={50} /><Coin n={1} /></div>
        </Card>
        <Card title="sellカード1枚で、同じ種類をまとめて売れる">例：卵4つ → 4コイン</Card>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="拠点を足す：5コイン">全部で3個まで。距離ルールを守れば、どの角にも置ける（道は要らない）</Card>
      </div></div></Area>);
    case 'orders': {
      const back = ['trap', 'deliver', 'reward', 'miss'].includes(h);
      return (<><div style={{ position: 'absolute', left: 60, top: 110, width: 620, height: 600, background: C.paper, borderRadius: 24, border: `4px solid ${C.ink}`, overflow: 'hidden', fontFamily: ENF }}>
        <div style={{ background: C.leaf, color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 34 }}><span>ORDER</span><span style={{ background: C.wheat, color: C.wheatInk, borderRadius: 18, padding: '0 16px' }}>2.5点</span></div>
        <div style={{ padding: '30px 30px', fontSize: 44, lineHeight: 1.35, color: C.ink }}>Please don’t send milk. We need two eggs and two carrots.</div>
        <div style={{ position: 'absolute', bottom: 20, left: 30, fontFamily: JPF, fontSize: 24, color: C.muted, border: `2px solid ${C.rule}`, borderRadius: 12, padding: '2px 14px' }}>中（英文だけ）</div>
        <div style={{ position: 'absolute', bottom: 20, right: 30, fontSize: 22, color: C.muted }}>+2 coins</div>
      </div>
      <Right>
        <Card on={back} title="裏：条件"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon id="p-egg" size={56} />×2<Icon id="p-carrot" size={56} />×2<span style={{ marginLeft: 12, color: C.warn, fontWeight: 800 }}>ミルクは送らない</span></div></Card>
        <Card on={h === 'deliver'} title="届け方">sellカードを使って宣言。書かれた数ちょうど（at least の注文だけ多くてよい）</Card>
        <Card on={h === 'reward'} title="報酬：書かれた点＋2コイン">点は0.5〜3点。絵が付くのは「易」の注文だけ</Card>
        <Card on={h === 'miss'} color={C.warn} title="読み違えたら不成立">sellカードは捨てる。その手番のうちは同じ注文に再挑戦できない</Card>
        <Card on={h === 'flush'} title="補充と、注文を流す">届いたらすぐ山から補充して読み上げる。1コインで1枚流せる（1手番1回）</Card>
      </Right></>);
    }
    case 'joint': {
      const lines: [string, number, number][] = [['egg', 3, 1.5], ['wheat', 2, 1], ['carrot', 3, 1.5]];
      const filled = h === 'line' ? [true, false, false] : h === 'done' ? [true, true, true] : h === 'timeout' ? [true, false, false] : [false, false, false];
      const by = [CHIKA, AKI, PCOL[1]];
      const JC: React.FC<{ title: string; f: boolean[]; tag: string }> = ({ title, f, tag }) => (
        <div style={{ background: '#fff8e6', border: `3px solid ${C.wheatInk}`, borderRadius: 18, overflow: 'hidden', fontFamily: JPF }}>
          <div style={{ background: C.wheat, color: C.wheatInk, padding: '8px 18px', fontWeight: 800, fontSize: 26, display: 'flex', justifyContent: 'space-between' }}><span>共同注文</span><span>{tag}</span></div>
          <div style={{ padding: '10px 18px', fontFamily: ENF, fontSize: 24, color: C.ink }}>{title}</div>
          <div style={{ display: 'flex', gap: 10, padding: '0 14px 14px' }}>{lines.map(([it, n, p], q) => (
            <div key={it} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 22, background: f[q] ? by[q] : 'transparent', color: f[q] ? '#fff' : C.ink, border: `2px solid ${f[q] ? by[q] : C.rule}`, borderRadius: 10, padding: '4px 8px' }}>
              <Icon id={PICON[it]} size={34} /><span style={{ fontFamily: ENF }}>×{n}</span><span>{p}点</span></div>))}</div>
        </div>);
      return (<><div style={{ position: 'absolute', left: 30, top: 110, width: 1000, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <JC title="The summer camp needs three eggs, two bags of wheat and three carrots." f={filled} tag={h === 'timeout' ? 'R5〜R7' : h === 'line' ? 'R5〜R7' : '未着手'} />
        <JC title="The village festival needs four carrots, two eggs and three bottles of milk." f={[false, false, false]} tag="未着手" />
      </div><Right>
        <Card on={h === 'cards'} title="2枚を表に。3行を全員で出し合う">1行はsellカード1枚で、1人で出す</Card>
        <Card on={h === 'line'} title="1人1手番に1行まで">2枚を合わせて1行。手番をまたげば1人で全部出してもよい</Card>
        <Card on={h === 'done'} title="完成：各自が自分の行の点">完成させた人は＋0.5点。コインはもらえない</Card>
        <Card on={h === 'timeout'} color={C.warn} title="最初の行から3ラウンドで時間切れ">出した人は行の点の半分（0.5点刻みで切り捨て）。誰も出していない札は時間切れにならない</Card>
      </Right></>);
    }
    case 'trade': return (<Area><div style={{ display: 'flex', gap: 40, alignItems: 'center', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, fontFamily: JPF }}>
        <div style={{ textAlign: 'center' }}><div style={{ width: 200, height: 200, borderRadius: 100, background: '#dcebd8', border: `5px solid ${C.leaf}`, display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 800 }}>手番の人</div></div>
        <div style={{ fontFamily: ENF, fontSize: 90, color: C.leaf }}>⇄</div>
        <div style={{ textAlign: 'center' }}><div style={{ width: 200, height: 200, borderRadius: 100, background: '#f2ecd8', border: `5px solid ${CHIKA}`, display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 800 }}>ほかの1人</div></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card on={h === 'who'} title="手番の人と、ほかの1人の間だけ">手番でない人どうしは交換できない</Card>
        <Card on={h === 'what'} title="カード・産物・コイン、何でも">お互いに1つ以上を出す。回数に上限はない</Card>
        <Card title="交渉は英語で">"Does anyone have a sell card?"</Card>
      </div></div></Area>);
    case 'bank': return (<Area><div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 10 }}>
      <Card on={h === 'bank'} title="銀行：同じカード4枚 → 好きなカード1枚">自分の手番中なら何回でも</Card>
      <Card on={h === 'harbor'} title="港：3:1 は同じカード3枚、2:1 はその種類のカード2枚 → 好きな1枚">港につながった外側の角に拠点がある人だけ使える</Card>
      <Card on={h === 'coin'} title="5コイン → 好きなカード1枚">何回でも</Card>
      <Card on={h === 'prod'} color={C.warn} title="産物を買う：ジャガイモ・小麦・卵は10コイン、ニンジンとミルクは15コイン">1手番に1つまで。最後の手段</Card>
    </div></Area>);
    case 'english': {
      const rows: [string, string, React.ReactNode][] = [
        ['word', '日本語の単語を1つ（先に "Japanese word!"）', <Coin n={1} />],
        ['talk', '交渉1件を日本語で（話せるのは払った本人だけ）', <Coin n={2} />],
        ['slip', '宣言しないで日本語を話した', <Coin n={2} />],
        ['ticket', '無料券（全員2枚）：単語1つか交渉1件を無料に', <span style={{ fontFamily: JPF, fontSize: 22, fontWeight: 800, color: C.leaf }}>0コイン</span>],
      ];
      return (<Area><div style={{ display: 'flex', gap: 30 }}>
        <div style={{ flex: 1.3, background: C.paper, borderRadius: 18, border: `2px solid ${C.rule}`, overflow: 'hidden' }}>
          <div style={{ background: C.leaf, color: '#fff', fontFamily: JPF, fontSize: 28, fontWeight: 800, padding: '12px 22px' }}>No Japanese：交渉は英語で</div>
          {rows.map(([k, t, c]) => (<div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', fontFamily: JPF, fontSize: 26, background: h === k ? '#fff8e6' : '#fff', borderLeft: `8px solid ${h === k ? C.wheatInk : 'transparent'}` }}><span>{t}</span>{c}</div>))}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card on={h === 'basic'} title="ルールの確認は日本語でよい">支払いの対象は交渉の発言だけ</Card>
          <Card on={h === 'ask'} title="英語で聞くのはタダ">How do you say ニンジン?<br />What does "dozen" mean?</Card>
          <Card on={h === 'grammar'} title="文法は審査しない">通じれば成立。言い直しを手伝うのは歓迎</Card>
        </div></div></Area>);
    }
    case 'end': return (<Area><div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 20, alignItems: 'center' }}>
      <div style={{ fontFamily: '"Arial Black",Impact,sans-serif', fontSize: 90, color: C.leaf }}>WORD FARM</div>
      <div style={{ display: 'flex', gap: 24, width: '100%' }}>
        {[['収入', 'サイコロでカード'], ['育てる', '作物と動物'], ['届ける', '英語の注文を読む'], ['交渉', '英語で頼む']].map(([t, d]) => <Card key={t} on={h === 'sum1'} title={t} style={{ flex: 1 }}>{d}</Card>)}
      </div>
      <Card on={h === 'sum2'} title="自分の手番中に8点に届いた人の勝ち" style={{ width: '100%' }}>細かいことはルールブックで確かめる</Card>
    </div></Area>);
  }
  return null;
};

// ---------- 2人と吹き出し ----------
const Speakers: React.FC<{ b: GBeat; local: number }> = ({ b, local }) => {
  const pop = spring({ frame: local, fps: FPS, config: { damping: 14, mass: 0.6 } });
  const fig = (who: 'a' | 'c', left: number) => {
    const on = b.w === who;
    return <Img src={staticFile(face(b, who))} style={{ position: 'absolute', left, bottom: 0, height: on ? 330 : 290, opacity: on ? 1 : 0.55, filter: on ? 'none' : 'grayscale(0.35)' }} />;
  };
  const col = b.w === 'a' ? AKI : CHIKA;
  return (<>
    {fig('a', 20)}
    {fig('c', 1590)}
    <div style={{ position: 'absolute', left: 340, top: 770, width: 1230, height: 280, transform: `translateY(${(1 - pop) * 16}px)`, opacity: pop }}>
      <div style={{ background: C.paper, border: `4px solid ${col}`, borderRadius: 22, padding: '16px 28px', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontFamily: ENF, fontSize: 22, fontWeight: 800, color: col }}>{b.w === 'a' ? 'Aki' : 'Chika'}</div>
        {b.en ? <div style={{ fontFamily: ENF, fontSize: b.en.length > 50 ? 34 : 42, fontWeight: 800, color: C.ink, marginTop: 4 }}>{b.en}</div> : null}
        <div style={{ fontFamily: JPF, fontSize: b.en ? 28 : 34, color: b.en ? C.muted : C.ink, lineHeight: 1.45, marginTop: 6 }}>{b.t}</div>
      </div>
      <div style={{ position: 'absolute', top: 120, [b.w === 'a' ? 'left' : 'right']: -26, width: 0, height: 0, borderTop: '18px solid transparent', borderBottom: '18px solid transparent', [b.w === 'a' ? 'borderRight' : 'borderLeft']: `28px solid ${col}` } as any} />
    </div>
  </>);
};

export const Guide: React.FC = () => {
  const frame = useCurrentFrame();
  const { beats } = useMemo(() => buildGuide(), []);
  let bi = beats.findIndex(b => frame >= b.start && frame < b.start + b.dur);
  if (bi < 0) bi = beats.length - 1;
  const b = beats[bi] as GBeat; const local = frame - b.start;
  // 場面が変わった直後だけ図をふわっと出す
  const sceneStart = beats.slice(0, bi + 1).reverse().find((x, k, arr) => k === arr.length - 1 || arr[k + 1].s !== x.s)!;
  const fade = interpolate(frame - sceneStart.start, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const defs = <svg width={0} height={0} style={{ position: 'absolute' }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
  const chapters = Array.from(new Set(GUIDE.map(l => CHAPTERS[l.s])));
  return (<AbsoluteFill style={{ ...VARS, background: C.bg }}>
    {defs}
    <div style={{ position: 'absolute', left: 30, top: 18, right: 30, height: 66, display: 'flex', alignItems: 'center', gap: 18, fontFamily: JPF }}>
      <span style={{ fontFamily: '"Arial Black",Impact,sans-serif', fontSize: 38, color: C.ink }}>WORD FARM</span>
      <span style={{ fontSize: 26, color: C.muted }}>ルール説明</span>
      <span style={{ fontSize: 30, fontWeight: 800, color: '#fff', background: C.leaf, borderRadius: 12, padding: '2px 16px' }}>{CHAPTERS[b.s]}</span>
      <span style={{ marginLeft: 'auto', fontSize: 20, color: C.muted }}>{chapters.indexOf(CHAPTERS[b.s]) + 1} / {chapters.length}</span>
    </div>
    <div style={{ opacity: fade }}><Scene b={b} local={frame - sceneStart.start} /></div>
    <Speakers b={b} local={local} />
  </AbsoluteFill>);
};
