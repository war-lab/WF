# WORD FARM 素材仕様書 v0.2

更新日：2026-11-10

位置づけ：アプリ版で使う絵と音の素材を、Codexの画像生成とフリー素材で用意するための仕様。

ゲームのルールは `word_farm_rules.html` を正とし、本書は見た目と素材の扱いだけを定める。

## 結論

絵はすべてCodexで生成し、フリー素材は効果音とBGMに限る。

**形の決まった部分はプログラムで描く。**六角タイルの輪郭、カードの枠、数字トークン、文字はゲーム側で描画し、Codexには中身の絵だけを描かせる。

絵柄は最初に見本1枚で確定し、以後の指示文はすべて同じ絵柄の指定を含める。

生成は「見本1枚 → タイル7種 → 残り」の順に進め、各段階で検収してから次へ進む。

ルールは人の試遊を経ていないため、本格的な量産は第1回試遊の後に行う。ただし、試遊で画面を読みやすくするため、産物、カードの絵、作物、動物、駒、区画の地面、コインは、1種類1枚の静止画として試遊の前に作った（8章）。

## 1. 役割分担

| 部分 | 作り方 | 理由 |
|---|---|---|
| タイル、カード、産物、動物、背景の絵 | Codexで生成 | 絵柄を揃えるため、絵は一つの生成元に限る |
| 六角の輪郭、カードの枠、数字トークン、文字 | プログラムで描画 | 形と大きさが1枚ずつずれると、盤面に隙間や段差ができる |
| 効果音、BGM | フリー素材 | ライセンス台帳で管理する（5章） |
| スプライトシートのアトラス（コマ位置のJSON） | ツールで生成 | 生成画像からコマ位置を手で書くと誤りが出る |

タイルの絵は、塗り足しを付けた正方形で生成する。画像の中央84%をタイルの範囲とし、その外側にも同じ地面を描き足させる。検収のときに、塗り足しの中から切り出す正方形の位置と大きさを選び（`art/cut_tile.py`）、1024×1024 にしてから、ゲーム側で六角形の型で切り抜く。

塗り足しを付けるのは、題材が六角形の縁で欠けたときに、描き直さずに切り出す位置をずらして直すためである。塗り足しのない正方形では、六角形の高さが正方形の高さと同じで、縦にずらす余地がない（2026-11-09 の grow の見本で、上の先端で欠けたじょうろを描き直した）。

タイルの中の配置は次のとおりとする。種類を示す絵（grow ならじょうろ）は上部（上から16〜38%、横幅の中央66%）に置き、中央は数字のトークン、下部は種類の単語に空ける。トークンと単語はプログラムで描く。中央に絵を置くと、盤面に並べたときにトークンで隠れるためである（2026-11-09 の見本で確かめた）。

型は先端が上を向く正六角形とし、幅と高さの比は √3 : 2 とする。

## 2. 絵柄の指定

2026-11-09 に grow のタイル（`art/final/tile-grow@2x.png`）を見本として確定し、次の指定にした。以後の素材は、この見本を参照の画像として Codex に渡して作る（6.1）。

| 項目 | 指定 |
|---|---|
| 視点 | 真上からやや斜めに見下ろす。タイルは真上から見た地面として描く |
| 塗り | 絵本風の厚塗り。やわらかい陰影で、形は単純にし、細部は少なくする。盤面の大きさ（タイルの幅180ピクセル）で読めることを優先し、小石や細かい粒のような模様は描かない |
| 輪郭線 | 濃い茶色の線。黒は使わない |
| 光源 | 左上から。影は右下に落とす |
| 色 | 彩度は高め。緑、麦色、土色を基調とし、アクセントに赤と空色を使う |
| 避けるもの | 写真風、3DCG風、アニメ塗り、文字、透かし、枠線、画面の端で切れた被写体 |

「豪華に見せる」演出は、絵そのものよりも光の粒子、揺れ、拡大縮小などの動きで出す。

動きはゲーム側で付けるため、絵は静止画として完結させる。

## 3. 共通の技術仕様

- 形式は PNG（RGBA、32ビット）。透過が必要な素材は、背景を完全に透明にする。
- 解像度は表示サイズの2倍で作る。ファイル名の末尾に `@2x` を付ける。
- 被写体の周囲に、画像の幅の4%以上の余白を残す。切り抜きや光の演出で端が欠けるのを防ぐため。
- ファイル名は英小文字と数字とハイフンで、`区分-名前-状態@2x.png` とする（例：`tile-grow@2x.png`、`crop-carrot-2@2x.png`）。
- 生成した元画像は `art/raw/`、検収済みの画像は `art/final/` に置く。

スプライトシートは次の規則で作る。

- コマの大きさは素材ごとに固定し、横一列に並べる。8コマを超える場合は次の行に折り返す。
- コマ同士の間に2ピクセルの透明な隙間を入れる。
- アトラスのJSONは、検収後にパッキングツール（例：free-tex-packer）で作る。Codexには作らせない。

## 4. 素材一覧

表示サイズは、盤面を横1280ピクセルで描いたときの目安である。

| 区分 | 素材 | 枚数 | 生成サイズ | 透過 | 備考 |
|---|---|---:|---|---|---|
| タイル | grow, buy, feed, sell, seed, animal, market | 7 | 1024×1024 | なし | 正方形で生成し、六角に切り抜く |
| 盤面 | 海、砂浜の質感 | 2 | 1024×1024 | なし | 敷き詰める。つなぎ目は `art/cut_texture.py` で消す。島の外周の形（各タイルを広げた六角の重なり）はゲーム側で描く |
| 盤面 | 桟橋、港の看板 | 2 | 桟橋は横長、看板は512×512 | あり | 桟橋は交点から看板の向きに回して引き伸ばす。看板の文字（grow 2:1 など）はゲーム側で描く |
| 駒 | 拠点（家の形） | 1 | 256×256 | あり | 白っぽく描き、4色はゲーム側で着色する（SVG のフィルタで乗算）。色だけで人を見分けさせないため、形の記号を重ねる |
| 農場 | 区画の地面 | 1 | 1024×1024 | なし | 区画の背景に敷く |
| 農場 | 作物（carrot, potato, wheat） | 3 | 512×512 | あり | 試遊の前は収穫前の1段階だけ作った。ルールでは植えた次の自分の番に収穫するため、段階の絵は試遊の後に要否を決める |
| 農場 | 牛、ニワトリ | 2 | 512×512 | あり | 試遊の前は静止画。待機の動き（4コマのスプライトシート）は試遊の後 |
| 産物 | carrot, potato, wheat, egg, milk | 5 | 256×256 | あり | |
| カード | 単語カードの絵（grow, buy, feed, sell, carrot, potato, wheat, cow, chicken） | 9 | 512×512 | あり | 枠と文字はゲーム側 |
| 演出 | きらめき、土煙、星 | 3 | 512×512 | あり | 1枚ずつの粒子。ゲーム側で回して大きさを変える（BD04 6.1）。紙吹雪はゲーム側の図形で描く |
| UI | コイン | 1 | 256×256 | あり | |

ダイスはゲーム側で描画し、絵は生成しない。

## 5. 音のフリー素材

音は次の場面に付ける：ダイスを振る、カードを受け取る、植える、収穫する、売る、注文を達成する、勝利する、7のMarket day、BGM。

素材ごとに次の項目を台帳（`art/sound_licenses.md`）に記録する。

| 項目 | 内容 |
|---|---|
| ファイル名 | ゲームで使う名前 |
| 出典 | 配布サイト名とページのURL |
| 作者 | 表記が求められる名前 |
| ライセンス | 種類と、クレジット表記の要否 |
| 加工 | 音量調整や切り出しをしたか |
| 取得日 | 絶対日付 |

クレジット表記が必要な素材は、アプリの「クレジット」画面に表示する。

## 6. Codexへの指示文

画像生成への指示は英語で書く。

共通部分は全素材で変えず、素材ごとの部分だけを差し替える。

```text
[共通部分]
Style: storybook illustration with soft painterly shading, simple bold shapes and LOW detail,
readable at a small size (about 180 pixels wide), dark-brown outlines (no black),
light from the upper left with soft shadows to the lower right,
saturated warm palette based on leaf green, wheat yellow and soil brown, accents of red and sky blue.
Do not include any text, letters, numbers, watermark, border or frame.
Do not crop the subject at the image edge.

[素材ごとの部分：タイルの例]
Subject: a farm field seen from directly above (top-down view), filling the entire square canvas edge to edge
with neat horizontal rows of young green sprouts growing in rich brown tilled soil.
Bleed (important): the tile area is only the central 84% of the canvas. Continue the same ground pattern
into the outer 8% margin on every side as bleed, with nothing important there; the tile is cropped out later.
Composition (important): a red watering can is the key object. Place it horizontally centered,
entirely inside the central 55% of the canvas width and inside the band between 21% and 40% of the canvas height
from the top (the top of a pointy-top hexagon is narrow, so objects placed higher get cut).
Below 45% of the canvas height there must be only the plain rows of sprouts and soil, with no objects,
because a round number token and a word label will be drawn there later.
Paint the illustration over the ENTIRE square canvas, all four corners included. Do NOT draw any hexagon,
tile shape, outline, border, frame or white background; the hexagon will be cut out later by software.
The soil rows must continue seamlessly from top to bottom with no visible seam or change of pattern.
Not a photograph, not 3D render, not anime. No sky, no horizon, no mountains, no landscape scenery.
Square image, opaque background.

[素材ごとの部分：透過素材の例]
Subject: a single ripe carrot with green leaves, centered, 3/4 top-down view.
Canvas: 256x256 PNG with a fully transparent background, keep at least 10 px of empty margin.

[素材ごとの部分：スプライトシートの例]
Subject: a golden sparkle burst animation for a harvest effect.
Sprite sheet: 8 frames in one horizontal row, each frame 256x256, 2 px transparent gap between frames,
frame 1 is the smallest spark and frame 8 fades out. Fully transparent background.
```

タイル7種の題材は次のとおり。

| タイル | 題材 |
|---|---|
| grow | 芽が並ぶ畑と、じょうろ |
| buy | 市場の屋台と、コインの入った袋 |
| feed | 餌箱と、こぼれた穀物（seed の袋と見分けるため、袋にしない） |
| sell | 産物を積んだ木箱と、荷車 |
| seed | 種の袋と、畝に蒔かれた種 |
| animal | 柵に囲まれた牧草地 |
| market | 小さな広場と、色とりどりの日よけ |

### 6.1 Codex の呼び出し方

2026-11-09 に、Codex CLI（0.164.0、ChatGPT のアカウントでログイン）の画像生成で、次の手順が動いた。

1. 指示文をファイルに書き、`codex exec -s read-only --skip-git-repo-check --json - < 指示文.txt` で渡す。指示文を引数で渡すと、標準入力の追加の入力を待って止まった。引数で渡した別の回では、指示と無関係な画像（写真風の山と湖）が返った。
2. 指示文の頭で、BEGIN PROMPT と END PROMPT の間の文を、変えずに画像生成に渡すよう求め、渡した文と、保存先のパスを返させる。渡した文を返させるのは、指示どおりに渡ったかを確かめるためである。
3. Codex にはファイルを保存させない。Windows では、書き込みを許す設定（`-s workspace-write`）でも、Codex がコマンドを実行できなかった。生成された画像は `~/.codex/generated_images/` の下に置かれるので、こちらで `art/raw/` にコピーする。
4. 返る大きさは指定どおりにならない（正方形を求めて 1254×1254 が返った）。検収の前に、指定の大きさへ縮める。
5. 見本の一部だけを直すときは、`-i <画像>` で元の画像を渡し、変える点だけを書いて直させる。作り直すより見た目が保たれる。位置と大きさの指示は割合で書くが、指示どおりにはならないことがある（「2割小さく」で4割小さくなった）。検収で確かめ、ずれたら直させる。

画像生成には、ChatGPT のプランの使用量の上限がある。2026-11-06 に上限に達し、約3時間使えなかった。

透過素材は、指示文で背景の透過を求めて生成する（Codex は透過の PNG を返した）。`python art/cut_item.py <名前>...` で `art/raw/<名前>.png` を整え、`art/final/<名前>@2x.png`（512×512）にする。処理は次のとおり。

- 背景が透過でなければ、四隅の色に近い画素を四隅からたどって透明にする。
- 白に近く不透明度の低い画素を透明にする。透過を求めても、ほぼ透明な白の背景が返ることがある（2026-11-10、card-buy）。
- 被写体の外接矩形で切り詰めて正方形にし、周りに幅の8%の余白を足す。

ゲームで使う形式への書き出しは `python art/export_web.py` で行う（webp。タイルは512px、透過素材は256px）。

タイルの検収では、`python art/cut_tile.py <生成した画像> <切り出した画像>` で塗り足しの中から正方形を切り出し（既定は中央84%。欠けるときは `--dx`、`--dy`、`--size` で調整する）、`python art/mock_tile.py <切り出した画像> <単語>` で、六角に切り抜き、盤面の大きさで数字のトークンと単語を重ねた見え方を作って確かめる。

## 7. 検収の項目

生成した画像は、`art/final/` に移す前に次を確認する。

1. 透過素材の背景が完全に透明か。被写体の縁に白い縁取りが残っていないか。
2. 指定したサイズと余白を守っているか。
3. 文字、数字、透かし、枠線が描かれていないか。
4. 見本の絵柄（線、塗り、光の向き、色）と揃っているか。並べて比べる。
5. タイルを六角に切り抜いたとき、題材の主要部分が欠けないか。盤面の大きさで、数字のトークンと単語に隠れないか。
6. スプライトシートのコマ数、コマの大きさ、隙間が指定どおりか。

## 8. 生成の順番

1. 絵柄の見本として、growのタイルを1枚生成する。2章の指定を見本に合わせて確定する。
2. タイルの残り6種を生成し、7枚を六角に切り抜いて盤面に並べ、揃っているかを確かめる。
3. 産物と作物、動物を生成する。
4. カードの絵、演出のスプライトシート、UIを生成する。
5. 効果音とBGMを選び、台帳に記録する。

手順2までは第1回試遊の前に行ってよい。

手順3と4のうち、産物、カードの絵、作物（1段階）、動物（静止画）、駒、区画の地面、コインは、2026-11-10 に試遊の前に作った。文字だけの画面では区別しにくく、試遊の観察を妨げるためである。

残りの作物の段階と動物の動きは、試遊でタイルや産物の種類が変わる可能性があるため、試遊の後に行う。

## 経緯

| 日付 | 出来事 |
|---|---|
| 2026-10-19 | 初版を作成 |
| 2026-11-09 | grow の見本を確定した。絵柄の指定を「細部は少なく」に改め、タイルの中の配置、Codex の呼び出し方、検収の見え方の作り方を足した |
| 2026-11-09 | タイルを塗り足し付きで生成し、切り出す位置を検収で選ぶ形にした（1章、`art/cut_tile.py`） |
| 2026-11-10 | 演出の粒子（きらめき、土煙、星）を作った。スプライトシートはやめ、1枚ずつの粒子にした。海と島の外周は `art/bake_board.py` で1枚に焼く形にした |
| 2026-11-10 | 海と砂浜の質感、桟橋、港の看板を作り、島の外周と港を絵にした（`art/cut_texture.py`） |
| 2026-11-10 | 産物、カードの絵、作物、動物、駒、区画の地面、コインを試遊の前に作り、画面に組み込んだ。作物は1段階、動物は静止画とした。feed のタイルの題材を餌箱にした。透過素材の整え方（`art/cut_item.py`）を足した |
