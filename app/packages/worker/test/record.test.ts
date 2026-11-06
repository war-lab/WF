// 記録の検証と書き出し（BD06 TC-SRV-19〜19d、BD05 5章）
import { describe, expect, it } from "vitest";
import { apply, board, legalActions, type GameState } from "@word-farm/engine";
import type { BoardView } from "@word-farm/protocol";
import { buildExport, verifyRecord, type RecordFile } from "@word-farm/protocol/record";
import { finishSetup, startTable, type Table } from "./harness.ts";

const state = (t: Table): GameState => t.srv.core.debugState().state!;

async function answerAll(t: Table): Promise<void> {
  for (let g = 0; g < 20; g++) {
    const s = state(t);
    const p = s.prompts.find((x) => !s.answers[x.id]);
    if (!p) return;
    if (p.k === "chooseKind") {
      await t.srv.cmd(t.seats[p.seat]!, { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array(p.count).fill(p.options[0]) } });
    } else {
      const cards: Record<string, number> = {};
      let left = p.count;
      for (const [k, v] of Object.entries(s.players[p.seat]!.hand)) {
        const n = Math.min(v!, left);
        if (n > 0) cards[k] = n;
        left -= n;
      }
      await t.srv.cmd(t.seats[p.seat]!, { t: "answerPrompt", promptId: p.id, answer: { k: "discard", cards } });
    }
  }
}

function seedNumber(s: GameState, seat: number): number | null {
  for (const v of s.players[seat]!.houses) {
    for (const tid of board.vertices[v]!.tiles) {
      const tile = s.board.tiles[tid]!;
      if (tile.kind === "seed" && tile.number !== null && tile.number !== 7) return tile.number;
    }
  }
  return null;
}

/** 数手番を進め、行動、日本語の支払い、取り消し2回を含む記録を作り、局を打ち切る */
async function playRecord(): Promise<{ t: Table; rec: RecordFile }> {
  const t = await startTable();
  await finishSetup(t);
  for (let turn = 0; turn < 8; turn++) {
    const seat = state(t).turn!.seat;
    const c = t.seats[seat]!;
    await t.srv.tick(1000);
    // 手番の人の拠点に接する seed のタイルの数を出目にし、作物のカードが入るようにする（植え付けを起こすため）
    const sum = seedNumber(state(t), seat) ?? 3 + (turn % 3);
    const a = Math.min(6, sum - 1);
    await t.srv.cmd(c, { t: "inputDice", a, b: sum - a });
    await answerAll(t);
    const L = legalActions(state(t), seat);
    const plant = L.plant.find((h) => h.enabled);
    if (plant) await t.srv.send(c, { t: "cmd", id: (await import("./harness.ts")).seqHex(), cmd: { t: "plant", crop: plant.value }, meta: { sentenceShown: turn % 2 === 0 } });
    if (turn === 2) await t.srv.cmd(t.seats[(seat + 1) % 4]!, { t: "payJapanese", kind: "word", method: "ticket" });
    if (turn === 4 || turn === 5) {
      // 最後の行を取り消す（行動か日本語の支払いか、手番の始まり）
      await t.srv.admin(t.board, { k: "undoLast", seq: (t.board.last("view").view as BoardView).lastCommand!.seq });
    }
    await t.srv.cmd(t.seats[state(t).turn!.seat]!, { t: "endTurn" });
  }
  await t.srv.admin(t.board, { k: "abortGame" });
  const r = t.srv.core.record(true);
  if (!r.ok) throw new Error("記録を取り出せない");
  return { t, rec: r.body as RecordFile };
}

describe("記録の検証（TC-SRV-19、19b）", () => {
  it("TC-SRV-19b 取り消しを2回含む記録で、検証の道具が食い違いを報告しない", async () => {
    const { rec } = await playRecord();
    expect(rec.commands.filter((r) => r.undo !== null)).toHaveLength(2);
    const v = verifyRecord(rec);
    expect(v.mismatches).toEqual([]);
    expect(v.checked).toBe(rec.commands.length);
  });

  it("TC-SRV-19 試験用に変えたエンジンで、検証の道具が食い違いを報告する", async () => {
    const { rec } = await playRecord();
    // 植えるたびにコインを1枚多く渡す、誤ったエンジン
    const bad: typeof apply = (s, a, c) => {
      const r = apply(s, a, c);
      if (r.ok && c.t === "plant") r.state.players[r.state.turn!.seat]!.coins += 1;
      return r;
    };
    const v = verifyRecord(rec, bad);
    expect(v.ok).toBe(false);
    expect(v.mismatches[0]!.detail).toContain("coins");
  });

  it("TC-SRV-19 写しを書き換えた記録も、食い違いとして報告する", async () => {
    const { rec } = await playRecord();
    const row = rec.commands[5]!;
    row.state!.players[0]!.halfPoints += 2;
    const v = verifyRecord(rec);
    expect(v.mismatches.map((m) => m.seq)).toContain(row.seq);
  });
});

describe("書き出し（TC-SRV-19b〜19d）", () => {
  it("TC-SRV-19b 書き出した actions.csv に、取り消した操作が出ない", async () => {
    const { rec } = await playRecord();
    const files = buildExport(rec);
    const undone = new Set(rec.commands.flatMap((r) => r.undo?.seqs ?? []));
    const undoneCmds = rec.commands.filter((r) => undone.has(r.seq)).map((r) => r.cmd.t);
    expect(undoneCmds.length).toBe(2);
    // 取り消された日本語の支払いや植え付けの回数だけ、actions.csv の行が少ない
    const actions = files["actions.csv"]!.trim().split("\n").slice(1);
    const kept = rec.commands.filter((r) => !undone.has(r.seq) && r.undo === null && (r.cmd.t === "plant" || r.cmd.t === "payJapanese"));
    const shown = actions.filter((l) => /,(planted|japanesePaid),/.test(l));
    expect(shown.length).toBe(kept.length);
  });

  it("TC-SRV-19c 名前を伏せた組には参加者の名前がなく、player の列は P0〜P3 だけ。名前は _named の組にだけある", async () => {
    const { rec } = await playRecord();
    const files = buildExport(rec);
    const names = rec.participants.map((p) => p.name);
    for (const [f, body] of Object.entries(files)) {
      if (f.includes("_named") || f === "record.json") continue;
      for (const n of names) expect(body, f).not.toContain(n);
    }
    for (const f of ["turns.csv", "points.csv", "actions.csv", "farms.csv"]) {
      const lines = files[f]!.trim().split("\n");
      const col = lines[0]!.split(",").indexOf("player");
      for (const l of lines.slice(1)) expect(["P0", "P1", "P2", "P3", ""]).toContain(l.split(",")[col]);
    }
    expect(files["turns_named.csv"]!).toMatch(new RegExp(names.join("|")));
  });

  it("TC-SRV-19d 書き出しに、方式設計10章の各項目の列がある", async () => {
    const { rec } = await playRecord();
    const f = buildExport(rec);
    expect(Object.keys(f).sort()).toEqual(
      ["actions.csv", "actions_named.csv", "farms.csv", "farms_named.csv", "orders.csv", "orders_named.csv", "points.csv", "points_named.csv", "record.json", "summary.json", "summary_named.json", "turns.csv", "turns_named.csv"].sort(),
    );
    const head = (n: string) => f[n]!.split("\n")[0];
    expect(head("turns.csv")).toBe("turn,round,seat,player,dice,startMs,endMs,durationMs,actions,trades,japanese,hpAfter");
    expect(head("points.csv")).toBe("turn,seat,player,src,orderId,level,hp,coins");
    expect(head("actions.csv")).toBe("turn,elapsedMs,seat,player,event,detail,sentence,sentenceShown");
    expect(head("orders.csv")).toBe("orderId,kind,level,text,revealedTurn,resolvedTurn,outcome,failedAttempts,seat");
    expect(head("farms.csv")).toBe("turn,seat,player,crops,animals,products");
    const summary = JSON.parse(f["summary.json"]!) as Record<string, unknown>;
    for (const k of ["startedAt", "endedAt", "elapsedMs", "setupMs", "n", "reason", "ranking", "turns", "rounds", "rulesVersion", "engineVersion"]) expect(summary).toHaveProperty(k);
    expect(summary.reason).toBe("aborted");
    // sentenceShown が記録の meta から入る
    expect(f["actions.csv"]!).toMatch(/,planted,.*,(true|false)\n/);
    // 手番の行は終わった手番の数だけ、farms は手番の終わりごとに4人分。取り消しで出目が戻った手番は endTurn が拒否され、終わっていない
    const undone = new Set(rec.commands.flatMap((r) => r.undo?.seqs ?? []));
    const ended = rec.commands.filter((r) => r.cmd.t === "endTurn" && !undone.has(r.seq)).length;
    expect(ended).toBeGreaterThanOrEqual(6);
    expect(f["turns.csv"]!.trim().split("\n")).toHaveLength(1 + ended);
    expect(f["farms.csv"]!.trim().split("\n")).toHaveLength(1 + ended * 4);
  });
});
