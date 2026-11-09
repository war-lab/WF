// 大画面の効果音（BD04 6章）。音は大画面だけで鳴らし、スマホは鳴らさない。
// 素材は紹介動画の効果音（video/public/audio/se）の写し。出典は art/sound_licenses.md
// ブラウザは、利用者の操作のあとでないと音を鳴らさない。H01 の「部屋を開く」などの操作で鳴らせる状態になる
import { useCallback } from "react";
import type { GameEvent } from "@word-farm/protocol";

const SE: Partial<Record<string, string[]>> = {
  housePlaced: ["plant"],
  houseBuilt: ["plant"],
  cardsGranted: ["card"],
  harvested: ["harvest"],
  planted: ["plant"],
  animalBought: ["plant"],
  fed: ["harvest"],
  productsSold: ["coin"],
  animalSold: ["coin"],
  cardBought: ["coin"],
  productBought: ["coin"],
  orderSucceeded: ["deliver"],
  orderFailed: ["expire"],
  ordersRevealed: ["card"],
  orderExpired: ["expire"],
  jointRowFilled: ["card"],
  jointCompleted: ["deliver"],
  jointExpired: ["expire"],
  bankTraded: ["card"],
  harborTraded: ["card"],
  tradeAccepted: ["trade"],
  turnStarted: ["card"],
  gameOver: ["fanfare", "win_jingle"],
};

const cache = new Map<string, HTMLAudioElement>();
function playFile(name: string, delayMs = 0): void {
  window.setTimeout(() => {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(`/audio/se/${name}.mp3`);
      cache.set(name, a);
    }
    a.currentTime = 0;
    void a.play().catch(() => undefined); // 操作の前は鳴らせない。鳴らなくても続ける
  }, delayMs);
}

export function useSounds(): (e: GameEvent) => void {
  return useCallback((e: GameEvent) => {
    if (e.k === "diceRolled") {
      playFile(e.dice[0] + e.dice[1] === 7 ? "market_day" : "dice");
      return;
    }
    const files = SE[e.k];
    if (!files) return;
    // 宣言の結果の音は、結果を出す約3秒後に合わせる（BD04 6章）
    const delay = e.k === "orderSucceeded" || e.k === "orderFailed" ? 3000 : 0;
    files.forEach((f, i) => playFile(f, delay + i * 1800));
  }, []);
}
