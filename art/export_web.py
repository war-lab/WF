# 検収済みの素材（art/final）を、画面で使う大きさに縮めて client の配信フォルダへ写す。
#   python art/export_web.py
# タイルは盤面で幅180ピクセル（BD04 5.1）。高精細の画面の2倍を見込み、512×512 の WebP にする。ほかの素材は256×256
import os
from PIL import Image

src = "art/final"
dst = "app/packages/client/public/art"
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.endswith("@2x.png"):
        continue
    name = f.replace("@2x.png", "")
    # タイルは盤面で幅180ピクセルのため512、ほかの素材（産物、カード、作物、動物）は表示が小さいため256にする。透過は保つ
    size = 512 if name.startswith("tile-") else 256
    im = Image.open(os.path.join(src, f))
    im = (im.convert("RGB") if name.startswith("tile-") or name == "farm-ground" else im.convert("RGBA")).resize((size, size), Image.LANCZOS)
    out = os.path.join(dst, f"{name}.webp")
    im.save(out, "WEBP", quality=88, method=6)
    print(out, os.path.getsize(out) // 1024, "KB")
