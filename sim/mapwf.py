# マップ形状の比較用。タイルを多角形として定義し、交点・隣接を自動計算する
import os, math, random
from collections import Counter
from wf import Game, Player, RuleError, STRATS, PROB, ORDERS, DEVDECK, TILES
import wf

HARBORS = int(os.environ.get('HARBORS','0'))
HSINGLE = os.environ.get('HSINGLE')=='1'
import json as _json
FIXED = _json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'fixed_layout.json'))) if os.environ.get('FIXED')=='1' else None
HANY=int(os.environ.get('HANY','3')); HSPEC=int(os.environ.get('HSPEC','2'))
CARDSET={'grow':['grow'],'buy':['buy'],'feed':['feed'],'sell':['sell'],'seed':['carrot','potato','wheat'],'animal':['cow','chicken']}
MAXBASE = int(os.environ.get('MAP_MAXBASE','3'))
T3 = int(os.environ.get('MAP_T3','8')); T4 = int(os.environ.get('MAP_T4','7'))
HV=float(os.environ.get('HV','0.08'))
SAMEOK = os.environ.get('SAMEOK')=='1'
HIGH=[5,6,6,8,8,9]; LOW=[2,3,4,10,11,12]

def hex_poly(cx,cy):
    return [(cx+math.cos(math.radians(60*k+30)), cy+math.sin(math.radians(60*k+30))) for k in range(6)]
def sq_poly(x,y):
    return [(x,y),(x+1,y),(x+1,y+1),(x,y+1)]

def hex_rows(rows):
    r3=math.sqrt(3); polys=[]
    for ri,(cnt,off) in enumerate(rows):
        for i in range(cnt): polys.append(hex_poly((i+off)*r3, ri*1.5))
    return polys

def oct_poly(cx,cy):
    R_=1/(2*math.sin(math.radians(22.5)))
    return [(cx+R_*math.cos(math.radians(22.5+45*k)), cy+R_*math.sin(math.radians(22.5+45*k))) for k in range(8)]
def diamond(cx,cy):
    h=1/math.sqrt(2); return [(cx+h,cy),(cx,cy+h),(cx-h,cy),(cx,cy-h)]
def octsq(w,h):
    d=1+math.sqrt(2)
    octs=[oct_poly(i*d,j*d) for j in range(h) for i in range(w)]
    sqs=[diamond((i+.5)*d,(j+.5)*d) for j in range(h-1) for i in range(w-1)]
    return octs+sqs
def house(x0,y0,up=True):
    if up: return [(x0,y0),(x0+1,y0),(x0+1,y0+1),(x0+.5,y0+1.5),(x0,y0+1)]
    return [(x0,y0+1.5),(x0+1,y0+1.5),(x0+1,y0+.5),(x0+.5,y0),(x0,y0+.5)]
def pent():
    # 上向きの家4・下向きの家4（屋根を噛み合わせる）・その上に上向きの家4
    ps=[house(x,0) for x in range(4)]
    ps+=[house(x-.5,1,up=False) for x in range(4)]
    ps+=[house(x-.5,2.5) for x in range(4)]
    return ps

LAYOUTS = {
    'octsq':  (lambda: octsq(4,3), list(range(12,18))),
    'pent':   (pent, None),
    'hex454': (lambda: hex_rows([(4,.5),(5,0),(4,.5)]), 6),
    'hex444': (lambda: hex_rows([(4,0),(4,.5),(4,0)]), None),
    'sq43':   (lambda: [sq_poly(x,y) for y in range(3) for x in range(4)], None),
    'sqplus': (lambda: [sq_poly(x,y) for y in range(3) for x in range(3)]+[sq_poly(1,-1),sq_poly(-1,1),sq_poly(3,1),sq_poly(1,3)], 4),
    'sqring': (lambda: [sq_poly(x,y) for y in range(4) for x in range(4) if x in (0,3) or y in (0,3)], None),
}

def build(name):
    mk, market = LAYOUTS[name]; polys=mk()
    vid={}; TV=[]
    for poly in polys:
        vs=[]
        for (x,y) in poly:
            k=(round(x,3),round(y,3))
            if k not in vid: vid[k]=len(vid)
            vs.append(vid[k])
        TV.append(vs)
    NB={v:set() for v in vid.values()}
    for vs in TV:
        for a,b in zip(vs, vs[1:]+vs[:1]): NB[a].add(b); NB[b].add(a)
    VT={v:[i for i,vs in enumerate(TV) if v in vs] for v in NB}
    TADJ={i:{j for v in TV[i] for j in VT[v] if j!=i} for i in range(len(TV))}
    # 海岸線の辺（1タイルにしか属さない辺）を中心まわりの角度順に並べる
    cnt=Counter()
    for vs in TV:
        for a,b in zip(vs, vs[1:]+vs[:1]): cnt[frozenset((a,b))]+=1
    co={v:k for k,v in vid.items()}
    cx=sum(x for x,y in co.values())/len(co); cy=sum(y for x,y in co.values())/len(co)
    be=[tuple(e) for e,c in cnt.items() if c==1]
    be.sort(key=lambda e: math.atan2(sum(co[v][1] for v in e)/2-cy, sum(co[v][0] for v in e)/2-cx))
    mset=set(market) if isinstance(market,list) else ({market} if market is not None else set())
    return dict(TV=TV,VT=VT,NB=NB,TADJ=TADJ,MARKET=mset,BEDGES=be,n=len(TV),coords={v:k for k,v in vid.items()})

class MapGame(Game):
    def __init__(s, n, strats, seed=0, layout='hex454', target=None, log=False):
        s.L=build(layout)
        s.rng=random.Random(seed); s.n=n; s.logon=log; s.logs=[]; s.devdeck=[]
        s.target = target or (T3 if n==3 else T4)
        s.layout_tiles()
        s.harbor={}   # 交点→港の種類
        if HARBORS and FIXED:
            types=['any','any']+s.rng.sample(TILES,4); s.rng.shuffle(types)
            # 汎用港（3:1）は位置を固定（交点37と3）。専門港の種類だけ毎回変わる。乱数の使い方は以前と同じ
            specs=[t for t in types if t!='any']
            for v in FIXED['harbors']: s.harbor[v]='any' if v in (37,3) else specs.pop(0)
        elif HARBORS and HSINGLE:
            # 港は「タイル1枚だけに接する外側の角」1か所。その角のタイルは6・8にしない
            co=s.L['coords']; cx=sum(x for x,y in co.values())/len(co); cy=sum(y for x,y in co.values())/len(co)
            cand=sorted([v for v,ts in s.L['VT'].items() if len(ts)==1], key=lambda v: math.atan2(co[v][1]-cy, co[v][0]-cx))
            for _ in range(200):
                types=['any','any']+s.rng.sample(TILES,4); s.rng.shuffle(types)
                offs=list(range(len(cand))); s.rng.shuffle(offs); picked=None
                for off in offs:
                    vs=[cand[(off+round(k*len(cand)/HARBORS))%len(cand)] for k in range(HARBORS)]
                    if all(s.tnum[s.L['VT'][v][0]] not in (6,8) for v in vs): picked=vs; break
                if picked: break
                s.layout_tiles()
            for v,t in zip(picked,types): s.harbor[v]=t
        elif HARBORS:
            be=s.L['BEDGES']; types=['any','any']+s.rng.sample(TILES,4); s.rng.shuffle(types)
            off=s.rng.randrange(len(be))
            for k,t in enumerate(types[:HARBORS]):
                e=be[(off+round(k*len(be)/HARBORS))%len(be)]
                for v in e: s.harbor[v]=t
        s.vocc={}
        s.players=[Player(i,strats[i]) for i in range(n)]
        for p in s.players: p.hand.update(['grow','sell'])
        if os.environ.get('ORDERGEN')=='1':
            import ordergen, wf as _wf
            deck=ordergen.gen_deck(random.Random(seed*7919+1), int(os.environ.get('ORDERN','24')))
            _wf.ORDERS[:]=deck; _wf.OBYID.clear(); _wf.OBYID.update({o['id']:o for o in deck})
        s.deck=[o['id'] for o in ORDERS]; s.rng.shuffle(s.deck)
        if os.environ.get('JOINT')=='1':
            import ordergen as _og
            s.jdeck=_og.unique_events(_og.gen_joint_deck(random.Random(seed*104729+3), 8)); s.jface=s.jdeck.pop(); s.jface['since']=1
            for _ in range(wf.JOINTN-1):
                if s.jdeck: j=s.jdeck.pop(); j['since']=1; s.jfaces.append(j)
        else: s.jdeck=[]; s.jface=None
        s.face=[s.deck.pop() for _ in range(3)]
        order=list(range(n))+list(range(n))[::-1]
        for k,i in enumerate(order):
            p=s.players[i]; v=s.choose_tile(p); s.place_base(p,v)
            if k>=n:
                for t in s.L['VT'][v]:
                    if s.tcat[t]: p.hand[s.card_from(p,s.tcat[t])]+=1
        # 初期配置後の期待収入（1回の出目あたりの枚数）
        s.start_ev=[sum(PROB[s.tnum[t]] for b in p.bases for t in s.L['VT'][b] if s.tcat[t]) for p in s.players]
        if n==3:
            for p in s.players: p.hand[s.best_any(p)]+=1
        s.devdeck=list(DEVDECK); s.rng.shuffle(s.devdeck); s.guard=None
        for p in s.players: p.dev=[]; p.vp=0; p.fox=0
        s.round=1; s.cur=0; s.winner=None; s.ended=False; s.end_reason=None; s.exhaust=False
        s.turn_active=False; s.tilenum={}

    def layout_tiles(s):
        L=s.L; idx=[i for i in range(L['n']) if i not in L['MARKET']]
        if FIXED:
            num=FIXED['num']; hi=[i for i in idx if num[i] in (5,6,8,9)]; lo=[i for i in idx if i not in hi]
            for _ in range(5000):
                h=hi[:]; l=lo[:]; s.rng.shuffle(h); s.rng.shuffle(l); cats=list(TILES); s.rng.shuffle(cats)
                s.tcat=[None]*L['n']; s.tnum=list(num)
                for c,a,b in zip(cats,h,l): s.tcat[a]=c; s.tcat[b]=c
                sellhi=[k for k in hi if s.tcat[k]=='sell'][0]
                if num[sellhi] not in (6,8): continue
                if SAMEOK or not any(s.tcat[i]==s.tcat[j] for i in idx for j in L['TADJ'][i] if j in idx): return
            raise RuntimeError('種類を割り当てられない')
        for _ in range(2000):
            cats=[c for c in TILES for _ in range(2)]; s.rng.shuffle(cats)
            hi=list(HIGH); lo=list(LOW); s.rng.shuffle(hi); s.rng.shuffle(lo)
            num={}
            h=next(x for x in hi if x in (6,8)); hi.remove(h); num['sell']=[h]
            for c in TILES:
                if c!='sell': num[c]=[hi.pop()]
            for c in TILES: num[c].append(lo.pop())
            s.tcat=[None]*L['n']; s.tnum=[None]*L['n']
            for i,c in zip(idx,cats): s.tcat[i]=c
            used={c:0 for c in TILES}; order=list(idx); s.rng.shuffle(order)
            for i in order:
                c=s.tcat[i]; s.tnum[i]=num[c][used[c]]; used[c]+=1
            red=[i for i in idx if s.tnum[i] in (6,8)]
            same=any(s.tcat[j]==s.tcat[i] for i in idx for j in L['TADJ'][i] if j in idx)
            if SAMEOK: same=False
            if not same and all(j not in L['TADJ'][i] for i in red for j in red): return
        raise RuntimeError('6と8を離して置けない')

    def card_from(s, q, cat):
        if cat=='seed': return s.best_crop(q)
        if cat=='animal': return s.want_animal(q) or 'chicken'
        return cat
    def maxbase(s): return MAXBASE
    def ratio(s, p, card):
        r=int(os.environ.get('BANKBASE','3'))
        for b in p.bases:
            h=s.harbor.get(b)
            if h=='any': r=min(r,HANY)
            elif h and card in CARDSET[h]: r=min(r,HSPEC)
        return r
    def tile_ok(s, p, v): return v not in s.vocc and all(u not in s.vocc for u in s.L['NB'][v])
    def can_house(s, p): return any(s.tile_ok(p,v) for v in s.L['VT'])
    def place_base(s, p, v):
        if not s.tile_ok(p,v): raise RuleError('その交点には置けない')
        s.vocc[v]=p.id; p.bases.append(v)
    def choose_tile(s, p):
        an=bool(STRATS[p.strat]['animals'])
        w={'sell':1.3,'grow':1.0,'seed':1.0,'feed':1.2 if an else 0.2,'animal':0.7 if an else 0.05,'buy':0.6 if an else 0.05}
        have=Counter(s.tcat[t] for b in p.bases for t in s.L['VT'][b] if s.tcat[t])
        def score(v):
            sc=sum(PROB[s.tnum[t]]*w[s.tcat[t]]/(1+0.5*have[s.tcat[t]]) for t in s.L['VT'][v] if s.tcat[t])
            h=s.harbor.get(v)
            if h=='any': sc+=HV
            elif h: sc+=HV*(1.5 if (have[h] or any(s.tcat[t]==h for t in s.L['VT'][v])) else 0.6)
            return sc+s.rng.random()*1e-3
        c=[v for v in s.L['VT'] if s.tile_ok(p,v)]
        if not c: raise RuleError('置ける交点がない')
        return max(c,key=score)
    def payouts(s, r):
        for t in range(s.L['n']):
            if s.tnum[t]==r:
                for v in s.L['TV'][t]:
                    if v in s.vocc: yield s.players[s.vocc[v]], s.tcat[t]

def run_map(n, strats, seed, layout, maxround=40):
    g=MapGame(n,strats,seed,layout)
    while not g.ended and g.round<=maxround: g.bot_turn()
    if not g.ended: g.end_reason='timeout'
    return g
