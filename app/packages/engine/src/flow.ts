// 状態の移り方（BD01 5〜7章、10章）。apply が写した状態を書き換える関数の集まり。
// ここの関数は前提を確かめない。前提は commands.ts の validate で確かめてから呼ぶ。
import { bagAdd, bagTotal } from "./bag.ts";
import { board } from "./board.ts";
import type { EngineEvent, FaceUpOrderPublic } from "./events.ts";
import { intBetween } from "./rng.ts";
import type {
  AnimalCard,
  ChoiceGroup,
  CropCard,
  Distribution,
  FaceUpOrder,
  GameState,
  Grant,
  PlayerState,
  PointEntry,
  Prompt,
  PromptSource,
  Seat,
  TileId,
  VertexId,
  WordCard,
} from "./types.ts";
import { ANIMAL_CARDS, CROP_CARDS, WORD_CARDS } from "./types.ts";

export type Events = EngineEvent[];

// ---------- 盤面の参照 ----------

const vertexById = new Map(board.vertices.map((v) => [v.id, v]));

export function isVertex(v: unknown): v is VertexId {
  return typeof v === "number" && vertexById.has(v);
}

export function vertexTiles(v: VertexId): TileId[] {
  return vertexById.get(v)?.tiles ?? [];
}

export function vertexNeighbors(v: VertexId): VertexId[] {
  return vertexById.get(v)?.neighbors ?? [];
}

/** 拠点を置ける交点か（空いていて、隣に拠点がない） */
export function canPlaceAt(s: GameState, v: VertexId): boolean {
  if (!isVertex(v)) return false;
  if (s.board.houses[v] !== undefined) return false;
  return vertexNeighbors(v).every((u) => s.board.houses[u] === undefined);
}

export function tileKind(s: GameState, t: TileId) {
  return s.board.tiles[t]!.kind;
}

// ---------- プレイヤーとカード ----------

export function player(s: GameState, seat: Seat): PlayerState {
  const p = s.players[seat];
  if (!p) throw new Error(`席 ${seat} がない`);
  return p;
}

export function handCount(p: PlayerState): number {
  return bagTotal(p.hand);
}

/** 山から1枚を手札へ。山が0なら渡さず false */
export function drawCard(s: GameState, seat: Seat, k: WordCard, n = 1): boolean {
  if (s.piles[k] < n) return false;
  s.piles[k] -= n;
  bagAdd(player(s, seat).hand, k, n);
  return true;
}

/** 手札から山へ戻す */
export function returnCard(s: GameState, seat: Seat, k: WordCard, n = 1): void {
  bagAdd(player(s, seat).hand, k, -n);
  s.piles[k] += n;
}

export function newId(s: GameState, prefix: string): string {
  s.nextId += 1;
  return `${prefix}${s.nextId}`;
}

/** 点を払う。ledger と halfPoints を同時に動かす（BD01 4章の不変条件3） */
export function award(s: GameState, seat: Seat, e: PointEntry): void {
  const p = player(s, seat);
  p.ledger.push(e);
  p.halfPoints += e.hp;
}

/** 手番の人から時計回りの席の並び */
export function clockwiseFrom(s: GameState, start: Seat): Seat[] {
  return Array.from({ length: s.n }, (_, i) => (start + i) % s.n);
}

export function groupKinds(g: ChoiceGroup): readonly WordCard[] {
  return g === "crop" ? CROP_CARDS : g === "animal" ? ANIMAL_CARDS : WORD_CARDS;
}

export function availableKinds(s: GameState, g: ChoiceGroup): WordCard[] {
  return groupKinds(g).filter((k) => s.piles[k] > 0);
}

/** タイルの種類から、渡すカード（決まった種類）か選ぶまとまり */
export function tileGrant(kind: string): { fixed: WordCard | null; group: ChoiceGroup | null } {
  if (kind === "seed") return { fixed: null, group: "crop" };
  if (kind === "animal") return { fixed: null, group: "animal" };
  return { fixed: kind as WordCard, group: null };
}

// ---------- 注文の公開 ----------

export function publicOrder(f: FaceUpOrder): FaceUpOrderPublic {
  return {
    slot: f.slot,
    id: f.order.id,
    text: f.order.text,
    picture: f.order.picture,
    isBonus: f.order.isBonus,
    to: f.order.to,
    counterSeat: f.counterSeat,
    remaining: f.remaining,
    revealedTurn: f.revealedTurn,
  };
}

/** 山から1枚を指定の slot に表にする。山が0なら何もしない */
export function refillOrder(s: GameState, slot: number, counterSeat: Seat, ev: Events): void {
  const o = s.orders.deck.shift();
  if (!o) return;
  const f: FaceUpOrder = { slot, order: o, counterSeat, remaining: s.config.orderExpireTurns, revealedTurn: s.turn?.serial ?? 0 };
  s.orders.faceUp.push(f);
  s.orders.faceUp.sort((a, b) => a.slot - b.slot);
  ev.push({ k: "ordersRevealed", orders: [publicOrder(f)], reason: "refill" });
}

export function refillJoint(s: GameState, slot: number, ev: Events): void {
  const j = s.joint.deck.shift();
  if (!j) return;
  s.joint.faceUp.push({ slot, joint: j, rows: [null, null, null], counter: null });
  s.joint.faceUp.sort((a, b) => a.slot - b.slot);
  ev.push({ k: "jointRevealed", jointId: j.id, slot });
}

/** 表も山も0枚なら終了の印を立てる（BD01 7.5 手順4、8.1） */
export function flagIfOrdersOut(s: GameState, ev: Events): void {
  if (s.endFlag) return;
  if (s.orders.faceUp.length === 0 && s.orders.deck.length === 0 && s.orders.revealed) {
    s.endFlag = { reason: "orders", at: s.turn?.serial ?? 0 };
    ev.push({ k: "endFlagged", reason: "orders", at: s.endFlag.at });
  }
}

// ---------- 勝ちと終わり（BD01 10章） ----------

function ranking(s: GameState) {
  const ps = s.players.map((p) => ({ seat: p.seat, halfPoints: p.halfPoints, coins: p.coins }));
  return ps.map((p) => ({
    ...p,
    rank: 1 + ps.filter((q) => q.halfPoints > p.halfPoints || (q.halfPoints === p.halfPoints && q.coins > p.coins)).length,
  }))
    .sort((a, b) => a.rank - b.rank || a.seat - b.seat)
    .map((r) => ({ seat: r.seat, rank: r.rank, halfPoints: r.halfPoints, coins: r.coins }));
}

function clearTrades(s: GameState, ev: Events, reason: "turnEnd" | "gameOver"): void {
  for (const t of s.trades) ev.push({ k: "tradeWithdrawn", id: t.id, reason });
  s.trades = [];
}

/** 勝ちで終える（BD01 10.1） */
export function winNow(s: GameState, seat: Seat, ev: Events): void {
  clearTrades(s, ev, "gameOver");
  s.prompts = [];
  s.answers = {};
  s.dist = null;
  s.phase = { k: "over" };
  s.result = { reason: "target", winnerSeat: seat, ranking: ranking(s) };
  ev.push({ k: "gameOver", result: s.result, finalHalf: [] });
}

/** 点が増えたあとの判定。main の段階で手番の人が目標以上なら勝ち */
export function checkWinInMain(s: GameState, ev: Events): void {
  if (s.phase.k !== "main" || !s.turn) return;
  const p = player(s, s.turn.seat);
  if (p.halfPoints >= s.config.targetHalfPoints) winNow(s, p.seat, ev);
}

/** 注文切れ、ホストの宣言、中止で終える（BD01 10.2、8.5） */
export function finishGame(s: GameState, reason: "orders" | "host" | "aborted", ev: Events): void {
  const finalHalf: PointEntry[] = [];
  for (const f of s.joint.faceUp) {
    f.rows.forEach((row, i) => {
      if (!row) return;
      const e: PointEntry = {
        src: "jointHalf",
        jointId: f.joint.id,
        row: i as 0 | 1 | 2,
        hp: Math.floor(f.joint.lines[i]!.hp / 2),
        turn: s.turn?.serial ?? 0,
        reason: "gameEnd",
      };
      award(s, row.seat, e);
      finalHalf.push(e);
    });
  }
  clearTrades(s, ev, "gameOver");
  s.prompts = [];
  s.answers = {};
  s.dist = null;
  s.phase = { k: "over" };
  s.result = { reason, winnerSeat: null, ranking: ranking(s) };
  ev.push({ k: "gameOver", result: s.result, finalHalf });
}

// ---------- 準備（BD01 6章） ----------

/** setupPlace の step で置く人 */
export function setupPlacer(s: GameState, step: number): Seat {
  return step < s.n ? step : 2 * s.n - 1 - step;
}

/** 拠点の配置を1つ進める。すべて置いたら3人戦の問いか、準備の完了へ */
export function advanceSetup(s: GameState, nextStep: number, ev: Events): void {
  if (nextStep < 2 * s.n) {
    s.phase = { k: "setupPlace", step: nextStep };
    return;
  }
  if (s.n === 3 && s.config.threePlayerExtraCard > 0) {
    const grants: Grant[] = [];
    for (const seat of clockwiseFrom(s, 0)) {
      for (let i = 0; i < s.config.threePlayerExtraCard; i++) {
        grants.push({ seat, fixed: null, group: "any", tile: null, status: "pending" });
      }
    }
    startDistribution(s, "threePlayer", grants, ev, null);
    return;
  }
  finishSetup(s, ev);
}

/** 準備の完了。コインを配り、共同注文を表にして最初の手番を始める（BD01 6.2） */
export function finishSetup(s: GameState, ev: Events): void {
  for (const p of s.players) p.coins += s.config.seatCoins[s.n][p.seat] ?? 0;
  for (let slot = 0; slot < s.config.jointFaceUp; slot++) refillJoint(s, slot, ev);
  startTurn(s, 0, ev);
}

// ---------- 手番（BD01 7章） ----------

export function startTurn(s: GameState, seat: Seat, ev: Events): void {
  const serial = (s.turn?.serial ?? 0) + 1;
  const round = (s.turn?.round ?? 0) + (seat === 0 ? 1 : 0);
  s.turn = {
    serial,
    seat,
    round,
    dice: null,
    fedPlots: [],
    jointRowDone: false,
    productBought: false,
    failedOrders: [],
    receivedIncome: false,
  };
  player(s, seat).ownTurns += 1;
  ev.push({ k: "turnStarted", seat, serial, round });

  // ラウンド3の初めに注文を表にする
  if (round === s.config.orderRevealRound && seat === 0 && !s.orders.revealed) {
    s.orders.revealed = true;
    const shown: FaceUpOrderPublic[] = [];
    for (let slot = 0; slot < s.config.orderFaceUp; slot++) {
      const o = s.orders.deck.shift();
      if (!o) break;
      const f: FaceUpOrder = { slot, order: o, counterSeat: 0, remaining: s.config.orderExpireTurns, revealedTurn: serial };
      s.orders.faceUp.push(f);
      shown.push(publicOrder(f));
    }
    ev.push({ k: "ordersRevealed", orders: shown, reason: "round3" });
    flagIfOrdersOut(s, ev);
  }

  // 手番の初めの勝ち
  if (player(s, seat).halfPoints >= s.config.targetHalfPoints) {
    winNow(s, seat, ev);
    return;
  }
  s.phase = { k: "roll" };
}

/** サイコロの目を受けて収入を始める（BD01 7.2） */
export function handleDice(s: GameState, dice: [number, number], manual: boolean, ev: Events): void {
  const t = s.turn!;
  t.dice = dice;
  ev.push({ k: "diceRolled", seat: t.seat, dice, manual });
  const sum = dice[0] + dice[1];
  if (sum === 7) {
    startSeven(s, ev);
    return;
  }
  const grants: Grant[] = [];
  for (const seat of clockwiseFrom(s, t.seat)) {
    for (const v of player(s, seat).houses) {
      for (const tile of vertexTiles(v)) {
        const bt = s.board.tiles[tile]!;
        if (bt.kind === "market" || bt.number !== sum) continue;
        const g = tileGrant(bt.kind);
        grants.push({ seat, fixed: g.fixed, group: g.group, tile, status: "pending" });
      }
    }
  }
  startDistribution(s, "income", grants, ev, null);
}

export function rollServerDice(s: GameState): [number, number] {
  return [intBetween(s.rng, 1, 6), intBetween(s.rng, 1, 6)];
}

function startSeven(s: GameState, ev: Events): void {
  const prompts: Prompt[] = [];
  for (const seat of clockwiseFrom(s, s.turn!.seat)) {
    const c = handCount(player(s, seat));
    if (c >= s.config.sevenThreshold) {
      prompts.push({ id: newId(s, "p"), k: "discard", seat, count: Math.floor(c / 2) });
    }
  }
  if (prompts.length > 0) {
    s.prompts = prompts;
    s.answers = {};
    s.phase = { k: "income" };
    ev.push({
      k: "promptsOpened",
      prompts: prompts.map((p) => ({ promptId: p.id, seat: p.seat, kind: "discard", count: p.count, reissued: false })),
    });
    return;
  }
  startMarketDay(s, ev);
}

function startMarketDay(s: GameState, ev: Events): void {
  const grants: Grant[] = clockwiseFrom(s, s.turn!.seat).map((seat) => ({
    seat,
    fixed: null,
    group: "any",
    tile: null,
    status: "pending",
  }));
  startDistribution(s, "marketDay", grants, ev, null);
}

/** 7の捨て札の答えを処理する（BD01 7.2 の出目7の手順2） */
export function resolveDiscards(s: GameState, ev: Events): void {
  const bySeat = new Map(s.prompts.map((p) => [p.seat, p]));
  for (const seat of clockwiseFrom(s, s.turn!.seat)) {
    const p = bySeat.get(seat);
    if (!p) continue;
    const a = s.answers[p.id];
    if (!a || a.k !== "discard") throw new Error("捨て札の答えがない");
    for (const k of WORD_CARDS) {
      const n = a.cards[k] ?? 0;
      if (n > 0) returnCard(s, seat, k, n);
    }
    ev.push({ k: "cardsDiscarded", seat, cards: { ...a.cards } });
  }
  s.prompts = [];
  s.answers = {};
  startMarketDay(s, ev);
}

// ---------- カードを配る処理（BD01 6.1、6.2、7.2） ----------

const qkey = (seat: Seat, g: ChoiceGroup) => `${seat}|${g}`;

export function startDistribution(
  s: GameState,
  source: PromptSource,
  grants: Grant[],
  ev: Events,
  setupStep: number | null,
): void {
  s.dist = { source, grants, cursor: 0, queue: {}, promptKeys: {}, setupStep };
  // 種類を選ぶ権利について、席とまとまりごとに問いを作る。選べる種類がなければ「もらえない」
  const prompts = openPrompts(s, s.dist, 0, null, false);
  if (prompts.length > 0) {
    waitForPrompts(s, prompts, ev);
    return;
  }
  continueDistribution(s, ev);
}

/**
 * from 以降の未処理の選ぶ権利について、問いを作る。onlyKey を指定すると、その席とまとまりだけ。
 * 選べる種類がないまとまりは、権利を none にして問いを作らない。
 */
function openPrompts(s: GameState, d: Distribution, from: number, onlyKey: string | null, reissued: boolean): Prompt[] {
  const counts = new Map<string, { seat: Seat; group: ChoiceGroup; count: number }>();
  for (let i = from; i < d.grants.length; i++) {
    const g = d.grants[i]!;
    if (g.status !== "pending" || g.group === null) continue;
    const key = qkey(g.seat, g.group);
    if (onlyKey !== null && key !== onlyKey) continue;
    const c = counts.get(key) ?? { seat: g.seat, group: g.group, count: 0 };
    c.count += 1;
    counts.set(key, c);
  }
  const prompts: Prompt[] = [];
  for (const [key, c] of counts) {
    const options = availableKinds(s, c.group);
    if (options.length === 0) {
      for (let i = from; i < d.grants.length; i++) {
        const g = d.grants[i]!;
        if (g.status === "pending" && g.group !== null && qkey(g.seat, g.group) === key) g.status = "none";
      }
      continue;
    }
    const id = newId(s, "p");
    d.promptKeys[id] = key;
    prompts.push({
      id,
      k: "chooseKind",
      seat: c.seat,
      options,
      count: c.count,
      source: d.source,
      preset: presetFor(s, d.source, c.seat, c.group, options),
      reissued,
    });
  }
  return prompts;
}

function presetFor(s: GameState, source: PromptSource, seat: Seat, g: ChoiceGroup, options: WordCard[]): WordCard | null {
  if (source !== "income" || g === "any") return null;
  const last = player(s, seat).lastChoice[g];
  return last !== null && options.includes(last) ? last : null;
}

function waitForPrompts(s: GameState, prompts: Prompt[], ev: Events): void {
  s.prompts = prompts;
  s.answers = {};
  s.phase = s.turn ? { k: "income" } : { k: "setupPrompt" };
  ev.push({
    k: "promptsOpened",
    prompts: prompts.map((p) => ({
      promptId: p.id,
      seat: p.seat,
      kind: p.k,
      count: p.count,
      reissued: p.k === "chooseKind" ? p.reissued : false,
    })),
  });
}

/** 問いの答えがそろったときの処理。答えを権利の列へ移し、配る処理を再開する */
export function resolveChoices(s: GameState, ev: Events): void {
  const d = s.dist!;
  for (const p of s.prompts) {
    if (p.k !== "chooseKind") continue;
    const a = s.answers[p.id];
    if (!a || a.k !== "chooseKind") throw new Error("種類の答えがない");
    const key = d.promptKeys[p.id];
    if (key === undefined) throw new Error("問いのまとまりがない");
    d.queue[key] = [...a.kinds];
    const group = key.split("|")[1] as ChoiceGroup;
    if (d.source === "income" && group !== "any") {
      const pl = player(s, p.seat);
      if (group === "crop") pl.lastChoice.crop = a.kinds[0] as CropCard;
      else pl.lastChoice.animal = a.kinds[0] as AnimalCard;
    }
  }
  s.prompts = [];
  s.answers = {};
  d.promptKeys = {};
  continueDistribution(s, ev);
}

function giveGrant(s: GameState, d: Distribution, g: Grant, k: WordCard, ev: Events): void {
  drawCard(s, g.seat, k);
  g.status = "given";
  if (d.source === "income" && s.turn && g.seat === s.turn.seat) s.turn.receivedIncome = true;
  ev.push({ k: "cardsGranted", seat: g.seat, cards: { [k]: 1 }, reason: d.source, tile: g.tile });
}

/** 権利の列を cursor から処理する。選んだ山が尽きていたら止めて、その人に問いを出し直す（BD01 7.2 手順5） */
function continueDistribution(s: GameState, ev: Events): void {
  const d = s.dist!;
  while (d.cursor < d.grants.length) {
    const g = d.grants[d.cursor]!;
    if (g.status !== "pending") {
      d.cursor += 1;
      continue;
    }
    if (g.fixed !== null) {
      if (s.piles[g.fixed] > 0) giveGrant(s, d, g, g.fixed, ev);
      else g.status = "empty";
      d.cursor += 1;
      continue;
    }
    const key = qkey(g.seat, g.group!);
    const q = d.queue[key] ?? [];
    const k = q.shift();
    d.queue[key] = q;
    if (k !== undefined && s.piles[k] > 0) {
      giveGrant(s, d, g, k, ev);
      d.cursor += 1;
      continue;
    }
    // 選んだ山が尽きている。その人の同じまとまりの残りの権利について問いを作り直す
    d.queue[key] = [];
    const prompts = openPrompts(s, d, d.cursor, key, true);
    if (prompts.length > 0) {
      waitForPrompts(s, prompts, ev);
      return;
    }
    // 選べる種類がない。残りの権利は none になったので、このまま続ける
  }
  finishDistribution(s, d, ev);
}

function finishDistribution(s: GameState, d: Distribution, ev: Events): void {
  s.dist = null;
  switch (d.source) {
    case "setupTile":
      advanceSetup(s, (d.setupStep ?? 0) + 1, ev);
      return;
    case "threePlayer":
      finishSetup(s, ev);
      return;
    case "income": {
      const t = s.turn!;
      if (!t.receivedIncome) {
        const grants: Grant[] = [{ seat: t.seat, fixed: null, group: "any", tile: null, status: "pending" }];
        startDistribution(s, "relief", grants, ev, null);
        return;
      }
      harvest(s, ev);
      return;
    }
    case "relief":
    case "marketDay":
      harvest(s, ev);
      return;
  }
}

// ---------- 収穫（BD01 7.3） ----------

function harvest(s: GameState, ev: Events): void {
  const t = s.turn!;
  const p = player(s, t.seat);
  p.plots.forEach((plot, i) => {
    if (plot.t === "crop" && plot.plantedOwnTurn < p.ownTurns) {
      bagAdd(p.products, plot.crop, s.config.cropYield);
      ev.push({ k: "harvested", seat: p.seat, plot: i, crop: plot.crop, n: s.config.cropYield });
      p.plots[i] = { t: "empty" };
    }
  });
  s.phase = { k: "main" };
}

// ---------- 手番の終わり（BD01 7.5） ----------

export function endTurn(s: GameState, ev: Events): void {
  const t = s.turn!;
  for (const tr of s.trades) ev.push({ k: "tradeWithdrawn", id: tr.id, reason: "turnEnd" });
  s.trades = [];

  // 通常の注文の時間切れ
  for (const f of [...s.orders.faceUp].sort((a, b) => a.slot - b.slot)) {
    if (f.counterSeat !== t.seat || f.revealedTurn === t.serial) continue;
    f.remaining -= 1;
    if (f.remaining <= 0) {
      s.orders.faceUp = s.orders.faceUp.filter((x) => x !== f);
      ev.push({ k: "orderExpired", orderId: f.order.id, slot: f.slot });
      refillOrder(s, f.slot, f.counterSeat, ev);
    }
  }

  // 共同注文の時間切れ
  for (const f of [...s.joint.faceUp].sort((a, b) => a.slot - b.slot)) {
    const c = f.counter;
    if (!c || c.seat !== t.seat || c.startedTurn === t.serial) continue;
    c.remaining -= 1;
    if (c.remaining <= 0) {
      const rows: { row: number; seat: Seat; hp: number }[] = [];
      f.rows.forEach((row, i) => {
        if (!row) return;
        const hp = Math.floor(f.joint.lines[i]!.hp / 2);
        award(s, row.seat, { src: "jointHalf", jointId: f.joint.id, row: i as 0 | 1 | 2, hp, turn: t.serial, reason: "expire" });
        rows.push({ row: i, seat: row.seat, hp });
      });
      s.joint.faceUp = s.joint.faceUp.filter((x) => x !== f);
      ev.push({ k: "jointExpired", jointId: f.joint.id, rows });
      refillJoint(s, f.slot, ev);
    }
  }

  flagIfOrdersOut(s, ev);
  ev.push({ k: "turnEnded", seat: t.seat, serial: t.serial });

  if (s.endFlag && t.seat === s.n - 1) {
    finishGame(s, s.endFlag.reason, ev);
    return;
  }
  startTurn(s, (t.seat + 1) % s.n, ev);
}
