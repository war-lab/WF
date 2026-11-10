# 盤面の背景（海と島の外周）を1枚の画像に焼く（素材仕様書 4章）。
#   python art/bake_board.py      → app/packages/client/public/art/board-bg.webp
# 盤面の配置は固定（app/packages/engine/src/data/board.json）なので、海の質感と、砂浜・波打ち際の重なりを
# 毎回 SVG の模様で描かず、ここで1枚にする。SVG の模様の塗りは、スマホ（WebKit）で描くのが重いため（2026-11-10、E2E の mixed で確かめた）。
# 寸法と座標の式は app/packages/client/src/BoardMap.tsx と同じにする（R、PIER、PAD）。変えたときは両方を直す。
import json
import math
from PIL import Image, ImageDraw

R = 180 / math.sqrt(3)
PIER = 0.85
PAD = 60
SCALE = 2  # 高精細の画面向けに2倍で焼く
SS = 4  # 輪郭のなめらかさのため、型はさらに4倍で描いて縮める

board = json.load(open("app/packages/engine/src/data/board.json", encoding="utf-8"))
vtx = {v["id"]: v for v in board["vertices"]}
xs = [v["x"] for v in board["vertices"]] + [vtx[h["vertex"]]["x"] + h["pier"][0] * PIER for h in board["harbors"]]
ys = [v["y"] for v in board["vertices"]] + [vtx[h["vertex"]]["y"] + h["pier"][1] * PIER for h in board["harbors"]]
minx, miny = min(xs), min(ys)
W = (max(xs) - minx) * R + PAD * 2
H = (max(ys) - miny) * R + PAD * 2
px = lambda x: (x - minx) * R + PAD
py = lambda y: (y - miny) * R + PAD
w, h = round(W * SCALE), round(H * SCALE)


def tiled(src: str, tile: int) -> Image.Image:
    """質感を tile ピクセル（盤面の座標）ごとに敷き詰めた、盤面の大きさの画像"""
    t = Image.open(src).convert("RGB").resize((tile * SCALE, tile * SCALE), Image.LANCZOS)
    out = Image.new("RGB", (w, h))
    for y in range(0, h, t.height):
        for x in range(0, w, t.width):
            out.paste(t, (x, y))
    return out


def hex_mask(k: float) -> Image.Image:
    """全タイルの六角を中心から k 倍に広げて重ねた型"""
    m = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    for t in board["tiles"]:
        cx, cy = t["center"]
        pts = [(px(cx + (vtx[i]["x"] - cx) * k) * SCALE * SS, py(cy + (vtx[i]["y"] - cy) * k) * SCALE * SS) for i in t["vertices"]]
        d.polygon(pts, fill=255)
    return m.resize((w, h), Image.LANCZOS)


img = tiled("art/final/board-sea@2x.png", 360).convert("RGBA")
# 外側から、浅瀬の明るい帯、波打ち際の白、砂浜の順に重ねる（BoardMap.tsx の旧実装と同じ倍率と色）
for k, color in [(1.42, (210, 245, 240, 115)), (1.24, (255, 255, 250, 230))]:
    layer = Image.new("RGBA", (w, h), color)
    a = hex_mask(k).point(lambda v, al=color[3]: v * al // 255)
    layer.putalpha(a)
    img.alpha_composite(layer)
sand = tiled("art/final/board-sand@2x.png", 240).convert("RGBA")
sand.putalpha(hex_mask(1.2))
img.alpha_composite(sand)

# 角を丸める（rx 24）
corner = Image.new("L", (w * SS, h * SS), 0)
ImageDraw.Draw(corner).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius=24 * SCALE * SS, fill=255)
img.putalpha(corner.resize((w, h), Image.LANCZOS))

out = "app/packages/client/public/art/board-bg.webp"
img.save(out, "WEBP", quality=85, method=6)
print(out, f"{w}x{h}（盤面の座標 {W:.1f}x{H:.1f}）")
