# 動画用の台本を模擬エンジンで実行し、出来事と状態を JSON に書き出す
# 使い方: python scenario_run.py [最後に実行する手番の番号]
import os, sys, json, copy
os.environ.update(ORDERSET='3', ORD13='down', DEV='1', DEVOFF='1', LOWPRICE='1', COINBANK='1', COINPRICE='4',
                  HARBORS='6', BANKBASE='4', HSINGLE='1', FIXED='1', COWMODE='delay', SEVEN='1', MAP_T4='8', MAP_T3='8', EGGW='1.8', MILKW='1.8')
from collections import Counter
import mapwf, wf
from wf import RuleError, OBYID
from scenario import PLAYERS, PLACEMENT, ORDER_DECK, SETUP_STEPS, TURNS, OUTRO_STEPS, SCEN_ORDERS, FINALE_NOTES
import random, ordergen

def build_deck():
    deck=[]
    for o in SCEN_ORDERS:
        o=dict(o); o.setdefault('nums',[]); o.setdefault('picture',False)
        if 'pts' not in o: o['pts']=ordergen.points(o['req'] if o['kind']!='anyof' else {o['allowed'][0]:o['total']}, o.get('hard',False))
        deck.append(o)
    seen={o['text'] for o in deck}; rng=random.Random(4242); nid=101
    while len(deck)<36:
        o=ordergen.gen_one(rng,nid)
        if o['text'] in seen: continue
        seen.add(o['text']); deck.append(o); nid+=1
    return deck
DECK=build_deck()
wf.ORDERS[:]=DECK; wf.OBYID.clear(); wf.OBYID.update({o['id']:o for o in DECK})

class ScenGame(mapwf.MapGame):
    def emit(s, **e):
        if getattr(s,'events',None) is not None:
            s.events.append(e)
            if getattr(s,'capture',None) is not None: s.capture.append((e, snapshot(s)))
    def choose_tile(s, p):
        if s.place_queue: return s.place_queue.pop(0)
        return super().choose_tile(p)
    def best_any(s, p):
        q=s.picks.get(p.id) if hasattr(s,'picks') else None
        if q: return q.pop(0)
        return super().best_any(p)
    def card_from(s, q, cat):
        pk=getattr(s,'picks',{}).get(q.id)
        if pk and cat in ('seed','animal'): return pk.pop(0)
        return super().card_from(q, cat)

def snapshot(g):
    return dict(players=[dict(pts=p.pts, coins=p.coins, hand={k:v for k,v in p.hand.items() if v}, handsize=p.handsize(), prod={k:v for k,v in p.prod.items() if v},
                              fields=[None if f is None else {k:v for k,v in f.items()} for f in p.fields],
                              bases=list(p.bases), tickets=p.tickets, debt=p.debt) for p in g.players],
                face=list(g.face), deck=len(g.deck), cur=g.cur, round=g.round, actions=getattr(g,'actions',2))

def run_cmd(g, c):
    a=c.split(); p=g.players[g.cur]; op=a[0]
    if op=='plant': g.act_plant(p,a[1])
    elif op=='buy': g.act_buy(p,a[1])
    elif op=='feed': g.act_feed(p,int(a[1]))
    elif op=='market': g.act_market(p,a[1],int(a[2]))
    elif op=='deliver': g.act_deliver(p,int(a[1]))
    elif op=='house': g.act_house(p,int(a[1]))
    elif op=='bank': g.bank(p,a[1],a[2])
    elif op=='coinbank':
        if p.coins<4: raise RuleError('コイン不足')
        p.coins-=4; p.hand[a[1]]+=1; g.emit(t='coinbank',p=p.id,card=a[1],coins=4)
    elif op=='flush': g.flush(p,int(a[1]))
    elif op=='misread':
        # 条件を満たさない届け出：sellカードを捨てて不成立
        oid=int(a[1]); assert g.deliverable(p,oid) is None, '実は条件を満たしている'
        g.use(p,['sell']); g.emit(t='misread',p=p.id,order=oid)
    elif op=='trade':
        q=g.players[int(a[1])]
        def kv(x):
            pk={'cards':{},'prod':{},'coins':0}
            for part in x.split(','):
                if not part: continue
                k,v=part.split('='); v=int(v)
                if k=='coins': pk['coins']=v
                else:
                    t,n=k.split(':'); pk['cards' if t=='card' else 'prod'][n]=v
            return pk
        g.trade(p,q,kv(a[a.index('give')+1]),kv(a[a.index('get')+1]))
    elif op=='ticket':
        q=g.players[int(a[1])]
        if q.tickets<1: raise RuleError('無料券がない')
        q.tickets-=1; g.emit(t='ticket',p=q.id,use=' '.join(a[2:]))
    elif op=='pay':
        q=g.players[int(a[1])]; n=int(a[2]); paid=min(n,q.coins); q.coins-=paid; q.debt+=n-paid
        g.emit(t='jp_pay',p=q.id,n=n,paid=paid,debt=n-paid,why=' '.join(a[3:]))
    elif op=='paydebt':
        q=g.players[int(a[1])]; n=min(q.debt,q.coins); q.coins-=n; q.debt-=n; g.emit(t='paydebt',p=q.id,n=n)
    else: raise RuleError('不明なコマンド '+op)

def main(upto):
    g=ScenGame.__new__(ScenGame)
    g.place_queue=[v for _,v,*_ in PLACEMENT]
    g.picks={}
    for i,(pid,v,*rest) in enumerate(PLACEMENT):
        if rest and rest[0]: g.picks.setdefault(pid,[]).extend(rest[0])
    mapwf.MapGame.__init__(g,4,[pl['strat'] for pl in PLAYERS],5,'hex454')
    for p in g.players: p.tickets=2; p.debt=0
    # 注文の山を台本どおりに並べ直す（表向き3枚＋山）
    ids={o['id'] for o in DECK}; head=[i for i in ORDER_DECK if i in ids]
    rest=[o['id'] for o in DECK if o['id'] not in head]
    g.face=head[:3]; g.deck=list(reversed(head[3:]+rest))
    g.events=[]; timeline=[]
    timeline.append(dict(kind='setup', steps=SETUP_STEPS, state=snapshot(g),
                         board=dict(tcat=g.tcat, tnum=g.tnum, harbor={str(k):v for k,v in g.harbor.items()})))
    for ti,turn in enumerate(TURNS[:upto]):
        g.forced_rolls=[turn['roll']]
        g.picks={int(k):list(v) for k,v in turn.get('picks',{}).items()}
        g.events=[]
        pre=turn.get('pre',[])
        g.start_turn()
        tstart=list(g.events); g.events=[]
        rec=dict(kind='turn', idx=ti, p=g.cur, roll=turn['roll'], dice=turn.get('dice'), start_events=tstart,
                 pre=pre, state_after_start=snapshot(g), steps=[])
        for st in turn['steps']:
            if st[0]=='cmd':
                g.events=[]
                try: run_cmd(g, st[1])
                except (RuleError, AssertionError) as e:
                    print(f'手番{ti} P{g.cur} コマンド失敗: {st[1]} → {e}'); print(json.dumps(snapshot(g)['players'][g.cur],ensure_ascii=False)); sys.exit(1)
                rec['steps'].append(dict(st=st, events=list(g.events), state=snapshot(g)))
            else:
                rec['steps'].append(dict(st=st, state=snapshot(g)))
            if g.ended: break
        g.end_turn()
        timeline.append(rec)
        s=snapshot(g)
        print(f"手番{ti} 終了 R{rec['state_after_start']['round']} P{rec['p']} 出目{turn['roll']}")
        for i,pl in enumerate(s['players']):
            print(f"  P{i} {PLAYERS[i]['name']}: {pl['pts']}点 {pl['coins']}c 券{pl['tickets']} 借{pl['debt']} 手札{pl['hand']} 産物{pl['prod']} 畑{[f and (f.get('c') or f['t']) for f in pl['fields']]}")
        print(f"  注文 {s['face']} 山{s['deck']}")
        if g.ended: break
    if FINISH:
        finish(g); return
    auto=autoplay(g)
    timeline.extend(auto)
    timeline.append(dict(kind='outro', steps=OUTRO_STEPS, state=snapshot(g)))
    orders={str(o['id']):dict(text=o['text'], pts=o['pts'], level=o.get('level','中'), picture=o.get('picture',False), req=o.get('req',{})) for o in wf.ORDERS}
    json.dump(dict(players=PLAYERS, orders=orders, timeline=timeline, layout=export_layout(g)), open('../video/public/game.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
    print('書き出し: video/public/game.json')

def export_layout(g):
    L=g.L
    return dict(coords={str(v):list(c) for v,c in L['coords'].items()}, TV=L['TV'], market=sorted(L['MARKET']))

def autoplay(g):
    # 台本の後をボットで進める。乱数の種を探して、Chika(2)が勝ち、Ben(1)が競る展開を選ぶ
    import copy
    best=None
    for seed in ([int(os.environ['AUTOSEED'])] if os.environ.get('AUTOSEED') else range(1,int(os.environ.get('SEEDMAX','1200')))):
        gc=copy.deepcopy(g); gc.rng=random.Random(seed); gc.forced_rolls=[]; gc.picks={}
        r0=gc.round; turns=[]
        while not gc.ended and gc.round<=r0+10:
            gc.events=[]; gc.capture=[]; p=gc.cur
            gc.bot_turn()
            turns.append(dict(p=p, events=list(gc.events), seq=list(gc.capture), state=snapshot(gc)))
        if not gc.ended or gc.winner!=2: continue
        last=turns[-1]
        if last['p']!=2: continue
        ben=gc.players[1].pts; others=max(q.pts for q in gc.players if q.id!=2)
        lows=sorted(q.pts for q in gc.players if q.id!=2)
        score=(lows[0], lows[1], ben, -abs(len(turns)-14))
        if best is None or score>best[0]: best=(score,seed,turns,gc)
    score,seed,turns,gc=best
    print(f'採用した種 {seed}：自動の手番{len(turns)}、最終 '+' '.join(f"{PLAYERS[q.id]['name']}{q.pts}" for q in gc.players))
    out=[]
    for i,t in enumerate(turns):
        roll=next(e['roll'] for e in t['events'] if e['t']=='turn')
        d1=max(1,min(6,roll-1)) if roll<=7 else roll-6; dice=[min(d1,roll-d1) if False else d1, roll-d1]
        out.append(dict(kind='auto', idx=len(TURNS)+i, p=t['p'], roll=roll, dice=dice, round=t['seq'][0][1]['round'] if t['seq'] else None,
                        seq=[dict(ev=e, state=st) for e,st in t['seq']], state=t['state'], finale=(i>=len(turns)-4),
                        notes=FINALE_NOTES.get(len(TURNS)+i, {})))
    return out

FINISH=False
NAMES=[p['name'] for p in PLAYERS]
def finish(g):
    # 台本の後をボットで最後まで進め、手番ごとの要約を出す
    import random
    g.rng=random.Random(2026); g.forced_rolls=[]; g.picks={}
    while not g.ended and g.round<=40:
        g.events=[]; p=g.players[g.cur]
        g.bot_turn()
        ev=g.events; roll=next(e['roll'] for e in ev if e['t']=='turn')
        acts=[]
        for e in ev:
            t=e['t']
            if t=='plant': acts.append(f"植付{e['crop']}")
            elif t=='buy': acts.append(f"{e['animal']}購入")
            elif t=='feed': acts.append(f"給餌->{e['out']}{e['n']}")
            elif t=='market': acts.append(f"市場{e['prod']}x{e['n']}(+{e['coins']}c)")
            elif t=='deliver': acts.append(f"[注文#{e['order']}達成+{e['pts']}点]")
            elif t=='trade': acts.append(f"交換(相手{NAMES[e['q']]})")
            elif t=='bank': acts.append(f"銀行{e['give']}x{e['k']}->{e['get']}")
            elif t=='coinbank': acts.append(f"コイン購入{e['card']}")
            elif t=='flush': acts.append(f"注文#{e['order']}を流す")
            elif t=='house': acts.append("拠点追加")
            elif t=='harvest': acts.append(f"収穫{e['crop']}")
            elif t=='seven_discard': acts.append(f"{NAMES[e['p']]}が7で{e['n']}枚捨てる")
            elif t=='relief': acts.append("救済")
        pts=' '.join(f"{NAMES[q.id]}{q.pts}" for q in g.players)
        print(f"R{g.round} {NAMES[p.id]:5} 出目{roll:2}  {', '.join(acts) or '(行動なし)'}   [{pts}]")
    print()
    if g.ended:
        w=g.players[g.winner]
        print(f"終了: {NAMES[w.id]}の勝ち（{w.pts}点）。理由={g.end_reason}。{g.round}ラウンド目")
    for q in g.players:
        print(f"  {NAMES[q.id]}: {q.pts}点 {q.coins}コイン 達成した注文{q.st['orders']}件 畑{[f and (f.get('c') or f['t']) for f in q.fields]}")
    print('表の注文', g.face, '山', len(g.deck))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='finish':
        FINISH=True; sys.argv.pop(1)
    os.makedirs('../video/public',exist_ok=True)
    main(int(sys.argv[1]) if len(sys.argv)>1 else 999)
