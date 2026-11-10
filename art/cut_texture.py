# 敷き詰める質感（海、砂浜）を、つなぎ目なく並べられる形に整える（素材仕様書 6.1）。
#   python art/cut_texture.py <名前>...      art/raw/<名前>.png → art/final/<名前>@2x.png（1024×1024）
# 生成した画像は、指示しても端と端がつながる保証がない。そこで、縦横に半分ずらした画像と混ぜる。
# 混ぜる重みは、元の画像では中央ほど大きく、端で0にする。端ではずらした画像だけになり、
# ずらした画像の端どうしは元の画像の中央でつながっているので、並べてもつなぎ目が出ない。
import sys
import numpy as np
from PIL import Image

SIZE = 1024
CROP = 0.9  # 生成した画像の縁は陰りやすいので、中央の9割を使う


def seamless(im: Image.Image) -> Image.Image:
    w, h = im.size
    m = round(w * (1 - CROP) / 2)
    im = im.convert("RGB").crop((m, m, w - m, h - m)).resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    b = np.roll(a, (SIZE // 2, SIZE // 2), axis=(0, 1))
    t = np.abs(np.linspace(-1, 1, SIZE))
    edge = np.minimum(1 - t[None, :], 1 - t[:, None])  # 端で0、中央で1
    wgt = np.clip(edge / 0.35, 0, 1)[..., None]  # 端から35%より内側は元の画像だけ
    out = a * wgt + b * (1 - wgt)
    return Image.fromarray(out.round().astype(np.uint8))


for n in sys.argv[1:]:
    seamless(Image.open(f"art/raw/{n}.png")).save(f"art/final/{n}@2x.png")
    print(f"{n}: {SIZE}x{SIZE}（つなぎ目なし）")
