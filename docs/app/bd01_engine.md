# 基本設計 BD01 ルールエンジン

更新日：2026-10-26

位置づけ：アプリのルールエンジン（`app/packages/engine`）の基本設計。型、状態の移り方、コマンドごとの前提と効果、拒否の理由を定める。

上位の方針は `WORD_FARM_APP_DESIGN_v0.1.md`（以下、方式設計）の5章を正とし、ここでは繰り返さない。ゲームのルールは `word_farm_rules.html`（ルールブック v0.9）を正とする。

注文の条件、点の計算、英文の組み立ては BD02 で定める。

## 結論

エンジンは `GameState` とコマンドを受け取り、新しい `GameState` と出来事の列を返す純粋な関数である。

席の番号は、開始プレイヤーを0とし、時計回りに1、2、3と振る。ラウンドの最後の人は常に席 n−1 になり、終了の判定が単純になる。

カードの山は種類ごとに有限で、銀行と港の交換、カードの購入、収入は山から取り、使ったカードと捨てたカードは山に戻す。産物とコインは無限とする。

点は半点の整数で持つ。8点は16である。

1つのコマンドの処理は、前提の確認、費用の支払い、効果、付随する処理（勝ちの判定、注文の補充、終了の印）の順で行い、前提を1つでも満たさなければ状態を変えずに拒否する。

## 1. 用語と識別子

| 用語 | 型 | 内容 |
|---|---|---|
| 席 | `Seat`（0〜3） | 開始プレイヤーが0。時計回りに増える |
| 手番の通し番号 | `TurnSerial`（1から） | ゲームの最初の手番を1とし、手番ごとに1増える。時間切れの数え方に使う |
| 自分の手番の回数 | `ownTurns` | その人の手番が始まった回数。作物の収穫に使う |
| ラウンド | `round`（1から） | 席0の手番が始まるたびに1増える |
| 交点 | `VertexId` | 盤面データ（方式設計5.4）の交点の番号 |
| タイル | `TileId` | 盤面データのタイルの番号。中央の Market も含む |
| 注文の識別子 | `OrderId` | 1つのゲームの中で一意の文字列。生成した順の番号から作る（例 `o07`、共同注文は `j03`） |

### 1.1 席を決める手順

アプリは、実際にテーブルを囲む人の時計回りの並びを知らないと、席の順番を決められない。そこで、ロビー（BD04）で次の手順を踏む。

1. 参加者がスマホで名前を入れて参加する。この時点の識別子は参加の順番で、席ではない。
2. ホストが大画面で、参加者を時計回りの並びに並べ替える。
3. ゲームの作成時に、エンジンが開始プレイヤーを乱数で選び、その人を席0として、時計回りの並びどおりに席を振り直す。

ロビーでは、ほかに次をホストが大画面で行う（操作の形は BD03 の `AdminOp`）。

- 色を割り当てる。既定は参加の順に赤、青、緑、黄とする。
- 上級者の倍率（`japaneseRate`）を参加者ごとに決める。既定は1倍。
- 参加者を外す。

5人目の参加は、サーバーがロビーの段階で断る。参加者が3人か4人でなければ、ゲームを作成できない。

## 2. 型の定義

### 2.1 基本の列挙

```ts
type ActionCard = "grow" | "buy" | "feed" | "sell";
type CropCard = "carrot" | "potato" | "wheat";
type AnimalCard = "cow" | "chicken";
type WordCard = ActionCard | CropCard | AnimalCard;   // 9種類

type Crop = CropCard;                                  // 作物の産物
type Product = "carrot" | "potato" | "wheat" | "egg" | "milk";
type Animal = AnimalCard;

type TileKind = "grow" | "buy" | "feed" | "sell" | "seed" | "animal" | "market";
type HarborKind = "any" | Exclude<TileKind, "market">;   // 汎用港と専門港6種類

type HalfPoints = number;   // 半点の整数。8点 = 16
type Bag<K extends string> = Partial<Record<K, number>>;   // 数の入れ物。0の項目は持たない
```

`Bag` は、0の項目を持たない形に正規化する。比較と保存の結果を、項目の順番や0の有無で変えないためである。

### 2.2 盤面

```ts
interface BoardState {
  tiles: { id: TileId; kind: TileKind; number: number | null }[];   // number は Market だけ null
  harbors: { vertex: VertexId; kind: HarborKind }[];               // 6つ
  houses: Partial<Record<VertexId, Seat>>;                         // 交点 → 置いた人
}
```

タイルの位置、交点の座標、隣接は盤面データ（方式設計5.4）にあり、状態には持たない。状態に持つのは、ゲームごとに変わるタイルの種類、港の種類、拠点の位置だけである。

### 2.3 プレイヤー

```ts
type Plot =
  | { t: "empty" }
  | { t: "crop"; crop: Crop; plantedOwnTurn: number }     // 植えたときの ownTurns
  | { t: "animal"; animal: Animal };

interface PlayerState {
  seat: Seat;
  participantId: string;       // ロビーでの識別子。名前は持たない（下記）
  color: "red" | "blue" | "green" | "yellow";
  hand: Bag<WordCard>;         // 秘密
  freeTickets: number;         // 0〜2
  japaneseRate: 1 | 2;         // 上級者の倍率（ルールブック07章）
  products: Bag<Product>;
  coins: number;
  halfPoints: HalfPoints;
  plots: [Plot, Plot, Plot, Plot];
  houses: VertexId[];          // 置いた順。2個目の判定に使う
  ownTurns: number;
  ledger: PointEntry[];        // 点の内訳
}

type PointEntry =
  | { src: "order"; orderId: OrderId; hp: HalfPoints; coins: number; turn: TurnSerial }
  | { src: "bonus"; orderId: OrderId; hp: HalfPoints; coins: number; turn: TurnSerial }
  | { src: "jointRow"; jointId: OrderId; row: 0 | 1 | 2; hp: HalfPoints; turn: TurnSerial }
  | { src: "jointFinish"; jointId: OrderId; hp: 1; turn: TurnSerial }
  | { src: "jointHalf"; jointId: OrderId; row: 0 | 1 | 2; hp: HalfPoints; turn: TurnSerial; reason: "expire" | "gameEnd" };
```

エンジンの状態に参加者の名前を持たないのは、状態のスナップショットと記録に名前を残さないためである。名前はサーバーが `participantId` から引き、表示の時に付ける（BD05）。

`ledger` は記録の書き出し（方式設計10章）の「点の出どころ」に使う。`halfPoints` は `ledger` の `hp` の合計と常に等しい（4章の不変条件）。

### 2.4 注文

注文の中身（英文、条件、点）の型は BD02 で定める。ここでは、場に置かれた状態だけを定める。

```ts
interface FaceUpOrder {
  slot: 0 | 1 | 2;            // 表示の位置。補充しても同じ位置に置く
  order: Order;               // BD02。cond、hp、level は viewFor で隠す（BD02 1章）
  counterSeat: Seat;          // 時間切れを数える人（表にした人）
  remaining: number;          // 時間切れまでの残り（最初は3）
  revealedTurn: TurnSerial;   // 表にした手番。この手番の終わりは数えない
}

interface FaceUpJoint {
  slot: 0 | 1;
  joint: JointOrder;          // BD02。行の産物と数は viewFor で隠し、英文と行の点だけを見せる
  rows: [JointRowFill | null, JointRowFill | null, JointRowFill | null];   // joint.lines と同じ順
  counter: { seat: Seat; remaining: number; startedTurn: TurnSerial } | null;   // 最初の行が出るまで null
}

interface JointRowFill { seat: Seat; turn: TurnSerial }
```

### 2.5 手番と問い

```ts
type Phase =
  | { k: "lobby" }
  | { k: "setupPlace"; step: number }      // 拠点の配置。step は 0〜2n−1
  | { k: "setupPrompt" }                   // 準備の問い（2個目のカード、3人戦の1枚）
  | { k: "roll" }                          // サイコロを待つ
  | { k: "income" }                        // 収入の問いを待つ
  | { k: "main" }                          // 交渉と行動
  | { k: "over" };

interface TurnState {
  serial: TurnSerial;
  seat: Seat;                  // 手番の人
  round: number;
  dice: [number, number] | null;
  fedPlots: number[];          // 餌をやった区画の番号
  jointRowDone: boolean;       // 共同注文に出したか
  productBought: boolean;      // 銀行で産物を買ったか
  failedOrders: OrderId[];     // この手番に不成立になった注文
  receivedIncome: boolean;     // 救済の判定用
}

type Prompt =
  | { id: string; k: "chooseKind"; seat: Seat; options: WordCard[]; count: number; source: PromptSource }
  | { id: string; k: "discard"; seat: Seat; count: number };

type PromptSource = "setupTile" | "threePlayer" | "income" | "marketDay" | "relief";
```

`chooseKind` は「種類を選んで1枚もらう」問いの共通の形である。`count` は、同じ人が同じ場面で選ぶ枚数（例：seed のタイル2枚の角に拠点がある）。`options` は、問いを作った時点で山が残っている種類だけを入れる。

1つの問いの `options` には、作物だけ、動物だけ、全種類のどれかしか入れない。seed と animal の両方の権利を持つ人には、作物の問いと動物の問いを別々に出す（7.2）。作物と動物を1つの問いにすると、作物2枚を選ぶような、権利と合わない答えを形の上で防げないためである。

### 2.6 ゲームの状態

```ts
interface GameState {
  rulesVersion: string;        // "0.9"
  config: RuleConfig;          // 方式設計5.3
  rng: RngState;               // BD02 4章
  n: 3 | 4;
  board: BoardState;
  piles: Record<WordCard, number>;
  players: PlayerState[];      // 席の順
  orders: { deck: Order[]; faceUp: FaceUpOrder[]; revealed: boolean };
  joint: { deck: JointOrder[]; faceUp: FaceUpJoint[] };
  turn: TurnState | null;      // 準備中は null
  phase: Phase;
  prompts: Prompt[];
  answers: Record<string, PromptAnswer>;   // 届いた答え。全員そろうまで処理しない
  trades: TradeOffer[];
  endFlag: { reason: "orders" | "host"; at: TurnSerial } | null;
  result: GameResult | null;
}

interface TradeOffer {
  id: string;
  from: Seat; to: Seat;
  give: Goods; get: Goods;     // from が渡す物、from が受け取る物
  turn: TurnSerial;
}
interface Goods { cards: Bag<WordCard>; products: Bag<Product>; coins: number }

interface GameResult {
  reason: "target" | "orders" | "host" | "aborted";
  winnerSeat: Seat | null;     // target のときだけ
  ranking: { seat: Seat; rank: number; halfPoints: HalfPoints; coins: number }[];   // 同順位は同じ rank
}
```

## 3. ルール設定の既定値（v0.9）

方式設計5.3の項目の既定値を示す。値はルールブック v0.9 から取った。

| キー | 値 | ルールブック |
|---|---|---|
| `targetHalfPoints` | 16 | 01章 |
| `initialHand` | grow 1、sell 1 | 02章 |
| `freeTickets` | 2 | 02章、07章 |
| `seatCoins` | 4人戦 [3,3,4,5]、3人戦 [3,3,4] | 02章 |
| `threePlayerExtraCard` | 1 | 02章 |
| `cardCounts` | grow 14、buy 8、feed 14、sell 18、carrot 8、potato 8、wheat 8、cow 6、chicken 6 | 09章 |
| `maxHouses` | 3 | 05章 |
| `houseCost` | 5 | 05章 |
| `plots` | 4 | 05章 |
| `cropYield` | 3 | 05章 |
| `animalCost` | chicken 2、cow 4 | 05章 |
| `animalExtraCard` | cow に grow | 05章 |
| `carrotExtraCard` | feed | 05章 |
| `animalSellPrice` | chicken 1、cow 2 | 05章 |
| `feedYield` | chicken → egg 2、cow → milk 3 | 05章 |
| `marketPrice` | potato 1、wheat 1、egg 1、carrot 2、milk 2 | 05章 |
| `productBuyPrice` | potato 10、wheat 10、egg 10、carrot 15、milk 15 | 04章 |
| `productBuyPerTurn` | 1 | 04章 |
| `cardBuyPrice` | 5 | 04章 |
| `bankRatio`、`genericHarborRatio`、`specialHarborRatio` | 4、3、2 | 04章 |
| `sevenThreshold` | 7 | 03章 |
| `orderFaceUp`、`orderRevealRound`、`orderExpireTurns`、`orderCoins` | 3、3、3、2 | 06章 |
| `jointFaceUp`、`jointExpireTurns`、`jointFinishHalfPoints` | 2、3、1 | 06章 |
| `japaneseCost` | word 1、talk 2、undeclared 2 | 07章 |
| `animalInclude` | false（動物の頭数の注文に動物の指定を付けない。BD02 6章 Q1） | 08章 |
| `orderDeck` | `generated`（36枚）か `fixed`（08章の印刷用） | 06章、08章 |
| `dice` | `server` か `manual` | 方式設計6章 |

## 4. 不変条件

どのコマンドを適用したあとも、次が成り立つ。性質のテスト（方式設計11.2）でこれを確かめる。

1. 各種類の単語カードについて、山の枚数と全員の手札の枚数の合計が、`cardCounts` の値に等しい。
2. 手札、産物、コイン、無料券、山の枚数は負にならない。
3. 各プレイヤーの `halfPoints` は、`ledger` の `hp` の合計に等しい。
4. 拠点は、どの2つも隣り合う交点にない。1人の拠点は `maxHouses` 個以下。
5. 表の注文は `orderFaceUp` 枚以下で、`slot` が重ならない。表の共同注文も同じ。
6. `phase` が `main` のときだけ `trades` に申し出がある。
7. `prompts` が空でないとき、`phase` は `setupPrompt` か `income` である。
8. `phase` が `over` なら `result` がある。
9. 表の共同注文は、3行そろっていない。3行目が埋まった時点で完成として場から除くためである（8.1.1）。

## 5. 盤面の生成

`createGame` の中で、次の順に乱数を引く。乱数を引く順番を固定するのは、同じ種から同じゲームを再現するためである。

1. 開始プレイヤーを選ぶ（1.1）。
2. タイルの種類を割り当てる。出やすいマス（数字が5、6、8、9の6マス）と出にくいマス（2、3、4、10、11、12の6マス）を、それぞれシャッフルする。6種類の順番もシャッフルし、k番目の種類を、出やすいマスの k 番目と出にくいマスの k 番目に置く。次の2つを満たすまでやり直す。
   - sell の出やすい方のマスの数字が6か8
   - 同じ種類のタイルが隣り合わない
3. 港の種類を割り当てる。汎用港2つは盤面データで決まっている。専門港4つには、6種類から重複なしに4つを引いて、盤面データの港の順に割り当てる。
4. 注文の山と共同注文の山を作る（BD02）。

手順2は `sim/mapwf.py` の `layout_tiles` と同じ方式である。やり直しの上限は5000回とし、超えたら例外にする。模擬では、この上限に達したことはない。

## 6. 準備の進み方

### 6.1 拠点の配置

`setupPlace` の `step` が k のとき、置く人は次のとおり。

- k < n なら席 k
- k ≥ n なら席 2n−1−k

席 n−1 は、step n−1 と step n で続けて2個置く（ルールブック02章）。

`placeHouse(vertex)` の前提は、置く人であること、交点が空いていること、隣の交点に拠点がないことである。

2個目の拠点（k ≥ n）を置いたら、その交点に接するタイル（Market を除く）1枚につき1枚を配る。種類が決まっているタイルは山から直接配り、seed と animal は `chooseKind` の問いを作る。この問いは置いた人にだけ出し、`phase` を `setupPrompt` にする。答えて処理したら `setupPlace` の次の `step` に戻る。答えるまで次の人は置けない。拠点の配置は順番に行うため、同時に聞く利点がない。

### 6.2 3人戦の追加の1枚と、コイン

すべての拠点を置き終えたら、3人戦では全員に `chooseKind`（`source: "threePlayer"`、全種類）を同時に出す。答えは席0から順に処理する。

続いて `seatCoins` を配り、共同注文を2枚表にし、最初の手番を始める。通常の注文は表にしない。

最初の手番を始める時点を、方式設計5.9の「準備の完了」とする。サーバーは、ここから経過の時間を数え、大画面に出す。

## 7. 手番の進み方

### 7.1 手番の初め

`startTurn` は、手番の人を決めたあとにエンジンが自動で行う処理である。コマンドではない。

1. `turn` を作る。`serial` を1増やし、席0なら `round` を1増やす。手番の人の `ownTurns` を1増やす。
2. `round` が `orderRevealRound` で、席0の手番で、まだ注文を表にしていなければ、山から3枚を表にする。3枚とも `counterSeat` は0、`revealedTurn` はこの手番の `serial` とする。
3. 手番の人の `halfPoints` が `targetHalfPoints` 以上なら、その人の勝ちでゲームを終える（10章）。
4. `phase` を `roll` にする。

### 7.2 収入

`rollDice()` は、手番の人が `roll` の段階で送る。サーバーが乱数でサイコロ2個を振る。`dice: manual` の設定では、代わりに `inputDice(a, b)` を受け付ける。

出目が7以外の場合は、次の手順で処理する。

1. 受け取る権利の一覧を作る。手番の人から時計回りに、各人の拠点の順に、その交点に接するタイルのうち数字が出目と同じものを並べる。1つの権利が1枚である。
2. 一覧のうち、seed と animal の権利について、`chooseKind` の問いを作る。1人につき、seed の権利をまとめた作物の問いと、animal の権利をまとめた動物の問いを、別々に作る。`count` にはそれぞれの権利の数を入れる。`options` には、山が残っている種類だけを入れる。`options` が空なら、その問いは作らず、対応する権利は「もらえない」とする。
3. 問いがあれば `phase` を `income` にし、全員の答えを待つ。
4. 答えがそろったら、一覧の順に1枚ずつ処理する。種類が決まっている権利は、その山に残りがあれば渡し、なければ渡さない。選んだ権利は、答えの種類の山に残りがあれば渡す。
5. 選んだ種類の山が尽きている権利に当たったら、その時点で処理を止める。その人に、同じ問い（作物か動物）の残りの権利について問いを作り直す。`options` は、その時点で山が残っている種類だけとし、空なら残りの権利は「もらえない」として処理を続ける。答えを得たら、止めた権利から一覧の順に処理を再開する。
6. 手番の人が1枚も受け取らなかったら、救済の `chooseKind`（全種類のうち山が残っているもの、`count` 1）を手番の人に出す。

手順5で処理を止めるのは、ルールブック03章の「手番の人から時計回りに取る」を保つためである。一覧の最後まで処理してから出し直すと、時計回りで後の人が、先に出し直すべき人より先に残りのカードを取ってしまう。

出目が7の場合は、次の手順で処理する。

1. 単語カードを `sevenThreshold` 枚以上持っている人全員に、`discard`（`count` は枚数の半分の切り捨て）を出す。無料券は数えない。
2. 答えがそろったら、手番の人から時計回りに、捨てたカードを山に戻す。
3. 全員に `chooseKind`（全種類のうち山が残っているもの、`count` 1、`source: "marketDay"`）を出す。
4. 答えがそろったら、手番の人から時計回りに処理する。選んだ山が尽きていた人に当たったら、7以外の手順5と同じく、その時点で処理を止めて問いを作り直し、答えを得てからその人から再開する。
5. 救済の1枚はない（ルールブック10章）。

収入をすべて処理したら、収穫（7.3）に進む。

### 7.3 収穫

手番の人の区画のうち、作物があり、`plantedOwnTurn < ownTurns` のものを、すべて収穫する。1区画につき `cropYield` 個の産物を渡し、区画を空にする。

`plantedOwnTurn < ownTurns` は、前の自分の手番までに植えた作物、を表す。今の手番に植えた作物は `plantedOwnTurn == ownTurns` となり、収穫されない。

収穫のあと、`phase` を `main` にする。

### 7.4 交渉と行動

`main` の段階では、手番の人は8章のコマンドを好きな順に何度でも送れる。手番でない人が送れるのは、交換の申し出と承諾（8.3）と、日本語の支払い（8.4）だけである。

### 7.5 手番の終わり

`endTurn()` の前提は、手番の人であること、`phase` が `main` であることである。処理は次の順で行う。

1. `trades` を空にする。
2. 表の注文のうち、`counterSeat` が手番の人で、`revealedTurn` がこの手番でないものの `remaining` を1減らす。0になったら、捨てて山から補充する。補充した注文の `counterSeat` は同じ人、`revealedTurn` はこの手番とする。
3. 表の共同注文のうち、`counter` があり、`counter.seat` が手番の人で、`startedTurn` がこの手番でないものの `remaining` を1減らす。0になったら時間切れとし、出された行それぞれについて、行を出した人に行の点の半分（半点の整数で `floor(hp / 2)`）を払う。カードを捨て、共同注文の山から補充する。
4. 表の注文も注文の山も0枚で、`endFlag` がなければ、`endFlag` を `orders` にする。
5. `endFlag` があり、手番の人が席 n−1 なら、ゲームを終える（10章）。
6. 次の席の手番を始める（7.1）。

手順2と3は、`slot` の小さい順に処理する。

手順3で払った点では、手番の人であっても勝ちにしない（方式設計5.7）。この点は次の自分の手番の初め（7.1の手順3）で判定する。

`callLastRound` で、`endFlag` を `host` にする（8.5）。ルールブック01章の70分の打ち切りは、MVP ではホストがこの操作で行う（方式設計5.9）。

## 8. コマンド

各コマンドについて、前提、費用、効果を示す。前提を満たさないときの拒否理由は9章の符号で示す。

すべての行動と銀行のコマンドには、次の共通の前提がある。以下の表では繰り返さない。

- `phase` が `main` である（`WRONG_PHASE`）
- 送った人が手番の人である（`NOT_YOUR_TURN`）

### 8.1 行動

| コマンド | 前提 | 費用 | 効果 |
|---|---|---|---|
| `plant(crop)` | 空き区画がある | grow 1、crop 1。carrot なら feed 1も | 最も番号の小さい空き区画に作物を置く。`plantedOwnTurn` は今の `ownTurns` |
| `buyAnimal(animal)` | 空き区画がある | buy 1、animal 1、コイン（chicken 2、cow 4）。cow なら grow 1も | 最も番号の小さい空き区画に動物を置く |
| `feed(plot)` | その区画に動物がいる。この手番にその区画に餌をやっていない | feed 1 | chicken なら egg 2、cow なら milk 3 |
| `sellProducts(product, n)` | n ≥ 1。産物を n 個以上持つ | sell 1、産物 n | コイン（市場価格 × n） |
| `sellAnimal(plot)` | その区画に動物がいる | sell 1 | コイン（chicken 1、cow 2）。区画を空にする |
| `deliverOrder(orderId, items)` | 表の注文である。この手番に不成立になっていない。`items` の産物を持つ。`items` が空でない。ボーナス注文と動物の頭数の注文ではない（違えば `ORDER_KIND`） | sell 1 | BD02 の判定。成立なら産物を渡し、点とコインを得て、補充する。不成立なら産物は戻り、sell は山に戻る |
| `deliverBonus(orderId, product, n)` | 表のボーナス注文である。この手番に不成立になっていない。n ≥ 1。産物を n 個以上持つ | sell 1 | BD02 の判定。成立と不成立の扱いは `deliverOrder` と同じ |
| `claimAnimalOrder(orderId)` | 表の動物の頭数の注文である。この手番に不成立になっていない | なし | BD02 の判定。成立なら点とコインを得て補充する。動物は手放さない。不成立なら何も失わない |
| `contributeJoint(jointId, product, n)` | 表の共同注文である。この手番に共同注文に出していない。産物を n 個以上持つ。空いている行のうち、産物と数が `product` と n にちょうど一致する行がある（なければ `JOINT_MISMATCH`） | sell 1、産物 n | 一致した行を埋める。最初の行なら `counter` を作る。3行そろえば完成（8.1.1） |
| `buildHouse(vertex)` | 拠点が `maxHouses` 個未満。交点が空いていて、隣の交点に拠点がない | コイン5 | 拠点を置く。カードはもらえない |

「最も番号の小さい空き区画」に置くのは、区画を選ぶ操作を省くためである。区画の位置はゲームに影響しない。

`contributeJoint` は、共同注文の行の産物と数を、本人が英文から読み取って指定する形とする。ルールブック08章が、共同注文で「読み解く対象は、どの産物をいくつ出すか」としているためである。合わない指定は受け付けず、sell も産物も失わない（ルールブック06章「行と合わない数や産物を出したときは受け付けない（カードも産物も戻す）」）。そのため不成立ではなく拒否として扱う。

`deliverOrder` を頭数の注文やボーナス注文に送るような、注文の種類とコマンドの食い違いは `ORDER_KIND` で拒否し、sell を失わない。紙では、頭数の注文に産物と sell を出す読み違えは不成立になる。しかし注文の種類は英文と色で見分けられ、スマホの入力画面も種類ごとに分かれるため、この場面は起きにくい。紙からの意図した逸脱として、方式設計6章の対応表に載せる。

`deliverOrder` で不成立になったとき、使った sell は捨てる（山に戻す）。`turn.failedOrders` に注文を加える。`claimAnimalOrder` の不成立も、`failedOrders` に加える（ルールブック06章「動物の頭数の注文も同じ」）。

不成立になった注文の条件と点は、出来事 `orderFailed` で全員に一度見せるが、表示用の状態（BD03）では再び隠す。ルールブック06章の「開いた折り返しは元に戻す」に合わせるためである。成立した注文の条件は公開したままにし、ゲームが終わったらすべての注文の条件を公開する。

注文が成立して補充した場合、補充した注文の `counterSeat` は手番の人、`revealedTurn` はこの手番とする。補充した注文にも、同じ手番のうちに届けてよい（ルールブック06章）。

注文が成立して表も山も0枚になった場合は、その場で `endFlag` を `orders` にする。

#### 8.1.1 共同注文の完成

3行目が埋まったら、次を行う。

1. 各行について、行を出した人に行の点を払う（`ledger` は `jointRow`）。
2. 3行目を出した人に、`jointFinishHalfPoints`（1、つまり0.5点）を払う（`ledger` は `jointFinish`）。
3. コインは払わない。
4. カードを捨て、共同注文の山に残りがあれば1枚を表にする。同じ `slot` に置く。山が尽きていれば補充しない。

この点で手番の人が8点以上になれば、その場で勝つ（10章）。手番でない人は、その人の手番の初めに判定する。

### 8.2 銀行

| コマンド | 前提 | 費用 | 効果 |
|---|---|---|---|
| `bankTrade(give, get)` | `give` を4枚以上持つ。`get` の山に残りがある | `give` 4枚 | `get` 1枚 |
| `harborTrade(vertex, give, get)` | その交点が港で、自分の拠点がある。汎用港なら `give` を3枚、専門港なら2枚以上持つ。専門港なら `give` が港の種類に合う。`get` の山に残りがある | `give` 3枚か2枚 | `get` 1枚 |
| `buyCard(kind)` | コインが5以上。`kind` の山に残りがある | コイン5 | `kind` 1枚 |
| `buyProduct(product)` | この手番に産物を買っていない。コインが価格以上 | コイン10か15 | 産物1つ |

港の種類に合う、とは次のことである。

| 港の種類 | 出せるカード |
|---|---|
| grow、buy、feed、sell | その種類のカード |
| seed | carrot、potato、wheat のどれか1種類 |
| animal | cow、chicken のどれか1種類 |

出すカードは常に1種類だけである（ルールブック02章「種類を混ぜて出すことはできない」）。コマンドの形が `give` を1種類しか表せないため、混ぜて出すことは形の上で起きない。

### 8.3 交換

交換は、方式設計9.4の流れで行う。

`proposeTrade(to, give, get)` の前提は次のとおり。

- `phase` が `main` である
- 送った人と `to` のどちらかが手番の人で、2人は別の人である（ルールブック04章）
- `give` と `get` のどちらも空でない（双方が1つ以上を出す）
- `give` と `get` は単語カード、産物、コインだけ（型で保証する）
- 送った人が `give` を持っている

同じ人から同じ相手への申し出がすでにあれば、新しい申し出で置き換える。古い申し出の承諾が、新しい申し出に対して通ることを防ぐため、申し出の `id` は置き換えるたびに作り直す。

`respondTrade(id, accept)` の前提は、申し出の `to` が送った人であることである。`accept` が真なら、その時点で両者が出す物を持っているかを確かめ、持っていれば交換する。持っていなければ `TRADE_NOT_HOLDING` で拒否し、申し出は残す。持ち物が変われば、あとで承諾し直せるためである。

交換が成立した場合と、`accept` が偽（断った）の場合は、その申し出を `trades` から消す。

`withdrawTrade(id)` は、申し出を出した本人だけが送れる。

### 8.4 日本語の支払い

`payJapanese(kind, method)` は、`main` の段階なら、手番の人でなくても送れる。

| `kind` | `method` | 支払い |
|---|---|---|
| `word` | `coin` | コイン 1 × 倍率。足りなければ拒否 |
| `word` | `ticket` | 無料券1枚。なければ拒否 |
| `talk` | `coin` | コイン 2 × 倍率。足りなければ拒否 |
| `talk` | `ticket` | 無料券1枚。なければ拒否 |
| `undeclared` | `coin` | コイン 2 × 倍率。足りなければ持っている分 |

宣言せずに話した場合に無料券を使えないのは、ルールブック07章が無料券の用途を「日本語の単語1つか、交渉1件分」としているためである。

`undeclared` を `ticket` で払うコマンドは `TICKET_NOT_ALLOWED` で拒否する。

無料券に倍率を掛けない（2倍の人も1枚で済む）。ルールブックに定めがないため、BD02 6章の Q3 で確定した扱いである。

`main` 以外の段階（収入の問いの途中など）でも日本語は話されうるが、支払いは `main` の段階だけで受け付ける。問いの最中は短く、支払いを後で押せば足りるためである。

### 8.5 時刻と管理

| コマンド | 送る者 | 前提 | 効果 |
|---|---|---|---|
| `answerFor(promptId, answer)` | 管理 | 問いが残っている | その人の代わりに答える |
| `endTurnFor(turnSerial)` | 管理 | `phase` が `main`。`turnSerial` が今の手番の通し番号と一致する（違えば `STALE_TARGET`） | 手番の人の代わりに `endTurn` |
| `callLastRound()` | 管理 | `phase` が `over` でない。`endFlag` がない（あれば `ALREADY_ENDING`） | 7.5のとおり `endFlag` を `host` にする。どの段階でも受け付ける |
| `abortGame()` | 管理 | `phase` が `over` でない | 方式設計5.9の終わり方の手順2と3を行い、`reason: "aborted"` で終える |

`endTurnFor` に手番の通し番号を持たせるのは、ホストが古い表示を見て押したときに、すでに始まった次の人の手番を終えてしまうことを防ぐためである。

### 8.6 問いへの答え

`answerPrompt(promptId, answer)` は、問いの対象の人だけが送れる。前提は、一時停止していないこと、問いが残っていることである。すでに答えていても送れる（下記）。

| 問い | 答えの形 | 確かめること |
|---|---|---|
| `chooseKind` | 種類の列（長さ `count`） | 各種類が `options` に含まれる |
| `discard` | 単語カードの `Bag`（合計 `count` 枚） | 手札にその枚数がある |

答えは `answers` に入れるだけで、全員の答えがそろうまで処理しない（7.2）。そろう前なら、同じ人が答えを送り直せる。最後の答えを処理に使う。

山が尽きているかは、答えを受け取る時点では確かめない。処理の時点で尽きていた場合の扱いは7.2の手順5のとおりである。

### 8.7 サーバーが行うもの

取り消し（`undoLast`）、一時停止と再開、席の再発行は、エンジンのコマンドではない。サーバーが行う。取り消しは状態の写しの読み込み（BD05 2.9）、一時停止は部屋の時計の状態（BD05 3.3）、席の再発行は参加者の管理（BD03 3.6）である。

## 9. 拒否の理由

| 符号 | 意味 | スマホに出す文言 |
|---|---|---|
| `PAUSED` | 一時停止中（サーバーが返す。BD05 3.3） | 一時停止中です |
| `GAME_OVER` | ゲームが終わっている | ゲームは終わりました |
| `WRONG_PHASE` | 今の段階では送れない | 今はできません |
| `NOT_YOUR_TURN` | 手番の人ではない | 自分の手番ではありません |
| `NOT_PROMPTED` | その問いの対象ではない、問いがもうない | この質問には答えられません |
| `BAD_ANSWER` | 答えが問いに合わない（種類、枚数） | 選び方が正しくありません |
| `MISSING_CARDS` | 必要なカードがない | カードが足りません |
| `MISSING_PRODUCTS` | 必要な産物がない | 産物が足りません |
| `NOT_ENOUGH_COINS` | コインが足りない | コインが足りません |
| `NO_TICKET` | 無料券がない | 無料券がありません |
| `NO_EMPTY_PLOT` | 空き区画がない | 空いている区画がありません |
| `NOT_ANIMAL_PLOT` | 区画に動物がいない | その区画に動物はいません |
| `ALREADY_FED` | この手番に餌をやった | この手番は餌をやりました |
| `PILE_EMPTY` | 山にその種類がない | そのカードは残っていません |
| `BAD_VERTEX` | 置けない交点 | そこには置けません |
| `HOUSE_LIMIT` | 拠点が上限 | 拠点はこれ以上置けません |
| `NOT_HARBOR_OWNER` | 港の交点に拠点がない | その港は使えません |
| `HARBOR_KIND` | 港の種類と合わない | この港では出せないカードです |
| `NOT_FACE_UP` | 表の注文ではない | その注文はもうありません |
| `ORDER_KIND` | 注文の種類とコマンドが合わない | この注文には使えません |
| `ORDER_FAILED_THIS_TURN` | この手番に不成立になった | この注文はこの手番には届けられません |
| `JOINT_MISMATCH` | 空いている行に、産物と数がちょうど一致する行がない | その産物と数の行はありません |
| `JOINT_LIMIT` | この手番に共同注文に出した | 共同注文はこの手番に出しました |
| `PRODUCT_BUY_LIMIT` | この手番に産物を買った | 産物はこの手番に買いました |
| `TRADE_PARTIES` | 交換の当事者が不正 | 手番の人との間でだけ交換できます |
| `TRADE_EMPTY` | どちらかが何も出さない | お互いに1つ以上出してください |
| `TRADE_NOT_HOLDING` | 出す物を持っていない | 持っていない物があります |
| `TRADE_GONE` | 申し出がない | その申し出はもうありません |
| `BAD_DICE` | `inputDice` の出目が1〜6でない、または `dice: server` の設定で送った | 出目を正しく入れてください |
| `BAD_AMOUNT` | 数が1未満（`sellProducts` の n、`deliverOrder` の空の `items`、`deliverBonus` の n） | 数を1つ以上選んでください |
| `ALREADY_ENDING` | `callLastRound` を、`endFlag` が立ったあとに送った | すでに最終ラウンドです |
| `NOT_TRADE_PARTY` | `respondTrade` を相手以外が、`withdrawTrade` を出した本人以外が送った | この申し出には操作できません |
| `TICKET_NOT_ALLOWED` | 宣言しなかった日本語を無料券で払おうとした | 宣言しなかった日本語はコインで払います |
| `STALE_TARGET` | `endTurnFor` の通し番号が今の手番と違う。`undoLast` の `seq` が最後の有効な行と違う（管理だけ） | 手番が変わっています。画面を確かめてください |
| `NOTHING_TO_UNDO` | 取り消せる行がない（サーバーが返す。BD05 2.9。管理だけ） | 取り消せる操作がありません |
| `BAD_MESSAGE` | メッセージの形が正しくない（サーバーが返す。BD03） | 操作を受け付けられませんでした |

注文が不成立になるのは拒否ではない。コマンドは受け付けられ、出来事 `orderFailed` が出る。拒否と不成立を分けるのは、不成立には sell を失うという結果があるためである。

## 10. 勝ちと終わり

### 10.1 勝ち

点が増える処理のあと、次の2つが両方成り立てば、その場でゲームを終える。

- `phase` が `main` で、点を得たのが手番の人である
- その人の `halfPoints` が `targetHalfPoints` 以上である

点が増える処理は、注文の成立、ボーナス注文の成立、動物の頭数の注文の成立、共同注文の完成である。

7.1の手順3の判定と合わせて、ルールブック01章の2つの勝ち方を満たす。

勝ちで終えたときは、`trades` を空にし、`phase` を `over` にする。`result.reason` は `target`、`winnerSeat` は手番の人とする。`ranking` は点とコインで付ける（10.2の手順3）。

### 10.2 注文切れとホストの宣言による終わり

7.5の手順5で終えるときは、次の順で処理する。

1. 表の共同注文のうち、行が1つ以上出ているものについて、行を出した人に行の点の半分を払う（`ledger` は `jointHalf`、`reason: "gameEnd"`）。7.5の手順3で時間切れになったカードは、すでに捨てているため対象にならない。
2. `trades` を空にし、`phase` を `over` にする。
3. 点の多い順に並べ、同点ならコインの多い順にする。点もコインも同じ人は同じ順位とする。

## 11. 操作の一覧（legalActions）

`legalActions(state, seat)` は、そのプレイヤーのスマホに出すボタンの状態を返す。

```ts
interface Hint<T> { value: T; enabled: boolean; reason?: RejectCode }

interface ActionHints {
  // 準備
  placeHouse?: { vertices: VertexId[] };                 // 置ける交点。自分が置く番のときだけ
  // 問い
  prompts: { prompt: Prompt; answer: PromptAnswer | null }[];   // 自分が答えるべき問い。答え済みも残し、今の答えを持たせる
  // 収入
  rollDice?: Hint<null>;
  // 行動
  plant: Hint<Crop>[];
  buyAnimal: Hint<Animal>[];
  feed: Hint<number>[];                                  // 区画の番号
  sellProducts: { product: Product; max: number }[];     // max は持っている数。sell がなければ空
  sellAnimal: Hint<number>[];
  deliver: Hint<{ orderId: OrderId; kind: "normal" | "bonus" | "animals" }>[];
  contributeJoint: Hint<{ jointId: OrderId }>[];        // 行は本人が産物と数で指定する（8.1）
  buildHouse: Hint<{ vertices: VertexId[] }>;
  // 銀行
  bankTrade: { give: WordCard[]; get: WordCard[] };      // 4枚以上持つ種類と、山が残る種類
  harborTrade: { vertex: VertexId; kind: HarborKind; give: WordCard[]; get: WordCard[] }[];
  buyCard: Hint<{ kinds: WordCard[] }>;
  buyProduct: Hint<{ products: Product[] }>;
  // 交換と日本語
  tradePartners: Seat[];                                 // 申し出を出せる相手
  japanese: { word: Hint<"coin" | "ticket">[]; talk: Hint<"coin" | "ticket">[]; undeclared: Hint<"coin"> };
  // 手番
  endTurn?: Hint<null>;
}
```

`deliver` の `kind` は、スマホが入力画面を選ぶために使う（通常は産物と数、ボーナスは種類と数、頭数は入力なし）。注文の種類は英文と色で公開されている情報であり、条件ではない。

`deliver` の `enabled` は、届ける前提（8.1）を満たすかだけを表す。通常の注文とボーナス注文は sell を持っていることを含み、動物の頭数の注文は sell を含まない（ルールブック05章「なし（sellカード不要）」）。条件を満たすかは含めない。含めると、条件を満たす注文だけが押せることになり、読解を問う意味がなくなる（方式設計6章）。

`contributeJoint` の `enabled` は、sell を持ち、この手番に共同注文に出しておらず、空いている行があるかだけを表す。どの行に合う産物を持っているかは含めない。含めると、行の産物と数を読み取る必要がなくなるためである。

`legalActions` が `enabled: true` を返した操作は、そのまま `apply` に渡せば必ず受け付けられる。方式設計11.2の性質のテストで、これを確かめる。

## 12. 出来事

`apply` は、状態の差分ではなく、画面の演出と記録に使う出来事を返す。出来事の一覧は BD03 で定める。

## 付録

### 付録 A 経緯

| 日付 | 出来事 |
|---|---|
| 2026-10-26 | 初版を作成 |
| 2026-10-26 | 6観点の多角レビューを反映。共同注文を産物と数で指定する形、収入の問いの分け方と出し直しの順番、不成立の条件を再び隠すこと、`endTurnFor` の通し番号、状態から名前を除くこと、拒否の符号の追加と削除 |
| 2026-10-27 | 70分の自動の打ち切りをやめた。`markTimeUp`、`timeUp`、`timeLimitMinutes`、`timeLimitEnabled`、`ALREADY_TIME_UP` を除き、管理の `callLastRound` と `ALREADY_ENDING` を加えた。`endFlag` の理由 `time` を `host` に替えた（方式設計5.9） |
| 2026-10-27 | 多角レビューを反映。一時停止をエンジンから外し（`paused`、`pause`、`resume` を削除。`PAUSED` はサーバーが返す）、`NOTHING_TO_UNDO` を加え、使わなくなった `STORAGE_ERROR` を除いた。10.2 の見出しと 8.7 を直した |
