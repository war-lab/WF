# 音のフリー素材の台帳

`art/ASSET_SPEC.md` の5章に従い、使う音の素材ごとに出典とライセンスを記録する。

ファイルは `video/public/audio/` に置く。

取得日はすべて 2026-10-21。

いずれも加工はしていない（音量は動画の側で調整する）。

## 配布サイトの規約（要点）

| 配布サイト | 規約のページ | クレジット表記 | 主な禁止事項 |
|---|---|---|---|
| 甘茶の音楽工房 | https://amachamusic.chagasi.com/terms.html | 不要（表記するならサイト名・作曲者名・URLのいずれか） | 音楽単体での販売・再配布、直リンクでの使用、JASRAC等や Content ID への登録 |
| 魔王魂 | https://maou.audio/rule/ | 必要（例：「音楽：魔王魂」）。YouTube では動画内か概要欄 | 曲単体の再配布、mp3 の URL の直接記載、JASRAC等への登録、生成AIの学習 |
| 効果音ラボ | https://soundeffect-lab.info/agreement/ | 不要 | 効果音を紹介する動画、再配布、mp3への直リンク、Content ID への登録、AIの学習 |
| Pixabay | https://pixabay.com/service/license-summary/ | 不要（推奨形式は「by [投稿者] via Pixabay」） | 素材単体での販売・配布 |

規約の内容は、2026-10-21 にサブエージェントが規約のページを読んで要約したもの。

## BGM

| ファイル名 | 使う場面 | 出典 | 作者 | ライセンス | クレジット |
|---|---|---|---|---|---|
| `bgm/setup.mp3` | 準備 | 甘茶の音楽工房「ゆるやかな朝焼け」 https://amachamusic.chagasi.com/music_yuruyakanaasayake.html | 甘茶 | 甘茶の音楽工房の利用規約 | 不要 |
| `bgm/early.mp3` | 序盤（R1〜R2） | 甘茶の音楽工房「楽しい麦畑」 https://amachamusic.chagasi.com/music_tanoshiimugibatake.html | 甘茶 | 同上 | 不要 |
| `bgm/middle.mp3` | 中盤（R3〜R8） | 甘茶の音楽工房「ハッピータイム」 https://amachamusic.chagasi.com/music_happytime.html | 甘茶 | 同上 | 不要 |
| `bgm/final.mp3` | 最終ラウンド（R9） | 甘茶の音楽工房「チェス」 https://amachamusic.chagasi.com/music_chess.html | 甘茶 | 同上 | 不要 |
| `bgm/end.mp3` | 勝利のあとの締め | 甘茶の音楽工房「6人のラッパ吹き」 https://amachamusic.chagasi.com/music_rokuninnorappafuki.html | 甘茶 | 同上 | 不要 |

## 効果音

| ファイル名 | 使う場面 | 出典 | 作者 | ライセンス | クレジット |
|---|---|---|---|---|---|
| `se/dice.mp3` | ダイスを振る | Pixabay「Dice roll」 https://pixabay.com/sound-effects/film-special-effects-dice-roll-37917/ | freesound_community | Pixabay Content License | 不要 |
| `se/card.mp3` | カードを受け取る | 効果音ラボ「カードを配る」 https://soundeffect-lab.info/sound/various/various3.html | 効果音ラボ | 効果音ラボの利用規約 | 不要 |
| `se/plant.mp3` | 植える | 効果音ラボ「手で穴を掘る2（1回）」 https://soundeffect-lab.info/sound/various/ | 効果音ラボ | 同上 | 不要 |
| `se/harvest.mp3` | 収穫する | 効果音ラボ「ポン（柔らかい音）」 https://soundeffect-lab.info/sound/button/ | 効果音ラボ | 同上 | 不要 |
| `se/coin.mp3` | 市場で売る・コインを得る | 効果音ラボ「お金を落とす2」 https://soundeffect-lab.info/sound/various/ | 効果音ラボ | 同上 | 不要 |
| `se/deliver.mp3` | 注文を達成する | 効果音ラボ「正解2（鉄琴）」 https://soundeffect-lab.info/sound/anime/ | 効果音ラボ | 同上 | 不要 |
| `se/market_day.mp3` | 7の Market day | 効果音ラボ「教会の鐘2」 https://soundeffect-lab.info/sound/anime/ | 効果音ラボ | 同上 | 不要 |
| `se/expire.mp3` | 時間切れ・不成立 | 効果音ラボ「不正解2」 https://soundeffect-lab.info/sound/anime/ | 効果音ラボ | 同上 | 不要 |
| `se/trade.mp3` | 交換成立 | 効果音ラボ「キラッ1（鉄琴）」 https://soundeffect-lab.info/sound/anime/ | 効果音ラボ | 同上 | 不要 |
| `se/fanfare.mp3` | 勝利の瞬間 | 効果音ラボ「ラッパのファンファーレ」 https://soundeffect-lab.info/sound/anime/ | 効果音ラボ | 同上 | 不要 |
| `se/win_jingle.mp3` | 勝利の画面 | 魔王魂「ジングル01」 https://maou.audio/game_jingle01/ | 魔王魂 | 魔王魂の利用規約 | **必要**（「音楽：魔王魂」） |

## 動画に入れるクレジット

魔王魂の素材を使うので、プレイ動画の最後に次を表示する。表記が任意の素材も、合わせて記載する。

```text
BGM：甘茶の音楽工房
音楽：魔王魂
効果音：効果音ラボ、Pixabay
音声：Microsoft Edge 読み上げ（edge-tts）
```
