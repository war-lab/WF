# 生成した画像（塗り足し付き）から、タイルにする正方形を切り出して 1024×1024 にする（素材仕様書 1章、6.1）
#   python art/cut_tile.py <入力.png> <出力.png> [--size 0.84] [--dx 0] [--dy 0]
# size は切り出す正方形の一辺（画像の幅に対する割合）。dx、dy は中心からのずらし（画像の幅に対する割合、右と下が正）。
# 切り出した正方形の中央に、ゲームが先端の上を向く正六角形を当てて切り抜く。
import argparse
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("dst")
p.add_argument("--size", type=float, default=0.84)
p.add_argument("--dx", type=float, default=0.0)
p.add_argument("--dy", type=float, default=0.0)
a = p.parse_args()
im = Image.open(a.src).convert("RGB")
w, h = im.size
s = a.size * w
cx, cy = w / 2 + a.dx * w, h / 2 + a.dy * h
box = (round(cx - s / 2), round(cy - s / 2), round(cx + s / 2), round(cy + s / 2))
if box[0] < 0 or box[1] < 0 or box[2] > w or box[3] > h:
    raise SystemExit(f"切り出す範囲 {box} が画像 {w}x{h} の外に出る。size か dx、dy を小さくする")
im.crop(box).resize((1024, 1024), Image.LANCZOS).save(a.dst)
print(f"{a.src} → {a.dst} 範囲 {box}")
