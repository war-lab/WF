# 産物購入の価格別：活動量と勝ち方
import random, sys
from collections import Counter
from statistics import mean
import mapwf
from wf import STRATS
N=int(sys.argv[1]); n=int(sys.argv[2]); names=list(STRATS); rng=random.Random(5)
agg=Counter(); housew=Counter(); jexp=0; ptsum=[]; over=[]; acts=[]; tp=[]; maxl=[]; R=[]; wins=Counter(); plays=Counter(); lead3=[]; gap=[]
for gi in range(N):
    g=mapwf.MapGame(n,[rng.choice(names) for _ in range(n)],gi*41+3,'hex454'); hist=[]
    while not g.ended and g.round<=40:
        g.bot_turn()
        if g.cur==0 and not g.ended: hist.append([p.pts for p in g.players])
    R.append(g.round)
    jexp+=sum(1 for e in getattr(g,'_jexp',[]))
    agg['carrot_orders_face']+=0
    for p in g.players:
        plays[p.strat]+=1
        for k in ('prod_trade','prodbuy','prodbuy_coin','refused','coinbank','orders','joint_done','market','market_coin'): agg[k]+=p.st[k]
        agg['coins_end']+=p.coins
        agg['plant']+=p.st['plant']; agg['trade']+=p.st['trade']; agg['bank']+=p.st['bank']
        agg['joint_line']+=p.st['joint_line']; agg['joint_pts']+=p.st['joint_pts']; agg['joint_half']+=p.st['joint_half']; ptsum.append(p.pts)
        agg['house']+=p.st['house']; housew[p.strat]+=p.st['house']
        acts.append(p.st['acts']); tp.append(p.st['turns_played']); maxl.append(p.st.get('maxacts',0))
    if g.winner is not None and g.end_reason=='target':
        wins[g.players[g.winner].strat]+=1; over.append(g.players[g.winner].pts-g.target); sc=sorted([p.pts for p in g.players],reverse=True); gap.append(sc[0]-sc[1])
        if len(hist)>=3:
            h=hist[2]; mx=max(h)
            if h.count(mx)==1: lead3.append(1 if h.index(mx)==g.winner else 0)
print(f"ラウンド{mean(R):.1f}  1位と2位の差{mean(gap):.2f}  3R首位が勝つ{mean(lead3):.0%}  1局あたり: "+'  '.join(f"{k} {v/N:.2f}" for k,v in agg.items()))
print("  勝率: "+"  ".join(f"{s} {wins[s]/plays[s]*100:.0f}%" for s in names))
print('  拠点の追加（方針別、1人1局）: '+'  '.join(f"{k} {housew[k]/plays[k]:.2f}" for k in names))
print(f'  1手番の行動 平均{sum(acts)/max(sum(tp),1):.2f}回  1局で最も多かった手番の平均{mean(maxl):.1f}回  勝者の超過{mean(over) if over else 0:.2f}点')
print(f'  共同注文：点のうちの割合{agg["joint_pts"]/max(sum(ptsum),1):.0%}')
