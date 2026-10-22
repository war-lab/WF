// 長い動画を区間に分けて書き出し、最後につなぐ
// 使い方: node scripts/render_parts.mjs <コンポジション名> <出力ファイル>
//   例: node scripts/render_parts.mjs WordFarm out/word_farm.mp4
//   2つで並べる: 同じコマンドをもう1つ、末尾に --reverse をつけて起動する
// 映像は区間ごとに無音で書き出し、out/parts/ に置く。書き出し済みの区間は飛ばすので、止まっても続きから再開できる
// 音声は区切りでずれないよう、全体を1本で書き出す。最後に映像をつなぎ、音声と合わせる
// 同時にいくつ起動してもよい。区間はロックファイルで取り合い、全部そろった時点で最後のプロセスがつなぐ
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [id = 'WordFarm', outArg = 'out/word_farm.mp4'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = resolve(ROOT, outArg);
const PARTS = join(ROOT, 'out', 'parts', id);
const CHUNK = 6000; // 1区間のフレーム数（30fps で約3分20秒）
const RETRY = 2; // 区間ごとの再試行の回数
const OPTS = { concurrency: 4, timeoutInMilliseconds: 120000 };

const remotion = join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const ffmpeg = (args) => execFileSync(process.execPath, [remotion, 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

mkdirSync(PARTS, { recursive: true });
console.log('バンドル中…');
const serveUrl = await bundle({ entryPoint: join(ROOT, 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id });
const total = composition.durationInFrames;
const n = Math.ceil(total / CHUNK);
console.log(`${id}: ${total} フレーム（${(total / composition.fps).toFixed(1)} 秒）を ${n} 区間に分ける`);

// 区間を確保する。ロックを持つプロセスが止まっていれば奪う
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const claim = (lock) => {
  for (let k = 0; k < 2; k++) {
    try { const fd = openSync(lock, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return true; } catch {}
    const pid = parseInt(readFileSync(lock, 'utf8'), 10);
    if (pid && alive(pid)) return false;
    rmSync(lock, { force: true });
  }
  return false;
};

// 一時ファイルに書いてから名前を変える。途中で止まった区間は残らない
const renderTo = async (file, extra, label) => {
  if (existsSync(file)) { console.log(`${label}: 書き出し済み`); return; }
  const lock = file + '.lock';
  if (!claim(lock)) { console.log(`${label}: 別のプロセスが書き出し中`); return; }
  try { await renderOne(file, extra, label); } finally { rmSync(lock, { force: true }); }
};
const renderOne = async (file, extra, label) => {
  const tmp = file.replace(/(\.\w+)$/, '.tmp$1');
  for (let k = 0; ; k++) {
    try {
      let last = -1;
      await renderMedia({
        serveUrl, composition, outputLocation: tmp, ...OPTS, ...extra,
        onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`${label}: ${p * 10}%`); } },
      });
      renameSync(tmp, file);
      return;
    } catch (e) {
      rmSync(tmp, { force: true });
      if (k >= RETRY) throw e;
      console.log(`${label}: 失敗したので再試行（${k + 1}/${RETRY}）: ${e.message.split('\n')[0]}`);
    }
  }
};

// --reverse をつけたプロセスは後ろの区間から取る（2つ起動するときの片方に使う）
const reverse = process.argv.includes('--reverse');
const parts = Array.from({ length: n }, (_, i) => {
  const a = i * CHUNK, b = Math.min(total, a + CHUNK) - 1;
  return { i, a, b, file: join(PARTS, `part${String(i).padStart(2, '0')}_${a}-${b}.mp4`) };
});
const files = parts.map((x) => x.file);
const audio = join(PARTS, 'audio.wav');
if (reverse) await renderTo(audio, { codec: 'wav' }, '音声');
for (const x of reverse ? [...parts].reverse() : parts) await renderTo(x.file, { codec: 'h264', muted: true, frameRange: [x.a, x.b] }, `映像 ${x.i + 1}/${n}`);
if (!reverse) await renderTo(audio, { codec: 'wav' }, '音声');

// 全部そろっていなければ、ほかのプロセスに任せて終わる
if (![...files, audio].every(existsSync)) { console.log('ほかのプロセスの区間が残っているので、つなぐのは任せる'); process.exit(0); }
if (!claim(OUT + '.lock')) { console.log('別のプロセスがつないでいる'); process.exit(0); }
if (existsSync(OUT)) rmSync(OUT);
console.log('つないで音声と合わせる…');
const list = join(PARTS, 'list.txt');
writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n');
const video = join(PARTS, 'video.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
mkdirSync(dirname(OUT), { recursive: true });
ffmpeg(['-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT]);
rmSync(OUT + '.lock', { force: true });
console.log(`完了: ${OUT}`);
