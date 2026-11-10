// 拒否の文言（BD01 9章の表の写し）。docs/app/bd01_engine.md の9章の表から機械的に写した。BD01 を直したら写し直す
export const REJECT_TEXT: Record<string, string> = {
  "PAUSED": "一時停止中です",
  "GAME_OVER": "ゲームは終わりました",
  "WRONG_PHASE": "今はできません",
  "NOT_YOUR_TURN": "自分の手番ではありません",
  "NOT_PROMPTED": "この質問には答えられません",
  "BAD_ANSWER": "選び方が正しくありません",
  "MISSING_CARDS": "カードが足りません",
  "MISSING_PRODUCTS": "産物が足りません",
  "NOT_ENOUGH_COINS": "コインが足りません",
  "NO_TICKET": "無料券がありません",
  "NO_EMPTY_PLOT": "空いている区画がありません",
  "NOT_ANIMAL_PLOT": "その区画に動物はいません",
  "ALREADY_FED": "この手番は餌をやりました",
  "PILE_EMPTY": "そのカードは残っていません",
  "BAD_VERTEX": "そこには置けません",
  "HOUSE_LIMIT": "拠点はこれ以上置けません",
  "NOT_HARBOR_OWNER": "その港は使えません",
  "HARBOR_KIND": "この港では出せないカードです",
  "NOT_FACE_UP": "その注文はもうありません",
  "ORDER_KIND": "この注文には使えません",
  "ORDER_FAILED_THIS_TURN": "この注文はこの手番には届けられません",
  "JOINT_MISMATCH": "その産物と数の行はありません",
  "JOINT_LIMIT": "共同注文はこの手番に出しました",
  "PRODUCT_BUY_LIMIT": "産物はこの手番に買いました",
  "TRADE_PARTIES": "手番の人との間でだけ交換できます",
  "TRADE_EMPTY": "お互いに1つ以上出してください",
  "TRADE_NOT_HOLDING": "持っていない物があります",
  "TRADE_GONE": "その申し出はもうありません",
  "BAD_DICE": "出目を正しく入れてください",
  "BAD_AMOUNT": "数を1つ以上選んでください",
  "ALREADY_ENDING": "すでに最終ラウンドです",
  "NOT_TRADE_PARTY": "この申し出には操作できません",
  "TICKET_NOT_ALLOWED": "宣言しなかった日本語はコインで払います",
  "STALE_TARGET": "手番が変わっています。画面を確かめてください",
  "NOTHING_TO_UNDO": "取り消せる操作がありません",
  "BAD_MESSAGE": "操作を受け付けられませんでした"
};

export function rejectText(code: string): string {
  return REJECT_TEXT[code] ?? "操作を受け付けられませんでした";
}
