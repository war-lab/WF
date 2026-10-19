// game.json（台本をエンジンで実行した結果）から、動画の時間割（ビート）を組み立てる
import game from '../public/game.json';

export const FPS = 30;
export const G: any = game;
export const NAMES: string[] = G.players.map((p: any) => p.name);

export type Beat = {
  start: number;
  dur: number;
  kind: 'title' | 'intro' | 'step' | 'roll' | 'end';
  step?: any[];
  events?: any[];
  state: any;
  turn?: { idx: number; p: number; round: number; roll: number; dice: number[] };
  placed: { p: number; v: number }[];
  inSetup: boolean;
  fast?: boolean;
};

const sec = (s: number) => Math.round(s * FPS);
const jlen = (t: string) => (t || '').length;

function durFor(step: any[], hasEvents: boolean): number {
  const k = step[0];
  if (k === 'narr') return sec(Math.min(6, 1.4 + jlen(step[1]) / 13));
  if (k === 'think') return sec(Math.min(5.5, 1.3 + jlen(step[2]) / 13));
  if (k === 'say') return sec(Math.min(6, 1.3 + jlen(step[2]) / 20 + jlen(step[3]) / 18));
  if (k === 'place') return sec(0.8);
  if (k === 'cmd') return sec(hasEvents ? 1.0 : 0.5);
  return sec(2);
}

// 産物と単語の英語・日本語
const JP: Record<string, string> = { carrot: 'ニンジン', potato: 'ジャガイモ', wheat: '小麦', egg: '卵', milk: 'ミルク', cow: '牛', chicken: 'ニワトリ' };
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export function nounEn(item: string, n: number): string {
  const w = NUMW[n] || String(n);
  if (item === 'carrot') return n === 1 ? 'a carrot' : `${w} carrots`;
  if (item === 'potato') return n === 1 ? 'a potato' : `${w} potatoes`;
  if (item === 'egg') return n === 1 ? 'an egg' : `${w} eggs`;
  if (item === 'wheat') return n === 1 ? 'a bag of wheat' : `${w} bags of wheat`;
  if (item === 'milk') return n === 1 ? 'a bottle of milk' : `${w} bottles of milk`;
  return `${w} ${item}`;
}
const pl = (c: string) => ({ carrot: 'carrots', potato: 'potatoes', wheat: 'wheat' } as any)[c] || c;
const goodsEn = (g: Record<string, number>) => { const a = Object.entries(g).map(([k, v]) => nounEn(k, v as number)); return a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0]; };
const goodsJp = (g: Record<string, number>) => Object.entries(g).map(([k, v]) => `${JP[k] || k}${v}`).join('、');
const cardsJp = (c: any) => Object.entries(c.cards || {}).map(([k, v]) => `${k}カード${v}枚`).concat(Object.entries(c.prod || {}).map(([k, v]) => `${JP[k]}${v}`)).concat(c.coins ? [`${c.coins}コイン`] : []).join('と');

// キャラクターの口調（0 Aki 冷静なお姉さん／1 Ben 陽気なお兄さん／2 Chika 元気な女の子／3 Dan 英国紳士）
// ニンジンを植える宣言（feedカードも使う）
const CARROT = [['I grow carrots and feed the soil.', 'ニンジンを植えて、土に肥料をやるわ'], ['I grow carrots and feed the soil! Easy!', 'ニンジン植えて肥料もまいちゃうぜ！'], ['I grow carrots and feed the soil!!', 'ニンジン植えて、肥料もあげるよー！'], ['I shall grow carrots and feed the soil.', 'ニンジンを植えて、土に肥料をやらせていただこう']];
const V = {
  plant: [(x: string, j: string) => [`I grow ${x}.`, `${j}を植えるわ`], (x: string, j: string) => [`I grow ${x}! Easy!`, `${j}植えちゃうぜ！`], (x: string, j: string) => [`I grow ${x}!!`, `${j}植えるよー！`], (x: string, j: string) => [`I shall grow ${x}.`, `${j}を植えさせていただこう`]],
  buy: [(a: string, j: string) => [`I buy a ${a}.`, `${j}を買うわ`], (a: string, j: string) => [`I buy a ${a}! Party time!`, `${j}買っちゃう！`], (a: string, j: string) => [`I buy a ${a}!! Yay!!`, `${j}さん買う！ やったー！`], (a: string, j: string) => [`I shall buy a ${a}.`, `${j}を迎え入れよう`]],
  feed: [(a: string, j: string) => [`I feed the ${a}.`, `${j}に餌をやるわ`], (a: string, j: string) => [`I feed the ${a}. Eat up, buddy!`, `${j}にごはん！ いっぱい食えよ〜`], (a: string, j: string) => [`I feed the ${a}!`, `${j}さん、ごはんだよー！`], (a: string, j: string) => [`I shall feed the ${a}.`, `${j}に食事を差し上げよう`]],
  market: [(x: string) => [`I sell ${x}.`, '市場で売るわ'], (x: string) => [`I sell ${x}! Cash, baby!`, '市場で売っちゃうぜ！'], (x: string) => [`I sell ${x}!`, '市場で売りまーす！'], (x: string) => [`I shall sell ${x} at the market.`, '市場で売らせていただこう']],
  deliver: [(x: string) => [`I sell ${x}.`, '注文を届けるわ'], (x: string) => [`I sell ${x}. Boom!`, '注文、届けちゃうぜ！'], (x: string) => [`I sell ${x}!! Yay!!`, '注文、届けまーす！'], (x: string) => [`I sell ${x}. Cheerio!`, '注文をお届けしよう']],
  flush: [(n: number) => [`I flush number ${n}.`, `${n}番を流すわ`], (n: number) => [`I'll flush number ${n}! Bye-bye!`, `${n}番、さよなら〜！`], (n: number) => [`I flush number ${n}!`, `${n}番、流しちゃう！`], (n: number) => [`I shall flush number ${n}.`, `${n}番を流させていただく`]],
  house: ['I build a farmhouse.', 'I build a farmhouse! New crib!', 'I build a farmhouse!!', 'I shall build a farmhouse.'],
};
const ASK = [
  (x: string) => `Would anyone trade me ${x}? I can pay.`,
  (x: string) => `Come on, guys! I just need ${x}!`,
  (x: string) => `Please!! I need ${x}!!`,
  (x: string) => `Might anyone spare ${x}?`,
];
const NO = [
  'No. You are too close to winning.',
  'Sorry, buddy. Not for the leader!',
  'No, thank you!! You are winning!!',
  'I am afraid not, old chap.',
];
const BRING = [
  (x: string, ev: string) => `I bring ${x} to ${ev}.`,
  (x: string, ev: string) => `I bring ${x} to ${ev}! Party time!`,
  (x: string, ev: string) => `I bring ${x} to ${ev}!!`,
  (x: string, ev: string) => `I shall bring ${x} to ${ev}.`,
];
const evName = (id: number) => { const t: string = G.orders[String(id)]?.text || 'the party'; const m = t.match(/^(The [^,]+?) needs/); return m ? m[1].replace(/^The/, 'the') : 'the party'; };
const nameOf = (k: string) => (JP as any)[k] ? `${k}` : k;
const TV = [
  (s: string) => `${s}。冷静にいきましょう`,
  (s: string) => `${s}！ イケるっしょ`,
  (s: string) => `${s}！ がんばるぞー！`,
  (s: string) => `ふむ、${s}。紳士的に参ろう`,
];

// エンジンの出来事を、台詞・解説に変換する
function eventToStep(e: any, cur: number): any[] | null {
  const pi = e.p ?? cur;
  const n = NAMES[pi];
  switch (e.t) {
    case 'plant': {
      // ニンジンはfeedカードも使うので、宣言に肥料の一文を付ける
      if (e.crop === 'carrot') return ['say', e.p, CARROT[pi][0], `${CARROT[pi][1]}（feedカードも使う）`];
      const [en, jp] = V.plant[pi](pl(e.crop), JP[e.crop]); return ['say', e.p, en, jp];
    }
    case 'buy': {
      // 牛はgrowカードも使うので、宣言に牧草の一文を足す
      const [en, jp] = V.buy[pi](e.animal, JP[e.animal]);
      return e.animal === 'cow' ? ['say', e.p, en.replace(`a ${e.animal}`, `a ${e.animal} and grow grass`), jp + '（牧草にgrowカードも使う）'] : ['say', e.p, en, jp];
    }
    case 'feed': { const [en, jp] = V.feed[pi](e.animal, JP[e.animal]); return ['say', e.p, en, jp + (e.animal === 'cow' ? `（ミルク${e.n}本）` : `（卵${e.n}つ）`)]; }
    case 'market': { const [en, jp] = V.market[pi](nounEn(e.prod, e.n)); return ['say', e.p, en, `${jp}：${JP[e.prod]}${e.n}つで +${e.coins}コイン`]; }
    case 'deliver': {
      const o = G.orders[String(e.order)];
      const [en, jp] = V.deliver[pi](goodsEn(e.goods || {}));
      return ['say', e.p, en, `${jp}：${goodsJp(e.goods || {})}（+${e.pts}点、+2コイン）`, { deliver: e.order, pts: e.pts, text: o?.text }];
    }
    case 'refill': { const o = G.orders[String(e.order)]; return ['say', cur, `New order: "${o?.text}"`, `新しい注文（${o?.pts}点）`]; }
    case 'trade': return ['narr', `交換：${NAMES[e.p]}は${cardsJp(e.give) || 'なし'}を渡し、${NAMES[e.q]}から${cardsJp(e.get) || 'なし'}を受け取る`];
    case 'bank': return ['narr', `${n}：${e.k === 4 ? '銀行' : '港'}で ${e.give}カード${e.k}枚 → ${e.get}カード1枚`];
    case 'coinbank': return ['narr', `${n}：銀行で${e.coins}コインを払い、${e.card}カードを1枚買う`];
    case 'prodbuy': return ['narr', `${n}：銀行で${e.coins}コインを払い、${JP[e.item]}を1つ買う（1手番1つまで）`];
    case 'flush': { const [en, jp] = V.flush[pi](e.order); return ['say', e.p, en, `${jp}（1コイン）`]; }
    case 'house': return ['say', e.p, V.house[pi], '拠点を追加する'];
    case 'harvest': return ['narr', `${n}：${JP[e.crop]}を${e.n}つ収穫。区画が空く`];
    case 'milk': return ['narr', `${n}：牛のミルク${e.n}本を受け取る`];
    case 'win': return ['narr', `${n}が自分の手番中に勝利点8点に届いた。その場で${n}の勝ち！`];
    case 'joint_line': { const en = BRING[pi](nounEn(e.item, e.n), evName(e.order)); return ['say', e.p, en, `共同注文に${JP[e.item]}${e.n}つを出す（完成したら+${e.pts}点）`]; }
    case 'joint_done': { const g = Object.entries(e.gains || {}).map(([k, v]) => `${NAMES[+k]} +${v}点`).join('、'); return ['narr', `共同注文が完成！ ${g}（完成させた${n}は+0.5点込み）`]; }
    case 'joint_refill': { const o = G.orders[String(e.order)]; return ['say', cur, `New joint order: "${o?.text}"`, '新しい共同注文']; }
    case 'joint_expire': return ['narr', '共同注文が、最初の行が出てから3ラウンドで完成せず時間切れ。出した人に行の点の半分を払い、山から1枚を表にする'];
    case 'refuse': return ['refuse', e.p, e.q, e.want];
    default: return null;
  }
}

// 早送りの手番の考え（その手番の行動から作り、口調を付ける）
function autoThought(rec: any): string | null {
  const ev = rec.seq.map((x: any) => x.ev).filter((e: any) => e.p === rec.p || e.t === 'trade');
  const pts = rec.state.players[rec.p].pts;
  const rest = Math.max(0, 8 - pts);
  const has = (t: string) => ev.some((e: any) => e.t === t);
  let base: string;
  if (has('joint_done')) base = `共同注文が完成した！ ${pts}点、あと${rest}点`;
  else if (has('deliver')) { const d = ev.filter((e: any) => e.t === 'deliver'); base = `注文を${d.length}つ届けて${pts}点。あと${rest}点`; }
  else if (has('joint_line')) base = `共同注文に1行出した。誰か残りを出してくれ。あと${rest}点`;
  else if (has('refuse')) base = `誰も売ってくれない。トップは警戒されている。あと${rest}点`;
  else if (has('bank')) base = `港と銀行でカードを替えて、次の注文に備える。あと${rest}点`;
  else if (has('coinbank')) base = `足りないカードは銀行でコインで買う。あと${rest}点`;
  else if (has('flush')) base = `狙われそうな注文は流しておく。あと${rest}点`;
  else if (has('buy')) base = `動物を増やして、産物を作る量を上げる。あと${rest}点`;
  else if (has('trade')) base = `交換でカードをそろえる。あと${rest}点`;
  else if (has('feed')) base = `餌をやって産物を貯め、合う注文を待つ。あと${rest}点`;
  else if (has('plant')) base = `作物を植えた。次の手番で収穫する。あと${rest}点`;
  else if (has('market')) base = `市場で売ってコインに替える。あと${rest}点`;
  else base = `今は動けない。次の出目を待つ。あと${rest}点`;
  return TV[rec.p](base);
}

export function buildBeats(): { beats: Beat[]; total: number } {
  const beats: Beat[] = [];
  let t = 0;
  const push = (b: Omit<Beat, 'start'>) => { beats.push({ ...b, start: t }); t += b.dur; };
  const tl = G.timeline;
  const setup = tl[0];
  const placed: { p: number; v: number }[] = [];
  const emptyState = JSON.parse(JSON.stringify(setup.state));
  emptyState.players.forEach((p: any) => { p.bases = []; });

  push({ kind: 'title', dur: sec(4.5), state: emptyState, placed: [], inSetup: true });
  push({ kind: 'intro', dur: sec(8), state: emptyState, placed: [], inSetup: true });
  for (const st of setup.steps) {
    if (st[0] === 'place') placed.push({ p: st[1], v: st[2] });
    push({ kind: 'step', step: st, dur: durFor(st, false), state: setup.state, placed: [...placed], inSetup: true });
  }

  let fastAnnounced = false;
  for (const rec of tl.slice(1)) {
    if (rec.kind === 'turn') {
      const turn = { idx: rec.idx, p: rec.p, round: rec.state_after_start.round, roll: rec.roll, dice: rec.dice || [1, rec.roll - 1] };
      push({ kind: 'roll', dur: sec(2.4), events: rec.start_events, state: rec.state_after_start, turn, placed: [], inSetup: false });
      for (const s of rec.steps) push({ kind: 'step', step: s.st, events: s.events || [], dur: durFor(s.st, (s.events || []).length > 0), state: s.state, turn, placed: [], inSetup: false });
    } else if (rec.kind === 'auto') {
      const fast = !rec.finale;
      const startEv = rec.seq.filter((x: any) => ['turn', 'income', 'market_day', 'relief', 'seven_discard'].includes(x.ev.t));
      const st0 = startEv.length ? startEv[startEv.length - 1].state : rec.state;
      const round = st0.round;
      const turn = { idx: rec.idx, p: rec.p, round, roll: rec.roll, dice: rec.dice };
      if (fast && !fastAnnounced) {
        fastAnnounced = true;
        push({ kind: 'step', step: ['narr', 'ここから早送り。4人がそれぞれの農場を育て、注文を取り合う'], dur: sec(3), state: st0, turn, placed: [], inSetup: false, fast: true });
      }
      if (!fast && rec.idx === tl.filter((r: any) => r.kind === 'auto' && r.finale)[0].idx) {
        const ps = st0.players.map((pp: any, i: number) => `${NAMES[i]} ${pp.pts}点`).join('、');
        push({ kind: 'step', step: ['narr', `終盤。${ps}。全員が勝利点8点の目前`], dur: sec(3.6), state: st0, turn, placed: [], inSetup: false });
      }
      push({ kind: 'roll', dur: sec(fast ? 1.0 : 2.4), events: startEv.map((x: any) => x.ev), state: st0, turn, placed: [], inSetup: false, fast });
      const notes = rec.notes || {};
      for (const st of notes.before || []) push({ kind: 'step', step: st, dur: durFor(st, false), state: st0, turn, placed: [], inSetup: false });
      let refillN = 0;
      let won = false;
      // ボットは同じ相手に同じ頼みを繰り返すので、断りは1手番に同じものを1回、合計3回まで見せる
      const refused = new Set<string>();
      for (const x of rec.seq) {
        if (won) break;
        if (x.ev.t === 'win') won = true;
        if (['turn', 'income', 'market_day', 'relief', 'seven_discard'].includes(x.ev.t)) continue;
        const step = eventToStep(x.ev, rec.p);
        if (!step) continue;
        if (step[0] === 'refuse') {
          const [, a, b, want] = step as any[];
          const key = `${a}-${b}-${want}`;
          if (refused.has(key) || refused.size >= 3) continue;
          refused.add(key);
          const wantEn = ['carrot', 'potato', 'wheat', 'egg', 'milk'].includes(want) ? nounEn(want, 1).replace(/^an? /, 'some ').replace('some bag of', 'a bag of').replace('some bottle of', 'a bottle of') : `a ${want} card`;
          const s1 = ['say', a, ASK[a](wantEn), `${want === 'egg' ? '卵' : want}がほしい！`];
          const s2 = ['say', b, NO[b], 'トップに近い人には売らない'];
          push({ kind: 'step', step: s1, events: [], dur: fast ? sec(1.0) : durFor(s1, false), state: x.state, turn, placed: [], inSetup: false, fast });
          push({ kind: 'step', step: s2, events: [x.ev], dur: fast ? sec(1.0) : durFor(s2, false), state: x.state, turn, placed: [], inSetup: false, fast });
          continue;
        }
        const d = fast ? sec(0.7) : durFor(step, true);
        push({ kind: 'step', step, events: [x.ev], dur: d, state: x.state, turn, placed: [], inSetup: false, fast });
        if (x.ev.t === 'refill') {
          for (const st of (notes.on_refill || [])[refillN] || []) push({ kind: 'step', step: st, dur: durFor(st, false), state: x.state, turn, placed: [], inSetup: false });
          refillN++;
        }
      }
      if (fast) {
        const th = autoThought(rec);
        if (th) push({ kind: 'step', step: ['think', rec.p, th], dur: sec(1.6), state: rec.state, turn, placed: [], inSetup: false, fast });
      }
      for (const st of notes.after || []) push({ kind: 'step', step: st, dur: durFor(st, false), state: rec.state, turn, placed: [], inSetup: false });
    } else if (rec.kind === 'outro') {
      push({ kind: 'end', dur: sec(6), state: rec.state, placed: [], inSetup: false });
      for (const st of rec.steps) push({ kind: 'step', step: st, dur: durFor(st, false), state: rec.state, placed: [], inSetup: false });
    }
  }
  return { beats, total: t };
}
