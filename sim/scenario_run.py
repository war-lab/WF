# プレイ動画の台本（scenario.py）を模擬エンジンで実行し、出来事と状態を JSON に書き出す（ルールブック v0.9）
# 台本は最初から最後まで手書きで、ボットには任せない。エンジンでルールどおりに成り立つかを確かめる
# 使い方: python scenario_run.py [最後に実行する手番の番号]
import os, sys, json, random
os.environ.update(ORDERSET='3', ORD13='down', DEV='1', DEVOFF='1', LOWPRICE='1', COINBANK='1', COINPRICE='5',
                  HARBORS='6', BANKBASE='4', HSINGLE='1', FIXED='1', COWMODE='', SEVEN='1', MAP_T4='8', MAP_T3='8',
                  EGGW='1.8', MILKW='1.8', JOINT='1', JQSMALL='1', JTIMEOUT='3', ACTIVE='1', PRODMULT='5',
                  PRICES='carrot:2,potato:1,wheat:1,egg:1,milk:2', CARROTFEED='1', COWGROW='buy', HOUSECOST='5',
                  ACTIONS='99', PRODPRICES='1:10,2:15', JOINTN='2', JSTART='line',
                  ORDEXP='3', ORDSTART='1', ORDREVEAL='3', EXPTURN='1', EXPOFF='1', JEXPTURN='1', NOFLUSH='1',
                  ANIMALSELL='1', BONUSN='0', SEATCOIN='auto')
import mapwf, wf, ordergen
from wf import RuleError
from scenario import PLAYERS, PLACEMENT, SETUP_STEPS, TURNS, OUTRO_STEPS, SCEN_ORDERS, SCEN_JOINT

N = len(PLAYERS)

def build_deck():
    # 台本の注文を山の上から順に並べる。点は計算式で出す（ボーナス注文は届けたときに決まる）
    deck = []
    for o in SCEN_ORDERS:
        o = dict(o); o.setdefault('nums', []); o.setdefault('picture', o.get('level') == '易')
        if 'pts' not in o:
            if o['kind'] == 'bonus': o['pts'] = 0.5; o['req'] = {x: 1 for x in o['items']}
            elif o['kind'] == 'animals': o['pts'] = 1.5 if o['n'] == 2 else 2.5; o.setdefault('req', {})
            else: o['pts'] = ordergen.points(o['req'], o.get('level') == '難')
        deck.append(o)
    return deck
DECK = build_deck()
wf.ORDERS[:] = DECK; wf.OBYID.clear(); wf.OBYID.update({o['id']: o for o in DECK})

class ScenGame(mapwf.MapGame):
    def emit(s, **e):
        if getattr(s, 'events', None) is not None: s.events.append(e)
    def choose_tile(s, p):
        if s.place_queue: return s.place_queue.pop(0)
        return super().choose_tile(p)
    def best_any(s, p):
        q = s.picks.get(p.id)
        if q: return q.pop(0)
        raise RuleError(f'P{p.id} が好きなカードを選ぶ場面で、台本に選ぶカードがない')
    def card_from(s, q, cat):
        if cat in ('seed', 'animal'):
            pk = s.picks.get(q.id)
            if pk: return pk.pop(0)
            raise RuleError(f'P{q.id} が {cat} のカードを選ぶ場面で、台本に選ぶカードがない')
        return cat

def tokens_left(g, shown_t):
    # 表にした人の手番が終わるたびに1個取る（表にした手番の終わりは取らない）。3個から数える
    if shown_t is None: return None
    owner = (shown_t - 1) % N
    done = sum(1 for k in range(shown_t + 1, g.tix + (0 if g.turn_active else 1)) if (k - 1) % N == owner)
    return max(0, 3 - done)

def snapshot(g):
    ft = g.__dict__.get('fshown_t', {})
    return dict(
        players=[dict(pts=p.pts, coins=p.coins, hand={k: v for k, v in p.hand.items() if v}, handsize=p.handsize(),
                      prod={k: v for k, v in p.prod.items() if v},
                      fields=[None if f is None else {k: v for k, v in f.items()} for f in p.fields],
                      bases=list(p.bases), tickets=p.tickets) for p in g.players],
        face=[dict(id=o, owner=(ft[o] - 1) % N if o in ft else None, tokens=tokens_left(g, ft.get(o))) for o in g.face],
        deck=len(g.deck), cur=g.cur, round=g.round,
        joints=[dict(id=j['id'], text=j['text'], owner=(j['started_t'] - 1) % N if j.get('started_t') else None,
                     tokens=tokens_left(g, j.get('started_t')),
                     lines=[dict(item=l['item'], n=l['n'], pts=l['pts'], by=l.get('by')) for l in j['lines']])
                for j in (g.__dict__.get('jfaces') or [])])

def field_of(p, x, unfed=False):
    # 区画は番号でも動物の名前でも指定できる。名前なら、その動物の区画（餌なら、まだ餌をやっていない区画）
    if x.isdigit(): return int(x)
    for i, f in enumerate(p.fields):
        if f and f['t'] == x and not (unfed and f.get('fed')): return i
    raise RuleError(f'{x} の区画がない')

def run_cmd(g, c):
    a = c.split(); p = g.players[g.cur]; op = a[0]
    if op == 'plant': g.act_plant(p, a[1])
    elif op == 'buy': g.act_buy(p, a[1])
    elif op == 'feed': g.act_feed(p, field_of(p, a[1], unfed=True))
    elif op == 'sellanimal': g.act_sell_animal(p, field_of(p, a[1]))
    elif op == 'market': g.act_market(p, a[1], int(a[2]))
    elif op == 'deliver': g.act_deliver(p, int(a[1]))
    elif op == 'bonus':
        # bonus 注文番号 産物 数
        g.bonus_pick = (a[2], int(a[3]))
        try: g.act_deliver(p, int(a[1]))
        finally: g.bonus_pick = None
    elif op == 'house': g.act_house(p, int(a[1]))
    elif op == 'bank': g.bank(p, a[1], a[2])
    elif op == 'coinbank':
        if not g.turn_active: raise RuleError('手番外')
        if p.coins < wf.COINPRICE: raise RuleError('コイン不足')
        p.coins -= wf.COINPRICE; p.hand[a[1]] += 1; g.emit(t='coinbank', p=p.id, card=a[1], coins=wf.COINPRICE)
    elif op == 'prodbuy': g.buy_product(p, a[1])
    elif op == 'misread':
        # 英文と出した物は一致していたが、条件を満たしていなかった（不成立）。sellカードを捨てる
        oid = int(a[1]); give = dict(x.split('=') for x in a[2:])
        if oid not in g.face: raise RuleError('表向きの注文ではない')
        if g.deliverable(p, oid) is not None and all(g.deliverable(p, oid).get(k) == int(v) for k, v in give.items()):
            raise AssertionError('実は条件を満たしている')
        for k, v in give.items():
            if p.prod[k] < int(v): raise RuleError(f'{k}が足りない')
        g.use(p, ['sell']); g.emit(t='misread', p=p.id, order=oid, goods={k: int(v) for k, v in give.items()})
    elif op == 'trade':
        q = g.players[int(a[1])]
        def kv(x):
            pk = {'cards': {}, 'prod': {}, 'coins': 0}
            for part in x.split(','):
                if not part: continue
                k, v = part.split('='); v = int(v)
                if k == 'coins': pk['coins'] = v
                else:
                    t, n = k.split(':'); pk['cards' if t == 'card' else 'prod'][n] = v
            return pk
        g.trade(p, q, kv(a[a.index('give') + 1]), kv(a[a.index('get') + 1]))
    elif op == 'refuse':
        g.emit(t='refuse', p=p.id, q=int(a[1]))
    elif op == 'ticket':
        q = g.players[int(a[1])]
        if q.tickets < 1: raise RuleError('無料券がない')
        q.tickets -= 1; g.emit(t='ticket', p=q.id, use=' '.join(a[2:]))
    elif op == 'pay':
        # コインが足りないときは、持っている分だけ払う（借りはない）
        q = g.players[int(a[1])]; n = int(a[2]); paid = min(n, q.coins); q.coins -= paid
        g.emit(t='jp_pay', p=q.id, n=n, paid=paid, why=' '.join(a[3:]))
    elif op == 'joint': g.act_joint(p, a[1], int(a[2]) if len(a) > 2 else None)
    else: raise RuleError('不明なコマンド ' + op)

def show(g):
    s = snapshot(g)
    for i, pl in enumerate(s['players']):
        print(f"  {PLAYERS[i]['name']:5} {pl['pts']:>4}点 {pl['coins']:>2}c 券{pl['tickets']} 手札{pl['hand']} 産物{pl['prod']} "
              f"畑{[f and (f.get('c') or f['t']) for f in pl['fields']]} 拠点{pl['bases']}")
    print(f"  注文 {[(o['id'], PLAYERS[o['owner']]['name'] if o['owner'] is not None else '-', o['tokens']) for o in s['face']]} 山{s['deck']}")
    print(f"  共同 {[(j['id'], j['tokens'], [(l['item'], l['n'], l['pts'], l['by']) for l in j['lines']]) for j in s['joints']]}")

def main(upto):
    g = ScenGame.__new__(ScenGame)
    g.place_queue = [v for _, v, *_ in PLACEMENT]
    g.picks = {}
    for pid, v, *rest in PLACEMENT:
        if rest and rest[0]: g.picks.setdefault(pid, []).extend(rest[0])
    mapwf.MapGame.__init__(g, N, [pl['strat'] for pl in PLAYERS], 5, 'hex454')
    for p in g.players: p.tickets = 2
    # 注文は伏せた山だけ（ラウンド3の初めに上から3枚を表にする）
    g.face = []; g.deck = list(reversed([o['id'] for o in DECK]))
    jd = [dict(o, lines=[dict(l) for l in o['lines']]) for o in SCEN_JOINT]
    for o in jd:
        for l in o['lines']: l.setdefault('pts', ordergen.line_points(l['item'], l['n']))
        o.setdefault('bonus', 0.5)
    g.jfaces = [jd[0], jd[1]]
    for j in g.jfaces: j['since'] = 1
    g.jdeck = list(reversed(jd[2:]))
    g.events = []; timeline = []
    timeline.append(dict(kind='setup', steps=SETUP_STEPS, state=snapshot(g),
                         board=dict(tcat=g.tcat, tnum=g.tnum, harbor={str(k): v for k, v in g.harbor.items()})))
    print('準備のあと'); show(g)
    for ti, turn in enumerate(TURNS[:upto]):
        g.forced_rolls = [turn['roll']]
        g.picks = {int(k): list(v) for k, v in turn.get('picks', {}).items()}
        g.seven_pick = {int(k): list(v) for k, v in turn.get('discard', {}).items()}
        g.events = []
        try: g.start_turn()
        except RuleError as e:
            print(f'手番{ti} の初めで失敗: {e}'); show(g); sys.exit(1)
        rec = dict(kind='turn', idx=ti, p=g.cur, round=g.round, roll=turn['roll'], dice=turn.get('dice'),
                   start_events=list(g.events), state_after_start=snapshot(g), steps=[])
        for st in turn['steps']:
            if st[0] == 'cmd':
                g.events = []
                try: run_cmd(g, st[1])
                except (RuleError, AssertionError) as e:
                    print(f'手番{ti}（R{g.round} {PLAYERS[g.cur]["name"]}） コマンド失敗: {st[1]} → {e}'); show(g); sys.exit(1)
                rec['steps'].append(dict(st=st, events=list(g.events), state=snapshot(g)))
            else:
                rec['steps'].append(dict(st=st, state=snapshot(g)))
            if g.ended: break
        if not g.ended: g.end_turn()
        timeline.append(rec)
        ev = [e['t'] for e in rec['start_events']]
        print(f"手番{ti} R{rec['round']} {PLAYERS[rec['p']]['name']} 出目{turn['roll']} {[e for e in ev if e not in ('turn',)]}")
        show(g)
        if g.ended: break
    if not g.ended:
        print('まだ終わっていない'); return
    w = g.players[g.winner]
    print(f"終了：{PLAYERS[w.id]['name']} の勝ち（{w.pts}点）、R{g.round}")
    timeline.append(dict(kind='outro', steps=OUTRO_STEPS, state=snapshot(g)))
    orders = {str(o['id']): dict(text=o['text'], pts=o['pts'], level=o.get('level', '中'), picture=o.get('picture', False),
                                 req=o.get('req', {}), kind=o['kind'], items=o.get('items')) for o in DECK}
    for o in jd: orders[str(o['id'])] = dict(text=o['text'], pts=sum(l['pts'] for l in o['lines']), level='共同', picture=False, req={}, kind='joint')
    out = '../video/public/game.json'
    json.dump(dict(players=PLAYERS, orders=orders, timeline=timeline, layout=export_layout(g)), open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('書き出し: video/public/game.json')

def export_layout(g):
    L = g.L
    return dict(coords={str(v): list(c) for v, c in L['coords'].items()}, TV=L['TV'], market=sorted(L['MARKET']))

if __name__ == '__main__':
    os.makedirs('../video/public', exist_ok=True)
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 999)
