// プレイ動画の台詞の音声を edge-tts で作る
// 使い方: npm run tts:play （先に sim/scenario_run.py で public/game.json を作っておく）
// 読むのは台詞（say）だけ。考え（think）とナレーション（narr）は読まない
// 読む言語が 'en' の台詞（交渉・行動の宣言・注文の読み上げ）は英語 → 日本語の順に2つ、'ja' の台詞は日本語だけ
// 出力: public/voice_play/<hash>.mp3 と public/voice_play/manifest.json（キーは「人|英語|日本語」、値は {en?, ja}）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reading } from './readings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'voice_play');
const G = JSON.parse(readFileSync(join(ROOT, 'public', 'game.json'), 'utf8'));

// 声（席の順：Aki、Ben、Dan、Chika）。英語も日本語も、その人の同じ声で読む
// プレイ動画は長いので、ルール説明動画より全員15%速くしてある
const VOICES = {
  Aki: { voice: 'de-DE-SeraphinaMultilingualNeural', rate: '+25%', pitch: '+5Hz' },
  Ben: { voice: 'it-IT-GiuseppeMultilingualNeural', rate: '+15%', pitch: '+0Hz' },
  Dan: { voice: 'fr-FR-RemyMultilingualNeural', rate: '+15%', pitch: '+0Hz' },
  Chika: { voice: 'ja-JP-NanamiNeural', rate: '+23%', pitch: '+25Hz' },
};

const py = existsSync(join(ROOT, '.venv', 'Scripts', 'python.exe')) ? join(ROOT, '.venv', 'Scripts', 'python.exe')
  : existsSync(join(ROOT, '.venv', 'bin', 'python')) ? join(ROOT, '.venv', 'bin', 'python') : 'python';
const remotion = join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const probe = (file) => {
  const out = execFileSync(process.execPath, [remotion, 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const sec = parseFloat(out.trim().split(/\s+/).pop());
  if (!(sec > 0)) throw new Error(`長さを取得できない: ${file}\n${out}`);
  return sec;
};

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const known = new Map(Object.values(old).flatMap((m) => [m.en, m.ja]).filter(Boolean).map((c) => [c.file.replace('voice_play/', ''), c.sec]));

let made = 0;
const synth = (v, text, label) => {
  const hash = createHash('sha1').update(JSON.stringify([v, text])).digest('hex').slice(0, 12);
  const file = `${hash}.mp3`;
  const path = join(OUT, file);
  // 前回が途中で止まって壊れたファイル（長さを読めない）は作り直す
  if (existsSync(path) && !known.has(file)) { try { probe(path); } catch { rmSync(path); } }
  if (!existsSync(path)) {
    // edge-tts がまれに空のファイルを返すので、そのときは3回まで作り直す
    for (let k = 0; k < 3 && !(existsSync(path) && statSync(path).size > 0); k++) {
      execFileSync(py, ['-m', 'edge_tts', '--voice', v.voice, `--rate=${v.rate}`, `--pitch=${v.pitch}`, '--text', text, '--write-media', path], { stdio: 'inherit' });
    }
    if (statSync(path).size === 0) { rmSync(path); throw new Error(`音声が空のまま: ${label}`); }
    made++;
    console.log(label);
  }
  const sec = known.get(file) ?? probe(path);
  return { file: `voice_play/${file}`, sec: Math.round(sec * 1000) / 1000 };
};

// 台本の全ステップから台詞を集める（準備・手番・終わり）
const steps = G.timeline.flatMap((rec) => rec.kind === 'turn' ? rec.steps.map((x) => x.st) : (rec.steps || []));
const names = G.players.map((p) => p.name);
const manifest = {};
for (const st of steps) {
  if (st[0] !== 'say') continue;
  const [, who, en, ja, , lang] = st;
  const name = names[who];
  const key = `${who}|${en}|${ja}`;
  if (manifest[key]) continue;
  const v = VOICES[name];
  const m = {};
  if (lang === 'en') m.en = synth(v, en, `${name} (英語) ${en}`);
  m.ja = synth(v, reading(ja), `${name} ${ja}`);
  manifest[key] = m;
}

// 使わなくなった音声を消す
const used = new Set(Object.values(manifest).flatMap((m) => [m.en?.file, m.ja.file]).filter(Boolean).map((f) => f.replace('voice_play/', '')));
for (const f of readdirSync(OUT)) if (f.endsWith('.mp3') && !used.has(f)) rmSync(join(OUT, f));

writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
const total = Object.values(manifest).reduce((s, m) => s + m.ja.sec + (m.en?.sec ?? 0), 0);
console.log(`完了: 台詞${Object.keys(manifest).length}行（新規の音声 ${made}）、音声の合計 ${Math.floor(total / 60)}分${Math.round(total % 60)}秒`);
