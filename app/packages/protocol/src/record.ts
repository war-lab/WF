// 記録の再適用、検証、書き出し（BD05 5章）。
// 記録は GET /api/rooms/<roomId>/record の応答で、大画面のブラウザ（書き出し）と開発の道具（検証）が読む。
// 再適用は、取り消しの行と取り消された行を除いた「有効な行」だけで行う。取り消された操作の出来事は書き出しに出ない。
import {
  apply as engineApply,
  createGame,
  type Actor,
  type Command,
  type EngineEvent,
  type GameSetup,
  type GameState,
  type Plot,
  type RuleConfig,
} from "@word-farm/engine";

export interface RecordRow {
  seq: number;
  rev: number;
  at: string;
  elapsedMs: number;
  id: string;
  actor: Actor | { k: "server" };
  cmd: Command | { t: "createGame"; config: RuleConfig; setup: GameSetup; seed: string } | { t: "undoLast"; seq: number };
  meta: { sentenceShown?: boolean } | null;
  undo: { seqs: number[] } | null;
  /** ?states=1 のときだけ */
  state?: GameState;
}

export interface RecordFile {
  meta: { roomId: string; createdAt: string; engineVersion: string; rulesVersion: string; config: RuleConfig; seed: string; n: number };
  participants: { participantId: string; name: string; ord: number; seat: number | null; color: string; rate: number }[];
  commands: RecordRow[];
}

export interface ReplayedRow {
  row: RecordRow;
  state: GameState;
  events: EngineEvent[];
}

export type ApplyFn = typeof engineApply;

/** 有効な行（BD05 2.9）。取り消しの行と、取り消された行を除く */
export function validRows(rec: RecordFile): RecordRow[] {
  const undone = new Set<number>();
  for (const r of rec.commands) if (r.undo) for (const s of r.undo.seqs) undone.add(s);
  return rec.commands.filter((r) => r.undo === null && !undone.has(r.seq));
}

/** 有効な行を先頭から再適用する。apply を差し替えられるのは、検証の道具のテスト（TC-SRV-19）のため */
export function replayRecord(rec: RecordFile, apply: ApplyFn = engineApply): ReplayedRow[] {
  const rows = validRows(rec);
  const first = rows[0];
  if (!first || first.cmd.t !== "createGame") throw new Error("記録の1行目がゲームの作成ではない");
  const c = first.cmd as { config: RuleConfig; setup: GameSetup; seed: string };
  let s = createGame(c.config, c.setup, c.seed);
  const out: ReplayedRow[] = [{ row: first, state: s, events: [] }];
  for (const r of rows.slice(1)) {
    const res = apply(s, r.actor as Actor, r.cmd as Command);
    if (!res.ok) throw new Error(`seq ${r.seq} が拒否された（${res.code}）。記録とエンジンが合わない`);
    s = res.state;
    out.push({ row: r, state: s, events: res.events });
  }
  return out;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  mismatches: { seq: number; detail: string }[];
}

/**
 * 記録の検証（BD05 5.4）。サーバーと同じ手順で、記録の行を順に適用し、各行の写し（?states=1 で取り出したもの）と比べる。
 * 取り消しの行では1つ前の状態に戻す。あとで取り消された行も、その時点の適用の結果として比べる。
 */
export function verifyRecord(rec: RecordFile, apply: ApplyFn = engineApply): VerifyResult {
  const mismatches: VerifyResult["mismatches"] = [];
  const stack: { seq: number; state: GameState }[] = [];
  let checked = 0;
  for (const r of rec.commands) {
    let s: GameState;
    if (r.cmd.t === "createGame") {
      const c = r.cmd as { config: RuleConfig; setup: GameSetup; seed: string };
      s = createGame(c.config, c.setup, c.seed);
      stack.push({ seq: r.seq, state: s });
    } else if (r.undo) {
      const top = stack.pop();
      if (!top || !r.undo.seqs.includes(top.seq)) {
        mismatches.push({ seq: r.seq, detail: `取り消しの対象 ${r.undo.seqs} が最後の有効な行 ${top?.seq} と違う` });
        break;
      }
      s = stack.at(-1)!.state;
    } else {
      const top = stack.at(-1);
      if (!top) {
        mismatches.push({ seq: r.seq, detail: "ゲームの作成より前の行" });
        break;
      }
      const res = apply(top.state, r.actor as Actor, r.cmd as Command);
      if (!res.ok) {
        mismatches.push({ seq: r.seq, detail: `再適用で拒否された（${res.code}）` });
        break;
      }
      s = res.state;
      stack.push({ seq: r.seq, state: s });
    }
    if (r.state === undefined) continue;
    checked += 1;
    if (JSON.stringify(r.state) !== JSON.stringify(s)) mismatches.push({ seq: r.seq, detail: firstDiff(r.state, s) });
  }
  return { ok: mismatches.length === 0, checked, mismatches };
}

function firstDiff(a: unknown, b: unknown, path = "state"): string {
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return JSON.stringify(a) === JSON.stringify(b) ? "" : `${path}: 記録 ${JSON.stringify(a)?.slice(0, 80)} / 再適用 ${JSON.stringify(b)?.slice(0, 80)}`;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return "";
}

// ---------- 書き出し（BD05 5.1〜5.3） ----------

const ACTION_EVENTS = new Set([
  "planted",
  "animalBought",
  "fed",
  "productsSold",
  "animalSold",
  "orderDeclared",
  "orderSucceeded",
  "orderFailed",
  "jointRowFilled",
  "houseBuilt",
  "bankTraded",
  "harborTraded",
  "cardBought",
  "productBought",
  "tradeProposed",
  "tradeAccepted",
  "tradeDeclined",
  "japanesePaid",
]);
/** 英文を言う行動（BD02 7.2）。turns.csv の actions に数える */
const DECLARED = new Set(["planted", "animalBought", "fed", "productsSold", "animalSold", "orderDeclared", "jointRowFilled", "houseBuilt"]);

function csv(rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

const bagText = (b: Record<string, number | undefined>) =>
  Object.entries(b)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

function eventSeat(e: EngineEvent): number | null {
  const x = e as { seat?: number; offer?: { from: number }; from?: number };
  if (typeof x.seat === "number") return x.seat;
  if (x.offer) return x.offer.from;
  if (typeof x.from === "number") return x.from;
  return null;
}

function detailOf(e: EngineEvent): string {
  const x = e as Record<string, unknown>;
  switch (e.k) {
    case "productsSold":
      return `${e.product}×${e.n}`;
    case "bankTraded":
      return `bank ${e.give}×${e.n}→${e.get}`;
    case "harborTraded":
      return `harbor:${e.vertex} ${e.give}×${e.n}→${e.get}`;
    case "japanesePaid":
      return `${e.kind}/${e.method}`;
    default: {
      const keep = ["crop", "animal", "product", "n", "orderId", "jointId", "vertex", "kind", "plot", "coins", "items"];
      return keep
        .filter((k) => x[k] !== undefined)
        .map((k) => `${k}=${typeof x[k] === "object" ? bagText(x[k] as Record<string, number>) : String(x[k])}`)
        .join(" ");
    }
  }
}

function farmText(plots: Plot[], kind: "crop" | "animal"): string {
  const c: Record<string, number> = {};
  for (const p of plots) {
    if (kind === "crop" && p.t === "crop") c[p.crop] = (c[p.crop] ?? 0) + 1;
    if (kind === "animal" && p.t === "animal") c[p.animal] = (c[p.animal] ?? 0) + 1;
  }
  return bagText(c);
}

/**
 * 書き出すファイルを作る。名前を入れた組（*_named）と、名前を P0〜P3 に置き換えた組の2組（BD05 5.3）。
 * zip にまとめるのは画面の側で行う。
 */
export function buildExport(rec: RecordFile): Record<string, string> {
  const rows = replayRecord(rec);
  const init = rows[0]!.state;
  const nameOf = new Map<number, string>();
  for (const p of rec.participants) if (p.seat !== null) nameOf.set(p.seat, p.name);
  const levelOf = new Map<string, string>();
  for (const o of init.orders.deck) levelOf.set(o.id, o.level);
  for (const j of [...init.joint.deck, ...init.joint.faceUp.map((f) => f.joint)]) levelOf.set(j.id, "joint");

  type Named = (seat: number | null) => string;
  const make = (who: Named) => {
    const turns: (string | number | null)[][] = [["turn", "round", "seat", "player", "dice", "startMs", "endMs", "durationMs", "actions", "trades", "japanese", "hpAfter"]];
    const points: (string | number | null)[][] = [["turn", "seat", "player", "src", "orderId", "level", "hp", "coins"]];
    const actions: (string | number | boolean | null)[][] = [["turn", "elapsedMs", "seat", "player", "event", "detail", "sentence", "sentenceShown"]];
    const farms: (string | number | null)[][] = [["turn", "seat", "player", "crops", "animals", "products"]];
    const orders = new Map<string, { kind: string; level: string; text: string; revealedTurn: number | null; resolvedTurn: number | null; outcome: string; failedAttempts: number; seat: number | null }>();
    for (const o of init.orders.deck) orders.set(o.id, { kind: "normal", level: o.level, text: o.text, revealedTurn: null, resolvedTurn: null, outcome: "unrevealed", failedAttempts: 0, seat: null });
    for (const j of [...init.joint.faceUp.map((f) => f.joint), ...init.joint.deck]) {
      orders.set(j.id, { kind: "joint", level: "joint", text: j.text, revealedTurn: null, resolvedTurn: null, outcome: "unrevealed", failedAttempts: 0, seat: null });
    }
    let cur: { turn: number; round: number; seat: number; dice: number | null; start: number; actions: number; trades: number; japanese: number } | null = null;
    let prev = init;
    let setupDoneMs: number | null = null;
    let lastTurn = 0;
    for (const r of rows.slice(1)) {
      const s = r.state;
      const turnNo = s.turn?.serial ?? 0;
      // 点の内訳の増分
      s.players.forEach((p, i) => {
        for (const e of p.ledger.slice(prev.players[i]!.ledger.length)) {
          const oid = "orderId" in e ? e.orderId : e.jointId;
          points.push([e.turn, i, who(i), e.src, oid, levelOf.get(oid) ?? "", e.hp, "coins" in e ? e.coins : null]);
        }
      });
      for (const e of r.events) {
        const seat = eventSeat(e);
        if (ACTION_EVENTS.has(e.k)) {
          actions.push([turnNo, r.row.elapsedMs, seat, who(seat), e.k, detailOf(e), (e as { sentence?: string }).sentence ?? null, r.row.meta?.sentenceShown ?? null]);
        }
        if (cur) {
          if (DECLARED.has(e.k) && seat === cur.seat) cur.actions += 1;
          if (e.k === "tradeAccepted") cur.trades += 1;
          if (e.k === "japanesePaid") cur.japanese += 1;
          if (e.k === "diceRolled") cur.dice = e.dice[0] + e.dice[1];
        }
        if (e.k === "turnEnded" && cur) {
          turns.push([cur.turn, cur.round, cur.seat, who(cur.seat), cur.dice, cur.start, r.row.elapsedMs, r.row.elapsedMs - cur.start, cur.actions, cur.trades, cur.japanese, s.players[cur.seat]!.halfPoints]);
          s.players.forEach((p, i) => farms.push([cur!.turn, i, who(i), farmText(p.plots, "crop"), farmText(p.plots, "animal"), bagText(p.products)]));
          cur = null;
        }
        if (e.k === "turnStarted") {
          if (setupDoneMs === null) setupDoneMs = Date.parse(r.row.at);
          cur = { turn: e.serial, round: e.round, seat: e.seat, dice: null, start: r.row.elapsedMs, actions: 0, trades: 0, japanese: 0 };
          lastTurn = e.serial;
        }
        if (e.k === "ordersRevealed") for (const o of e.orders) Object.assign(orders.get(o.id)!, { revealedTurn: turnNo, outcome: "openAtEnd" });
        if (e.k === "jointRevealed") Object.assign(orders.get(e.jointId)!, { revealedTurn: turnNo, outcome: "openAtEnd" });
        if (e.k === "orderSucceeded") Object.assign(orders.get(e.orderId)!, { resolvedTurn: turnNo, outcome: "succeeded", seat: e.seat });
        if (e.k === "orderFailed") orders.get(e.orderId)!.failedAttempts += 1;
        if (e.k === "orderExpired") Object.assign(orders.get(e.orderId)!, { resolvedTurn: turnNo, outcome: "expired" });
        if (e.k === "jointCompleted") Object.assign(orders.get(e.jointId)!, { resolvedTurn: turnNo, outcome: "completed", seat: e.finisher });
        if (e.k === "jointExpired") Object.assign(orders.get(e.jointId)!, { resolvedTurn: turnNo, outcome: "expired" });
      }
      prev = s;
    }
    // 準備のときから表にある共同注文
    for (const f of init.joint.faceUp) {
      const o = orders.get(f.joint.id)!;
      if (o.revealedTurn === null) Object.assign(o, { revealedTurn: 0, outcome: o.outcome === "unrevealed" ? "openAtEnd" : o.outcome });
    }
    const last = rows.at(-1)!;
    const fin = last.state;
    const orderRows: (string | number | null)[][] = [["orderId", "kind", "level", "text", "revealedTurn", "resolvedTurn", "outcome", "failedAttempts", "seat"]];
    for (const [id, o] of orders) orderRows.push([id, o.kind, o.level, o.text, o.revealedTurn, o.resolvedTurn, o.outcome, o.failedAttempts, o.seat]);
    const createdMs = Date.parse(rows[0]!.row.at);
    const summary = {
      startedAt: rows[0]!.row.at,
      endedAt: last.row.at,
      elapsedMs: last.row.elapsedMs,
      setupMs: setupDoneMs === null ? null : setupDoneMs - createdMs,
      n: fin.n,
      reason: fin.result?.reason ?? null,
      ranking: (fin.result?.ranking ?? []).map((x) => ({ ...x, player: who(x.seat) })),
      turns: lastTurn,
      rounds: fin.turn?.round ?? null,
      rulesVersion: rec.meta.rulesVersion,
      engineVersion: rec.meta.engineVersion,
    };
    return {
      "summary.json": JSON.stringify(summary, null, 2) + "\n",
      "turns.csv": csv(turns),
      "points.csv": csv(points),
      "actions.csv": csv(actions),
      "orders.csv": csv(orderRows),
      "farms.csv": csv(farms),
    };
  };

  const named = make((s) => (s === null ? "" : nameOf.get(s) ?? `P${s}`));
  const anon = make((s) => (s === null ? "" : `P${s}`));
  const out: Record<string, string> = { "record.json": JSON.stringify(rec) };
  for (const [k, v] of Object.entries(anon)) out[k] = v;
  for (const [k, v] of Object.entries(named)) out[k.replace(/\.(csv|json)$/, "_named.$1")] = v;
  return out;
}
