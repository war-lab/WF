// game.json（台本をエンジンで実行した結果）から、プレイ動画の時間割（ビート）を組み立てる
// 台詞は音声（public/voice_play/manifest.json、npm run tts:play で作る）の長さに合わせる。考えと解説は文字数から読む時間を決める
import { staticFile } from 'remotion';
import game from '../public/game.json';

export const FPS = 30;
export const G: any = game;
export const NAMES: string[] = G.players.map((p: any) => p.name);

// 台詞の音声：キーは「人|英語|日本語」。'en' の台詞は英語 → 日本語の順に鳴らす
type Clip = { file: string; sec: number };
export type PlayVoice = Record<string, { en?: Clip; ja: Clip }> | null;
export const voiceKey = (st: any[]) => `${st[1]}|${st[2]}|${st[3]}`;

// BGM の区切り（scene）：準備・序盤（R1〜R2）・中盤（R3〜R8）・最終ラウンド（R9）・締め
export type Scene = 'setup' | 'early' | 'middle' | 'final' | 'end';

export type Beat = {
  start: number;
  dur: number;
  kind: 'title' | 'intro' | 'step' | 'roll' | 'end';
  scene: Scene;
  step?: any[];
  events?: any[];
  state: any;
  turn?: { idx: number; p: number; round: number; roll: number; dice: number[] };
  placed: { p: number; v: number }[];
  inSetup: boolean;
  clips?: { file: string; at: number; len: number }[];
};

const sec = (s: number) => Math.round(s * FPS);
const len = (t: string) => (t || '').length;
const LEAD = 5; // 吹き出しが出てから話し始めるまで（フレーム）
const GAP = 0.3; // 英語と日本語のあいだ（秒）
const TAIL = 0.45; // 話し終えてから次のステップまで（秒）

// 台詞は音声の長さ、考えと解説は文字数で決める
function timing(step: any[], hasEvents: boolean, voice: PlayVoice): { dur: number; clips?: Beat['clips'] } {
  const k = step[0];
  if (k === 'say') {
    const v = voice?.[voiceKey(step)];
    if (v) {
      const clips: NonNullable<Beat['clips']> = [];
      let at = LEAD;
      for (const c of [v.en, v.ja].filter(Boolean) as Clip[]) { const l = Math.round(FPS * c.sec); clips.push({ file: c.file, at, len: l }); at += l + Math.round(FPS * GAP); }
      const last = clips[clips.length - 1];
      return { dur: last.at + last.len + sec(TAIL), clips };
    }
    return { dur: sec(Math.min(7, 1.4 + len(step[2]) / 18 + len(step[3]) / 12)) };
  }
  if (k === 'narr') return { dur: sec(Math.min(7.5, 1.6 + len(step[1]) / 12)) };
  if (k === 'think') return { dur: sec(Math.min(6.5, 1.4 + len(step[2]) / 12)) };
  if (k === 'place') return { dur: sec(0.9) };
  if (k === 'cmd') return { dur: sec(hasEvents ? 0.9 : 0.4) };
  return { dur: sec(2) };
}

const sceneOf = (round: number): Scene => (round <= 2 ? 'early' : round >= 9 ? 'final' : 'middle');

export function buildBeats(voice: PlayVoice = null): { beats: Beat[]; total: number } {
  const beats: Beat[] = [];
  let t = 0;
  const push = (b: Omit<Beat, 'start'>) => { beats.push({ ...b, start: t }); t += b.dur; };
  const tl = G.timeline;
  const setup = tl[0];
  const placed: { p: number; v: number }[] = [];
  const emptyState = JSON.parse(JSON.stringify(setup.state));
  emptyState.players.forEach((p: any) => { p.bases = []; });

  push({ kind: 'title', scene: 'setup', dur: sec(4.5), state: emptyState, placed: [], inSetup: true });
  push({ kind: 'intro', scene: 'setup', dur: sec(8), state: emptyState, placed: [], inSetup: true });
  for (const st of setup.steps) {
    if (st[0] === 'place') placed.push({ p: st[1], v: st[2] });
    push({ kind: 'step', scene: 'setup', step: st, ...timing(st, false, voice), state: setup.state, placed: [...placed], inSetup: true });
  }
  for (const rec of tl.slice(1)) {
    if (rec.kind === 'turn') {
      const round = rec.state_after_start.round;
      const turn = { idx: rec.idx, p: rec.p, round, roll: rec.roll, dice: rec.dice || [1, rec.roll - 1] };
      const scene = sceneOf(round);
      push({ kind: 'roll', scene, dur: sec(2.6), events: rec.start_events, state: rec.state_after_start, turn, placed: [], inSetup: false });
      for (const s of rec.steps) {
        const ev = s.events || [];
        push({ kind: 'step', scene, step: s.st, events: ev, ...timing(s.st, ev.length > 0, voice), state: s.state, turn, placed: [], inSetup: false });
      }
    } else if (rec.kind === 'outro') {
      push({ kind: 'end', scene: 'end', dur: sec(6), state: rec.state, placed: [], inSetup: false });
      for (const st of rec.steps) push({ kind: 'step', scene: 'end', step: st, ...timing(st, false, voice), state: rec.state, placed: [], inSetup: false });
    }
  }
  return { beats, total: t };
}

// 音声の一覧を読む（なければ null で、文字数から決めた長さのまま動く）
export async function loadPlayVoice(): Promise<PlayVoice> {
  try {
    const r = await fetch(staticFile('voice_play/manifest.json'));
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
