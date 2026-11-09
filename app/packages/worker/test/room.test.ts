// 部屋の処理の単体テスト（BD06 6章の TC-SRV）。Durable Object の代わりに node:sqlite と偽の接続で動かす。
// 実際の Durable Object（休止、作り直し、HTTP の入口）は miniflare.test.ts で確かめる。
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BoardView, type PlayerView } from "@word-farm/protocol";
import { apply, createGame, type Command, type GameState } from "@word-farm/engine";
import { FakeConn, HOST_KEY, ROOM_ID, Server, finishSetup, seqHex, startTable, type Table } from "./harness.ts";

const state = (t: Table): GameState => t.srv.core.debugState().state!;
const rev = (t: Table): number => t.srv.core.debugState().rev;

/** 準備を終え、手番の人のサイコロを入れて main の段階にする（7を避ける） */
async function toMain(t: Table): Promise<void> {
  await finishSetup(t);
  const s = state(t);
  await t.srv.cmd(t.seats[s.turn!.seat]!, { t: "inputDice", a: 2, b: 2 });
  await answerAll(t);
  expect(state(t).phase.k).toBe("main");
}

async function answerAll(t: Table): Promise<void> {
  for (let g = 0; g < 20; g++) {
    const s = state(t);
    const p = s.prompts.find((x) => !s.answers[x.id]);
    if (!p) return;
    if (p.k === "chooseKind") {
      await t.srv.cmd(t.seats[p.seat]!, { t: "answerPrompt", promptId: p.id, answer: { k: "chooseKind", kinds: Array(p.count).fill(p.options[0]) } });
    } else {
      const hand = s.players[p.seat]!.hand;
      const cards: Record<string, number> = {};
      let left = p.count;
      for (const [k, v] of Object.entries(hand)) {
        const n = Math.min(v!, left);
        if (n > 0) cards[k] = n;
        left -= n;
      }
      await t.srv.cmd(t.seats[p.seat]!, { t: "answerPrompt", promptId: p.id, answer: { k: "discard", cards } });
    }
  }
}

const turnConn = (t: Table): FakeConn => t.seats[state(t).turn!.seat]!;

describe("コマンドの処理と保存（TC-SRV-01〜04）", () => {
  it("TC-SRV-01 同じ id のコマンドを2回送ると1回だけ適用され、2回目にも同じ ack が返る", async () => {
    const t = await startTable();
    await finishSetup(t);
    const c = turnConn(t);
    const id = seqHex();
    await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }, id);
    const r1 = rev(t);
    const rows1 = t.srv.rows().length;
    await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }, id);
    expect(t.srv.rows().length).toBe(rows1);
    expect(rev(t)).toBe(r1);
    const acks = c.all("ack").filter((m) => m.id === id);
    expect(acks).toHaveLength(2);
    expect(acks[0]!.rev).toBe(acks[1]!.rev);
  });

  it("TC-SRV-01 拒否された id を送り直すと、前回の reject が返り、記録は増えない", async () => {
    const t = await startTable();
    await finishSetup(t);
    const other = t.seats[(state(t).turn!.seat + 1) % 4]!;
    const id = seqHex();
    await t.srv.cmd(other, { t: "inputDice", a: 2, b: 2 }, id);
    await t.srv.cmd(other, { t: "inputDice", a: 2, b: 2 }, id);
    expect(other.all("reject").filter((m) => m.id === id).map((m) => m.code)).toEqual(["NOT_YOUR_TURN", "NOT_YOUR_TURN"]);
  });

  it("TC-SRV-02 ack が返ったコマンドは、適用後の状態の写しと併せて commands に書かれている", async () => {
    const t = await startTable();
    await finishSetup(t);
    const id = await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const row = t.srv.rows().find((r) => r.id === id)!;
    expect(JSON.parse(String(row.state))).toEqual(state(t));
    expect(Number(row.rev)).toBe(turnConn(t).all("ack").find((a) => a.id === id)!.rev);
    // 拒否は記録に残らない（BD05 1.3 の手順4）
    expect(t.srv.rows().every((r) => JSON.parse(String(r.cmd)).t !== "rejected")).toBe(true);
  });

  it("TC-SRV-03、20 書き込みの直後、ack の前に作り直させても、同じ id の送り直しは1回だけ適用される", async () => {
    const t = await startTable();
    await finishSetup(t);
    const c = turnConn(t);
    const id = seqHex();
    t.srv.crashNext = true;
    await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }, id);
    expect(c.all("ack").some((a) => a.id === id)).toBe(false); // ack は届かない
    const rows = t.srv.rows().length;
    await t.srv.hello(c, { token: t.tokens[state(t).turn!.seat] });
    await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }, id);
    expect(t.srv.rows().length).toBe(rows);
    expect(c.all("ack").filter((a) => a.id === id)).toHaveLength(1);
  });

  it("TC-SRV-04 作り直すと、最後の行の写しから状態、rev、参加者、トークンが元どおりになる", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const before = { s: state(t), r: rev(t) };
    t.srv.restart();
    expect(state(t)).toEqual(before.s);
    expect(rev(t)).toBe(before.r);
    // トークンで同じ席に戻れる
    const c = t.srv.connect();
    await t.srv.hello(c, { token: t.tokens[1] });
    expect(c.last("welcome").seat).toBe(1);
    expect((c.last("view").view as PlayerView).me.seat).toBe(1);
  });

  it("TC-SRV-04 作り直しでは先頭からの再適用をしない（最後の行の写しだけを読む）", async () => {
    const t = await startTable();
    await finishSetup(t);
    // 最後の行の写しをわざと書き換える。再適用していれば元の状態に戻り、写しを読んでいれば書き換えた値になる
    const last = t.srv.rows().at(-1)!;
    const s = JSON.parse(String(last.state)) as GameState;
    s.players[0]!.coins = 777;
    t.srv.db.prepare("UPDATE commands SET state = ? WHERE seq = ?").run(JSON.stringify(s), last.seq as number);
    t.srv.restart();
    expect(state(t).players[0]!.coins).toBe(777);
  });

  it("TC-SRV-04b 休止から戻ったあと、接続の付箋から参加者と管理の可否を読み直し、同じ接続に view を送れる", async () => {
    const t = await startTable();
    await finishSetup(t);
    t.srv.restart(); // メモリが消え、接続と付箋だけが残る
    const c = turnConn(t);
    const seat = state(t).turn!.seat;
    c.clear();
    t.board.clear();
    const id = await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }); // hello を送り直さずに
    expect(c.all("ack").some((a) => a.id === id)).toBe(true);
    expect((c.last("view").view as PlayerView).me.seat).toBe(seat);
    // 大画面の管理の可否も付箋から戻る
    expect((t.board.last("view").view as BoardView).lastCommand).not.toBeNull();
    await t.srv.admin(t.board, { k: "pause" });
    expect((t.board.last("view").view as BoardView).paused).toBe(true);
  });

  it("TC-SRV-04c エンジンの版が違う部屋は、すべてのメッセージに ENGINE_CHANGED を返し、コマンドを受け付けない", async () => {
    const t = await startTable();
    await finishSetup(t);
    t.srv.version = "0.1.0+changed0";
    t.srv.restart();
    const c = t.srv.connect();
    await t.srv.hello(c, { token: t.tokens[0] });
    expect(c.last("error").code).toBe("ENGINE_CHANGED");
    expect(c.last("error").message).toContain("0.1.0+testtest");
    const rows = t.srv.rows().length;
    await t.srv.cmd(t.seats[0]!, { t: "endTurn" });
    expect(t.seats[0]!.last("error").code).toBe("ENGINE_CHANGED");
    expect(t.srv.rows().length).toBe(rows);
    expect(t.srv.logs.some((l) => l.includes("engine changed"))).toBe(true);
  });

  it("TC-SRV-21 エンジンの版が同じなら、作り直しても止まらない", async () => {
    const t = await startTable();
    t.srv.restart();
    expect(t.srv.core.debugState().stopped).toBe(false);
  });
});

describe("取り消し（TC-SRV-05〜07c）", () => {
  it("TC-SRV-05、06 lastCommand が最後の有効な行を指し、その seq で取り消せる。rev は増え続ける", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const lc = (t.board.last("view").view as BoardView).lastCommand!;
    const last = t.srv.rows().at(-1)!;
    expect(lc.seq).toBe(Number(last.seq));
    expect(lc.summary).toContain("inputDice");
    const r0 = rev(t);
    const before = JSON.parse(String(t.srv.rows().at(-2)!.state)) as GameState;
    await t.srv.admin(t.board, { k: "undoLast", seq: lc.seq });
    expect(state(t)).toEqual(before);
    expect(rev(t)).toBe(r0 + 1);
    const undone = t.seats[0]!.last("view").events.find((e) => e.k === "undone");
    expect(undone).toMatchObject({ k: "undone", seq: lc.seq });
    // 席の画面には lastCommand を入れない
    expect((t.seats[0]!.last("view").view as PlayerView).lastCommand).toBeNull();
  });

  it("TC-SRV-06 間に別のコマンドが入ってから古い seq で送ると STALE_TARGET で拒否され、状態は変わらない", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const old = (t.board.last("view").view as BoardView).lastCommand!.seq;
    await answerAll(t);
    await t.srv.cmd(turnConn(t), { t: "endTurn" });
    const s0 = state(t);
    const id = await t.srv.admin(t.board, { k: "undoLast", seq: old });
    expect(t.board.all("reject").find((r) => r.id === id)!.code).toBe("STALE_TARGET");
    expect(state(t)).toEqual(s0);
  });

  it("TC-SRV-06b 一時停止と再開は commands に行を作らず、一時停止の間も undoLast を受け付ける", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const rows = t.srv.rows().length;
    await t.srv.admin(t.board, { k: "pause" });
    expect(t.srv.rows().length).toBe(rows);
    const seq = (t.board.last("view").view as BoardView).lastCommand!.seq;
    expect(seq).toBe(Number(t.srv.rows().at(-1)!.seq));
    const id = await t.srv.admin(t.board, { k: "undoLast", seq });
    expect(t.board.all("ack").some((a) => a.id === id)).toBe(true);
    await t.srv.admin(t.board, { k: "resume" });
    expect(t.srv.rows().length).toBe(rows + 1); // 取り消しの行だけ
  });

  it("TC-SRV-06c ゲームの作成の行だけが残った状態で undoLast を送ると NOTHING_TO_UNDO", async () => {
    const t = await startTable();
    const seq = Number(t.srv.rows()[0]!.seq);
    const id = await t.srv.admin(t.board, { k: "undoLast", seq });
    expect(t.board.all("reject").find((r) => r.id === id)!.code).toBe("NOTHING_TO_UNDO");
  });

  it("TC-SRV-06d 取り消すと1つ前が新しい lastCommand になり、続けて取り消せる。callLastRound を取り消すと endFlag が消える", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    await t.srv.admin(t.board, { k: "callLastRound" });
    expect(state(t).endFlag).not.toBeNull();
    const l1 = (t.board.last("view").view as BoardView).lastCommand!;
    expect(l1.summary).toContain("callLastRound");
    await t.srv.admin(t.board, { k: "undoLast", seq: l1.seq });
    expect(state(t).endFlag).toBeNull();
    const l2 = (t.board.last("view").view as BoardView).lastCommand!;
    expect(l2.seq).toBeLessThan(l1.seq);
    expect(l2.summary).toContain("inputDice");
    await t.srv.admin(t.board, { k: "undoLast", seq: l2.seq });
    expect(state(t).turn!.dice).toBeNull();
  });

  it("TC-SRV-06e 取り消しの確認の間に席1が切断して再接続しても rev は変わらず、undoLast を受け付ける", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const r0 = rev(t);
    const seq = (t.board.last("view").view as BoardView).lastCommand!.seq;
    t.srv.drop(t.seats[1]!);
    const c = t.srv.connect();
    await t.srv.hello(c, { token: t.tokens[1] });
    expect(rev(t)).toBe(r0);
    const id = await t.srv.admin(t.board, { k: "undoLast", seq });
    expect(t.board.all("ack").some((a) => a.id === id)).toBe(true);
  });

  it("TC-SRV-06f ゲームを終わらせた行（abortGame）は GAME_OVER で拒否され、状態と rev は変わらない", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.admin(t.board, { k: "abortGame" });
    expect(state(t).phase.k).toBe("over");
    const seq = (t.board.last("view").view as BoardView).lastCommand!.seq;
    const r0 = rev(t);
    const id = await t.srv.admin(t.board, { k: "undoLast", seq });
    expect(t.board.all("reject").find((r) => r.id === id)!.code).toBe("GAME_OVER");
    expect(rev(t)).toBe(r0);
    expect(state(t).phase.k).toBe("over");
  });

  it("TC-SRV-07 取り消して同じ手番でサイコロを振り直すと、同じ出目になる", async () => {
    const t = await startTable(4, "server");
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "rollDice" });
    const d1 = state(t).turn!.dice;
    // 問いが出ていれば答えずに、サイコロの行まで取り消す
    for (let g = 0; g < 5 && state(t).turn!.dice !== null; g++) {
      await t.srv.admin(t.board, { k: "undoLast", seq: (t.board.last("view").view as BoardView).lastCommand!.seq });
    }
    await t.srv.cmd(turnConn(t), { t: "rollDice" });
    expect(state(t).turn!.dice).toEqual(d1);
  });

  it("TC-SRV-07b 取り消しを2回重ねたあとの状態が、記録の有効な行を先頭から再適用した状態と一致する", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    await answerAll(t);
    await t.srv.cmd(turnConn(t), { t: "endTurn" });
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 3, b: 3 });
    for (let i = 0; i < 2; i++) await t.srv.admin(t.board, { k: "undoLast", seq: (t.board.last("view").view as BoardView).lastCommand!.seq });
    const rows = t.srv.rows();
    const undone = new Set(rows.filter((r) => r.undo !== null).flatMap((r) => (JSON.parse(String(r.undo)) as { seqs: number[] }).seqs));
    const valid = rows.filter((r) => r.undo === null && !undone.has(Number(r.seq)));
    const first = JSON.parse(String(valid[0]!.cmd)) as { config: never; setup: never; seed: string };
    let s = createGame(first.config, first.setup, first.seed);
    for (const r of valid.slice(1)) {
      const res = apply(s, JSON.parse(String(r.actor)), JSON.parse(String(r.cmd)) as Command);
      if (!res.ok) throw new Error(res.code);
      s = res.state;
    }
    expect(s).toEqual(state(t));
  });

  it("TC-SRV-07c 一時停止中はプレイヤーのコマンドが PAUSED で拒否され、状態も rev も変わらない。管理操作は受け付け、再開すると受け付ける", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.admin(t.board, { k: "pause" });
    const s0 = state(t);
    const r0 = rev(t);
    const id = await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    expect(turnConn(t).all("reject").find((r) => r.id === id)!.code).toBe("PAUSED");
    expect(state(t)).toEqual(s0);
    expect(rev(t)).toBe(r0);
    const a = await t.srv.admin(t.board, { k: "callLastRound" });
    expect(t.board.all("ack").some((x) => x.id === a)).toBe(true);
    await t.srv.admin(t.board, { k: "resume" });
    const id2 = await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    expect(turnConn(t).all("ack").some((x) => x.id === id2)).toBe(true);
  });
});

describe("管理と秘密（TC-SRV-08〜10）", () => {
  it("TC-SRV-08 鍵のない接続、誤った鍵の接続からの管理操作は NOT_ADMIN。正しい鍵なら受け付ける", async () => {
    const srv = new Server();
    const none = await srv.board(false);
    expect(none.last("welcome").admin).toBe(false);
    await srv.admin(none, { k: "pause" });
    expect(none.last("error").code).toBe("NOT_ADMIN");
    const wrong = srv.connect();
    await srv.send(wrong, { t: "hello", v: PROTOCOL_VERSION, roomId: ROOM_ID, role: "board", hostKey: `${HOST_KEY}x` });
    expect(wrong.last("welcome").admin).toBe(false);
    await srv.admin(wrong, { k: "kick", participantId: "p" });
    expect(wrong.last("error").code).toBe("NOT_ADMIN");
    const p = srv.connect();
    await srv.hello(p);
    await srv.admin(p, { k: "pause" });
    expect(p.last("error").code).toBe("NOT_ADMIN"); // 席の接続からも
    const ok = await srv.board(true);
    expect(ok.last("welcome").admin).toBe(true);
  });

  it("TC-SRV-08c 作成していない部屋への hello に ROOM を返し、表を作らない", async () => {
    const srv = new Server(false);
    const c = srv.connect();
    await srv.hello(c);
    expect(c.last("error").code).toBe("ROOM");
    expect(srv.db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
  });

  it("TC-SRV-08c 別の部屋の ID の hello には ROOM を返す", async () => {
    const srv = new Server();
    const c = srv.connect();
    await srv.send(c, { t: "hello", v: PROTOCOL_VERSION, roomId: "f".repeat(32), role: "player" });
    expect(c.last("error").code).toBe("ROOM");
  });

  it("TC-SRV-08d、08f 記録はゲームが終わるまで取り出せない。終わったあとは tokenHash を含まず、state は states のときだけ", async () => {
    const t = await startTable();
    await finishSetup(t);
    expect(t.srv.core.record(false)).toMatchObject({ ok: false, status: 409 });
    expect(t.srv.core.record(true)).toMatchObject({ ok: false, status: 409 });
    await t.srv.admin(t.board, { k: "abortGame" });
    const r = t.srv.core.record(false) as { ok: true; body: { participants: object[]; commands: object[]; meta: { seed: string } } };
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("tokenHash");
    expect(r.body.commands.every((x) => !("state" in x))).toBe(true);
    expect(r.body.meta.seed).toMatch(/^[0-9a-f]{32}$/);
    const rs = t.srv.core.record(true) as { ok: true; body: { commands: object[] } };
    expect(rs.body.commands.every((x) => "state" in x)).toBe(true);
    // 名前は participants にだけあり、commands にはない（BD05 5.3）
    expect(JSON.stringify(rs.body.commands)).not.toContain("N0");
  });

  it("TC-SRV-08e 1局分のログに、ホストの鍵、トークン、手札の中身、注文の条件が含まれない", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    await t.srv.admin(t.board, { k: "abortGame" });
    const log = t.srv.logs.join("\n");
    expect(log).not.toContain(HOST_KEY);
    for (const tk of t.tokens) expect(log).not.toContain(tk);
    expect(log).not.toMatch(/hand|cond|items|seed/);
  });

  it("TC-SRV-09、10 大画面と席の接続に送ったメッセージに、ほかの人の手札の中身と、表の注文の条件が含まれない", async () => {
    const t = await startTable();
    await toMain(t);
    const s = state(t);
    for (const m of t.board.all("view")) {
      const v = m.view as BoardView;
      expect(v).not.toHaveProperty("me");
      for (const p of v.players) expect(p).not.toHaveProperty("hand");
      for (const f of v.orders.faceUp) for (const k of ["cond", "hp", "level", "source"]) expect(f).not.toHaveProperty(k);
    }
    for (const m of t.seats[1]!.all("view")) {
      const v = m.view as PlayerView;
      expect(v.me.seat).toBe(1);
      for (const p of v.players) expect(p).not.toHaveProperty("hand");
    }
    // 伏せた注文の英文と、注文の山の生成の種が、どの接続の送信にも入らない
    const sent = t.srv.bytesSent.join("\n");
    for (const o of s.orders.deck) expect(sent).not.toContain(o.text);
    const seed = JSON.parse(String(t.srv.rows()[0]!.cmd)).seed as string;
    expect(sent).not.toContain(seed);
  });
});

describe("接続と席（TC-SRV-11〜13、18、22）", () => {
  it("TC-SRV-11 席の再発行の合言葉で入った端末は、ホストが承認するまで席を得ない。承認すると席が移り、旧端末に replaced が届く", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.admin(t.board, { k: "reissueSeat", seat: 2 });
    const code = t.board.last("claimCode");
    expect(code.seat).toBe(2);
    const n = t.srv.connect();
    await t.srv.hello(n, { claim: code.code });
    expect(n.last("claimPending")).toMatchObject({ seat: 2, seatName: expect.any(String) });
    expect(n.all("view")).toHaveLength(0);
    await t.srv.send(n, { t: "claimConfirm" });
    expect(t.board.last("claimRequest").seat).toBe(2);
    await t.srv.admin(t.board, { k: "approveClaim", seat: 2, approve: true });
    expect(n.last("welcome").seat).toBe(2);
    expect((n.last("view").view as PlayerView).me.seat).toBe(2);
    expect(t.seats[2]!.last("replaced")).toBeTruthy();
    expect(t.seats[2]!.closed).toBe(true);
  });

  it("TC-SRV-11b 同じ合言葉の2回目と、5分を過ぎた合言葉では席を得られない。承認のあとに旧トークンで hello すると TOKEN", async () => {
    const t = await startTable();
    await t.srv.admin(t.board, { k: "reissueSeat", seat: 2 });
    const code = t.board.last("claimCode").code;
    const n = t.srv.connect();
    await t.srv.hello(n, { claim: code });
    await t.srv.send(n, { t: "claimConfirm" });
    await t.srv.admin(t.board, { k: "approveClaim", seat: 2, approve: true });
    const again = t.srv.connect();
    await t.srv.hello(again, { claim: code });
    expect(again.last("error").code).toBe("TOKEN");
    const old = t.srv.connect();
    await t.srv.hello(old, { token: t.tokens[2] });
    expect(old.last("error").code).toBe("TOKEN");
    await t.srv.admin(t.board, { k: "reissueSeat", seat: 1 });
    const late = t.board.last("claimCode").code;
    t.srv.time += 5 * 60_000 + 1;
    const l = t.srv.connect();
    await t.srv.hello(l, { claim: late });
    expect(l.last("error").code).toBe("TOKEN");
  });

  it("TC-SRV-11 ホストが承認しなければ席は移らない", async () => {
    const t = await startTable();
    await t.srv.admin(t.board, { k: "reissueSeat", seat: 3 });
    const n = t.srv.connect();
    await t.srv.hello(n, { claim: t.board.last("claimCode").code });
    await t.srv.send(n, { t: "claimConfirm" });
    await t.srv.admin(t.board, { k: "approveClaim", seat: 3, approve: false });
    expect(n.last("error").code).toBe("CLAIM");
    expect(t.seats[3]!.closed).toBe(false);
  });

  it("TC-SRV-12 同じ席に2本目の接続が来ると、1本目が切られる", async () => {
    const t = await startTable();
    const c2 = t.srv.connect();
    await t.srv.hello(c2, { token: t.tokens[0] });
    expect(t.seats[0]!.last("replaced")).toBeTruthy();
    expect(t.seats[0]!.closed).toBe(true);
    expect(c2.closed).toBe(false);
  });

  it("TC-SRV-13b 作り直しても rev が戻らない。ロビーの変更のあとに作り直させた場合も同じ", async () => {
    const srv = new Server();
    const b = await srv.board();
    const c = srv.connect();
    await srv.hello(c);
    await srv.send(c, { t: "join", name: "Aki" });
    await srv.send(c, { t: "rename", name: "Ben" });
    const r = srv.core.debugState().rev;
    expect(r).toBe(2);
    srv.restart();
    expect(srv.core.debugState().rev).toBe(r);
    await srv.admin(b, { k: "setRate", participantId: c.getAttachment()!.pid!, rate: 2 });
    expect(srv.core.debugState().rev).toBe(r + 1);
  });

  it("TC-SRV-13c ack が届く前に切断した端末が同じ id で送り直しても、二重に適用されない", async () => {
    const t = await startTable();
    await finishSetup(t);
    const seat = state(t).turn!.seat;
    const c = turnConn(t);
    const id = seqHex();
    // 送った直後に接続が切れ、ack を受け取れなかった
    c.close();
    await t.srv.cmd(c, { t: "inputDice", a: 2, b: 2 }, id).catch(() => undefined);
    const rows = t.srv.rows().length;
    const n = t.srv.connect();
    await t.srv.hello(n, { token: t.tokens[seat] });
    await t.srv.cmd(n, { t: "inputDice", a: 2, b: 2 }, id);
    expect(t.srv.rows().length).toBe(rows);
    expect(n.all("ack").filter((a) => a.id === id)).toHaveLength(1);
  });

  it("TC-SRV-18 ping が30秒届かない接続は、ほかのメッセージの処理のときに切られ、connected が false になる", async () => {
    const t = await startTable();
    await finishSetup(t);
    t.srv.time += 20_000;
    for (const c of [t.board, t.seats[0]!, t.seats[1]!, t.seats[2]!]) await t.srv.send(c, { t: "ping", n: 1 });
    t.srv.time += 15_000; // 席3は35秒、ほかは15秒黙っている
    await t.srv.send(t.seats[0]!, { t: "ping", n: 2 });
    expect(t.seats[3]!.closed).toBe(true);
    expect(t.seats[1]!.closed).toBe(false);
    const v = t.seats[0]!.last("view").view as PlayerView;
    expect(v.players.find((p) => p.seat === 3)!.connected).toBe(false);
    expect(v.players.find((p) => p.seat === 1)!.connected).toBe(true);
  });

  it("端末が接続を閉じると、閉じた知らせの処理の中で、ほかの端末に connected: false を送る", async () => {
    const t = await startTable();
    await finishSetup(t);
    t.board.clear();
    t.srv.drop(t.seats[2]!);
    const v = t.board.last("view").view as BoardView;
    expect(v.players.find((p) => p.seat === 2)!.connected).toBe(false);
    expect(v.players.find((p) => p.seat === 1)!.connected).toBe(true);
  });

  it("TC-SRV-18 休止から戻った直後は、どの接続も切られない", async () => {
    const t = await startTable();
    t.srv.time += 10 * 60_000;
    t.srv.restart(); // 休止からの復帰（メモリが消え、接続は残る）
    await t.srv.send(t.seats[0]!, { t: "ping", n: 1 });
    expect([...t.seats, t.board].every((c) => !c.closed)).toBe(true);
  });

  it("TC-SRV-22 トークンのハッシュを求める間に同じトークンの2本目の hello が届いても、席を持つ接続は1本だけ", async () => {
    const t = await startTable();
    const a = t.srv.connect();
    const b = t.srv.connect();
    await Promise.all([t.srv.hello(a, { token: t.tokens[0] }), t.srv.hello(b, { token: t.tokens[0] })]);
    const live = [a, b].filter((c) => !c.closed);
    expect(live).toHaveLength(1);
    expect([a, b].find((c) => c.closed)!.last("replaced")).toBeTruthy();
    expect(t.seats[0]!.closed).toBe(true); // 元の接続も切られている
  });
});

describe("時計（TC-SRV-14、15）", () => {
  it("TC-SRV-14 偽の時計を70分より先へ進めても何も記録されない。一時停止の間は経過が進まず、再開で続きから数える", async () => {
    const t = await startTable();
    await finishSetup(t);
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    const rows = t.srv.rows().length;
    await t.srv.tick(71 * 60_000);
    expect(t.srv.rows().length).toBe(rows);
    await t.srv.admin(t.board, { k: "pause" });
    const e1 = (t.board.last("view").view as BoardView).clock.elapsedMs;
    await t.srv.tick(5 * 60_000);
    await t.srv.admin(t.board, { k: "resume" });
    const e2 = (t.board.last("view").view as BoardView).clock.elapsedMs;
    expect(e2).toBe(e1);
    t.srv.time += 1000;
    await answerAll(t);
    await t.srv.cmd(turnConn(t), { t: "endTurn" });
    expect((t.board.last("view").view as BoardView).clock.elapsedMs).toBe(e1 + 1000);
  });

  it("TC-SRV-15 経過はロビーの時間を含まず、作り直しの間も進み、一時停止中に作り直しても再開後の経過が正しい", async () => {
    const t = await startTable();
    await t.srv.tick(60_000); // ロビーと準備の間
    await finishSetup(t);
    const view = () => (t.board.last("view").view as BoardView).clock;
    expect(view().elapsedMs).toBe(0);
    await t.srv.tick(10_000);
    t.srv.restart();
    t.srv.time += 5_000; // 作り直しの間も時計は進む
    await t.srv.cmd(turnConn(t), { t: "inputDice", a: 2, b: 2 });
    expect(view().elapsedMs).toBe(15_000);
    await t.srv.admin(t.board, { k: "pause" });
    await t.srv.tick(30_000);
    t.srv.restart();
    await t.srv.admin(t.board, { k: "resume" });
    expect(view().elapsedMs).toBe(15_000);
  });
});

describe("プロトコルの誤り（TC-SRV-16、16b）", () => {
  it("TC-SRV-16 形の正しくないメッセージは状態を変えない。cmd で id が読めれば reject、それ以外は error", async () => {
    const t = await startTable();
    await finishSetup(t);
    const c = turnConn(t);
    const s0 = state(t);
    const id = seqHex();
    await t.srv.send(c, { t: "cmd", id, cmd: { t: "plant", crop: "egg" } });
    expect(c.last("reject")).toMatchObject({ id, code: "BAD_MESSAGE" });
    await t.srv.send(c, "{not json");
    expect(c.last("error").code).toBe("BAD_MESSAGE");
    await t.srv.send(c, { t: "nope" });
    expect(c.last("error").code).toBe("BAD_MESSAGE");
    await t.srv.send(c, { t: "join" });
    expect(c.last("error").code).toBe("BAD_MESSAGE");
    expect(state(t)).toEqual(s0);
    expect(c.closed).toBe(false);
  });

  it("TC-SRV-16b プロトコルの誤りの表", async () => {
    const srv = new Server();
    const big = srv.connect();
    await srv.send(big, JSON.stringify({ t: "ping", n: 1, pad: "x".repeat(5000) }));
    expect(big.last("error").code).toBe("TOO_LARGE");
    expect(big.closed).toBe(true);

    const ver = srv.connect();
    await srv.send(ver, { t: "hello", v: PROTOCOL_VERSION + 1, roomId: ROOM_ID, role: "player" });
    expect(ver.last("error").code).toBe("VERSION");
    expect(ver.closed).toBe(true);

    const tok = srv.connect();
    await srv.hello(tok, { token: "a".repeat(32) });
    expect(tok.last("error").code).toBe("TOKEN");

    const b = await srv.board();
    const ps: FakeConn[] = [];
    for (let i = 0; i < 5; i++) {
      const c = srv.connect();
      await srv.hello(c);
      await srv.send(c, { t: "join", name: i === 1 ? "P0" : `P${i}` });
      ps.push(c);
    }
    expect(ps[1]!.last("error").code).toBe("NAME_TAKEN");
    const sixth = srv.connect();
    await srv.hello(sixth);
    await srv.send(sixth, { t: "join", name: "P9" });
    expect(sixth.last("error").code).toBe("LOBBY_FULL");
    await srv.admin(b, { k: "startGame", options: { orderDeck: "fixed", dice: "manual", animalInclude: false } });
    expect(srv.core.debugState().phase).toBe("game");
    const late = srv.connect();
    await srv.hello(late);
    await srv.send(late, { t: "join", name: "Late" });
    expect(late.last("error").code).toBe("GAME_STARTED");

    const spam = srv.connect();
    for (let i = 0; i < 11; i++) await srv.send(spam, "x");
    expect(spam.closed).toBe(true);
  });
});

describe("ロビー（BD03 3.4）", () => {
  it("並べ替え、色、倍率、抜ける、外す。全員がつながっていないと始められない", async () => {
    const srv = new Server();
    const b = await srv.board();
    const cs: FakeConn[] = [];
    for (const n of ["A", "B", "C"]) {
      const c = srv.connect();
      await srv.hello(c);
      await srv.send(c, { t: "join", name: n });
      cs.push(c);
    }
    const pid = (c: FakeConn) => c.getAttachment()!.pid!;
    await srv.admin(b, { k: "reorder", participantIds: [pid(cs[2]!), pid(cs[0]!), pid(cs[1]!)] });
    expect(b.last("lobby").lobby.participants.map((p) => [p.name, p.order])).toEqual([["C", 0], ["A", 1], ["B", 2]]);
    await srv.admin(b, { k: "setColor", participantId: pid(cs[0]!), color: "green" });
    const colors = Object.fromEntries(b.last("lobby").lobby.participants.map((p) => [p.name, p.color]));
    expect(colors).toEqual({ A: "green", B: "blue", C: "red" });
    expect(b.last("lobby").lobby.canStart).toBe(true);
    srv.drop(cs[1]!);
    expect(b.last("lobby").lobby.canStart).toBe(false);
    const id = await srv.admin(b, { k: "startGame", options: { orderDeck: "fixed", dice: "manual", animalInclude: false } });
    expect(b.last("reject")).toMatchObject({ id, code: "WRONG_PHASE" });
    await srv.admin(b, { k: "kick", participantId: pid(cs[1]!) });
    await srv.send(cs[2]!, { t: "leave" });
    expect(b.last("lobby").lobby.participants.map((p) => [p.name, p.order])).toEqual([["A", 0]]);
  });

  it("ゲームを始めると、席が割り当てられ、作成の行が記録の1行目になる。名前は記録に入らない", async () => {
    const t = await startTable(3);
    const rows = t.srv.rows();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0]!.actor))).toEqual({ k: "server" });
    expect(String(rows[0]!.cmd)).not.toContain("N0");
    const v = t.seats[0]!.last("view");
    expect(v.events.map((e) => e.k)).toEqual(["seatsAssigned", "gameCreated"]);
    expect((v.view as PlayerView).players.map((p) => p.name).sort()).toEqual(["N0", "N1", "N2"]);
  });
});

describe("代わりに答える（BD04 2.5）", () => {
  it("answer を省いた answerFor は、サーバーが既定の答えを作って答える", async () => {
    const t = await startTable();
    for (let g = 0; g < 30; g++) {
      const s = state(t);
      const p = s.prompts.find((x) => !s.answers[x.id]);
      if (p) {
        const id = await t.srv.admin(t.board, { k: "answerFor", promptId: p.id });
        expect(t.board.all("ack").some((a) => a.id === id)).toBe(true);
        expect(state(t).answers[p.id] ?? state(t).prompts.every((x) => x.id !== p.id)).toBeTruthy();
        return;
      }
      if (s.phase.k === "setupPlace") {
        const step = s.phase.step;
        const seat = step < s.n ? step : 2 * s.n - 1 - step;
        const { legalActions } = await import("@word-farm/engine");
        await t.srv.cmd(t.seats[seat]!, { t: "placeHouse", vertex: legalActions(s, seat).placeHouse!.vertices[0]! });
      }
    }
    throw new Error("問いが出なかった");
  });

  it("捨て札の既定の答えは、ちょうどの枚数を多く持つ種類から選ぶ", async () => {
    const { defaultAnswer } = await import("../src/room.ts");
    const t = await startTable();
    const s = structuredClone(state(t));
    s.players[0]!.hand = { grow: 5, sell: 2, feed: 1 };
    s.prompts = [{ id: "p", k: "discard", seat: 0, count: 4 }];
    expect(defaultAnswer(s, "p")).toEqual({ k: "discard", cards: { grow: 2, sell: 1, feed: 1 } });
    expect(defaultAnswer(s, "none")).toBeNull();
  });
});

describe("試験用の口（E2E のため）", () => {
  it("debugGive はカードを山から渡し、不変条件を保ったまま全端末に表示を送る", async () => {
    const { checkInvariants } = await import("@word-farm/engine");
    const t = await startTable();
    await finishSetup(t);
    const r0 = rev(t);
    expect(t.srv.core.debugGive(1, { cards: { sell: 2 }, products: { carrot: 3 }, coins: 5 })).toBeNull();
    const s = state(t);
    expect(s.players[1]!.products.carrot).toBe(3);
    expect(checkInvariants(s)).toEqual([]);
    expect(rev(t)).toBe(r0 + 1);
    expect((t.seats[1]!.last("view").view as PlayerView).me.hand.sell).toBeGreaterThanOrEqual(2);
    expect(t.srv.core.debugGive(1, { cards: { cow: 99 } })).toBe("PILE_EMPTY");
  });
});

describe("pointer（BD03 3.2）", () => {
  it("拠点を置く番の人の pointer だけを大画面に転送する", async () => {
    const t = await startTable();
    await t.srv.send(t.seats[0]!, { t: "pointer", vertex: 5 });
    await t.srv.send(t.seats[1]!, { t: "pointer", vertex: 6 });
    expect(t.board.all("pointer")).toEqual([{ t: "pointer", seat: 0, vertex: 5 }]);
    expect(t.seats[2]!.all("pointer")).toEqual([]);
  });
});
