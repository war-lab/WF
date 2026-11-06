// 記録の検証の道具（BD05 5.4）。写しを含めて取り出した記録（GET /api/rooms/<roomId>/record?states=1）を読み、
// 記録を先頭から再適用して各行の写しと比べる。エンジンを直したあとに、過去の記録で判定が変わらないかを確かめるのに使う。
//
//   node tools/verify.ts <record.json>
//
// 食い違いがあれば、その行の seq と最初に違った項目を出し、終了コード1で終える。
import { readFileSync } from "node:fs";
import { verifyRecord, type RecordFile } from "../src/record.ts";

const file = process.argv[2];
if (!file) {
  console.error("使い方: node tools/verify.ts <record.json>");
  process.exit(2);
}
const rec = JSON.parse(readFileSync(file, "utf8")) as RecordFile;
if (rec.commands.some((r) => r.state === undefined)) {
  console.error("写し（state）を含まない記録です。?states=1 で取り出してください");
  process.exit(2);
}
const v = verifyRecord(rec);
for (const m of v.mismatches) console.log(`seq ${m.seq}: ${m.detail}`);
console.log(`${v.checked}行を比べ、食い違い ${v.mismatches.length}件（記録のエンジンの版 ${rec.meta.engineVersion}）`);
process.exitCode = v.ok ? 0 : 1;
