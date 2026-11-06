# 確定仕様の統計が、APPRULES（アプリと同じ扱い）と動物の頭数の注文の指定（ANIMALINCL）でどれだけ変わるかを測る。
#
#   APPRULES=0 python probe_apprules.py 1600     確定仕様のまま
#   python probe_apprules.py 1600                確定仕様＋APPRULES=1（record.py の既定）
#   ANIMALINCL=0 python probe_apprules.py 1600   ＋指定を付けない（アプリの既定。BD02 Q1）
#
# 局の種と方針の割り当ては record.py と同じ。4人戦と3人戦を各 N 局回す。
import os, random, sys
from collections import Counter
from statistics import mean, stdev

import record  # noqa: F401  確定仕様の環境変数を入れる
import mapwf
from wf import STRATS

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
print(f"APPRULES={os.environ.get('APPRULES')} ANIMALINCL={os.environ.get('ANIMALINCL', '既定')} 各{N}局")
for n in (4, 3):
    rounds, turns, reasons, seat, wins, plays = [], [], Counter(), Counter(), Counter(), Counter()
    expire, bonus, jdone, house, animal_orders = [], [], [], [], []
    for seed in range(1, N + 1):
        rng = random.Random(seed * 31 + n)  # record.py と同じ割り当て
        strats = [rng.choice(list(STRATS)) for _ in range(n)]
        g = mapwf.MapGame(n, strats, seed, 'hex454')
        g.events = []
        while not g.ended and g.round <= 40:
            g.bot_turn()
        reason = g.end_reason if g.ended else 'timeout'
        rounds.append(g.round)
        turns.append(sum(p.turns for p in g.players))
        reasons[reason] += 1
        for p in g.players:
            plays[p.strat] += 1
        if g.ended and g.winner is not None:
            seat[g.winner] += 1
            wins[g.players[g.winner].strat] += 1
        ev = Counter(e['t'] for e in g.events)
        expire.append(ev['order_expire'])
        jdone.append(ev['joint_done'])
        house.append(ev['house'])
        bonus.append(sum(p.st['bonus_orders'] for p in g.players))
        animal_orders.append(sum(1 for e in g.events if e['t'] == 'deliver' and e.get('goods') == {}))
    sd = lambda xs: f"{mean(xs):.2f}±{stdev(xs) / len(xs) ** 0.5 * 1.96:.2f}"
    print(f"{n}人戦: ラウンド {sd(rounds)}、手番 {sd(turns)}、終わり方 {dict(reasons)}、席ごとの勝ち {dict(sorted(seat.items()))}")
    print("  方針ごとの勝率 " + "、".join(f"{s} {wins[s] / max(1, plays[s]) * 100:.1f}%" for s in STRATS))
    print(f"  通常の注文の時間切れ {sd(expire)}、ボーナス注文 {sd(bonus)}、共同注文の完成 {sd(jdone)}、拠点の追加 {sd(house)}、動物の頭数の注文 {sd(animal_orders)}")
