// ルール説明動画の音声を edge-tts で作る
// 使い方: npm run tts （video/.venv に edge-tts を入れておく。なければ PATH の python を使う）
// 出力: public/voice/<hash>.mp3 と public/voice/manifest.json（台本の行順に {file, sec, en?, enFirst?}）
// en がある行は、英文も読む（en: {file, sec}）。英語 → 日本語の順で、声は同じ。台詞が英文で始まる行は、英語のあとに残りの日本語だけを読む
// 台詞・声・読み替えが変わっていない行は作り直さない
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reading } from './readings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'voice');
const { GUIDE } = await import('../src/guideScript.ts');

// 声（Aki は多言語対応の Seraphina を少し速めに。Chika は Nanami を高く・少し速くして妹らしくする）
const VOICES = {
  a: { voice: 'de-DE-SeraphinaMultilingualNeural', rate: '+10%', pitch: '+5Hz' },
  c: { voice: 'ja-JP-NanamiNeural', rate: '+8%', pitch: '+25Hz' },
};

// 誤読しやすい語の読み替えは readings.mjs（プレイ動画と共通）

// 英文（en）がある行は、英語 → 日本語の順に読む
const READ_EN = true;
// 英文を読むときも、日本語と同じ声を使う（声が変わると別の人に聞こえるため）
const EN_VOICES = VOICES;
// 英文の記号の読み替え
const EN_READ = [['／', ','], ['“', ''], ['”', '']];
const enReading = (t) => EN_READ.reduce((s, [a, b]) => s.split(a).join(b), t);

const py = existsSync(join(ROOT, '.venv', 'Scripts', 'python.exe')) ? join(ROOT, '.venv', 'Scripts', 'python.exe')
  : existsSync(join(ROOT, '.venv', 'bin', 'python')) ? join(ROOT, '.venv', 'bin', 'python') : 'python';
const remotion = join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

// 音声の長さ（秒）を ffprobe（Remotion 同梱）で測る
const probe = (file) => {
  const out = execFileSync(process.execPath, [remotion, 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const sec = parseFloat(out.trim().split(/\s+/).pop());
  if (!(sec > 0)) throw new Error(`長さを取得できない: ${file}\n${out}`);
  return sec;
};

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const known = new Map(old.flatMap((m) => [m.file && [m.file.replace('voice/', ''), m.sec], m.en && [m.en.file.replace('voice/', ''), m.en.sec]].filter(Boolean)));

const manifest = [];
let made = 0;
// 1つの音声を作る（同じ声・同じ文はファイル名が同じになるので作り直さない）
const synth = (v, text, label) => {
  const hash = createHash('sha1').update(JSON.stringify([v, text])).digest('hex').slice(0, 12);
  const file = `${hash}.mp3`;
  const path = join(OUT, file);
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
  return { file: `voice/${file}`, sec: Math.round(sec * 1000) / 1000 };
};

for (const [i, l] of GUIDE.entries()) {
  let ja = l.t;
  const en = READ_EN ? l.en : null;
  let enFirst = !!en;
  // 台詞が英文で始まるなら、英文は英語の声で先に読み、日本語の声は残りだけを読む
  if (en && l.t.startsWith(en)) { ja = l.t.slice(en.length).replace(/^[\s…]+/, ''); enFirst = true; }
  const m = {};
  if (ja.trim()) Object.assign(m, synth(VOICES[l.w], reading(ja), `[${i + 1}/${GUIDE.length}] ${l.w} ${ja}`));
  else { m.file = null; m.sec = 0; }
  if (en) { m.en = synth(EN_VOICES[l.w], enReading(en), `[${i + 1}/${GUIDE.length}] ${l.w} (英語) ${en}`); if (enFirst) m.enFirst = true; }
  manifest.push(m);
}

// 使わなくなった音声を消す
const used = new Set(manifest.flatMap((m) => [m.file, m.en?.file]).filter(Boolean).map((f) => f.replace('voice/', '')));
for (const f of readdirSync(OUT)) if (f.endsWith('.mp3') && !used.has(f)) rmSync(join(OUT, f));

writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
const total = manifest.reduce((s, m) => s + m.sec + (m.en?.sec ?? 0), 0);
console.log(`完了: ${manifest.length}行（新規 ${made}）、音声の合計 ${Math.floor(total / 60)}分${Math.round(total % 60)}秒`);
