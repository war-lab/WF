# 対話式プレイ用CLI。状態は state.pkl に保存する
# 使い方:
#   python cli.py new <人数> <seed> <方針,方針,...>   新規（方針は収入選択・初期配置の自動判断に使う）
#   python cli.py show                                 現在の手番を表示
#   python cli.py do "<コマンド>; <コマンド>; ..."      手番中の操作を順に実行
# コマンド:
#   plant <crop> | buy <cow|chicken> | feed <区画番号> | market <産物> [数字]
#   deliver <注文id> [数字] | animals <注文id> | house <タイル> | tractor
#   bank <渡すカード> <得るカード> | flush <注文id>
#   trade <相手id> give <k=v,...> get <k=v,...>   （k は card:名前 / prod:名前 / coins）
#   pay <コイン数>   （日本語の支払いを記録）
#   end [捨てるカード,...]   手番終了→次の手番を自動開始
import sys, pickle, os
from collections import Counter
from wf import Game, OBYID, RuleError, CARDS
ST=os.path.join(os.path.dirname(os.path.abspath(__file__)),'state.pkl')
LOG=os.path.join(os.path.dirname(os.path.abspath(__file__)),'game_log.txt')

def save(g): pickle.dump(g,open(ST,'wb'))
def load(): return pickle.load(open(ST,'rb'))
def flushlog(g):
    with open(LOG,'a',encoding='utf-8') as f:
        for m in g.logs: f.write(m+'\n')
    g.logs=[]

def show(g):
    p=g.players[g.cur]
    out=[]
    if g.ended:
        out.append(f"### ゲーム終了 理由={g.end_reason} 勝者=P{g.winner}")
    out.append(f"== ラウンド{g.round} 手番 P{p.id} 出目{getattr(g,'lastroll','-')} 残り行動{g.actions} 勝利点{g.target}")
    out.append(f"産地: " + ", ".join(f"{t}={n}{g.occ[t]}" for t,n in g.tilenum.items()) + f"  (枠 {g.cap})")
    out.append("表の注文:")
    for oid in g.face:
        o=OBYID[oid]; out.append(f"  #{oid} [{o['pts']}点] {o['text']}")
    out.append(f"山の残り注文: {len(g.deck)}枚")
    for q in g.players:
        fl=[]
        for i,f in enumerate(q.fields):
            if f is None: fl.append(f"{i}:空")
            elif f['t']=='crop': fl.append(f"{i}:{f['c']}(植{f['planted']})")
            else: fl.append(f"{i}:{f['t']}{'(済)' if f.get('fed') else ''}")
        hand = dict(q.hand) if q is p else f"{q.handsize()}枚"
        out.append(f"P{q.id}: {q.pts}点 {q.coins}コイン 拠点{q.bases} 産物{dict(q.prod)} 畑[{' '.join(fl)}] 手札{hand}")
    return "\n".join(out)

def kv(s):
    pkg={'cards':{},'prod':{},'coins':0}
    for part in s.split(','):
        if not part: continue
        k,v=part.split('='); v=int(v)
        if k=='coins': pkg['coins']=v
        else:
            t,name=k.split(':'); pkg['cards' if t=='card' else 'prod'][name]=v
    return pkg

def run_cmd(g, c):
    a=c.split(); p=g.players[g.cur]
    op=a[0]
    if op=='plant': g.act_plant(p,a[1])
    elif op=='buy': g.act_buy(p,a[1])
    elif op=='feed': g.act_feed(p,int(a[1]))
    elif op=='market': g.act_market(p,a[1],a[2] if len(a)>2 else None)
    elif op=='deliver': g.act_deliver(p,int(a[1]),a[2] if len(a)>2 else None)
    elif op=='animals': g.act_deliver(p,int(a[1]))
    elif op=='house': g.act_house(p,a[1])
    elif op=='tractor': g.act_tractor(p)
    elif op=='bank': g.bank(p,a[1],a[2])
    elif op=='flush': g.flush(p,int(a[1]))
    elif op=='trade':
        q=g.players[int(a[1].lstrip('P'))]
        gi=a.index('give'); ge=a.index('get')
        g.trade(p,q,kv(a[gi+1] if gi+1<ge else ''),kv(a[ge+1] if ge+1<len(a) else ''))
    elif op=='pay':
        n=int(a[1])
        if p.coins<n: raise RuleError('コイン不足')
        p.coins-=n; p.st['jp_pay']+=n; g.log(f"  日本語の支払い {n}コイン")
    elif op=='end':
        g.end_turn(a[1].split(',') if len(a)>1 else None)
        if not g.ended: g.start_turn()
    else: raise RuleError(f'不明なコマンド {op}')

if __name__=='__main__':
    cmd=sys.argv[1]
    if cmd=='new':
        n=int(sys.argv[2]); seed=int(sys.argv[3]); strats=sys.argv[4].split(',')
        if os.path.exists(LOG): os.remove(LOG)
        g=Game(n,strats,seed,log=True); g.start_turn(); flushlog(g); save(g); print(show(g))
    elif cmd=='show':
        g=load(); print(show(g))
    elif cmd=='do':
        g=load()
        for c in [x.strip() for x in sys.argv[2].split(';') if x.strip()]:
            try:
                run_cmd(g,c); print(f"OK: {c}")
            except RuleError as e:
                print(f"NG: {c} → {e}"); break
            if g.ended: break
        msgs=list(g.logs); flushlog(g); save(g)
        print("\n".join(msgs)); print(show(g))
