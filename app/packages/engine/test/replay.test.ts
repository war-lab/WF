// 模擬との照合（BD06 5.5）の回帰テスト。sim/record.py で記録した8局を、エンジンで再適用して手番ごとに比べる。
// 照合の本番（人数ごとに1600局）は python が要るため、npm run compare で別に回す。ここは python なしで回せる分だけを持つ。
// 記録は APPRULES=1 の模擬で作った。模擬のボットかルールを変えたら、記録を作り直す（BD06 5.5）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { replay, type SimRecord } from "../tools/replay.ts";

const dir = join(import.meta.dirname, "fixtures", "sim");
const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort();

describe("模擬の記録の再適用（TC-CMP-01）", () => {
  it("記録が8局ある", () => expect(files).toHaveLength(8));
  for (const f of files) {
    it(f, () => {
      const r = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")) as SimRecord;
      const res = replay(r);
      expect(res.what ?? "", `${res.where}`).toBe("");
      expect(res.turns).toBe(r.turns.length);
    });
  }
});
