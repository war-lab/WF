// ルール設定の既定値（BD01 3章）。値はルールブック v0.9 から取った。
import type { RuleConfig } from "./types.ts";

export const RULES_VERSION = "0.9";

export function defaultConfig(): RuleConfig {
  return {
    rulesVersion: RULES_VERSION,
    targetHalfPoints: 16,
    initialHand: { grow: 1, sell: 1 },
    freeTickets: 2,
    seatCoins: { 3: [3, 3, 4], 4: [3, 3, 4, 5] },
    threePlayerExtraCard: 1,
    cardCounts: { grow: 14, buy: 8, feed: 14, sell: 18, carrot: 8, potato: 8, wheat: 8, cow: 6, chicken: 6 },
    maxHouses: 3,
    houseCost: 5,
    plots: 4,
    cropYield: 3,
    animalCost: { chicken: 2, cow: 4 },
    animalExtraCard: { cow: "grow" },
    carrotExtraCard: "feed",
    animalSellPrice: { chicken: 1, cow: 2 },
    feedYield: { chicken: { product: "egg", n: 2 }, cow: { product: "milk", n: 3 } },
    marketPrice: { potato: 1, wheat: 1, egg: 1, carrot: 2, milk: 2 },
    productBuyPrice: { potato: 10, wheat: 10, egg: 10, carrot: 15, milk: 15 },
    productBuyPerTurn: 1,
    cardBuyPrice: 5,
    bankRatio: 4,
    genericHarborRatio: 3,
    specialHarborRatio: 2,
    sevenThreshold: 7,
    orderFaceUp: 3,
    orderRevealRound: 3,
    orderExpireTurns: 3,
    orderCoins: 2,
    jointFaceUp: 2,
    jointExpireTurns: 3,
    jointFinishHalfPoints: 1,
    japaneseCost: { word: 1, talk: 2, undeclared: 2 },
    animalInclude: false,
    orderDeck: "generated",
    dice: "server",
  };
}
