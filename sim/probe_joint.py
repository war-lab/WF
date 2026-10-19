# 共同注文あり／なしの比較
import random, sys
from collections import Counter
from statistics import mean
import mapwf
from wf import STRATS
N=int(sys.argv[1]); n=int(sys.argv[2]); names=list(STRATS); rng=random.Random(91)
R=[]; reason=Counter(); done=[]; lines=[]; share=[]; stuck=[]; lead3=[]; gap=[]; multi=0; wins=Counter(); plays=Counter()
for gi in range(N):
    st=[rng.choice(names) for _ in range(n)]
    g=mapwf.MapGame(n,st,gi*37+11,'hex454'); hist=[]
    while not g.ended and g.round<=40:
        g.bot_turn()
        if g.cur==0 and not g.ended: hist.append([p.pts for p in g.players])
    R.append(g.round); reason[g.end_reason]+=1
    for p in g.players: plays[p.strat]+=1
    done.append(sum(p.st['joint_done'] for p in g.players)); lines.append(sum(p.st['joint_line'] for p in g.players))
    tot=sum(p.pts for p in g.players); share.append(sum(p.st['joint_pts'] for p in g.players)/tot if tot else 0)
    if g.jface: stuck.append(sum(1 for l in g.jface['lines'] if l.get('by') is not None))
    if sum(1 for p in g.players if p.pts>=g.target)>=2: multi+=1
    if g.winner is not None and g.end_reason=='target':
        wins[g.players[g.winner].strat]+=1
        sc=sorted([p.pts for p in g.players],reverse=True); gap.append(sc[0]-sc[1])
        if len(hist)>=3:
            h=hist[2]; mx=max(h)
            if h.count(mx)==1: lead3.append(1 if h.index(mx)==g.winner else 0)
print(f"{n}人戦 {N}局: ラウンド 平均{mean(R):.1f} 終了理由{dict(reason)}")
print(f"  共同注文 完成{mean(done):.2f}回/局  出された行{mean(lines):.2f}行/局  点のうち共同注文の割合{mean(share):.0%}")
print(f"  終局時に出しかけ（1〜2行出たまま）の共同注文 {sum(1 for x in stuck if 0<x<3)}/{N}局  8点以上が2人以上いた局 {multi}")
print(f"  1位と2位の差 平均{mean(gap):.2f}点  3R時点の首位が勝つ割合 {mean(lead3):.0%}")
print("  勝率: "+"  ".join(f"{s} {wins[s]/plays[s]*100:.0f}%" for s in names))
