# 生成したタイルを1024に縮め、六角に切り抜き、盤面の大きさで数字のトークンと単語を重ねた見え方を作る（素材仕様書 7章の5）
#   python art/mock_tile.py <入力.png> <名前>
import math, sys
from PIL import Image, ImageDraw, ImageFont
src, name = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB").resize((1024, 1024), Image.LANCZOS)
H = 1024
pts = [(512 + (H / 2) * math.cos(math.radians(a - 90)), 512 + (H / 2) * math.sin(math.radians(a - 90))) for a in range(0, 360, 60)]
mask = Image.new("L", (1024, 1024), 0)
ImageDraw.Draw(mask).polygon(pts, fill=255)
hexim = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
hexim.paste(im, (0, 0), mask)
S = 2
R = 180 / math.sqrt(3)
Wt, Ht = 180, 2 * R
tile = hexim.crop((512 - 443, 0, 512 + 443, 1024)).resize((int(Wt * S), int(Ht * S)), Image.LANCZOS)
can = Image.new("RGBA", (int(Wt * S) + 40, int(Ht * S) + 40), (234, 224, 200, 255))
can.alpha_composite(tile, (20, 20))
d = ImageDraw.Draw(can)
cx, cy = 20 + Wt * S / 2, 20 + Ht * S / 2
r, oy = 27 * S, 10 * S
d.ellipse((cx - r, cy + oy - r, cx + r, cy + oy + r), fill=(240, 214, 140, 255), outline=(90, 60, 30, 255), width=2 * S)
f = ImageFont.truetype("arialbd.ttf", 28 * S)
d.text((cx, cy + oy + 2), "8", fill=(200, 40, 30, 255), font=f, anchor="mm")
# 単語はトークンの下に、白い帯で描く
fw = ImageFont.truetype("arialbd.ttf", 22 * S)
ty = cy + 62 * S
tw = d.textlength(name, font=fw)
d.rounded_rectangle((cx - tw / 2 - 10, ty - 16 * S, cx + tw / 2 + 10, ty + 14 * S), radius=8, fill=(255, 250, 235, 230))
d.text((cx, ty), name, fill=(70, 45, 20, 255), font=fw, anchor="mm")
can.save(src.replace(".png", "-board-mock.png"))
print(Image.open(src).size)
