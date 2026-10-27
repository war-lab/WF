# 基本設計 BD03 表示用の状態と通信

更新日：2026-10-27

位置づけ：サーバーが端末に送る表示用の状態（`viewFor` の結果）、出来事（`GameEvent`）、端末とサーバーの間のメッセージを定める。

上位の方針は `WORD_FARM_APP_DESIGN_v0.1.md`（以下、方式設計）の5.11と7章を正とする。状態の型は BD01、注文の型は BD02 を正とする。

## 結論

表示用の状態は2種類である。大画面に送る `BoardView` は公開情報だけを持ち、スマホに送る `PlayerView` は `BoardView` に本人の秘密の情報を足したものである。

`PlayerView` を `BoardView` の拡張にするのは、秘密を隠す処理を1か所（公開情報の切り出し）にまとめ、隠し漏れを性質のテストで確かめやすくするためである。

注文の条件と点は、届けると宣言したときの出来事にだけ載せる。成立した注文は、その後も条件を見られる。不成立だった注文は、`view` では再び隠す。時間切れで流れた注文の条件は公開しない。ゲームが終わったら、表と山のすべての注文の条件を公開する。

共同注文は、英文と3行の点だけを見せ、行の産物と数は見せない。どの産物をいくつ出すかは、英文から読み解く対象だからである（ルールブック08章）。

出来事は、収入で得たカード、7で捨てたカード、交換の申し出と中身を含めて、すべて公開とする。紙でも、表向きの山から取る、山に戻す、口頭で交渉するため、場の全員に見えるからである。例外は、問いへの答えの中身で、処理されるまでは本人にしか見せない。

メッセージは JSON で、端末から送るものは4KB、サーバーから送るものは64KBを上限とする。1回の `view` は、4人戦の終盤で約13KBと見積もる（未検証）。

## 1. 表示用の状態

### 1.1 公開と秘密の区分

方式設計5.11の表を、`GameState` のフィールドごとに展開する。

| `GameState` のフィールド | 大画面 | 本人のスマホ | 他人のスマホ |
|---|---|---|---|
| `players[].hand` | 枚数だけ | 中身 | 枚数だけ |
| `players[].freeTickets` | 枚数 | 枚数 | 枚数 |
| `players[]` のそのほか（産物、コイン、点、区画、拠点、内訳） | 見える | 見える | 見える |
| `orders.faceUp[].order.cond`、`hp` | 送らない（宣言の出来事にだけ載せる。1.2） | 同左 | 同左 |
| `orders.faceUp[].order.level` | 送らない | 送らない | 送らない |
| `orders.faceUp[].order` のそのほか（英文、絵、ボーナスか、宛先） | 見える | 見える | 見える |
| `orders.deck` | 枚数だけ | 枚数だけ | 枚数だけ |
| `joint.faceUp` | 英文、行の点、行を出した人 | 同左 | 同左 |
| `joint.faceUp[].joint.lines` の産物と数 | 送らない | 送らない | 送らない |
| `joint.deck` | 枚数だけ | 枚数だけ | 枚数だけ |
| `piles` | 見える | 見える | 見える |
| `prompts` | 誰が答え待ちか | 自分の問いの中身 | 誰が答え待ちか |
| `answers` | 答えたかだけ | 自分の答えの中身 | 答えたかだけ |
| `trades` | 見える | 見える | 見える |
| `rng` | 送らない | 送らない | 送らない |
| `config` | 見える | 見える | 見える |

手札の枚数と銀行の山の枚数を公開するのは、ルールブック02章の「手札は枚数だけ公開」と、山が表向きであること（ルールブック01章）に合わせるためである。

`trades` を公開し、申し出を大画面にも出すのは、交渉を口頭で行い、場の全員に聞こえるためである。申し出が手元のスマホだけに出ると、口頭の英語を使わずにスマホだけで交換が成立し、交渉を英語で行うルール（ルールブック04章）と日本語の支払い（07章）が働かなくなる。申し出に条件を変えて返す操作は作らない（方式設計9.4）。

注文の `level`（易、中、難）を送らないのは、紙で見分けられるのが、絵のある「易」と色の違うボーナス注文だけだからである（ルールブック06章）。「難」と分かると、半ダース、合計、同数のどれかだという手がかりになる。クライアントには `picture` と `isBonus` だけを送る。

### 1.2 注文の条件を公開する時点

| 出来事 | 条件と点の公開 |
|---|---|
| 届けると宣言して成立した | 公開する |
| 届けると宣言して不成立だった | 出来事 `orderFailed` にだけ載せ、`view` では再び隠す |
| 動物の頭数の注文に宣言した | 成立なら公開する。不成立なら上と同じ |
| 時間切れで流れた | 公開しない |
| ゲームが終わった | 表と山のすべてを公開する |

宣言した注文の条件を出来事に載せるのは、紙で折り返しを開いて全員で確かめる手順（ルールブック06章）に合わせるためである。大画面は、`orderSucceeded` と `orderFailed` の演出で条件を見せる（BD04）。

不成立の注文の条件を `view` で再び隠すのは、ルールブック06章の「開いた折り返しは元に戻す」に合わせるためである。紙では一度見ただけで、あとは記憶に頼る。`view` に残すと、全員が条件を見ながら届けられ、紙より易しくなる。

成立した注文は表から消え、達成した人の前に置かれる（ルールブック06章）ため、条件を見られるままにする。

時間切れで流れた注文の条件を公開しないのは、紙で、流れたカードを開かずに捨てるためである。

ゲームの終わりに全部を公開するのは、終わったあとの振り返り（どの注文を読み違えたか）に使うためである。

### 1.3 型

```ts
interface BoardView {
  kind: "board";
  rev: number;                       // 方式設計7.3
  rulesVersion: string;
  config: RuleConfig;
  n: 3 | 4;
  phase: Phase;
  paused: boolean;
  endFlag: { reason: "orders" | "host"; at: TurnSerial } | null;
  clock: ClockView;                  // 1.4
  board: BoardState;                 // BD01 2.2。そのまま
  piles: Record<WordCard, number>;
  players: PublicPlayer[];
  turn: TurnView | null;
  orders: {
    faceUp: FaceUpOrderView[];
    deckCount: number;
    revealed: boolean;               // ラウンド3の公開が済んだか
  };
  joint: { faceUp: FaceUpJointView[]; deckCount: number };
  revealedOrders: RevealedOrder[];   // 成立した注文の条件（表から消えたもの）
  promptStatus: { promptId: string; seat: Seat; k: "chooseKind" | "discard"; count: number; answered: boolean }[];
  trades: TradeOffer[];              // BD01 2.6。そのまま
  result: GameResult | null;
  finalReveal: { orders: Order[] } | null;   // ゲームの終わりにだけ。表と山の全注文
}

interface PublicPlayer {
  seat: Seat;
  name: string;                      // サーバーが参加者の表（BD05 2.6）から付ける。エンジンの状態は名前を持たない（BD05 5.3）
  color: Color;
  connected: boolean;                // サーバーが付ける。エンジンの状態ではない
  handCount: number;
  freeTickets: number;
  japaneseRate: 1 | 2;
  products: Bag<Product>;
  coins: number;
  halfPoints: HalfPoints;
  plots: Plot[];                     // BD01 2.3
  houses: VertexId[];
  ledger: PointEntry[];
}

interface TurnView {
  serial: TurnSerial;
  seat: Seat;
  round: number;
  dice: [number, number] | null;
  fedPlots: number[];
  jointRowDone: boolean;
  productBought: boolean;
  failedOrders: OrderId[];
}

interface FaceUpOrderView {
  slot: 0 | 1 | 2;
  id: OrderId;
  text: string;
  picture: Product | null;
  isBonus: boolean;
  to: string | null;
  counterSeat: Seat;
  remaining: number;
  revealedTurn: TurnSerial;
  // cond、hp、level は持たない（1.1）
}

interface FaceUpJointView {
  slot: 0 | 1;
  id: OrderId;
  text: string;
  to: string;
  rowPoints: [HalfPoints, HalfPoints, HalfPoints];   // 行の点だけ。産物と数は持たない
  rows: [{ seat: Seat } | null, { seat: Seat } | null, { seat: Seat } | null];
  counter: { seat: Seat; remaining: number; startedTurn: TurnSerial } | null;
}

interface RevealedOrder {
  id: OrderId;
  text: string;
  cond: OrderCondition;
  hp: HalfPoints | null;
  declaredBy: Seat;
  turn: TurnSerial;
}

interface PlayerView extends Omit<BoardView, "kind"> {
  kind: "player";
  me: {
    seat: Seat;
    hand: Bag<WordCard>;
    prompts: Prompt[];               // BD01 2.5。自分の問いの中身
    answers: Record<string, PromptAnswer>;   // 自分の答えの中身
  };
  legal: ActionHints;                // BD01 11章
}
```

`TurnView` は `TurnState` から `receivedIncome` を除いたものである。`receivedIncome` は救済の判定に使うだけで、表示に要らない。

`FaceUpOrderView` と `FaceUpJointView` は、`cond`、`hp`、`level`、行の産物と数を持たない型として定義する。`viewFor` は、元の注文を写してから消すのではなく、見せてよい項目だけを選んで組み立てる。写してから消す作りにすると、消し忘れで漏れるためである。

共同注文の行を出すときは、スマホで行と、出す産物と数を選ばせる（BD04）。行と合わない物を選んだ場合は受け付けない（ルールブック06章、BD01）。

### 1.4 時計

```ts
interface ClockView {
  startedAt: number | null;          // 準備の完了の時刻（サーバーの時計、ミリ秒）
  elapsedMs: number;                 // 送った時点の経過時間（一時停止の分を除く）
  serverNow: number;                 // 送った時点のサーバーの時刻
}
```

時計はエンジンの状態ではなく、サーバーが `view` を送るときに付ける。エンジンは時刻を読まないためである（方式設計5.9）。

大画面は `elapsedMs` を受け取った時点から自分で数え進め、次の `view` で合わせ直す。スマホと大画面の時計の差は、`serverNow` と端末の時刻の差から補正する。

## 2. 出来事

### 2.1 共通の形

```ts
interface GameEventBase {
  eventSeq: number;                  // 出来事の通し番号。記録の行の seq（BD05）とは別のもの
  rev: number;                       // この出来事を起こした状態の版
  turn: TurnSerial | null;
  at: number;                        // サーバーの時刻（記録用。エンジンは使わない）
}
type GameEvent = GameEventBase & EventBody;
```

`at` は、エンジンが返した出来事にサーバーが付ける。エンジンは時刻を読まないためである。

### 2.2 一覧

送る先の「全員」は、大画面とすべてのスマホである。「本人」は、その出来事の当事者のスマホだけである。

| 出来事 | 中身 | 送る先 |
|---|---|---|
| `gameCreated` | 盤面、注文の山の枚数、共同注文の表2枚 | 全員 |
| `seatsAssigned` | 参加者ごとの席と色、開始プレイヤー | 全員 |
| `housePlaced` | 席、交点、準備か追加か | 全員 |
| `cardsGranted` | 席、カードの `Bag`、理由（`setupTile`、`threePlayer`、`income`、`marketDay`、`relief`）、タイル | 全員 |
| `promptsOpened` | 問いごとの席、種類、枚数 | 全員（中身は本人だけ。2.3） |
| `promptAnswered` | 問いの `id`、席 | 全員（答えの中身は送らない） |
| `diceRolled` | 席、2つの目、手で振ったか | 全員 |
| `cardsDiscarded` | 席、カードの `Bag` | 全員 |
| `harvested` | 席、区画、作物、数 | 全員 |
| `planted` | 席、区画、作物、英文 | 全員 |
| `animalBought` | 席、区画、動物、英文 | 全員 |
| `fed` | 席、区画、動物、産物と数、英文 | 全員 |
| `productsSold` | 席、産物、数、コイン、英文 | 全員 |
| `animalSold` | 席、区画、動物、コイン、英文 | 全員 |
| `orderDeclared` | 席、注文の `id`、出した物、英文 | 全員 |
| `orderSucceeded` | 席、注文の `id`、条件、点、コイン、出した物 | 全員 |
| `orderFailed` | 席、注文の `id`、条件、点、出した物（戻った物）。条件と点は演出にだけ使い、`view` には残さない（1.2） | 全員 |
| `ordersRevealed` | 表にした注文（`FaceUpOrderView`、条件なし）、理由（`round3`、`refill`） | 全員 |
| `orderExpired` | 注文の `id`（条件なし） | 全員 |
| `jointRowFilled` | 席、共同注文の `id`、行、出した産物と数、英文 | 全員 |
| `jointCompleted` | 共同注文の `id`、行ごとの席と点、完成させた席 | 全員 |
| `jointExpired` | 共同注文の `id`、行ごとの席と半分の点 | 全員 |
| `houseBuilt` | 席、交点、コイン、英文 | 全員 |
| `bankTraded` | 席、出したカードと枚数、もらったカード | 全員 |
| `harborTraded` | 席、港の交点、出したカードと枚数、もらったカード | 全員 |
| `cardBought` | 席、カード、コイン | 全員 |
| `productBought` | 席、産物、コイン | 全員 |
| `tradeProposed` | 申し出（`TradeOffer`） | 全員 |
| `tradeAccepted` | 申し出の `id`、両者、渡した物 | 全員 |
| `tradeDeclined` | 申し出の `id` | 全員 |
| `tradeWithdrawn` | 申し出の `id`、理由（本人、手番の終わり、置き換え） | 全員 |
| `japanesePaid` | 席、種類、払い方、コイン | 全員 |
| `turnStarted` | 席、手番の通し番号、ラウンド | 全員 |
| `turnEnded` | 席、手番の通し番号 | 全員 |
| `endFlagged` | 理由（`orders`、`host`）、手番の通し番号 | 全員 |
| `paused`、`resumed` | 時刻 | 全員 |
| `gameOver` | `GameResult`、最後に払った半分の点 | 全員 |
| `undone` | 取り消したコマンドの数と、巻き込まれた操作の要約（BD05） | 全員 |

英文を持つ出来事は、BD02 7.2の英文を `sentence` として持つ。大画面の帯（方式設計9.1）は、最後の `sentence` を出す。

### 2.3 公開とする判断

収入で得たカード、7で捨てたカード、交換の申し出と中身を公開とする。

これらは手札の中身の一部だが、紙でも次のように場の全員に見える。

- 収入、救済、Market day、準備で得るカードは、表向きの種類別の山から取る（ルールブック01章、03章）。
- 7で捨てたカードは、その種類の山に戻す（ルールブック03章）。
- 交換は英語で口頭で行う（ルールブック04章）。

注意深い人は、紙でもこれらを覚えて他人の手札を推測できる。アプリが出来事を公開しても、紙より多くの情報を与えることにはならない。

ただし、大画面とスマホは、出来事を流れる記録として短く出すだけにし、プレイヤーごとの手札の中身を集計して表示することはしない。集計を出すと、紙では記憶力に頼る推測を、誰もが労力なしにできるようになり、手札を枚数だけ公開するルールの意味が薄れるためである。

例外は問いへの答えである。問いへの答えは、全員の答えがそろって処理されるまで、本人にしか送らない。先に答えた人の選択が見えると、紙で同時に選べない状況で、後の人だけが有利になるためである。処理されたあとは `cardsGranted` と `cardsDiscarded` で公開する。

### 2.4 出来事を送る単位

サーバーは、1つのコマンドを適用するたびに、その適用で出た出来事を `view` と一緒に送る（3.3）。出来事だけを別に送ることはしない。

再接続した端末には、出来事を送らず、`view` だけを送る。切れていた間の出来事を演出として流し直すと、古い出来事の演出が今の状態の上に出て混乱するためである。大画面の記録の欄は、`view` に含めた直近の出来事（3.3の `recent`）で埋める。

## 3. メッセージ

### 3.1 共通の規則

- 形式は JSON とし、WebSocket のテキストのフレームで送る。
- すべてのメッセージは `t`（種類）を持つ。
- 端末からのメッセージは、サーバーが zod で形を確かめてから扱う（3.8）。
- プロトコルの版を `PROTOCOL_VERSION`（整数）とし、`hello` で送る。サーバーと版が違えば、サーバーは `error` を返して接続を切る。端末は画面を読み込み直す。

### 3.2 端末からサーバーへ

```ts
type ClientMsg =
  | { t: "hello"; v: number; roomId: string; role: "player" | "board"; token?: string; claim?: string; hostKey?: string }   // claim は席の再発行の合言葉（3.6）。hostKey はホストの鍵（BD05 1.2）
  | { t: "join"; name: string }                         // ロビーで参加する
  | { t: "rename"; name: string }                       // ロビーで名前を直す
  | { t: "leave" }                                      // ロビーで抜ける
  | { t: "cmd"; id: string; cmd: Command; meta?: { sentenceShown?: boolean } }   // ゲームのコマンド。meta はエンジンに渡さず記録だけに残す（BD04 の「英文を見る」）
  | { t: "admin"; id: string; op: AdminOp }             // ホストの鍵を示した大画面からだけ
  | { t: "ping"; n: number }                            // 生存確認（3.7）と、画面の復帰時の確かめ（3.5）
  | { t: "pointer"; vertex: VertexId | null };          // 確定前に選んでいる交点（下記）

type AdminOp =
  | { k: "reorder"; participantIds: string[] }          // 時計回りの並び
  | { k: "setColor"; participantId: string; color: Color }
  | { k: "setRate"; participantId: string; rate: 1 | 2 }  // 上級者の倍率
  | { k: "kick"; participantId: string }                // ロビーでだけ
  | { k: "startGame"; options: { orderDeck: "generated" | "fixed"; dice: "server" | "manual"; animalInclude: boolean } }
  | { k: "pause" } | { k: "resume" }
  | { k: "undoPreview"; seq?: number }                 // 取り消す行。省けば手番の人の最後のコマンド（BD05 2.9）
  | { k: "undoCommit"; rev: number }                   // undoPreview の時点の rev。一致しなければ拒否
  | { k: "answerFor"; promptId: string; answer: PromptAnswer }
  | { k: "endTurnFor"; turnSerial: TurnSerial }        // 一致しなければ拒否（古い表示で別の人の手番を終えないため）
  | { k: "reissueSeat"; seat: Seat }
  | { k: "approveClaim"; seat: Seat; approve: boolean } // 再発行の合言葉で入った端末を承認する（3.6）
  | { k: "callLastRound" }                           // 最終ラウンドにする（方式設計5.9）
  | { k: "abortGame" };
```

`pointer` は、拠点を置く人がスマホで選んでいる途中の交点を、大画面で光らせるための一時的な通知である（方式設計9.2）。ゲームの状態を変えないため、エンジンに渡さず、記録にも残さない。サーバーは、送った人が今拠点を置く番（準備の配置、または `buildHouse` を選んでいる手番の人）であるときだけ、大画面の接続にそのまま転送する。

`Command` は BD01 8章のコマンドの和である。`id` は、`crypto.getRandomValues` で作る128ビットの値の16進表記（32文字）とする（方式設計2.1）。サーバーが発するコマンド（`pause`、`resume`）の `id` も同じ形にし、出どころは記録の `actor` で区別する（BD05 2.3）。

`pause` と `resume` は、管理操作として受け、サーバーが時刻を付けてエンジンのコマンド `pause(at)`、`resume(at)` にする。

### 3.3 サーバーから端末へ

```ts
type ServerMsg =
  | { t: "welcome"; participantId: string; token: string; role: "player" | "board"; admin: boolean; serverNow: number }
  | { t: "lobby"; lobby: LobbyView }
  | { t: "view"; view: BoardView | PlayerView; events: GameEvent[]; recent: GameEvent[] }
  | { t: "ack"; id: string; rev: number }
  | { t: "reject"; id: string; code: RejectCode; detail?: string }
  | { t: "error"; code: ProtocolErrorCode; message: string }
  | { t: "pong"; n: number }                            // 端末からの ping への返事
  | { t: "claimPending"; seat: Seat; seatName: string } // 再発行の合言葉で入った端末に、どの席かを知らせる（3.6）
  | { t: "replaced" }                                   // 同じ席に新しい接続が来たので切る
  | { t: "pointer"; seat: Seat; vertex: VertexId | null };   // 大画面だけに送る。端末からの pointer の転送

type ProtocolErrorCode =
  | "BAD_MESSAGE" | "TOO_LARGE" | "VERSION" | "ROOM" | "TOKEN"
  | "NOT_ADMIN" | "LOBBY_FULL" | "NAME_TAKEN" | "GAME_STARTED" | "ENGINE_CHANGED";
```

`ack` の `rev` は、そのコマンドを適用したあとの版である。端末は、`ack` の `rev` 以上の `view` を受け取るまで、押したボタンを「処理中」で止めておく。

端末は次の規則で `view` を受け入れる。

- `welcome` の直後に届いた最初の `view` は、`rev` によらず受け入れる。
- それ以降は、`rev` が手元の値以上なら受け入れる。

`rev` はロビーの変更も含めて保存され、Durable Object の作り直しや休止をまたいでも戻らない（BD05 2.8）。旧設計の `bootId`（起動ごとの乱数で、`rev` の戻りを見分ける値）は要らない。

`ENGINE_CHANGED` は、記録を作ったエンジンと今のエンジンの版が違い、部屋を止めたときに返す（BD05 2.10）。端末は再接続を試みず、「ホストに知らせてください」と出す。

`rev` は、ゲームかロビーの状態が変わったときだけ上げる。接続の状態（`connected`）が変わったときは上げない。取り消しの `undoCommit` の照合（BD05 2.9）を、誰かの再接続で崩さないためである。

`view` の `events` は、その `view` を作ったコマンドで出た出来事である。`recent` は、直近の出来事を最大30件持つ（2.4）。

### 3.4 ロビー

```ts
interface LobbyView {
  roomId: string;
  participants: {
    id: string;
    name: string;
    color: Color;
    rate: 1 | 2;
    order: number;            // 時計回りの並び（0から）
    connected: boolean;
  }[];
  canStart: boolean;          // 3人か4人で、全員がつながっている
  gameStarted: boolean;
}
```

ロビーの流れは次のとおり。

1. スマホは QRコードから開き、`hello`（`token` なし）を送る。サーバーは参加者として登録せず、`welcome`（`participantId` と `token` を新しく作る）と `lobby` を返す。
2. スマホは名前を入れて `join` を送る。サーバーは参加者に加え、空いている色を付け、参加した順に並びの末尾に置く。全員に `lobby` を送る。
3. ホストは大画面で、参加者を時計回りの並びに並べ替え（`reorder`）、必要なら色と倍率を変える。
4. ホストが `startGame` を送る。サーバーは `createGame` を呼び、`seatsAssigned` で席を知らせる（BD01 1.1）。

名前は1〜12文字とし、同じ名前は受け付けない（`NAME_TAKEN`）。大画面とログで人を見分けるためである。

5人目の `join` は `LOBBY_FULL` で断る。ゲームが始まったあとの `join` は `GAME_STARTED` で断る。

### 3.5 再接続

1. スマホは `token` を `localStorage` に保存しておく。`localStorage` が使えない場合（プライベートブラウズ等）は `sessionStorage` に保存し、それも使えなければメモリだけに持つ。メモリだけの場合、画面を読み込み直すと戻れないため、ホストの `reissueSeat` で戻る。
2. 接続が切れたら、1秒、2秒、4秒の間隔で再接続を試み、以後は5秒おきに試し続ける。
3. つながったら `hello`（`token` あり）を送る。サーバーは `token` から参加者を見つけ、`welcome` を返し、ロビー中なら `lobby`、ゲーム中なら `view` を送る。
4. 端末は、`ack` も `reject` も受け取っていないコマンドを、`id` ごと `sessionStorage` に持っておく。`welcome` を受け取ったら、それらを同じ `id` で送り直す。サーバーは処理済みの `id` には前回の結果を返すため（BD05 1.2）、二重に適用されない。`ack` か `reject` を受け取ったら消す。
5. 同じ参加者の古い接続が残っていれば、サーバーは古い方に `replaced` を送って切る（方式設計7.4）。`replaced` を受けた端末は再接続を試みず、「別の画面で開かれています」と出す。
6. 端末は、今の接続以外（切り替える前の古い接続）から届いたメッセージを、`replaced` も含めて無視する。古い接続が遅れて `replaced` を受け取ったときに、新しい接続が生きているのに操作を止めてしまうことを防ぐためである。
7. `token` が見つからなければ `error`（`TOKEN`）を返す。端末は `token` を消し、参加の画面に戻す。

画面が見えるようになったとき（`visibilitychange`）は、接続が生きているように見えても、状態を確かめる。消灯から戻ったスマホは、接続が切れたことにまだ気づいていない場合があるためである。

具体的には、端末から `ping` を送り、2〜3秒のうちに `pong` が返らなければ、接続を切ってつなぎ直す。10秒おきの生存確認（3.7）の返事を待たないのは、画面を戻した直後に、切れた接続に気づくまで最大で20秒かかるためである。

### 3.6 席の再発行

スマホをなくした場合などに、ホストが `reissueSeat` で席を作り直す（方式設計7.4の手順4）。次の手順で行う。

1. サーバーは使い捨ての合言葉を作り、合言葉入りのQRコードを、ホストPCの画面の小窓に出す。HDMI の先の大画面には出さない。テレビに映ったQRコードを、ほかの参加者が先に読んで他人の席に入ることを防ぐためである。
2. 端末は QRコードから開き、`hello` に `claim` を付けて送る。サーバーは `claimPending` で、どの席の再発行かを端末に知らせる。端末は「Aki の席に入りますか」と確かめさせる。
3. 端末で確かめると、大画面に承認の確認が出る。ホストが `approveClaim` で承認したら、サーバーはその端末に新しいトークンを発行し、古いトークンを無効にする。

合言葉は1回使われるか5分たつと無効にする（BD05 4.6）。

### 3.7 生存確認

端末は、10秒おきに `ping`（通し番号 n）を送る。サーバーは同じ n で `pong` を返す。

- サーバーは、接続ごとに最後に受け取った時刻を持つ。メッセージを処理するたびに、30秒何も受け取っていない接続を切り、その参加者を `connected: false` にする。
- 端末は、`ping` を送ってから10秒 `pong` が来なければ、接続が切れたと見て再接続する。

サーバーから `ping` を送らないのは、サーバー（Durable Object）を休止させるためである。サーバーが10秒おきに送るには、Durable Object が起き続けている必要があり、無料の枠の時間を減らす（BD05 1.1）。端末からの `ping` は、届くたびに Durable Object を短い間だけ起こす。

接続を切る判断を、ほかのメッセージの処理のついでに行うため、全員が黙っている間は `connected` が古いままのことがある。全員が黙っていれば誰も表示を見ていないため、影響はない。

WebSocket のプロトコルの ping のフレームを使わず、アプリのメッセージで行うのは、ブラウザの JavaScript から ping のフレームを送ったり受けた時刻を知ったりできないためである。

### 3.8 形の確認と大きさの上限

| 方向 | 上限 | 超えたとき |
|---|---|---|
| 端末 → サーバー | 4KB | `error`（`TOO_LARGE`）を返して接続を切る |
| サーバー → 端末 | 64KB | 送らずにサーバーの記録に残す（設計の誤りとして扱う） |

端末からの最大のメッセージは、交換の申し出（9種類のカード、5種類の産物、コインの両側）で、1KBに届かない。4KBの上限は、誤りや悪意のある大きなメッセージでサーバーを止めないためのものである。

JSON として読めない、または zod の形に合わないメッセージは、次のように返し、メッセージは捨てる。接続は切らない。

- `cmd` で、`id` は読めるが中のコマンドの形が誤っている場合は、`reject`（`BAD_MESSAGE`）を返す。端末は、押したボタンの「処理中」を `id` で解除できる。
- それ以外（JSON として読めない、`t` が不明、`cmd` 以外のメッセージの形の誤り）は、`error`（`BAD_MESSAGE`）を返す。

形の誤りが同じ接続から10秒の間に10回を超えたら、接続を切る。画面の不具合で同じ誤りが続く場合に、記録をあふれさせないためである。

形が正しく、ルールに合わないコマンドは、`error` ではなく `reject`（BD01 9章の符号）を返す。

`admin` を、ホストの鍵を示していない接続から受けたら、`error`（`NOT_ADMIN`）を返す。

## 4. メッセージの大きさの見積もり

4人戦の終盤の `PlayerView` の大きさを、JSON の文字数で見積もる。実装前の見積もりで、実測していない（未検証）。

| 部分 | 見積もり | 根拠 |
|---|---|---|
| 盤面（タイル13、港6、拠点12） | 0.8KB | 1件あたり30〜50字 |
| プレイヤー4人の公開情報（内訳を除く） | 1.6KB | 1人400字 |
| 点の内訳 | 1.5KB | 1件80字 × 全員で20件程度 |
| 表の注文3枚、共同注文2枚 | 1.5KB | 英文100字と付随の項目 |
| 公開された注文の履歴 | 2.5KB | 1件100字 × 25件程度 |
| `config` | 1.0KB | 3章の項目 |
| 自分の手札、問い、`legal` | 1.5KB | `legal` が最も大きい |
| `recent`（30件） | 3.0KB | 1件100字 |
| 合計 | 約13KB | |

1局で状態が変わる回数は、手番45回、1手番あたりのコマンド10〜20回として、500〜1000回と見積もる（未検証。BD05 6章と同じ見積もり。M1 で、模擬の出来事の数から実測する）。5台に送るため、1局の送信の合計は約30〜60MBになる。1台あたり6〜12MBで、モバイル通信の量として許容の範囲と見る（BD05 6章）。Durable Object からの送信は、無料の枠の要求の数に数えない。

64KBの上限には、見積もりの約5倍の余裕がある。`config` と `recent` は変わることが少ないが、全量を送る方針（方式設計7.1）を優先し、分けて送る最適化はしない。実測で大きすぎた場合に見直す。

## 経緯

| 日付 | 出来事 |
|---|---|
| 2026-10-26 | 初版を作成 |
| 2026-10-26 | 多角レビューを反映。不成立の注文の条件を再び隠す、共同注文の行の産物と数を隠す、注文の難易度を送らない、交換の申し出を大画面に出す、`bootId`、未確定のコマンドの再送、席の再発行の承認、形の誤りの返し方を変えた |
| 2026-10-27 | サーバーを Cloudflare に移したことに合わせた（BD05）。`roomCode` を `roomId` に、管理の判定をホストの鍵に替えた。`bootId`、`exportRecord`、`selectAddress`、ロビーのアドレスの一覧をやめ、`ENGINE_CHANGED` を加えた。生存確認の `ping` を端末から送る形に替えた |
