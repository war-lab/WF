# WORD FARM

社内の英語学習サークル向けのボードゲーム。英語で交渉し、英文の注文を読んで、農場の産物を届ける。

現在は第1回試遊の前の段階で、ルールは模擬対局で確かめたが、人による試遊はまだ行っていない。

## まず読むもの

| 読む人 | ファイル | 内容 |
|---|---|---|
| 遊ぶ人 | `word_farm_rules.html` | ルールブック（正本）。公開版：https://claude.ai/artifact/HoSAWvybiFEWnQJ7oJBBcE |
| 遊ぶ人（オフライン） | `word_farm_rules_local.html` | ルールブックを単体で開ける形にしたもの。ブラウザで開いて印刷できる |
| 作る人 | `WORD_FARM_DESIGN_v0.4.md` | 設計メモ。仕様の要約、判断の根拠、保留した案、試遊で確認する項目、模擬の数値 |
| 絵や音を作る人 | `art/ASSET_SPEC.md` | アプリ版の素材仕様（Codexでの画像生成とフリー素材の効果音） |

ルールを変えるときは、`word_farm_rules.html` を直してから `word_farm_rules_local.html` を書き出し直す。設計メモには、変えた理由を書く。

## 現在の仕様の要点

詳細はルールブックを正とする。

- 3〜4人、60〜80分。勝利点8点（人数によらない）。自分の手番中に届いたら勝ち。
- マップは六角タイル13枚（中央はMarket）。数字と港の位置は固定し、タイルと港の種類だけシャッフルする。
- 拠点は交点に置く。距離ルールあり、道なし、最大3個。港は外側の角1か所。
- 注文はゲームごとに36枚を自動で作る（0.5〜3点）。紙ではルールブックの印刷用36枚を使う。
- 交渉は英語。日本語はコインか無料券（全員2枚）で使う。文法は審査しない。
- 7が出たら、手札7枚以上の人は半分を捨て、そのあと全員が好きな1枚をもらう。

## フォルダ構成

| 場所 | 内容 |
|---|---|
| `word_farm_rules.html`、`word_farm_rules_local.html` | ルールブック |
| `WORD_FARM_DESIGN_v0.4.md` | 設計メモ |
| `art/` | 素材仕様 |
| `sim/` | 模擬エンジンとボット、注文の生成、紹介動画の台本 |
| `sim/results/` | 模擬対局の結果（設計メモの付録の元データ） |
| `sim/backup/` | 作業前のコードの控え |
| `video/` | 紹介動画（Remotion） |
| `archive/` | 方針転換前の旧設計（v0.5、ブラウザ対戦と5文型の版） |

`.playwright-mcp/` は表示確認で撮った画像の置き場で、消してよい。

## 模擬の動かし方

模擬のコードは確定仕様を環境変数で切り替える。コードの既定値は旧仕様のままなので、次の設定を必ず付ける。

```text
cd sim
export PYTHONIOENCODING=utf-8 ORDERSET=3 ORD13=down DEV=1 DEVOFF=1 LOWPRICE=1 COINBANK=1 COINPRICE=4 \
  HARBORS=6 BANKBASE=4 HSINGLE=1 FIXED=1 COWMODE=delay SEVEN=1 \
  ORDERGEN=1 ORDERN=36 EGGW=1.8 MILKW=1.8 MAP_T4=8 MAP_T3=8
python probe_vp.py 300 4     # 4人戦300局の長さと展開
python mapprobe.py hex454 300 3   # 3人戦300局の収入、港、方針別の勝率
python ordergen.py 2026      # 注文36枚の生成例
```

`cli.py` は旧6タイル版の対話式実行で、今の仕様には対応していない。

## 紹介動画の作り方

台本（`sim/scenario.py`）を模擬エンジンで実行してから、Remotionで書き出す。

```text
cd sim
AUTOSEED=20 python scenario_run.py      # video/public/game.json を作る
cd ../video
npm install                             # 初回のみ
npx remotion studio src/index.ts        # ブラウザで確認
npx remotion render src/index.ts WordFarm out/word_farm.mp4
```

台本の1〜5ラウンドは手書きで、その後は乱数の種20でボットが進める。種を変えると展開が変わるため、終盤の考えと台詞（`FINALE_NOTES`）も書き直す必要がある。

キャラクターは、Aki が冷静なお姉さん（英語上級）、Ben がおちゃらけた陽気なお兄さん（中上級）、Chika が元気いっぱいの女の子（初級）、Dan が英国紳士（中級）。

## 次にやること

1. 第1回試遊の準備：交渉の例文を載せた早見表と、観察シートを作る。サークルの人数と活動時間（上限90分）を確かめる。
2. 試遊で、設計メモ5章の項目を確かめる。
3. 試遊の結果でルールを直してから、アプリの絵を作る（素材仕様の手順2以降）。
