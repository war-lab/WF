# 模擬の1局を、アプリのエンジンで再適用できる形の JSON に書き出す（BD06 5.5）。
#
#   python record.py <出力先のフォルダ> <局数> [人数=4] [最初の種=1]
#
# 確定仕様（設計メモ 付録 A）の環境変数を、この中で既定値として入れる。外から渡した値はそのまま使う。
# 1局ごとに <フォルダ>/g<種>_<人数>p.json を書く。中身は次のとおり。
#   初期の状態：タイルの種類と数字、港、席ごとのコイン、注文と共同注文の山（引く順）
#   setupChoices、turns[].choices：席ごとに、選んだカードの列（準備の2個目の拠点と3人戦の追加の1枚、手番ごとの seed と animal の収入、7、救済）
#   turns：手番ごとの出目、出来事と、3つの時点の写し（start：収入のあと、end：行動のあと、snap：手番の終わりの処理のあと）
import json, os, random, sys

SPEC = {
    'ORDERSET': '3', 'ORD13': 'down', 'DEV': '1', 'DEVOFF': '1', 'LOWPRICE': '1', 'COINBANK': '1',
    'HARBORS': '6', 'BANKBASE': '4', 'HSINGLE': '1', 'FIXED': '1', 'COWMODE': '', 'SEVEN': '1',
    'ORDERGEN': '1', 'ORDERN': '36', 'EGGW': '1.8', 'MILKW': '1.8', 'MAP_T4': '8', 'MAP_T3': '8',
    'JOINT': '1', 'JQSMALL': '1', 'JTIMEOUT': '3', 'ACTIVE': '1', 'PRODMULT': '5',
    'PRICES': 'carrot:2,potato:1,wheat:1,egg:1,milk:2', 'CARROTFEED': '1', 'COWGROW': 'buy',
    'ACTIONS': '99', 'COINPRICE': '5', 'PRODPRICES': '1:10,2:15', 'HOUSECOST': '5', 'JOINTN': '2', 'JSTART': 'line',
    'ORDEXP': '3', 'ORDSTART': '1', 'ORDREVEAL': '3', 'EXPTURN': '1', 'EXPOFF': '1', 'JEXPTURN': '1', 'NOFLUSH': '1',
    'ANIMALSELL': '1', 'BONUSN': '2', 'SEATCOIN': 'auto',
    'APPRULES': '1',
}
for k, v in SPEC.items():
    os.environ.setdefault(k, v)

import mapwf  # noqa: E402  環境変数を入れてから読み込む（模擬は読み込みの時点で環境変数を読む）
import wf  # noqa: E402
from wf import STRATS  # noqa: E402

LAYOUT = 'hex454'


def order_json(o):
    keep = ('id', 'kind', 'req', 'text', 'level', 'pts', 'to', 'picture', 'n', 'incl', 'total', 'allowed', 'pair', 'items')
    return {k: o[k] for k in keep if k in o}


def joint_json(j):
    return {'id': j['id'], 'text': j.get('text'), 'to': j.get('to'), 'bonus': j.get('bonus', 0),
            'lines': [{'item': l['item'], 'n': l['n'], 'pts': l['pts']} for l in j['lines']]}


def snap(g):
    def field(f):
        if f is None:
            return None
        if f['t'] == 'crop':
            return {'t': 'crop', 'c': f['c'], 'planted': f['planted']}
        return {'t': f['t']}
    return {
        'round': g.round, 'cur': g.cur, 'ended': g.ended, 'reason': g.end_reason,
        'players': [{
            'hand': {k: v for k, v in p.hand.items() if v}, 'prod': {k: v for k, v in p.prod.items() if v},
            'coins': p.coins, 'pts': p.pts, 'fields': [field(f) for f in p.fields], 'bases': list(p.bases), 'turns': p.turns,
        } for p in g.players],
        'face': list(g.face), 'deck': len(g.deck),
        'jfaces': [{'id': j['id'], 'by': [l.get('by') for l in j['lines']]} for j in g.jfaces], 'jdeck': len(g.jdeck),
    }


class RecGame(mapwf.MapGame):
    """選んだカードを席ごとに記録する。乱数の使い方は MapGame と同じにする（記録だけを足す）"""

    def __init__(s, n, strats, seed, layout):
        s._choices = [[] for _ in range(n)]
        s._setup = []
        super().__init__(n, strats, seed, layout)

    def card_from(s, q, cat):
        c = super().card_from(q, cat)
        if cat in ('seed', 'animal') and c is not None:
            s._choices[q.id].append(c)
        return c

    def best_any(s, p):
        c = super().best_any(p)
        if c is not None:
            s._choices[p.id].append(c)
        return c

    def start_turn(s):
        super().start_turn()
        s._start = snap(s)  # 収入と収穫のあと、行動の前

    def end_turn(s, discards=None):
        s._end = snap(s)  # 行動のあと、手番の終わりの処理の前
        super().end_turn(discards)

    def place_base(s, p, v):
        super().place_base(p, v)
        if not getattr(s, 'turn_active', False):
            s._setup.append([p.id, v])


def record(seed, n, strat_rng):
    strats = [strat_rng.choice(list(STRATS)) for _ in range(n)]
    g = RecGame(n, strats, seed, LAYOUT)
    init = {
        'seed': seed, 'n': n, 'strats': strats, 'target': g.target,
        'tcat': g.tcat, 'tnum': g.tnum, 'harbor': {str(k): v for k, v in g.harbor.items()},
        'coins': [p.coins for p in g.players],
        # 山は末尾から引く。引く順に並べ直して書く
        'orders': [order_json(wf.OBYID[i]) for i in reversed(g.deck)],
        'jfaces': [joint_json(j) for j in g.jfaces],
        'jdeck': [joint_json(j) for j in reversed(g.jdeck)],
        'setup': g._setup,
        'setupChoices': [list(c) for c in g._choices],
        'afterSetup': snap(g),
    }
    g.events = []
    turns = []
    while not g.ended and g.round <= 40:
        p = g.cur
        k0 = len(g.events)
        c0 = [len(c) for c in g._choices]
        g.bot_turn()
        chosen = [c[k:] for c, k in zip(g._choices, c0)]
        ev = g.events[k0:]
        roll = next((e['roll'] for e in ev if e['t'] == 'turn'), None)  # 手番の初めに勝ったときは出目がない
        turns.append({'p': p, 'roll': roll, 'events': ev, 'choices': chosen, 'start': g._start, 'end': g._end, 'snap': snap(g)})
    if not g.ended:
        g.end_reason = 'timeout'
    return {
        **init, 'turns': turns,
        'end': {'reason': g.end_reason, 'winner': g.winner, 'winners': getattr(g, 'winners', []), 'pts': [p.pts for p in g.players]},
    }


def main():
    out, count = sys.argv[1], int(sys.argv[2])
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    first = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    os.makedirs(out, exist_ok=True)
    for seed in range(first, first + count):
        rec = record(seed, n, random.Random(seed * 31 + n))
        with open(os.path.join(out, f'g{seed}_{n}p.json'), 'w', encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
