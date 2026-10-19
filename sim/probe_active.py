# 積極的なボットの活動量（交換・銀行・港・共同注文）
import random, sys
from collections import Counter
from statistics import mean
import mapwf
from wf import STRATS
N=int(sys.argv[1]); n=int(sys.argv[2]); names=list(STRATS); rng=random.Random(5)
agg=Counter(); R=[]
for gi in range(N):
    g=mapwf.MapGame(n,[rng.choice(names) for _ in range(n)],gi*41+3,'hex454')
    while not g.ended and g.round<=40: g.bot_turn()
    R.append(g.round)
    for p in g.players:
        for k in ('trade','prod_trade','prodbuy','refused','bank','coinbank','market','joint_line','joint_done'): agg[k]+=p.st[k]
    agg['bank2']+=sum(p.st['bank2'] for p in g.players); agg['bank3']+=sum(p.st['bank3'] for p in g.players)
wins=None
print(f"{n}人戦 {N}局 ラウンド{mean(R):.1f}  1局あたり: "+'  '.join(f"{k} {v/N:.2f}" for k,v in agg.items()))
