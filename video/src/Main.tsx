// WORD FARM 紹介動画の本体
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, Img, staticFile } from 'remotion';
import { buildBeats, Beat, G, NAMES, FPS, PlayVoice } from './timeline';
import { DEFS } from './defs';
import { Sound } from './Sound';

export const C = {
  bg: '#f3f5ef', paper: '#ffffff', ink: '#1d2a22', muted: '#5b685f', rule: '#d5dbd2', leaf: '#2f6b3a', wheat: '#f1d77a', wheatInk: '#3b2f05',
  warn: '#9a3b1f', sea: '#cfe1e3', soil: '#8a6a48', table: '#e6ede3',
};
export const PCOL = ['#2f6b3a', '#a2453a', '#c99a1c', '#3b6ea8'];

// ---------- 表情（public/faces/<名前>_<表情>.png） ----------
// 表情は台本で台詞ごとに指定する（say は5番目、think は4番目の要素）
export const FKEY = NAMES.map((n) => n.toLowerCase());
export function faceFor(st: any): string | null {
  if (!st || (st[0] !== 'say' && st[0] !== 'think')) return null;
  const who = st[1] as number;
  const f = st[0] === 'say' ? st[4] : st[3];
  return `faces/${FKEY[who]}_${f || 'normal'}.png`;
}
// 話していないときの表情
const REST_BY: Record<string, string> = { aki: 'normal', ben: 'normal', dan: 'normal', chika: 'smile' };
const REST = FKEY.map((k) => REST_BY[k] || 'normal');
const Avatar: React.FC<{ src: string; size: number; ring: string }> = ({ src, size, ring }) => (
  <div style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', background: '#fff', border: `2px solid ${ring}`, flex: 'none', position: 'relative' }}>
    <Img src={staticFile(src)} style={{ position: 'absolute', width: size * 1.6, left: -size * 0.3, top: -size * 0.12 }} />
  </div>
);
export const VARS: React.CSSProperties = {
  ['--bg' as any]: C.bg, ['--paper' as any]: C.paper, ['--ink' as any]: C.ink, ['--muted' as any]: C.muted, ['--rule' as any]: C.rule,
  ['--leaf' as any]: C.leaf, ['--wheat' as any]: C.wheat, ['--wheat-ink' as any]: C.wheatInk, ['--warn' as any]: C.warn,
  ['--sky' as any]: '#e3ece4', ['--hill' as any]: '#9cc39a', ['--soil' as any]: C.soil, ['--barn' as any]: '#a2453a', ['--barn-roof' as any]: '#5b2a24',
  ['--carrot' as any]: '#e07b2a', ['--potato' as any]: '#b88a55', ['--grain' as any]: '#d9a92e', ['--egg' as any]: '#f3ead8', ['--milk' as any]: '#ffffff', ['--line' as any]: '#1d2a22',
};
export const JPF = '"Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Sans",sans-serif';
export const ENF = '"Segoe UI","Helvetica Neue",Arial,sans-serif';
export const ICON: Record<string, string> = { grow: 'i-grow', buy: 'i-buy', feed: 'i-feed', sell: 'i-sell', seed: 'i-seed', animal: 'i-animal' };
export const PICON: Record<string, string> = { carrot: 'p-carrot', potato: 'p-potato', wheat: 'p-wheat', egg: 'p-egg', milk: 'p-milk' };
const LEVELS = G.players.map((p: any) => p.level);

export const Icon: React.FC<{ id: string; size: number; style?: React.CSSProperties }> = ({ id, size, style }) => (
  <svg width={size} height={size} style={style}><use href={`#${id}`} width={size} height={size} /></svg>
);

// ---------- 盤面 ----------
const BW = 1000, BH = 640, PAD = 60;
function useBoardGeom() {
  return useMemo(() => {
    const co: Record<string, number[]> = G.layout.coords;
    const xs = Object.values(co).map(c => c[0]), ys = Object.values(co).map(c => c[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const S = Math.min((BW - PAD * 2) / (maxx - minx), (BH - PAD * 2) / (maxy - miny));
    const ox = (BW - (maxx - minx) * S) / 2, oy = (BH - (maxy - miny) * S) / 2;
    const P = (v: string | number) => { const c = co[String(v)]; return [(c[0] - minx) * S + ox, (c[1] - miny) * S + oy]; };
    const cx0 = (BW) / 2, cy0 = (BH) / 2;
    const tiles = G.layout.TV.map((vs: number[], i: number) => {
      const pts = vs.map(P); const cx = pts.reduce((a: number, p: number[]) => a + p[0], 0) / 6; const cy = pts.reduce((a: number, p: number[]) => a + p[1], 0) / 6;
      return { i, pts, cx, cy };
    });
    return { P, S, tiles, cx0, cy0 };
  }, []);
}

export const Board: React.FC<{ beat: Beat; local: number }> = ({ beat, local }) => {
  const g = useBoardGeom();
  const board = G.timeline[0].board;
  const roll = beat.kind === 'roll' ? beat.turn?.roll : undefined;
  const glow = roll ? interpolate(local, [0, 20, 60], [0, 1, 0.6], { extrapolateRight: 'clamp' }) : 0;
  const bases: { p: number; v: number }[] = beat.inSetup ? beat.placed : beat.state.players.flatMap((pl: any, pi: number) => pl.bases.map((v: number) => ({ p: pi, v })));
  const lastPlaced = beat.inSetup && beat.step?.[0] === 'place' ? beat.placed[beat.placed.length - 1] : null;
  return (
    <svg width={BW} height={BH} style={{ position: 'absolute', left: 30, top: 96 }}>
      <rect x={0} y={0} width={BW} height={BH} rx={22} fill={C.sea} />
      {Object.entries(board.harbor).map(([v, h]: any) => {
        const [x1, y1] = g.P(v); const dx = x1 - g.cx0, dy = y1 - g.cy0; const d = Math.hypot(dx, dy); const X = x1 + dx / d * 46, Y = y1 + dy / d * 46;
        return (<g key={v}><path d={`M${x1} ${y1} L${X} ${Y}`} stroke={C.soil} strokeWidth={7} strokeLinecap="round" />
          <circle cx={X} cy={Y} r={24} fill={C.paper} stroke={C.ink} strokeWidth={2} />
          {h === 'any' ? <text x={X} y={Y + 6} textAnchor="middle" fontFamily={ENF} fontSize={17} fontWeight={700} fill={C.ink}>3:1</text>
            : <><use href={`#${ICON[h]}`} x={X - 13} y={Y - 20} width={26} height={26} /><text x={X} y={Y + 17} textAnchor="middle" fontFamily={ENF} fontSize={11} fontWeight={700} fill={C.ink}>2:1</text></>}
        </g>);
      })}
      {g.tiles.map((t: any) => {
        const cat = board.tcat[t.i], n = board.tnum[t.i];
        const poly = t.pts.map((p: number[]) => p.join(',')).join(' ');
        if (cat == null) return (<g key={t.i}><polygon points={poly} fill={C.wheat} stroke={C.ink} strokeWidth={2} />
          <text x={t.cx} y={t.cy + 2} textAnchor="middle" fontFamily={ENF} fontSize={20} fontWeight={700} fill={C.wheatInk}>Market</text>
          <text x={t.cx} y={t.cy + 24} textAnchor="middle" fontFamily={JPF} fontSize={13} fill={C.wheatInk}>7＝全員1枚</text></g>);
        const hot = roll === n;
        return (<g key={t.i}>
          <polygon points={poly} fill={hot ? '#fff6d6' : C.paper} stroke={hot ? '#e0a400' : C.leaf} strokeWidth={hot ? 3 + 5 * glow : 2.5} />
          <use href={`#${ICON[cat]}`} x={t.cx - 22} y={t.cy - 46} width={44} height={44} />
          <circle cx={t.cx} cy={t.cy + 18} r={17} fill={C.wheat} stroke={C.ink} strokeWidth={1.2} />
          <text x={t.cx} y={t.cy + 24} textAnchor="middle" fontFamily={ENF} fontSize={17} fontWeight={700} fill={n === 6 || n === 8 ? C.warn : C.wheatInk}>{n}</text>
          {Array.from({ length: 6 - Math.abs(7 - n) }).map((_, k, arr) => <circle key={k} cx={t.cx - (arr.length - 1) * 3 + k * 6} cy={t.cy + 44} r={2} fill={C.muted} />)}
        </g>);
      })}
      {bases.map(({ p, v }, k) => {
        const [x, y] = g.P(v);
        const isNew = lastPlaced && lastPlaced.v === v;
        const sc = isNew ? spring({ frame: local, fps: FPS, config: { damping: 9 } }) : 1;
        return <g key={k} transform={`translate(${x} ${y}) scale(${sc * 1.35})`}><path d="M-9 4 L-9 -4 L0 -11 L9 -4 L9 4 Z" fill={PCOL[p]} stroke={C.ink} strokeWidth={1.6} /></g>;
      })}
    </svg>
  );
};

// ---------- ダイス ----------
const PIPS: Record<number, number[][]> = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
export const Die: React.FC<{ v: number; rot: number; x: number }> = ({ v, rot, x }) => (
  <svg width={70} height={70} style={{ position: 'absolute', left: x, top: 0, transform: `rotate(${rot}deg)` }}>
    <rect x={3} y={3} width={64} height={64} rx={12} fill="#fff" stroke={C.ink} strokeWidth={3} />
    {(PIPS[v] || []).map(([a, b], i) => <circle key={i} cx={35 + a * 16} cy={35 + b * 16} r={6} fill={C.ink} />)}
  </svg>
);
const Dice: React.FC<{ beat: Beat; local: number }> = ({ beat, local }) => {
  if (!beat.turn) return null;
  const roll = beat.kind === 'roll'; const spinEnd = 22;
  const spinning = roll && local < spinEnd;
  const d = beat.turn.dice || [1, 1];
  const v1 = spinning ? ((Math.floor(local / 2) * 7) % 6) + 1 : d[0];
  const v2 = spinning ? ((Math.floor(local / 2) * 5 + 3) % 6) + 1 : d[1];
  const r = spinning ? local * 37 : 0;
  return (<div style={{ position: 'absolute', left: 870, top: 14, width: 160, height: 80, transform: 'scale(0.85)', transformOrigin: 'left top' }}>
    <Die v={v1} rot={r} x={0} /><Die v={v2} rot={-r} x={82} />
  </div>);
};

// ---------- 注文 ----------
// おはじき（表にした人の色、残りの個数）
const Tokens: React.FC<{ owner: number | null; n: number | null; size?: number }> = ({ owner, n, size = 12 }) => owner == null || n == null ? null : (
  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
    {Array.from({ length: 3 }).map((_, k) => <span key={k} style={{ width: size, height: size, borderRadius: size, background: k < n ? PCOL[owner] : 'transparent', border: `2px solid ${PCOL[owner]}`, boxSizing: 'border-box' }} />)}
  </span>);
const BONUS = '#7a5aa6';
const Orders: React.FC<{ beat: Beat }> = ({ beat }) => {
  const face: any[] = beat.state.face || [];
  const hl = beat.events?.find((e: any) => e.t === 'deliver')?.order;
  const joints: any[] = beat.state.joints || [];
  return (<div style={{ position: 'absolute', left: 1070, top: 18, width: 830, height: 220, display: 'flex', gap: 10 }}>
    {face.length === 0 ? (
      <div style={{ flex: 3, background: '#2f6b3a', borderRadius: 12, color: '#fff', fontFamily: JPF, display: 'grid', placeItems: 'center', textAlign: 'center', border: `2px solid ${C.ink}` }}>
        <div><div style={{ fontFamily: ENF, fontWeight: 800, fontSize: 30 }}>ORDERS</div><div style={{ fontSize: 22, marginTop: 6 }}>注文は伏せてある<br />ラウンド3の初めに3枚を表に（山 {beat.state.deck}枚）</div></div>
      </div>) : face.map((f: any) => {
      const o = G.orders[String(f.id)] || {};
      const bonus = o.kind === 'bonus';
      const head = bonus ? BONUS : C.leaf;
      return (<div key={f.id} style={{ flex: 1, background: bonus ? '#f4eefa' : C.paper, border: `2px solid ${hl === f.id ? '#e0a400' : bonus ? BONUS : C.ink}`, borderRadius: 12, overflow: 'hidden', fontFamily: ENF }}>
        <div style={{ background: head, color: '#fff', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }}>
          <span>{bonus ? 'BONUS' : `ORDER #${f.id}`}</span><span style={{ background: C.wheat, color: C.wheatInk, borderRadius: 14, padding: '0 10px', fontFamily: JPF, fontSize: 15 }}>{bonus ? '数×0.2点' : `${o.pts}点`}</span></div>
        <div style={{ padding: '8px 10px', fontSize: 15.5, lineHeight: 1.28, color: C.ink, height: 118, overflow: 'hidden' }}>{o.text}</div>
        <div style={{ padding: '0 10px', display: 'flex', gap: 4, alignItems: 'center', height: 30 }}>
          <span style={{ fontFamily: JPF, fontSize: 13, color: C.muted, border: `1px solid ${C.rule}`, borderRadius: 10, padding: '0 8px' }}>{o.level}</span>
          {o.picture && Object.entries(o.req || {}).flatMap(([k, v]: any) => Array.from({ length: v }).map((_, i) => <Icon key={k + i} id={PICON[k]} size={20} />))}
          <span style={{ marginLeft: 'auto' }}><Tokens owner={f.owner} n={f.tokens} /></span>
        </div>
      </div>);
    })}
    {joints.length ? (<div style={{ flex: 1.35, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {joints.map((j: any) => (<div key={j.id} style={{ flex: 1, background: '#fff8e6', border: `2px solid ${C.wheatInk}`, borderRadius: 10, overflow: 'hidden', fontFamily: ENF }}>
        <div style={{ background: C.wheat, color: C.wheatInk, padding: '2px 8px', fontWeight: 800, fontSize: 13, fontFamily: JPF, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>共同注文 #{j.id}</span>{j.owner != null ? <Tokens owner={j.owner} n={j.tokens} size={11} /> : <span>未着手</span>}</div>
        <div style={{ padding: '2px 8px', fontSize: 11.5, lineHeight: 1.2, color: C.ink, height: 42, overflow: 'hidden' }}>{j.text}</div>
        <div style={{ padding: '2px 6px', display: 'flex', gap: 4 }}>
          {j.lines.map((l: any, k: number) => (<div key={k} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, fontFamily: JPF, background: l.by != null ? PCOL[l.by] : 'transparent', color: l.by != null ? '#fff' : C.ink, border: `1px solid ${l.by != null ? PCOL[l.by] : C.rule}`, borderRadius: 6, padding: '0 3px' }}>
            <Icon id={PICON[l.item]} size={16} /><span style={{ fontFamily: ENF }}>×{l.n}</span><span style={{ opacity: 0.85 }}>{l.pts}点</span>
          </div>))}
        </div>
      </div>))}
    </div>) : null}
  </div>);
};

// ---------- プレイヤー ----------
const Panel: React.FC<{ i: number; beat: Beat; prev: Beat | null }> = ({ i, beat, prev }) => {
  const pl = beat.state.players[i]; const pp = prev?.state.players[i];
  const active = beat.turn?.p === i;
  const ptsUp = pp && pp.pts !== pl.pts;
  const hand = Object.entries(pl.hand || {});
  const prod = Object.entries(pl.prod || {});
  return (<div style={{ position: 'absolute', left: 1070, top: 254 + i * 204, width: 830, height: 192, background: C.paper, borderRadius: 14,
    border: `${active ? 5 : 2}px solid ${active ? PCOL[i] : C.rule}`, boxShadow: active ? `0 0 0 4px ${PCOL[i]}33` : 'none', overflow: 'hidden', fontFamily: JPF }}>
    <div style={{ background: PCOL[i], color: '#fff', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Avatar src={(beat.step && beat.step[1] === i && faceFor(beat.step)) || `faces/${FKEY[i]}_${REST[i]}.png`} size={44} ring="#ffffffcc" />
      <span style={{ fontFamily: ENF, fontWeight: 800, fontSize: 24 }}>{NAMES[i]}</span>
      <span style={{ fontSize: 15, background: '#ffffff33', borderRadius: 10, padding: '1px 10px' }}>英語{LEVELS[i]}</span>
      <span style={{ fontSize: 15, opacity: 0.9 }}>{G.players[i].style}</span>
      <span style={{ marginLeft: 'auto', fontFamily: ENF, fontWeight: 800, fontSize: 30, background: ptsUp ? C.wheat : 'transparent', color: ptsUp ? C.wheatInk : '#fff', borderRadius: 10, padding: '0 10px' }}>{pl.pts}<span style={{ fontSize: 16 }}> / 8点</span></span>
    </div>
    <div style={{ display: 'flex', padding: '8px 14px', gap: 16 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {pl.fields.map((f: any, k: number) => (
          <div key={k} style={{ width: 62, height: 62, borderRadius: 8, background: f ? (f.t === 'crop' ? '#e9ddd0' : '#dcebd8') : 'transparent', border: f ? 'none' : `2px dashed ${C.rule}`, display: 'grid', placeItems: 'center', fontSize: 11, color: C.muted, textAlign: 'center' }}>
            {f ? (f.t === 'crop' ? <div><Icon id="i-grow" size={34} /><div style={{ fontFamily: ENF, color: C.ink }}>{f.c}</div></div>
              : <div><Icon id={f.t === 'cow' ? 'a-cow' : 'a-chicken'} size={36} /><div>{f.t === 'cow' ? '牛' : 'ニワトリ'}</div></div>) : '空き'}
          </div>))}
      </div>
      <div style={{ flex: 1, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 18, color: C.ink, alignItems: 'center' }}>
          <span><Icon id="i-buy" size={22} style={{ verticalAlign: 'middle' }} /> {pl.coins}コイン</span>
          <span>無料券 {pl.tickets}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{prod.length ? prod.map(([k, v]: any) => <span key={k}><Icon id={PICON[k]} size={24} style={{ verticalAlign: 'middle' }} />{v}</span>) : <span style={{ color: C.muted }}>産物なし</span>}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <span style={{ fontSize: 14, color: C.muted, alignSelf: 'center' }}>手札 {pl.handsize}枚</span>
          {hand.map(([k, v]: any) => <span key={k} style={{ fontFamily: ENF, fontSize: 15, background: '#f1f4ee', border: `1px solid ${C.rule}`, borderRadius: 6, padding: '1px 7px', color: C.ink }}>{k}{v > 1 ? ` ×${v}` : ''}</span>)}
        </div>
      </div>
    </div>
  </div>);
};

// ---------- 吹き出し・考え・解説 ----------
const Caption: React.FC<{ beat: Beat; local: number }> = ({ beat, local }) => {
  const st = beat.step; if (!st) return null;
  const pop = spring({ frame: local, fps: FPS, config: { damping: 14, mass: 0.6 } });
  const box: React.CSSProperties = { position: 'absolute', left: 30, top: 760, width: 1000, height: 300, transform: `translateY(${(1 - pop) * 20}px)`, opacity: pop };
  if (st[0] === 'narr') return (<div style={box}><div style={{ background: C.leaf, color: '#fff', borderRadius: 16, padding: '20px 26px', height: 270, boxSizing: 'border-box', display: 'flex', gap: 18 }}>
    <div style={{ fontFamily: ENF, fontWeight: 800, fontSize: 18, background: '#ffffff26', borderRadius: 8, padding: '4px 10px', height: 'fit-content' }}>RULE</div>
    <div style={{ fontFamily: JPF, fontSize: 32, lineHeight: 1.5 }}>{st[1]}</div></div></div>);
  const who = st[1] as number;
  const face = faceFor(st);
  const portrait = face ? <Img src={staticFile(face)} style={{ position: 'absolute', left: 4, bottom: 30, height: 300, zIndex: 2, filter: st[0] === 'think' ? 'saturate(0.85)' : 'none' }} /> : null;
  if (st[0] === 'think') return (<div style={box}>{portrait}<div style={{ background: '#fbfbf7', border: `3px dashed ${PCOL[who]}`, borderRadius: 40, padding: '20px 30px 20px 290px', height: 270, boxSizing: 'border-box' }}>
    <div style={{ fontFamily: JPF, fontSize: 20, color: PCOL[who], fontWeight: 700 }}>{NAMES[who]} の頭の中 <span style={{ color: C.muted, fontWeight: 400 }}>（英語{LEVELS[who]}）</span></div>
    <div style={{ fontFamily: JPF, fontSize: 32, lineHeight: 1.5, color: C.ink, fontStyle: 'italic', marginTop: 8 }}>{st[2]}</div></div></div>);
  if (st[0] === 'say') {
    // 英語で読む台詞（ゲームの中の発言）は英語を大きく、雑談は日本語を大きく
    const en = st[5] !== 'ja';
    const big = en ? st[2] : st[3]; const small = en ? st[3] : st[2];
    return (<div style={box}>{portrait}<div style={{ background: C.paper, border: `4px solid ${PCOL[who]}`, borderRadius: 18, padding: '18px 26px 18px 290px', height: 270, boxSizing: 'border-box', position: 'relative' }}>
      <div style={{ fontFamily: ENF, fontSize: 20, color: PCOL[who], fontWeight: 800 }}>{NAMES[who]}{en ? <span style={{ marginLeft: 12, fontFamily: JPF, fontSize: 16, color: '#fff', background: PCOL[who], borderRadius: 8, padding: '1px 8px' }}>ゲームの発言</span> : null}</div>
      <div style={{ fontFamily: en ? ENF : JPF, fontSize: big.length > 90 ? 28 : en ? 38 : 34, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginTop: 6 }}>{big}</div>
      <div style={{ fontFamily: en ? JPF : ENF, fontSize: 22, color: C.muted, marginTop: 10 }}>{small}</div>
    </div></div>);
  }
  if (st[0] === 'place') return (<div style={box}><div style={{ background: C.paper, border: `3px solid ${PCOL[who]}`, borderRadius: 16, padding: '20px 26px', height: 270, boxSizing: 'border-box', fontFamily: JPF, fontSize: 32, color: C.ink }}>
    {NAMES[who]} が拠点を置く</div></div>);
  return null;
};

// 収入の表示（出目のとき）
const Income: React.FC<{ beat: Beat; local: number }> = ({ beat, local }) => {
  if (beat.kind !== 'roll' || !beat.events) return null;
  const ev = beat.events.filter((e: any) => ['income', 'market_day', 'relief', 'seven_discard', 'harvest', 'milk'].includes(e.t));
  const roll = beat.turn!.roll;
  const lines: string[] = [];
  const inc: Record<number, string[]> = {};
  ev.forEach((e: any) => { if (e.t === 'income' || e.t === 'market_day') (inc[e.p] = inc[e.p] || []).push(e.card); });
  Object.entries(inc).forEach(([p, cs]) => lines.push(`${NAMES[+p]}：${cs.join('、')} カードをもらう`));
  ev.filter((e: any) => e.t === 'seven_discard').forEach((e: any) => lines.unshift(`${NAMES[e.p]}：手札が7枚以上なので ${e.n}枚 捨てる`));
  ev.filter((e: any) => e.t === 'relief').forEach((e: any) => lines.push(`${NAMES[e.p]}：何ももらえなかったので救済で ${e.card} カード`));
  const evAll = beat.events;
  evAll.filter((e: any) => e.t === 'joint_expire').forEach(() => lines.unshift('共同注文が時間切れ。出した人に行の点の半分'));
  evAll.filter((e: any) => e.t === 'order_expire').forEach((e: any) => lines.unshift(`注文 #${e.order} が時間切れで流れた`));
  if (evAll.filter((e: any) => e.t === 'refill').length >= 3) lines.unshift('ラウンド3：伏せていた注文を3枚表にする');
  ev.filter((e: any) => e.t === 'milk').forEach((e: any) => lines.push(`${NAMES[e.p]}：牛のミルク${e.n}本を受け取る`));
  ev.filter((e: any) => e.t === 'harvest').forEach((e: any) => lines.push(`${NAMES[e.p]}：${e.crop} を${e.n}つ収穫`));
  const op = interpolate(local, [18, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (<div style={{ position: 'absolute', left: 30, top: 760, width: 1000, height: 270, background: C.paper, borderRadius: 16, border: `3px solid ${PCOL[beat.turn!.p]}`, padding: '18px 26px', boxSizing: 'border-box', fontFamily: JPF }}>
    <div style={{ fontSize: 30, fontWeight: 800, color: C.ink }}>{NAMES[beat.turn!.p]} の手番　出目 <span style={{ color: roll === 7 ? C.warn : C.leaf, fontFamily: ENF }}>{roll}</span>{roll === 7 ? '　Market day!' : ''}</div>
    <div style={{ opacity: op, marginTop: 10, fontSize: 24, lineHeight: 1.55, color: C.ink }}>{lines.length ? lines.slice(0, 5).map((l, i) => <div key={i}>{l}</div>) : <div style={{ color: C.muted }}>誰もカードをもらえない</div>}</div>
  </div>);
};

// ---------- タイトル・紹介・エンディング ----------
const Title: React.FC<{ local: number }> = ({ local }) => {
  const a = spring({ frame: local, fps: FPS, config: { damping: 12 } });
  return (<AbsoluteFill style={{ background: `linear-gradient(180deg,#e3ece4 0%,#e3ece4 55%,#9cc39a 55%,#7fae7c 100%)`, alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ transform: `scale(${0.8 + 0.2 * a})`, opacity: a, textAlign: 'center' }}>
      <div style={{ fontFamily: '"Arial Black",Impact,sans-serif', fontSize: 170, color: C.ink, letterSpacing: 4 }}>WORD FARM</div>
      <div style={{ fontFamily: JPF, fontSize: 46, color: C.ink, marginTop: 10 }}>4人で遊ぶ　プレイ動画（ルール v0.9）</div>
      <div style={{ fontFamily: JPF, fontSize: 30, color: C.muted, marginTop: 18 }}>英語で交渉し、英文の注文を読んで、農場の産物を届けるボードゲーム</div>
    </div>
  </AbsoluteFill>);
};
const Intro: React.FC<{ local: number }> = ({ local }) => (
  <AbsoluteFill style={{ background: C.bg, padding: 70, fontFamily: JPF }}>
    <div style={{ fontSize: 52, fontWeight: 800, color: C.ink }}>今日のプレイヤー</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 28, marginTop: 40 }}>
      {G.players.map((p: any, i: number) => {
        const a = spring({ frame: local - i * 8, fps: FPS, config: { damping: 12 } });
        return (<div key={i} style={{ background: C.paper, borderRadius: 20, border: `5px solid ${PCOL[i]}`, padding: 30, transform: `translateY(${(1 - a) * 60}px)`, opacity: a }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Img src={staticFile(`faces/${FKEY[i]}_${REST[i]}.png`)} style={{ height: 90 }} /><div style={{ fontFamily: ENF, fontSize: 44, fontWeight: 800, color: PCOL[i] }}>{p.name}</div></div>
          <div style={{ fontSize: 30, marginTop: 14, color: C.ink }}>英語：<b>{p.level}</b></div>
          <div style={{ fontSize: 28, marginTop: 10, color: C.muted, lineHeight: 1.5 }}>{p.style}</div>
        </div>);
      })}
    </div>
    <div style={{ fontSize: 30, color: C.muted, marginTop: 50 }}>自分の手番中に勝利点8点に届いた人の勝ち。交渉と行動の宣言は英語で、そのほかの会話は日本語で。頭の中の考えも一緒にお見せします。</div>
  </AbsoluteFill>
);
const End: React.FC<{ beat: Beat; local: number }> = ({ beat, local }) => {
  // 勝者は点の多さではなく、自分の手番中に8点に届いた人（最後の手番の人）
  const win = G.timeline.filter((r: any) => r.kind === 'turn').slice(-1)[0].p;
  const ps = beat.state.players.map((p: any, i: number) => ({ i, pts: p.pts })).sort((a: any, b: any) => (b.i === win ? 1 : 0) - (a.i === win ? 1 : 0) || b.pts - a.pts);
  const a = spring({ frame: local, fps: FPS, config: { damping: 10 } });
  return (<AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, #fff6d6, ${C.bg})`, alignItems: 'center', justifyContent: 'center', fontFamily: JPF }}>
    <div style={{ fontFamily: ENF, fontSize: 60, fontWeight: 800, color: C.warn, opacity: a }}>WINNER</div>
    <div style={{ fontFamily: ENF, fontSize: 130, fontWeight: 900, color: PCOL[win], transform: `scale(${a})` }}>{NAMES[win]}</div>
    <div style={{ display: 'flex', gap: 30, marginTop: 40 }}>
      {ps.map((p: any, k: number) => <div key={p.i} style={{ background: C.paper, border: `4px solid ${PCOL[p.i]}`, borderRadius: 16, padding: '16px 30px', fontSize: 30, textAlign: 'center' }}>
        <div style={{ fontFamily: ENF, fontWeight: 800, color: PCOL[p.i] }}>{p.i === win ? '勝ち' : `${k + 1}位`} {NAMES[p.i]}</div><div style={{ fontSize: 40, fontWeight: 800 }}>{p.pts}点</div></div>)}
    </div>
    <div style={{ position: 'absolute', bottom: 40, fontSize: 22, color: C.muted, opacity: a, textAlign: 'center', lineHeight: 1.6 }}>BGM：甘茶の音楽工房　音楽：魔王魂　効果音：効果音ラボ、Pixabay<br />音声：Microsoft Edge 読み上げ（edge-tts）</div>
  </AbsoluteFill>);
};

// ---------- 本体 ----------
export const Main: React.FC<{ voice: PlayVoice }> = ({ voice }) => {
  const frame = useCurrentFrame();
  const { beats, total } = useMemo(() => buildBeats(voice), [voice]);
  let bi = beats.findIndex(b => frame >= b.start && frame < b.start + b.dur);
  if (bi < 0) bi = beats.length - 1;
  const beat = beats[bi]; const local = frame - beat.start; const prev = bi > 0 ? beats[bi - 1] : null;
  const defs = <svg width={0} height={0} style={{ position: 'absolute' }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
  // 台詞の音声（英語 → 日本語）。画面の切り替えとは別に、時間割どおりに鳴らす
  const audio = beats.flatMap((b, k) => (b.clips || []).map((c, n) => <Sequence key={`v${k}-${n}`} from={b.start + c.at} durationInFrames={c.len + 2} layout="none"><Audio src={staticFile(c.file)} /></Sequence>))
    .concat(<Sound key="sound" beats={beats} total={total} />);
  if (beat.kind === 'title') return <AbsoluteFill style={VARS}>{defs}{audio}<Title local={local} /></AbsoluteFill>;
  if (beat.kind === 'intro') return <AbsoluteFill style={VARS}>{defs}{audio}<Intro local={local} /></AbsoluteFill>;
  if (beat.kind === 'end') return <AbsoluteFill style={VARS}>{defs}{audio}<End beat={beat} local={local} /></AbsoluteFill>;
  const t = beat.turn;
  return (<AbsoluteFill style={{ ...VARS, background: C.bg }}>
    {defs}
    {audio}
    <div style={{ position: 'absolute', left: 30, top: 18, width: 1000, height: 66, display: 'flex', alignItems: 'center', gap: 18, fontFamily: JPF }}>
      <span style={{ fontFamily: '"Arial Black",Impact,sans-serif', fontSize: 40, color: C.ink }}>WORD FARM</span>
      <span style={{ fontSize: 26, color: C.muted }}>{beat.inSetup ? '準備' : t ? `ラウンド${t.round}　${NAMES[t.p]} の手番` : 'まとめ'}</span>
      {beat.scene === 'end' && <span style={{ marginLeft: 'auto', fontSize: 17, color: C.muted, lineHeight: 1.35, textAlign: 'right' }}>BGM：甘茶の音楽工房　音楽：魔王魂<br />効果音：効果音ラボ、Pixabay　音声：edge-tts</span>}
    </div>
    <Board beat={beat} local={local} />
    <Dice beat={beat} local={local} />
    <Orders beat={beat} />
    {[0, 1, 2, 3].map(i => <Panel key={i} i={i} beat={beat} prev={prev} />)}
    {beat.kind === 'roll' ? <Income beat={beat} local={local} /> : <Caption beat={beat} local={local} />}
  </AbsoluteFill>);
};
