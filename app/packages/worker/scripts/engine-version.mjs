// エンジンの版を作る（BD05 2.2）。エンジンのパッケージの版と、app/packages/engine/src の全ファイルから求めたハッシュの先頭8文字。
// 画面や Worker だけを直したデプロイでは変わらず、エンジンのソースを変えたときだけ変わる（BD05 2.10）。
//   node scripts/engine-version.mjs   src/engine-version.ts を書く
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, "../../engine");
const src = join(engine, "src");

function walk(d) {
  return readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    .sort();
}

const h = createHash("sha256");
for (const f of walk(src)) {
  // 改行の違い（CRLF と LF）で版が変わらないようにそろえる
  h.update(relative(src, f).replaceAll("\\", "/"));
  h.update("\0");
  h.update(readFileSync(f, "utf8").replaceAll("\r\n", "\n"));
  h.update("\0");
}
const pkg = JSON.parse(readFileSync(join(engine, "package.json"), "utf8"));
const version = `${pkg.version ?? "0.0.0"}+${h.digest("hex").slice(0, 8)}`;
writeFileSync(
  resolve(here, "../src/engine-version.ts"),
  `// scripts/engine-version.mjs が書くファイル。手で直さない\nexport const ENGINE_VERSION = ${JSON.stringify(version)};\n`,
);
console.log(`engine version ${version}`);
