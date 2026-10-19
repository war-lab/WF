# 固定の数字配置と港位置を探索する
import math, random, itertools, json, sys
from statistics import pvariance
import mapwf
from wf import PROB, TILES
L=mapwf.build('hex454'); M=L['MARKET']; idx=[i for i in range(13) if i not in M]
co=L['coords']; cx=sum(x for x,y in co.values())/len(co); cy=sum(y for x,y in co.values())/len(co)
single=sorted([v for v,ts in L['VT'].items() if len(ts)==1], key=lambda v: math.atan2(co[v][1]-cy, co[v][0]-cx))
NUMS=[2,3,4,5,6,6,8,8,9,10,11,12]; HIGHS={5,6,8,9}
rng=random.Random(1)
def harbors_for(num):
    # 外側の角を等間隔に6か所、6・8のタイルを避ける。候補の中で最も等間隔に近いものを返す
    best=None
    n=len(single)
    for off in range(n):
        vs=[single[(off+round(k*n/6))%n] for k in range(6)]
        if all(num[L['VT'][v][0]] not in (6,8) for v in vs): return vs
    return None
def cat_feasible(num, tries=400):
    hi=[i for i in idx if num[i] in (5,6,6,8,8,9) ]
    # 5・6・6・8・8・9 の6か所が高頻度、残り6か所が低頻度
    hi=[i for i in idx if num[i] in (5,6,8,9)]; lo=[i for i in idx if i not in hi]
    ok=0
    for _ in range(tries):
        h=hi[:]; l=lo[:]; rng.shuffle(h); rng.shuffle(l)
        cat={}
        for c,a,b in zip(TILES,h,l): cat[a]=c; cat[b]=c
        if num[[k for k in idx if cat[k]=='sell' and num[k] in (5,6,8,9)][0]] not in (6,8): continue
        if any(cat[i]==cat[j] for i in idx for j in L['TADJ'][i] if j in idx): continue
        ok+=1
    return ok/tries
best=None
for it in range(60000):
    perm=NUMS[:]; rng.shuffle(perm); num={i:None for i in range(13)}
    for i,n in zip(idx,perm): num[i]=n
    red=[i for i in idx if num[i] in (6,8)]
    if any(j in L['TADJ'][i] for i in red for j in red): continue
    if any(num[j]==num[i] for i in idx for j in L['TADJ'][i] if j in idx): continue
    hv=harbors_for(num)
    if not hv: continue
    vals=[sum(PROB[num[t]] for t in L['VT'][v] if t not in M) for v in L['VT']]
    three=[sum(PROB[num[t]] for t in L['VT'][v] if t not in M) for v in L['VT'] if len([t for t in L['VT'][v] if t not in M])==3]
    score=pvariance(three)+0.3*max(vals)  # 内側の交点の価値をそろえ、突出した交点を作らない
    if best is None or score<best[0]:
        best=(score,dict(num),hv,max(vals),sorted(three))
score,num,hv,mx,three=best
feas=cat_feasible(num,2000)
print('score',round(score,5),'最大の交点価値',round(mx,3),'内側交点の価値',[round(x,3) for x in three])
print('数字',[num[i] for i in range(13)],'港の交点',hv,'種類の割り当てが条件を満たす割合',feas)
json.dump({'num':[num[i] for i in range(13)],'harbors':hv},open('fixed_layout.json','w'))
