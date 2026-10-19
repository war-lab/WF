# WORD FARM ルール v0.1 のシミュレーションエンジン
import random, json, sys, pickle, os, math
# 拠点を足す費用と、ボットが拠点を足す最後のラウンド（試験用。既定は確定仕様の値）
FEEDALL=__import__('os').environ.get('FEEDALL')=='1'
JSTART=__import__('os').environ.get('JSTART','show')  # 時間切れの数え始め：show=表に出たとき、line=最初の行が出たとき
JOINTN=int(__import__('os').environ.get('JOINTN','1'))  # 表にする共同注文の枚数
ACTIONS=int(__import__('os').environ.get('ACTIONS','2'))  # 1手番の行動の上限（99で実質なし）
HFROUND=int(__import__('os').environ.get('HFROUND','8'))
HOUSECOST=int(__import__('os').environ.get('HOUSECOST','3')); HOUSEROUND=int(__import__('os').environ.get('HOUSEROUND','5'))
from collections import Counter, defaultdict

CARDS = ['grow','buy','feed','sell','carrot','potato','wheat','cow','chicken','two','three','four','five']
NUM = {'two':2,'three':3,'four':4,'five':5}
NUMNAME = {v:k for k,v in NUM.items()}
CROPS = ['carrot','potato','wheat']
PRODUCTS = ['carrot','potato','wheat','egg','milk']
TILES = ['grow','buy','feed','sell','seed','animal']
PRICE = {'carrot':1,'potato':1,'wheat':1,'egg':1,'milk':2} if os.environ.get('LOWPRICE')=='1' else {'carrot':1,'potato':1,'wheat':1,'egg':2,'milk':3}
if os.environ.get('PRICES'): PRICE={k:int(v) for k,v in (x.split(':') for x in os.environ['PRICES'].split(','))}
ANIMAL_COST = {'cow':4,'chicken':2}
ANIMAL_OUT = {'cow':('milk',3),'chicken':('egg',int(os.environ.get('EGG','2')))}
YIELD=int(os.environ.get('YIELD','3')); DELAY=int(os.environ.get('DELAY','1'))
HOUSE_ALL = os.environ.get('HOUSE_ALL')=='1'
DEV = os.environ.get('DEV')=='1'
if DEV: CARDS = [c for c in CARDS if c not in ('two','three','four','five')]
DEVCOST = int(os.environ.get('DEVCOST','2'))
DEVNOBUY = os.environ.get('DEVNOBUY')=='1'
DEVOFF = os.environ.get('DEVOFF')=='1'
COINBANK = os.environ.get('COINBANK')=='1'
COWMODE = os.environ.get('COWMODE','')
SEVEN = os.environ.get('SEVEN')=='1'
JOINT = os.environ.get('JOINT')=='1'
ACTIVE = os.environ.get('ACTIVE')=='1'
PRODBUY = int(os.environ.get('PRODBUY','0'))
PRODMULT = int(os.environ.get('PRODMULT','0'))
CARROTFEED = os.environ.get('CARROTFEED')=='1'
COWGROW = os.environ.get('COWGROW','')   # 'buy'：牛を買うときgrowも要る／'feed'：餌のたびにgrowも要る   # ニンジンを植えるにはfeedカード（肥料）も要る   # 売値の何倍で買えるか（0なら PRODBUY の固定価格）
# PRODPRICES：売値ごとの購入価格（例 1:10,2:15）。指定があれば倍率より優先する
PRODPRICES={int(k):int(v) for k,v in (kv.split(':') for kv in filter(None,os.environ.get('PRODPRICES','').split(',')))}
def prod_price(item):
    if PRODPRICES: return PRODPRICES[PRICE[item]]
    return PRODMULT*PRICE[item] if PRODMULT else PRODBUY   # 産物の交換・トップへの拒否・余剰の換金を行う積極的なボット
JTIMEOUT = int(os.environ.get('JTIMEOUT','0'))   # 7で手札7枚以上は半分捨てる・手番終わりの上限なし
COINPRICE = int(os.environ.get('COINPRICE','2'))
DEVDECK = [] if DEVOFF else ['fox']*int(os.environ.get('FOX','8'))+['tractor']*4+['rain']*3+['lucky']*3+['bigorder']*2
PROB = {n:(6-abs(7-n))/36 for n in range(2,13)}
WEIGHT = {'sell':1.2,'feed':1.1,'grow':1.0,'carrot':1.0,'potato':1.0,'wheat':1.0,
          'buy':1.0,'cow':1.0,'chicken':1.0,'two':0.6,'three':0.6,'four':0.6,'five':0.6}

# 注文：kind = fixed / anyof(#12) / same(#13) / animals(#15)
ORDERS = [
 dict(id=1, pts=2, kind='fixed', req={'carrot':3}, nums=[3], text="The cafe needs three carrots."),
 dict(id=2, pts=2, kind='fixed', req={'potato':4}, nums=[4], text="Can you bring me four potatoes?"),
 dict(id=3, pts=2, kind='fixed', req={'wheat':3}, nums=[3], text="We are baking bread. Please send three bags of wheat."),
 dict(id=4, pts=3, kind='fixed', req={'egg':2,'milk':1}, nums=[2], text="I want two eggs and some milk."),
 dict(id=5, pts=3, kind='fixed', req={'potato':5}, nums=[5], text="A family of five wants five potatoes for dinner."),
 dict(id=6, pts=4, kind='fixed', req={'carrot':3,'potato':3}, nums=[3], text="It's soup day! Carrots and potatoes, three of each."),
 dict(id=7, pts=3, kind='fixed', req={'egg':4}, nums=[4], text="No vegetables, please. Just four eggs."),
 dict(id=8, pts=4, kind='fixed', req={'milk':4}, nums=[4], text="Our kids love milk. Could you send four bottles?"),
 dict(id=9, pts=3, kind='fixed', req={'milk':1,'egg':1,'wheat':1}, nums=[], text="The pancake shop needs milk, eggs and wheat. One of each is enough."),
 dict(id=10, pts=3, kind='fixed', req={'egg':2,'carrot':2}, nums=[2], text="Please don't send milk. We need two eggs and two carrots."),
 dict(id=11, pts=5, kind='fixed', req={'wheat':2,'egg':2,'milk':2}, nums=[2], text="The bakery is looking for wheat, eggs and milk, two of each."),
 dict(id=12, pts=3, kind='anyof', req={'potato':5,'wheat':5}, total=5, nums=[5], text="Anything but carrots: we need five crops in total."),
 dict(id=13, pts=3, kind='same', req={'carrot':2,'potato':2}, nums=[2,3,4,5], text="We want the same number of carrots and potatoes, at least two of each."),
 dict(id=14, pts=5, kind='fixed', req={'egg':6}, nums=[], text="Half a dozen eggs, please."),
 dict(id=15, pts=3, kind='animals', req={}, n=3, nums=[], text="A school trip wants to visit a farm with three animals."),
 dict(id=16, pts=3, kind='fixed', req={'wheat':4}, nums=[4], text="The brewery is short of wheat. Four bags would save us."),
]
if os.environ.get('ORDERSET') in ('2','3'):
    ORDERS[1]=dict(id=2, pts=2, kind='fixed', req={'egg':3}, nums=[3], text="Can you bring me three eggs?")
    ORDERS[4]=dict(id=5, pts=3, kind='fixed', req={'milk':3}, nums=[3], text="A family of three wants three bottles of milk.")
if os.environ.get('ORDERSET')=='3':
    ORDERS[1]=dict(id=2, pts=2, kind='fixed', req={'egg':2}, nums=[2], text="Can you bring me two eggs?")
    ORDERS[3]=dict(id=4, pts=3, kind='fixed', req={'egg':2,'milk':1}, nums=[2], text="I'd like two eggs and a bottle of milk.")
    if os.environ.get('ORD13')=='down': ORDERS[5]=dict(ORDERS[5], pts=3)
    else: ORDERS[11]=dict(ORDERS[11], pts=4); ORDERS[12]=dict(ORDERS[12], pts=4)
OBYID = {o['id']:o for o in ORDERS}

STRATS = {
 'crop':    dict(crop=True, animals=[]),
 'chicken': dict(crop=True, animals=['chicken','chicken','chicken']),
 'cow':     dict(crop=True, animals=['cow','cow']),
 'mixed':   dict(crop=True, animals=['chicken','cow','chicken']),
}

class RuleError(Exception): pass

class Player:
    def __init__(s, i, strat):
        s.id=i; s.strat=strat; s.hand=Counter(); s.prod=Counter(); s.coins=3; s.pts=0
        s.fields=[None]*4; s.bases=[]; s.turns=0
        s.st=Counter()  # 統計
    def animals(s): return [f for f in s.fields if f and f['t'] in ('cow','chicken')]
    def empty(s): return [i for i,f in enumerate(s.fields) if f is None]
    def handsize(s): return sum(s.hand.values())

class Game:
    # 共同注文の表の札。JOINTN 枚まで並べる。jface は先頭の1枚（台本と1枚の時の互換用）
    @property
    def jface(s):
        fs=s.__dict__.get('jfaces') or []
        return fs[0] if fs else None
    @jface.setter
    def jface(s, v): s.__dict__['jfaces']=[v] if v else []
    def joint_refill(s):
        while len(s.jfaces)<JOINTN and s.jdeck:
            j=s.jdeck.pop(); j['since']=s.round; s.jfaces.append(j); s.emit(t='joint_refill',order=j['id'])
    def __init__(s, n, strats, seed=0, target=None, log=False):
        s.rng=random.Random(seed); s.n=n; s.logon=log; s.logs=[]; s.devdeck=[]
        s.target = target or (8 if n==3 else 7)
        nums=[4,5,6,8,9,10]
        while True:
            sellnum=s.rng.choice([6,8]); rest=[x for x in nums if x!=sellnum]; s.rng.shuffle(rest)
            s.tilenum={'sell':sellnum}
            for t,x in zip([t for t in TILES if t!='sell'], rest): s.tilenum[t]=x
            low=lambda t: s.tilenum[t] in (4,10)
            if os.environ.get('TILERULE')!='1': break
            if not (low('grow') and low('seed')) and not (low('buy') and low('animal')): break
        s.cap=n-1; s.occ={t:[] for t in TILES}
        s.players=[Player(i,strats[i]) for i in range(n)]
        INIT=os.environ.get('INIT')=='base'
        for p in s.players: p.hand.update(['grow','sell'] if INIT else ['grow','carrot','feed','sell'])
        s.face=[]
        order=list(range(n))+list(range(n))[::-1]
        for i in order:
            p=s.players[i]; t=s.choose_tile(p); s.place_base(p,t)
            if INIT:
                c={'seed':s.rng.choice(CROPS),'animal':s.want_animal(p) or 'chicken'}.get(t,t)
                p.hand[c]+=1
        s.deck=[o['id'] for o in ORDERS]; s.rng.shuffle(s.deck)
        s.face=[s.deck.pop() for _ in range(3)]
        if n==3:
            for p in s.players: p.hand[s.best_any(p)]+=1
        s.devdeck=list(DEVDECK); s.rng.shuffle(s.devdeck); s.guard=None
        for p in s.players: p.dev=[]; p.vp=0; p.fox=0
        s.round=1; s.cur=0; s.winner=None; s.ended=False; s.end_reason=None; s.exhaust=False
        s.turn_active=False
        s.log(f"タイル: {s.tilenum}")
        for p in s.players: s.log(f"P{p.id}({p.strat}) 拠点 {p.bases}")
        s.log(f"注文: {s.face}")

    def log(s, m):
        if s.logon: s.logs.append(m)
    def card_from(s, q, t):
        if t=='seed': return s.best_crop(q)
        if t=='animal': return s.want_animal(q) or 'chicken'
        return t
    def next_roll(s):
        fr=getattr(s,'forced_rolls',None)
        if fr: return fr.pop(0)
        return s.rng.randint(1,6)+s.rng.randint(1,6)
    def emit(s, **e):
        if getattr(s,'events',None) is not None: s.events.append(e)

    # ---- 拠点 ----
    def maxbase(s): return 3
    def ratio(s, p, card): return int(os.environ.get('BANKBASE','3'))
    def can_house(s, p): return any(s.tile_ok(p,t) for t in TILES)
    def tile_ok(s, p, t): return len(s.occ[t])<s.cap and t not in p.bases
    def place_base(s, p, t):
        if not s.tile_ok(p,t): raise RuleError('その産地には置けない')
        s.occ[t].append(p.id); p.bases.append(t)
    def choose_tile(s, p):
        an = bool(STRATS[p.strat]['animals'])
        w={'sell':1.3,'grow':1.0,'seed':1.0,'feed':1.2 if an else 0.2,'animal':0.7 if an else 0.05,'buy':0.6 if an else 0.05}
        c=[t for t in TILES if s.tile_ok(p,t)]
        return max(c, key=lambda t: PROB[s.tilenum[t]]*w[t]+s.rng.random()*1e-3)

    # ---- 評価 ----
    def want_animal(s, p):
        tgt=Counter(STRATS[p.strat]['animals']); have=Counter(f['t'] for f in p.animals())
        for a in STRATS[p.strat]['animals']:
            if have[a]<tgt[a]: return a
        return None
    def producible(s, p):
        t=set(CROPS) if STRATS[p.strat]['crop'] else set()
        for a in STRATS[p.strat]['animals']+[f['t'] for f in p.animals()]:
            t.add(ANIMAL_OUT[a][0])
        return t
    def order_types(s, o):
        if o['kind']=='anyof': return set(o.get('allowed',['potato','wheat']))
        return set(o['req'].keys())
    def order_feasible(s, p, o):
        if o['kind']=='animals': return len(STRATS[p.strat]['animals'])>=3 or len(p.animals())>=3
        if o['kind']=='anyof': return bool(set(o.get('allowed',['potato','wheat'])) & s.producible(p))
        return s.order_types(o) <= s.producible(p)
    def missing(s, p, o, extra=None):
        prod=Counter(p.prod)
        if extra: prod.update(extra)
        if o['kind']=='animals': return Counter({'animal':max(0,o['n']-len(p.animals()))})
        if o['kind']=='anyof':
            al=o.get('allowed',['potato','wheat']); tot=o.get('total',5)
            return Counter({al[-1]:max(0,tot-sum(prod[x] for x in al))})
        return Counter({k:max(0,v-prod[k]) for k,v in o['req'].items()})
    def pipeline(s, p):
        # 植え付け済み作物の将来収量
        c=Counter()
        for f in p.fields:
            if f and f['t']=='crop': c[f['c']]+=3
        return c
    def best_crop(s, p):
        dem=Counter()
        pipe=s.pipeline(p)
        for oid in s.face:
            o=OBYID[oid]
            if not s.order_feasible(p,o): continue
            m=s.missing(p,o,pipe)
            for k,v in m.items():
                if k in CROPS: dem[k]+=v/ max(1,sum(m.values()))*o['pts']
        if JOINT:
            for jf in s.__dict__.get('jfaces',[]):
                for l in jf['lines']:
                    if l.get('by') is None and l['item'] in CROPS: dem[l['item']]+=l['pts']*0.5
        if not dem: return s.rng.choice(CROPS)
        return dem.most_common(1)[0][0]
    def desired(s, p):
        d=Counter()
        d['feed']=len(p.animals())
        if COWGROW=='feed': d['grow']+=sum(1 for f in p.animals() if f['t']=='cow')
        d['sell']=2
        emp=len(p.empty())
        wa=s.want_animal(p)
        crop_fields = emp - (1 if wa else 0)
        if STRATS[p.strat]['crop'] and crop_fields>0:
            bc=s.best_crop(p); d['grow']=min(2,crop_fields); d[bc]+=min(2,crop_fields)
            if CARROTFEED and bc=='carrot': d['feed']+=1
        if wa and emp>0:
            d['buy']=1; d[wa]+=1
        if DEV and not DEVNOBUY and s.devdeck and p.coins>=DEVCOST: d['buy']+=1
        for oid in (s.face if not DEV else []):
            o=OBYID[oid]
            if s.order_feasible(p,o):
                for x in o['nums']:
                    if x in NUMNAME: d[NUMNAME[x]]=1
        return d
    def value(s, p, c, d=None):
        d=d or s.desired(p)
        return WEIGHT[c] if p.hand[c]<d[c] else 0.1*WEIGHT[c]
    def best_any(s, p):
        d=s.desired(p)
        return max(CARDS, key=lambda c:(s.value(p,c,d), -p.hand[c], s.rng.random()))

    def payouts(s, r):
        for t,x in s.tilenum.items():
            if x==r:
                for qid in s.occ[t]: yield s.players[qid], t
    # ---- 手番開始（収入・収穫） ----
    def start_turn(s):
        p=s.players[s.cur]; s.turn_active=True
        s.actions=ACTIONS; s.flushed=False; s.tractor=False; s.trades=0; s.devplayed=False; s.jdone_turn=False; s.prodbought=False
        p.turns+=1
        if JOINT and JTIMEOUT and s.__dict__.get('jfaces') and s.cur==0:
            for j in list(s.jfaces):
                j.setdefault('since', s.round)
                # JSTART=line：最初の行が出たラウンドから数える。誰も出していなければ時間切れにならない
                t0=j.get('started') if JSTART=='line' else j['since']
                if t0 is not None and s.round-t0>=JTIMEOUT:
                    for l in j['lines']:
                        if l.get('by') is not None:
                            half=math.floor(l['pts'])/2; q=s.players[l['by']]; q.pts+=half; q.st['joint_pts']+=half; q.st['joint_half']+=1
                    s.emit(t='joint_expire',order=j['id'])
                    s.jfaces.remove(j)
                    if JOINTN==1:
                        if s.jdeck: nj=s.jdeck.pop(); nj['since']=s.round; s.jfaces.append(nj)
                    else: s.joint_refill()
        if JOINT: s.check_win(p)
        for f in p.fields:
            if f and f['t'] in ('cow','chicken'): f['fed']=False
            if f and f.get('pending'): p.prod['milk']+=f['pending']; s.emit(t='milk',p=p.id,n=f['pending']); f['pending']=0
        r=s.next_roll(); s.lastroll=r
        got=False
        s.log(f"--- R{s.round} P{p.id}({p.strat}) 出目{r}"); s.emit(t='turn',p=p.id,round=s.round,roll=r)
        if r==7:
            if SEVEN:
                for q in s.players:
                    if q.handsize()>=7:
                        k=q.handsize()//2; q.st['seven_discard']+=k; s.emit(t='seven_discard',p=q.id,n=k)
                        for _ in range(k):
                            d=s.desired(q)
                            c=min([c for c in CARDS if q.hand[c]>0], key=lambda c:(s.value(q,c,d), -q.hand[c]))
                            q.hand[c]-=1; q.hand+=Counter()
            for q in s.players:
                c=s.best_any(q); q.hand[c]+=1; q.st['income']+=1; s.emit(t='market_day',p=q.id,card=c)
                s.log(f"  Market day: P{q.id}+{c}")
            got=True
        else:
            for q,t in s.payouts(r):
                if True:
                    c=s.card_from(q,t)
                    q.hand[c]+=1; q.st['income']+=1; s.emit(t='income',p=q.id,card=c,tile=t)
                    if q is p: got=True
                    s.log(f"  収入: P{q.id}+{c}")
        if not got:
            c=s.best_any(p); p.hand[c]+=1; p.st['relief']+=1; s.emit(t='relief',p=p.id,card=c)
            s.log(f"  救済: P{p.id}+{c}")
        for i,f in enumerate(p.fields):
            if f and f['t']=='crop' and f['planted']+DELAY<=p.turns:
                p.prod[f['c']]+=YIELD; p.fields[i]=None; s.log(f"  収穫: {f['c']}×{YIELD}"); s.emit(t='harvest',p=p.id,crop=f['c'],n=YIELD,field=i)

    def need_act(s):
        if not s.turn_active or s.ended: raise RuleError('手番外')
        if s.actions<=0: raise RuleError('行動が残っていない')
    def use(s, p, cards):
        c=Counter(cards)
        for k,v in c.items():
            if p.hand[k]<v: raise RuleError(f'{k}カードが足りない')
        p.hand.subtract(c); p.hand+=Counter()
    def check_win(s, p):
        if p.pts+getattr(p,'vp',0)>=s.target and not s.ended:
            s.winner=p.id; s.ended=True; s.end_reason='target'; s.log(f"*** P{p.id} 勝利 ({p.pts}点)"); s.emit(t='win',p=p.id)

    # ---- 行動 ----
    def act_plant(s, p, crop):
        s.need_act(); e=p.empty()
        if not e: raise RuleError('空き区画がない')
        s.use(p,['grow',crop]+(['feed'] if (CARROTFEED and crop=='carrot') else [])); p.fields[e[0]]={'t':'crop','c':crop,'planted':p.turns}
        s.actions-=1; p.st['plant']+=1; s.log(f"  I grow {crop}s."); s.emit(t='plant',p=p.id,crop=crop,field=e[0])
    def act_buy(s, p, a):
        s.need_act(); e=p.empty()
        if not e: raise RuleError('空き区画がない')
        if p.coins<ANIMAL_COST[a]: raise RuleError('コイン不足')
        s.use(p,['buy',a]+(['grow'] if (COWGROW=='buy' and a=='cow') else [])); p.coins-=ANIMAL_COST[a]; p.fields[e[0]]={'t':a,'fed':False}
        s.actions-=1; p.st['buy_'+a]+=1; s.log(f"  I buy a {a}."); s.emit(t='buy',p=p.id,animal=a,field=e[0])
    def act_feed(s, p, idx):
        # FEEDALL：同じ手番の2頭目以降の餌やりは行動を使わない（I feed my animals.）
        free = FEEDALL and getattr(s,'feed_mark',None)==(p.id,p.turns)
        if not free: s.need_act()
        f=p.fields[idx]
        if not f or f['t'] not in ('cow','chicken'): raise RuleError('動物がいない')
        if f['fed']: raise RuleError('この手番は給餌済み')
        if not s.can_feed(p,f): raise RuleError('この牛は今回は餌をやれない')
        s.use(p,['feed']+(['grow'] if (COWGROW=='feed' and f['t']=='cow') else [])); f['fed']=True; f['last']=p.turns; k,v=ANIMAL_OUT[f['t']]
        if f['t']=='cow' and COWMODE=='delay': f['pending']=f.get('pending',0)+v
        else: p.prod[k]+=v
        if not free: s.actions-=1
        s.feed_mark=(p.id,p.turns); p.st['feed']+=1; s.log(f"  I feed the {f['t']}. (+{k}×{v})"); s.emit(t='feed',p=p.id,animal=f['t'],out=k,n=v,field=idx)
    def can_feed(s, p, f):
        if f['t']=='cow' and COWMODE=='cool' and p.turns-f.get('last',-9)<2: return False
        return True
    def act_market(s, p, prod, num=None):
        s.need_act()
        if DEV: q=num if isinstance(num,int) else 1; num=None
        else: q=NUM[num] if num else 1
        if p.prod[prod]<q: raise RuleError('産物不足')
        s.use(p,['sell']+([num] if num else []))
        p.prod[prod]-=q; p.coins+=PRICE[prod]*q
        s.actions-=1; p.st['market']+=1; p.st['market_coin']+=PRICE[prod]*q
        s.log(f"  I sell {num or 'a'} {prod}. (+{PRICE[prod]*q}コイン)"); s.emit(t='market',p=p.id,prod=prod,n=q,coins=PRICE[prod]*q)
    def deliverable(s, p, oid, n13=None):
        o=OBYID[oid]
        if o['kind']=='animals': return {} if len(p.animals())>=o['n'] else None
        if o['kind']=='anyof':
            al=o.get('allowed',['potato','wheat']); tot=o.get('total',5)
            if sum(p.prod[x] for x in al)<tot: return None
            out={}; need=tot
            for x in sorted(al,key=lambda x:-p.prod[x]):
                k=min(p.prod[x],need)
                if k: out[x]=k; need-=k
            return out
        if o['kind']=='same':
            n=n13 or 2; a,b=o.get('pair',['carrot','potato'])
            return {a:n,b:n} if p.prod[a]>=n and p.prod[b]>=n else None
        return dict(o['req']) if all(p.prod[k]>=v for k,v in o['req'].items()) else None
    def act_deliver(s, p, oid, num=None, n13=None):
        s.need_act()
        if oid not in s.face: raise RuleError('表向きの注文ではない')
        o=OBYID[oid]
        if o['kind']=='same' and num and not n13: n13=NUM[num]
        dl=s.deliverable(p,oid,n13)
        if dl is None: raise RuleError('条件を満たしていない')
        bonus=0
        if num:
            ok = (o['kind']=='same' and NUM[num]==n13) or (o['kind']!='same' and NUM[num] in o['nums'])
            if not ok: raise RuleError('数字ボーナスの対象外')
            bonus=1
        cards=([] if o['kind']=='animals' else ['sell'])+([num] if num else [])
        s.use(p,cards)
        p.prod.subtract(Counter(dl)); p.prod+=Counter()
        p.pts+=o['pts']+bonus; p.coins+=2; s.actions-=1
        p.st['orders']+=1; p.st['order_pts']+=o['pts']; p.st['bonus']+=bonus
        s.log(f"  注文#{oid}達成 +{o['pts']+bonus}点 +2コイン → {p.pts}点"); s.emit(t='deliver',p=p.id,order=oid,pts=o['pts']+bonus,goods=dict(dl))
        s.face.remove(oid)
        if s.deck: s.face.append(s.deck.pop()); s.log(f"  補充: #{s.face[-1]}"); s.emit(t='refill',order=s.face[-1])
        if not s.face and not s.deck: s.exhaust=True
        s.check_win(p)
    def act_joint(s, p, item, jid=None):
        s.need_act()
        fs=s.__dict__.get('jfaces') or []
        if not fs: raise RuleError('共同注文がない')
        # 札の指定がなければ、その産物の行が空いている最初の札
        cand=[j for j in fs if (jid is None or j['id']==jid) and any(l['item']==item and l.get('by') is None for l in j['lines'])]
        j=cand[0] if cand else fs[0]
        line=next((l for l in j['lines'] if l['item']==item), None)
        if line is None: raise RuleError('その産物の行はない')
        if line.get('by') is not None: raise RuleError('その行はもう出されている')
        if getattr(s,'jdone_turn',False): raise RuleError('共同注文は1手番に1行まで')
        if p.prod[item]<line['n']: raise RuleError('産物が足りない')
        s.use(p,['sell']); p.prod[item]-=line['n']; p.prod+=Counter(); s.actions-=1
        line['by']=p.id; p.st['joint_line']+=1; s.jdone_turn=True
        if j.get('started') is None: j['started']=s.round
        s.emit(t='joint_line',p=p.id,order=j['id'],item=item,n=line['n'],pts=line['pts'])
        if all(l.get('by') is not None for l in j['lines']):
            gains=Counter()
            for l in j['lines']: gains[l['by']]+=l['pts']
            gains[p.id]+=j['bonus']
            for pid,g in gains.items(): s.players[pid].pts+=g; s.players[pid].st['joint_pts']+=g
            p.st['joint_done']+=1
            s.emit(t='joint_done',p=p.id,order=j['id'],gains={str(k):v for k,v in gains.items()})
            s.jfaces.remove(j)
            if JOINTN==1:
                if s.jdeck: nj=s.jdeck.pop(); nj['since']=s.round; s.jfaces.append(nj); s.emit(t='joint_refill',order=nj['id'])
            else: s.joint_refill()
            s.check_win(p)
    def act_house(s, p, t):
        s.need_act()
        if len(p.bases)>=s.maxbase(): raise RuleError('拠点の上限')
        if p.coins<HOUSECOST: raise RuleError('コイン不足')
        s.place_base(p,t); p.coins-=HOUSECOST; s.actions-=1; p.st['house']+=1
        s.log(f"  I build a farm house. ({t})"); s.emit(t='house',p=p.id,v=t)
    def act_tractor(s, p):
        s.need_act()
        if s.tractor: raise RuleError('トラクターは1手番1回')
        if p.coins<5: raise RuleError('コイン不足')
        p.coins-=5; p.pts+=1; s.tractor=True; s.actions-=1; p.st['tractor']+=1
        s.log(f"  I buy a tractor. → {p.pts}点"); s.check_win(p)

    def act_devbuy(s, p):
        s.need_act()
        if not s.devdeck: raise RuleError('発展カードの山が尽きた')
        if p.coins<DEVCOST: raise RuleError('コイン不足')
        s.use(p,[] if DEVNOBUY else ['buy']); p.coins-=DEVCOST; c=s.devdeck.pop(); s.actions-=1; p.st['devbuy']+=1
        if c=='tractor': p.vp+=1; p.st['vp']+=1; s.log("  I buy a tool. (伏せ)"); s.check_win(p)
        else: p.dev.append((c,p.turns)); s.log("  I buy a tool. (伏せ)")
    def play_dev(s, p, c, arg=None):
        if s.devplayed: raise RuleError('発展カードは1手番1枚')
        idx=[i for i,(k,t) in enumerate(p.dev) if k==c and t<p.turns]
        if not idx: raise RuleError('使える発展カードがない')
        p.dev.pop(idx[0]); s.devplayed=True; p.st['dev_'+c]+=1
        if c=='fox':
            q=arg
            if q.handsize()>0:
                pool=[k for k,v in q.hand.items() for _ in range(v)]; k=s.rng.choice(pool)
                q.hand[k]-=1; q.hand+=Counter(); p.hand[k]+=1
            p.fox+=1
            if p.fox>=3 and (s.guard is None or p.fox>s.players[s.guard].fox) and s.guard!=p.id:
                if s.guard is not None: s.players[s.guard].pts-=2
                s.guard=p.id; p.pts+=2; p.st['guard']+=1; s.log(f"  Best Guard → P{p.id}")
            s.log(f"  Fox: P{q.id}から1枚")
        elif c=='rain':
            f=[i for i,x in enumerate(p.fields) if x and x['t']=='crop']
            if not f: raise RuleError('作物がない')
            x=p.fields[f[0]]; p.prod[x['c']]+=YIELD; p.fields[f[0]]=None; s.log("  Rain: 即収穫")
        elif c=='lucky':
            for k in arg: p.hand[k]+=1
            s.log(f"  Lucky Day: {arg}")
        elif c=='bigorder':
            tot=0
            for q in s.players:
                if q is p: continue
                tot+=q.hand[arg]; p.hand[arg]+=q.hand[arg]; q.hand[arg]=0
            for q in s.players: q.hand+=Counter()
            s.log(f"  Big Order: {arg}×{tot}")
        s.check_win(p)

    # ---- 行動不要の操作 ----
    def bank(s, p, give, get):
        if not s.turn_active: raise RuleError('手番外')
        k=s.ratio(p,give); s.use(p,[give]*k); p.hand[get]+=1; p.st['bank']+=1; p.st['bank%d'%k]+=1
        s.log(f"  銀行: {give}×{k} → {get}"); s.emit(t='bank',p=p.id,give=give,k=k,get=get)
    def flush(s, p, oid):
        if s.flushed: raise RuleError('流すのは1手番1回')
        if p.coins<1 or oid not in s.face: raise RuleError('流せない')
        p.coins-=1; s.face.remove(oid); s.flushed=True; p.st['flush']+=1
        if s.deck: s.face.append(s.deck.pop())
        if not s.face and not s.deck: s.exhaust=True
        s.log(f"  注文#{oid}を流す → 補充 {s.face}"); s.emit(t='flush',p=p.id,order=oid,face=list(s.face))
    def trade(s, p, q, give, get):
        # give/get: {'cards':{}, 'prod':{}, 'coins':n}
        for who,pkg in ((p,give),(q,get)):
            for k,v in pkg.get('cards',{}).items():
                if who.hand[k]<v: raise RuleError(f'P{who.id}の{k}が足りない')
            for k,v in pkg.get('prod',{}).items():
                if who.prod[k]<v: raise RuleError(f'P{who.id}の{k}産物が足りない')
            if who.coins<pkg.get('coins',0): raise RuleError('コイン不足')
        for a,b,pkg in ((p,q,give),(q,p,get)):
            for k,v in pkg.get('cards',{}).items(): a.hand[k]-=v; b.hand[k]+=v
            for k,v in pkg.get('prod',{}).items(): a.prod[k]-=v; b.prod[k]+=v
            a.coins-=pkg.get('coins',0); b.coins+=pkg.get('coins',0)
        p.hand+=Counter(); q.hand+=Counter(); p.prod+=Counter(); q.prod+=Counter()
        p.st['trade']+=1; q.st['trade_resp']+=1
        s.log(f"  交換: P{p.id} 渡す{give} ⇔ P{q.id} 渡す{get}"); s.emit(t='trade',p=p.id,q=q.id,give=give,get=get)

    def end_turn(s, discards=None):
        p=s.players[s.cur]
        if discards:
            s.use(p,discards); p.st['discard']+=len(discards)
        while not SEVEN and p.handsize()>7:
            d=s.desired(p)
            c=min([c for c in CARDS if p.hand[c]>0], key=lambda c:(s.value(p,c,d), -p.hand[c]))
            p.hand[c]-=1; p.hand+=Counter(); p.st['discard']+=1
        s.turn_active=False
        if s.ended: return
        s.cur+=1
        if s.cur>=s.n:
            s.cur=0
            if s.exhaust:
                s.ended=True; s.end_reason='exhaust'
                best=max(s.players,key=lambda q:(q.pts+q.vp,q.coins)); s.winner=best.id
                s.log("*** 注文切れで終了")
                return
            s.round+=1

    # ---- ボット ----
    def wants_house(s, p):
        # 拠点優先の方針（p.hf）：期限までに3個目の拠点を建てたい
        return getattr(p,'hf',False) and len(p.bases)<s.maxbase() and s.round<=HFROUND and s.can_house(p)
    def house_reserve(s, p): return HOUSECOST if s.wants_house(p) else 0
    def bot_turn(s):
        p=s.players[s.cur]
        s.start_turn()
        s.bot_free(p)
        if DEV and not s.ended: s.bot_dev(p)
        a0=s.actions
        while s.actions>0 and not s.ended:
            if not s.bot_action(p): break
            s.bot_free(p)
        p.st['acts']+=a0-s.actions; p.st['turns_played']+=1
        if a0-s.actions>p.st.get('maxacts',0): p.st['maxacts']=a0-s.actions
        s.end_turn()

    def bot_dev(s, p):
        usable=[k for k,t in p.dev if t<p.turns]
        d=s.desired(p)
        need=[c for c in CARDS if p.hand[c]<d[c]]
        if 'rain' in usable and any(x and x['t']=='crop' for x in p.fields): s.play_dev(p,'rain'); return
        if 'bigorder' in usable and need:
            c=max(need,key=lambda c:WEIGHT[c]); s.play_dev(p,'bigorder',c); return
        if 'lucky' in usable and need:
            a=sorted(need,key=lambda c:-WEIGHT[c]); s.play_dev(p,'lucky',(a+a)[:2]); return
        if 'fox' in usable:
            q=max([q for q in s.players if q is not p],key=lambda q:(q.pts+q.handsize()))
            s.play_dev(p,'fox',q); return

    def prod_need(s, q):
        # q が自分の注文のために取っておきたい産物の量
        need=Counter()
        for oid in s.face:
            o=OBYID[oid]
            if o['kind'] in ('fixed','same') and s.order_feasible(q,o):
                for k,v in o['req'].items(): need[k]=max(need[k],v)
        return need
    def bot_prod_trade(s, p):
        done=0
        targets=[]
        for oid in s.face:
            o=OBYID[oid]
            if o['kind']!='fixed': continue
            miss={k:v-p.prod[k] for k,v in o['req'].items() if p.prod[k]<v}
            if miss and sum(miss.values())<=3 and len(miss)==1: targets.append((o['pts'],miss))
        if JOINT and not s.jdone_turn:
            for jf in s.__dict__.get('jfaces',[]):
                for l in jf['lines']:
                    if l.get('by') is None and 0<l['n']-p.prod[l['item']]<=2: targets.append((l['pts'],{l['item']:l['n']-p.prod[l['item']]}))
        targets.sort(key=lambda x:-x[0])
        for pts,miss in targets:
            if done>=2: break
            item,k=next(iter(miss.items()))
            bought=False
            for q in s.players:
                if q is p: continue
                spare=q.prod[item]-s.prod_need(q)[item]
                if spare<k: continue
                if p.pts>=s.target-1.5:
                    s.emit(t='refuse',p=p.id,q=q.id,want=item); p.st['refused']+=1; continue
                if p.coins>=k+s.house_reserve(p): give={'coins':k}
                else:
                    d=s.desired(p); sur=[g for g in CARDS if p.hand[g]>d[g]]
                    if not sur: continue
                    give={'cards':{sur[0]:1}}
                s.trade(p,q,give,{'prod':{item:k}}); p.st['prod_trade']+=1; done+=1; bought=True
                break
            if not bought and (PRODBUY or PRODMULT) and k==1 and not s.prodbought and p.coins>=prod_price(item)+s.house_reserve(p):
                s.buy_product(p,item)
    def buy_product(s, p, item):
        if not s.turn_active: raise RuleError('手番外')
        if s.prodbought: raise RuleError('産物の購入は1手番1つまで')
        c=prod_price(item)
        if p.coins<c: raise RuleError('コイン不足')
        p.coins-=c; p.prod[item]+=1; s.prodbought=True; p.st['prodbuy']+=1; p.st['prodbuy_coin']+=c
        s.emit(t='prodbuy',p=p.id,item=item,coins=c)
    def bot_free(s, p):
        # 交換（最大3件/手番）
        others=[q for q in s.players if q is not p]
        d=s.desired(p)
        for c in sorted(CARDS, key=lambda c:-WEIGHT[c]):
            if s.trades>=3: break
            if p.hand[c]>=d[c]: continue
            for q in others:
                dq=s.desired(q)
                if q.hand[c]<=dq[c]: continue
                if ACTIVE and p.pts>=s.target-1.5:
                    s.emit(t='refuse',p=p.id,q=q.id,want=c); p.st['refused']+=1; continue
                surplus=[g for g in CARDS if p.hand[g]>d[g] and g!=c]
                good=[g for g in surplus if q.hand[g]<dq[g]]
                if good:
                    s.trade(p,q,{'cards':{good[0]:1}},{'cards':{c:1}}); s.trades+=1; break
                if sum(p.hand[g]-d[g] for g in surplus)>=2:
                    pk=Counter()
                    for g in surplus:
                        while p.hand[g]-d[g]-pk[g]>0 and sum(pk.values())<2: pk[g]+=1
                    s.trade(p,q,{'cards':dict(pk)},{'cards':{c:1}}); s.trades+=1; break
                if p.coins>=1 and (p.coins-1)>= (ANIMAL_COST.get(s.want_animal(p),0) if s.want_animal(p) else 0)+s.house_reserve(p):
                    s.trade(p,q,{'coins':1},{'cards':{c:1}}); s.trades+=1; break
            d=s.desired(p)
        if ACTIVE: s.bot_prod_trade(p)
        # 銀行
        for _ in range(4):
            d=s.desired(p)
            sur=[c for c in CARDS if p.hand[c]-d[c]>=s.ratio(p,c)]
            need=[c for c in CARDS if p.hand[c]<d[c]]
            if not sur or not need: break
            s.bank(p, sur[0], max(need,key=lambda c:WEIGHT[c]))
        # 銀行：2コイン→好きな1枚（最大2回/手番）
        if COINBANK:
            for _ in range(2):
                d=s.desired(p); need=[c for c in CARDS if p.hand[c]<d[c]]
                wa=s.want_animal(p); reserve=(ANIMAL_COST[wa] if wa else 0)+s.house_reserve(p)
                if not need or p.coins<COINPRICE+reserve: break
                c=max(need,key=lambda c:WEIGHT[c]); p.coins-=COINPRICE; p.hand[c]+=1; p.st['coinbank']+=1
                s.log(f"  銀行: {COINPRICE}コイン → {c}"); s.emit(t='coinbank',p=p.id,card=c,coins=COINPRICE)
        # 注文を流す
        if not s.flushed and p.coins>=2 and s.face:
            if not any(s.order_feasible(p,OBYID[o]) for o in s.face):
                s.flush(p, s.face[0])

    def bot_action(s, p):
        # A 注文達成
        best=None
        for oid in s.face:
            o=OBYID[oid]
            if o['kind']!='animals' and p.hand['sell']<1: continue
            if o['kind']=='same':
                a_,b_=o.get('pair',['carrot','potato'])
                for n in (2,):
                    if p.prod[a_]>=n and p.prod[b_]>=n:
                        num=NUMNAME.get(n) if (not DEV and p.hand[NUMNAME.get(n,'x')]>0) else None
                        sc=o['pts']+(1 if num else 0)
                        if not best or sc>best[0]: best=(sc,oid,num,n)
                        break
                continue
            if s.deliverable(p,oid) is None: continue
            num=None
            for x in (o['nums'] if not DEV else []):
                if x in NUMNAME and p.hand[NUMNAME[x]]>0: num=NUMNAME[x]
            sc=o['pts']+(1 if num else 0)
            if not best or sc>best[0]: best=(sc,oid,num,None)
        if best:
            s.act_deliver(p,best[1],best[2],best[3]); return True
        # A2 拠点優先の方針なら、建てられるときに建てる
        if s.wants_house(p) and p.coins>=HOUSECOST:
            s.act_house(p,s.choose_tile(p)); return True
        # J 共同注文の1行
        if JOINT and p.hand['sell']>=1 and not s.jdone_turn:
            for jf in s.__dict__.get('jfaces',[]):
                for l in jf['lines']:
                    if l.get('by') is None and p.prod[l['item']]>=l['n']:
                        s.act_joint(p,l['item'],jf['id']); return True
        # B 給餌
        for i,f in enumerate(p.fields):
            if f and f['t'] in ('cow','chicken') and not f['fed'] and p.hand['feed']>0 and s.can_feed(p,f) and not (COWGROW=='feed' and f['t']=='cow' and p.hand['grow']<1):
                s.act_feed(p,i); return True
        # C 動物購入
        wa=s.want_animal(p)
        if wa and p.empty() and p.hand['buy'] and p.hand[wa] and p.coins>=ANIMAL_COST[wa]+s.house_reserve(p) and not (COWGROW=='buy' and wa=='cow' and p.hand['grow']<1):
            s.act_buy(p,wa); return True
        # D 植え付け
        emp=len(p.empty())
        reserve = 1 if (wa and p.coins>=ANIMAL_COST[wa]-2) else 0
        if STRATS[p.strat]['crop'] and emp>reserve and p.hand['grow']:
            crops=[c for c in CROPS if p.hand[c]>0 and (c!='carrot' or not CARROTFEED or p.hand['feed']>0)]
            if crops:
                bc=s.best_crop(p); c=bc if bc in crops else crops[0]
                s.act_plant(p,c); return True
        # G 拠点（序盤）
        if len(p.bases)<s.maxbase() and p.coins>=HOUSECOST and s.round<=HOUSEROUND and (HOUSE_ALL or not wa):
            if s.can_house(p):
                s.act_house(p,s.choose_tile(p)); return True
        # H 発展カード
        if DEV and s.devdeck and p.coins>=DEVCOST and (DEVNOBUY or p.hand['buy']>(1 if wa else 0)) and not (wa and p.coins-DEVCOST<ANIMAL_COST[wa]):
            s.act_devbuy(p); return True
        # F トラクター
        if not DEV and not s.tractor and p.coins>=5 and not (wa and p.coins<ANIMAL_COST[wa]+5):
            s.act_tractor(p); return True
        # E 市場（不要な産物）
        if p.hand['sell']>=2 or (p.hand['sell']>=1 and wa and p.coins<ANIMAL_COST[wa]) or (ACTIVE and p.hand['sell']>=1 and max(p.prod.values() or [0])>6):
            need=Counter()
            for oid in s.face:
                o=OBYID[oid]
                if s.order_feasible(p,o):
                    for k,v in (o['req'] if o['kind']!='anyof' else {o.get('allowed',['wheat'])[-1]:o.get('total',5)}).items(): need[k]=max(need[k],v)
            sur={k:p.prod[k]-need[k] for k in PRODUCTS if p.prod[k]-need[k]>0}
            if sur:
                k=max(sur,key=lambda k:sur[k]*PRICE[k])
                if DEV: s.act_market(p,k,sur[k]); return True
                nums=[n for n in NUM if p.hand[n]>0 and NUM[n]<=sur[k]]
                num=max(nums,key=lambda n:NUM[n]) if nums else None
                s.act_market(p,k,num); return True
        return False

def run(n, strats, seed, maxround=40, log=False):
    g=Game(n,strats,seed,log=log)
    while not g.ended and g.round<=maxround:
        g.bot_turn()
    if not g.ended: g.end_reason='timeout'
    return g

if __name__=='__main__':
    pass
