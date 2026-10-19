# ルールブック用：合法な盤面を1つ組み立て、SVGを出力する
import os, sys, math
os.environ.update(FIXED='1', COINPRICE='3', HSINGLE='1', HARBORS='6', BANKBASE='4', ORDERSET='2', DEV='1', DEVOFF='1', LOWPRICE='1', COINBANK='1')
import mapwf
from wf import PROB

seed=int(sys.argv[1]) if len(sys.argv)>1 else 5
BLANK=len(sys.argv)>3 and sys.argv[3]=='blank'
MARK='<!--BLANKMAP-->' if BLANK else '<!--MAP-->'
g=mapwf.MapGame(4,['crop','chicken','cow','mixed'],seed,'hex454')
L=g.L; co=L['coords']
S=52; PAD=78
xs=[x for x,y in co.values()]; ys=[y for x,y in co.values()]
minx,maxx,miny,maxy=min(xs),max(xs),min(ys),max(ys)
W=(maxx-minx)*S+PAD*2; H=(maxy-miny)*S+PAD*2
P=lambda x,y: ((x-minx)*S+PAD, (y-miny)*S+PAD)
cx0=sum(xs)/len(xs); cy0=sum(ys)/len(ys)
ICON={'grow':'i-grow','buy':'i-buy','feed':'i-feed','sell':'i-sell','seed':'i-seed','animal':'i-animal'}
PCOL=['var(--p1)','var(--p2)','var(--p3)','var(--p4)']
out=[]
out.append(f'<svg class="map" viewBox="0 0 {W:.0f} {H:.0f}" role="img" aria-label="六角タイル13枚の産地マップ。中央にMarket、海岸線に港6つ、4人の初期拠点が交点に置かれている">')
out.append(f'<rect x="1" y="1" width="{W-2:.0f}" height="{H-2:.0f}" rx="18" fill="var(--sea)"/>')
# 港：外側の角1か所から海へ桟橋を出す
for v,h in g.harbor.items():
    x1,y1=co[v]; dx,dy=x1-cx0,y1-cy0; d=math.hypot(dx,dy); ox,oy=x1+dx/d*0.85, y1+dy/d*0.85
    X,Y=P(ox,oy); A=P(x1,y1)
    out.append(f'<path d="M{A[0]:.1f} {A[1]:.1f} L{X:.1f} {Y:.1f}" stroke="var(--soil)" stroke-width="6" stroke-linecap="round"/>')
    out.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="21" fill="var(--paper)" stroke="var(--line)" stroke-width="2"/>')
    if BLANK:
        out.append(f'<text x="{X:.1f}" y="{Y+5:.1f}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">港</text>')
    elif h=='any':
        out.append(f'<text x="{X:.1f}" y="{Y+5:.1f}" text-anchor="middle" class="en" font-size="14" font-weight="700" fill="var(--ink)">3:1</text>')
    else:
        out.append(f'<use href="#{ICON[h]}" x="{X-12:.1f}" y="{Y-17:.1f}" width="24" height="24"/>')
        out.append(f'<text x="{X:.1f}" y="{Y+16:.1f}" text-anchor="middle" class="en" font-size="10" font-weight="700" fill="var(--ink)">2:1</text>')
# タイル
for t,vs in enumerate(L['TV']):
    pts=[P(*co[v]) for v in vs]
    cx=sum(p[0] for p in pts)/6; cy=sum(p[1] for p in pts)/6
    poly=" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)
    if t in L['MARKET']:
        out.append(f'<polygon points="{poly}" fill="var(--wheat)" stroke="var(--line)" stroke-width="2"/>')
        out.append(f'<text x="{cx:.1f}" y="{cy-2:.1f}" text-anchor="middle" class="en" font-size="15" font-weight="700" fill="var(--wheat-ink)">Market</text>')
        out.append(f'<text x="{cx:.1f}" y="{cy+16:.1f}" text-anchor="middle" font-size="11" fill="var(--wheat-ink)">7＝全員1枚</text>')
        continue
    c=g.tcat[t]; n=g.tnum[t]
    out.append(f'<polygon points="{poly}" fill="var(--paper)" stroke="var(--leaf)" stroke-width="2.5"/>')
    if not BLANK: out.append(f'<use href="#{ICON[c]}" x="{cx-17:.1f}" y="{cy-36:.1f}" width="34" height="34"/>')
    red = n in (6,8)
    out.append(f'<circle cx="{cx:.1f}" cy="{cy+14:.1f}" r="14" fill="var(--wheat)" stroke="var(--line)" stroke-width="1.2"/>')
    out.append(f'<text x="{cx:.1f}" y="{cy+19:.1f}" text-anchor="middle" class="en" font-size="14" font-weight="700" fill="{"var(--warn)" if red else "var(--wheat-ink)"}">{n}</text>')
    dots=6-abs(7-n)
    for i in range(dots):
        out.append(f'<circle cx="{cx-(dots-1)*2.6+i*5.2:.1f}" cy="{cy+35:.1f}" r="1.7" fill="var(--muted)"/>')
    if BLANK: out.append(f'<text x="{cx:.1f}" y="{cy-12:.1f}" text-anchor="middle" font-size="10" fill="var(--muted)">{"出やすい" if n in (5,6,8,9) else "出にくい"}</text>')
# 拠点
for p in ([] if BLANK else g.players):
    for b in p.bases:
        X,Y=P(*co[b])
        out.append(f'<g transform="translate({X:.1f} {Y:.1f})"><path d="M-9 4 L-9 -4 L0 -11 L9 -4 L9 4 Z" fill="{PCOL[p.id]}" stroke="var(--line)" stroke-width="1.6"/></g>')
out.append('</svg>')
svg="\n".join(out)
# 盤面の要約（説明文の確認用）
summary={ 'tiles':[(c,n) for c,n in zip(g.tcat,g.tnum)], 'harbors':sorted(set(g.harbor.values()), key=str), 'bases':[p.bases for p in g.players],
          'adj68':[ (i,j) for i in range(13) for j in L['TADJ'][i] if g.tnum[i] in (6,8) and g.tnum[j] in (6,8)] }
print(summary, file=sys.stderr)
html=open(sys.argv[2],encoding='utf-8').read() if len(sys.argv)>2 else None
if html is not None:
    assert MARK in html
    open(sys.argv[2],'w',encoding='utf-8').write(html.replace(MARK,svg))
else:
    print(svg)
