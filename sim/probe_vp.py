# 勝利点と注文の山の枚数を変えたときの展開（長さ・逃げ切り・超過）
import random, sys
from collections import Counter, defaultdict
from statistics import mean
import mapwf
from wf import STRATS
N=int(sys.argv[1]); n=int(sys.argv[2]); names=list(STRATS); rng=random.Random(77)
R=[]; reason=Counter(); wins=Counter(); plays=Counter(); over=[]; lead3=[]; ords=[]; seat=Counter(); gap=[]
for gi in range(N):
    st=[rng.choice(names) for _ in range(n)]
    g=mapwf.MapGame(n,st,gi*31+9,'hex454'); hist=[]
    while not g.ended and g.round<=40:
        g.bot_turn()
        if g.cur==0 and not g.ended: hist.append([p.pts for p in g.players])
    R.append(g.round); reason[g.end_reason]+=1
    for p in g.players: plays[p.strat]+=1
    ords.append(sum(p.st['orders'] for p in g.players))
    if g.winner is not None and g.end_reason=='target':
        w=g.players[g.winner]; wins[w.strat]+=1; seat[g.winner]+=1; over.append(w.pts-g.target)
        sc=sorted([p.pts for p in g.players],reverse=True); gap.append(sc[0]-sc[1])
        if len(hist)>=3:
            h=hist[2]; mx=max(h)
            if h.count(mx)==1: lead3.append(1 if h.index(mx)==g.winner else 0)
print(f"{n}人戦 勝利点{g.target} 山{len(mapwf.ORDERS)}枚 {N}局: ラウンド 平均{mean(R):.1f} 中央{sorted(R)[N//2]} 15以上{sum(r>=15 for r in R)} 終了理由{dict(reason)}")
print(f"  局あたり達成注文 {mean(ords):.1f}件  勝者の超過 平均{mean(over):.2f}点  1位と2位の差 平均{mean(gap):.2f}点  3R時点の単独首位が勝つ割合 {mean(lead3):.0%}  座席{dict(sorted(seat.items()))}")
print("  勝率: "+"  ".join(f"{s} {wins[s]/plays[s]*100:.0f}%" for s in names))
