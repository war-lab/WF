# WORD FARM v0.1 演じ分け1局（seed 777, 4人）

配役：P0 Aki（作物・上級・日本語2倍）／P1 Ben（交渉好き・ニワトリ）／P2 Chika（牛・初級寄り）／P3 Dan（注文読解・中級）

初期配置（エンジン自動）：sell=6[P0,P1,P2] grow=4[P3,P0] feed=5[P3,P2,P1] buy=8[誰もいない] seed=10[誰もいない] animal=9[誰もいない]
初期注文：#16 wheat×4 / #12 potato+wheat計5 / #2 potato×4 → 全員の初期手札(carrot)では1枚も狙えない

## R1
- P0 Aki 出目8（buyタイル無人）→救済sell。"I grow carrots." 内心：注文は小麦とじゃがいもばかり、でも手札はcarrotしかない。
- P1 Ben 出目8→救済sell。"Does anyone have a chicken or a buy card? I'll give you a sell card." → 全員 "Sorry, no."（不成立）。"I grow carrots." 内心：ニワトリ派なのに動物カードの入手手段がない。
- P2 Chika 出目5→feed(P1,P2,P3)。"I grow carrots." 内心：牛は4コイン、手持ち3コインで買えない。feedだけ増える。
- P3 Dan 出目7 Market day（Aki+wheat, Ben+buy, Chika+sell, Dan+sell）。Dan "Aki, can I have your wheat card? I'll give you a feed card." Aki "No, thanks. I need wheat for the brewery."（不成立）。"I grow carrots." 内心：3枚とも"Anything but carrots"系、にんじんは今は売れない。

## R2
- P0 Aki 出目5→救済grow、にんじん3収穫。"I grow wheat."（エンジンのログは "wheats" と出る＝不可算名詞を複数形にする表示上の誤り）内心：#16の小麦4袋を目指す。
- P1 Ben 出目6→sell(P0,P1,P2)、にんじん3収穫。銀行 feed×3→chicken。"I buy a chicken." 交渉 "Chika, I'll give you a sell card for a feed card." Chika "OK, deal."（成立）。"I feed the chicken."（卵2）。1コイン。内心：銀行でしか動物カードが手に入らない。
- P2 Chika 出目3→救済buy、にんじん3収穫。"I sell a carrot."（4コイン）銀行 sell×3→cow。"I buy a cow."（0コイン）内心：sellが余るので銀行の材料にした。
- P3 Dan 出目8→救済chicken、にんじん3収穫。交渉 "Does anyone have a buy card? I'll give you a feed card." → 誰も持っていない（不成立）。銀行 feed×3→buy。"I buy a chicken."（1コイン）
## R3
- P0 Aki 出目6→sell、小麦3収穫。交渉 "Dan, do you have a grow card? I'll give you a sell card." Dan "Sorry, I don't."（不成立）。"I build a farm house."（seed=10へ、0コイン）銀行 sell×3→grow。内心：小麦あと1つで#16。種カードの入手経路がないので種タイルを取りに行く。
- P1 Ben 出目4→救済feed。"I feed the chicken."（卵4）"I sell a carrot."（2コイン）内心：卵の注文が出るまで溜める。
- P2 Chika 出目10→救済sell（Aki+wheat）。"I feed the cow."（ミルク3）"I sell milk."（3コイン）内心：まず牛で現金を作る。
- P3 Dan 出目11→救済feed。"I feed the chicken."（卵2）注文#2を1コインで流す→#9 "The pancake shop needs milk, eggs and wheat. One of each is enough." 交渉 "Aki, one carrot for one wheat? ... Two carrots?" Aki "Sorry, I need four bags for the brewery."（不成立）。小麦が取れないのでChikaとのミルク交換は見送り。内心：#9は3人の産物を寄せ集めないと作れない。

## R4
- P0 Aki 出目8→救済sell。交渉 "Ben, I'll give you two carrots and a feed card for one egg." Ben "Feed? Sure, deal."（成立）。"Chika, one carrot and a sell card for one milk?" Chika "Sell card... OK!"（成立、Chikaは市場で売るためのsellが欲しい）。"I grow wheat." "I sell milk, an egg and wheat to the pancake shop."→#9達成 3点・2コイン。内心：Danが#9を狙っていたのを見て、先に3人分の産物を交換で集めた。
- P1 Ben 出目6→sell。補充された#7 "No vegetables, please. Just four eggs." "I feed the chicken."（卵5）"I sell four eggs to the customer."→#7達成 3点（fourカードなし、ボーナスなし）。内心：さっきAkiに卵を1つ渡したのが危なかった。
- P2 Chika 出目11→救済grow。#13 を見て "What does 'the same number' mean?"（無料の質問）Dan "Same count, like two and two." "I feed the cow."（ミルク4）"I sell milk."（6コイン）
- P3 Dan 出目9→救済feed。"Does anyone have a potato card?" → 誰も持っていない（不成立）。"I feed the chicken."（卵4）"I sell a carrot."（1コイン）内心：まだ0点。#9を取られたのが痛い。
## R5
- P0 Aki 出目7 Market day、小麦3収穫（計5）。#12（5つ）と#16（4袋）が両方3点なので、少なくて済む#16。"I sell four bags of wheat to the brewery."→6点。"I sell wheat."（5コイン）内心：次の手番にトラクターを買えば7点で勝てる。コインが公開なので全員にばれている。
- P1 Ben 出目7 Market day（Ben+chicken）。勝ち筋がない（あと4点、ポテトの注文ばかり）。"I feed the chicken." "I sell a carrot."（5コイン）内心：Akiを止める手段がない。
- P2 Chika 出目7 Market day（Chika+potato）。"I buy a tractor."（1点）"I grow potatoes." 内心：牛で稼いだコインは点にしか替えられない。
- P3 Dan 出目3→救済potato。"I grow potatoes." "I feed the chicken."（卵6）内心：#14（half a dozen）が出れば即5点なのに。
## R6
- P0 Aki 出目7 Market day。"I buy a tractor."→7点で勝利。

## 結果
Aki 7点（勝利、R6第1手番）／Ben 3点／Chika 1点／Dan 0点。手番総数21。交換 成立3・不成立6。日本語の支払い0回（無料の質問1回）。
