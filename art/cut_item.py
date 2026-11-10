# 透過の素材（産物、カードの絵、作物、動物、駒）を整える（素材仕様書 3章）。
#   python art/cut_item.py <名前>...      art/raw/<名前>.png → art/final/<名前>@2x.png（512×512）
# 背景が透過でなければ、四隅の色に近い画素を、四隅からたどって透明にする。
# 被写体の外接矩形で切り詰め、正方形にして、周りに幅の8%の余白を足す。
import sys
from collections import deque
from PIL import Image

SIZE = 512
MARGIN = 0.08


def remove_background(im: Image.Image, tol: int = 38) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if all(c[3] < 16 for c in corners):
        return im  # すでに透過
    ref = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    near = lambda c: abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) <= tol * 3
    seen = bytearray(w * h)
    q = deque((x, y) for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        c = px[x, y]
        if not near(c):
            continue
        px[x, y] = (c[0], c[1], c[2], 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def clear_haze(im: Image.Image) -> Image.Image:
    """白に近く、不透明度の低い画素を透明にする。透過の指定でも、ほぼ透明な白の背景が返ることがある（2026-11-10、card-buy）。影は暗い色なので残る"""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b_, a = px[x, y]
            if a < 64 and r > 225 and g > 225 and b_ > 225:
                px[x, y] = (r, g, b_, 0)
    return im


def finish(name: str) -> None:
    im = clear_haze(remove_background(Image.open(f"art/raw/{name}.png")))
    box = im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
    if box is None:
        raise SystemExit(f"{name}: 被写体が見つからない")
    im = im.crop(box)
    side = max(im.size)
    pad = round(side * MARGIN / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(f"art/final/{name}@2x.png")
    print(f"{name}: 切り詰め {box} → {SIZE}x{SIZE}")


for n in sys.argv[1:]:
    finish(n)
