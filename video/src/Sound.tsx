// プレイ動画の BGM と効果音（素材と出典は art/sound_licenses.md）
// BGM は場面（Beat.scene）ごとに切り替えてループし、台詞の間は音量を下げる
// 効果音はビートの出来事（events）から1つだけ選んで鳴らす
import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { Beat, FPS } from './timeline';

const BGM_VOL = 0.16; // 台詞がないとき
const BGM_DUCK = 0.06; // 台詞の間
const DUCK_RAMP = 8; // 音量を上げ下げするフレーム数
const FADE = FPS; // 場面の切り替えのフェード（1秒）
const SE_VOL = 0.45;
const JINGLE = 4.5; // 勝利のジングルが鳴り終わるまで（秒）。ファイルは7.6秒だが、4.5秒より後は無音。締めの BGM はこのあとに始める
// 曲の頭の無音と終わりのフェードアウトを除いた、ループに使う区間（秒）。そのままループすると数秒の無音ができる
// 値は ffmpeg の silencedetect（-50dB）で測った。終わりはフェードが始まる少し前で切る
const LOOP: Record<string, [number, number]> = {
  setup: [0.55, 114.5], early: [0.55, 97.5], middle: [0.55, 99.5], final: [0.56, 130.5], end: [0.57, 116],
};
const XF = Math.round(1.5 * FPS); // ループのつなぎ目で重ねるフレーム数

// 出来事 → 効果音。ビートに複数あれば、先に書いたものを優先する
const SE_OF: [string, string][] = [
  ['win', 'fanfare'], ['deliver', 'deliver'], ['joint_done', 'deliver'], ['joint_line', 'deliver'],
  ['market_day', 'market_day'], ['order_expire', 'expire'], ['joint_expire', 'expire'], ['misread', 'expire'],
  ['trade', 'trade'], ['house', 'trade'], ['plant', 'plant'], ['harvest', 'harvest'],
  ['market', 'coin'], ['coinbank', 'coin'], ['bank', 'coin'], ['jp_pay', 'coin'],
  ['buy', 'card'], ['ticket', 'card'], ['income', 'card'], ['relief', 'card'],
];

function seFor(b: Beat): string | null {
  const ts = new Set((b.events || []).map((e: any) => e.t));
  for (const [t, se] of SE_OF) if (ts.has(t)) return se;
  return null;
}

// 台詞が鳴っているフレームを数え、BGM の音量の包絡を作る
function duckEnvelope(beats: Beat[], total: number): Float32Array {
  const on = new Uint8Array(total + 1);
  for (const b of beats) for (const c of b.clips || []) for (let f = b.start + c.at; f < Math.min(total, b.start + c.at + c.len); f++) on[f] = 1;
  const env = new Float32Array(total + 1);
  // 話し始める少し前から下げ、話し終えてから戻す
  let lv = 0;
  for (let f = total; f >= 0; f--) { lv = on[f] ? 1 : Math.max(0, lv - 1 / DUCK_RAMP); env[f] = lv; }
  lv = 0;
  for (let f = 0; f <= total; f++) { lv = on[f] ? 1 : Math.max(0, lv - 1 / DUCK_RAMP); env[f] = Math.max(env[f], lv); }
  return env;
}

export const Sound: React.FC<{ beats: Beat[]; total: number }> = ({ beats, total }) => {
  const env = React.useMemo(() => duckEnvelope(beats, total), [beats, total]);

  // 場面が続く区間ごとに BGM を1本
  const segs: { scene: string; from: number; to: number }[] = [];
  for (const b of beats) {
    const last = segs[segs.length - 1];
    if (last && last.scene === b.scene) last.to = b.start + b.dur;
    else segs.push({ scene: b.scene, from: b.start, to: b.start + b.dur });
  }
  const bgm = segs.map((s) => {
    const from = s.scene === 'end' ? s.from + Math.round(JINGLE * FPS) : s.from;
    const len = s.to - from;
    if (len <= 0) return null;
    // 場面の頭と終わりのフェードと、台詞の下での音量の下げ（f は場面の頭からのフレーム）
    const vol = (f: number) => {
      const fade = Math.min(1, f / FADE, (len - f) / FADE);
      const d = env[from + f] ?? 0;
      return Math.max(0, fade) * (BGM_VOL + (BGM_DUCK - BGM_VOL) * d);
    };
    // 曲の区間を、つなぎ目を XF フレーム重ねながら並べる
    const [a, b] = LOOP[s.scene];
    const body = Math.round((b - a) * FPS);
    const out: React.ReactNode[] = [];
    for (let k = 0, at = 0; at < len; k++, at += body - XF) {
      const n = Math.min(body, len - at);
      const first = k === 0, last = at + body >= len;
      const v = (f: number) => {
        const xin = first ? 1 : Math.min(1, f / XF);
        const xout = last ? 1 : Math.min(1, (body - f) / XF);
        return Math.max(0, Math.min(xin, xout)) * vol(at + f);
      };
      out.push(<Sequence key={`bgm-${s.scene}-${s.from}-${k}`} from={from + at} durationInFrames={n} layout="none"><Audio src={staticFile(`audio/bgm/${s.scene}.mp3`)} trimBefore={Math.round(a * FPS)} volume={v} /></Sequence>);
    }
    return out;
  });

  // 効果音：ダイスは出目のビートの頭、出来事は収入の表示（18フレーム目）か行動の直後に
  const se: React.ReactNode[] = [];
  const add = (name: string, at: number, key: string) => se.push(<Sequence key={key} from={at} durationInFrames={Math.round(8 * FPS)} layout="none"><Audio src={staticFile(`audio/se/${name}.mp3`)} volume={SE_VOL} /></Sequence>);
  beats.forEach((b, k) => {
    if (b.kind === 'roll') add('dice', b.start, `dice-${k}`);
    if (b.kind === 'end') add('win_jingle', b.start, `jingle-${k}`);
    const name = seFor(b);
    if (name) add(name, b.start + (b.kind === 'roll' ? 18 : 3), `se-${k}`);
  });

  return <>{bgm}{se}</>;
};
