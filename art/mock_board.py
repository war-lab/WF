# 13枚のタイルを盤面の配置（board.json）に並べ、数字のトークンと単語を重ねた見え方を作る（素材仕様書 8章の手順2）
#   python art/mock_board.py <出力.png> [タイルの画像のフォルダ=art/raw]
# タイルの種類は、ルールブックの産地マップの図（client の ?sample=rulebook）と同じにする
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
src = sys.argv[2] if len(sys.argv) > 2 else "art/raw"
KINDS = {0: "buy", 1: "seed", 2: "grow", 3: "feed", 4: "sell", 5: "animal", 6: "market", 7: "seed", 8: "animal", 9: "grow", 10: "feed", 11: "buy", 12: "sell"}
b = json.load(open("app/packages/engine/src/data/board.json", encoding="utf-8"))
U = 104  # 1単位（六角の1辺）あたりのピクセル。盤面の描画（BoardMap の R）と同じ大きさ
cs = [t["center"] for t in b["tiles"]]
minx, maxx = min(c[0] for c in cs) - 1, max(c[0] for c in cs) + 1
miny, maxy = min(c[1] for c in cs) - 1.2, max(c[1] for c in cs) + 1.2
W, H = int((maxx - minx) * U) + 40, int((maxy - miny) * U) + 40
can = Image.new("RGBA", (W, H), (120, 170, 200, 255))
d = ImageDraw.Draw(can)
f = ImageFont.truetype("arialbd.ttf", 28)
fw = ImageFont.truetype("arialbd.ttf", 20)
tw_, th_ = int(math.sqrt(3) * U), int(2 * U)
cache = {}
for t in b["tiles"]:
    k = KINDS[t["id"]]
    if k not in cache:
        im = Image.open(os.path.join(src, f"tile-{k}.png")).convert("RGB").resize((1024, 1024), Image.LANCZOS)
        pts = [(512 + 512 * math.cos(math.radians(a - 90)), 512 + 512 * math.sin(math.radians(a - 90))) for a in range(0, 360, 60)]
        m = Image.new("L", (1024, 1024), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        hx = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        hx.paste(im, (0, 0), m)
        cache[k] = hx.crop((512 - 443, 0, 512 + 443, 1024)).resize((tw_, th_), Image.LANCZOS)
    cx = int((t["center"][0] - minx) * U) + 20
    cy = int((t["center"][1] - miny) * U) + 20
    can.alpha_composite(cache[k], (cx - tw_ // 2, cy - th_ // 2))
    if t["number"] is not None:
        r, oy = 27, 10
        d.ellipse((cx - r, cy + oy - r, cx + r, cy + oy + r), fill=(240, 214, 140, 255), outline=(90, 60, 30, 255), width=2)
        d.text((cx, cy + oy + 1), str(t["number"]), fill=(200, 40, 30, 255) if t["number"] in (6, 8) else (70, 45, 20, 255), font=f, anchor="mm")
    label = "Market" if k == "market" else k
    ty = cy + 62
    w = d.textlength(label, font=fw)
    d.rounded_rectangle((cx - w / 2 - 7, ty - 13, cx + w / 2 + 7, ty + 12), radius=6, fill=(255, 250, 235, 230))
    d.text((cx, ty), label, fill=(70, 45, 20, 255), font=fw, anchor="mm")
can.save(out)
print(can.size)
