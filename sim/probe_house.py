# 拠点優先の方針の強さ：各局で半数の人に拠点優先（p.hf）を割り当て、同じ方針どうしで勝率を比べる
import random, sys
from collections import Counter
from statistics import mean
import mapwf
from wf import STRATS
N=int(sys.argv[1]); n=int(sys.argv[2]); names=list(STRATS); rng=random.Random(5); rhf=random.Random(11)
wins=Counter(); plays=Counter(); houses=Counter(); R=[]; hround=[]
for gi in range(N):
    g=mapwf.MapGame(n,[rng.choice(names) for _ in range(n)],gi*41+3,'hex454')
    for p in g.players: p.hf=rhf.random()<0.5
    while not g.ended and g.round<=40:
        before=[len(p.bases) for p in g.players]
        g.bot_turn()
        for p,b in zip(g.players,before):
            if len(p.bases)>b: hround.append(g.round)
    R.append(g.round)
    for p in g.players:
        k=(p.strat,'拠点優先' if p.hf else 'ふつう'); plays[k]+=1; houses[k]+=p.st['house']
        if g.winner==p.id and g.end_reason=='target': wins[k]+=1
print(f"{n}人戦 {N}局 ラウンド{mean(R):.1f}  拠点を建てたラウンドの平均{mean(hround) if hround else 0:.1f}")
for st in names:
    a=(st,'拠点優先'); b=(st,'ふつう')
    print(f"  {st:8} 拠点優先 勝率{wins[a]/plays[a]:.0%}（建てた回数{houses[a]/plays[a]:.2f}）  ふつう 勝率{wins[b]/plays[b]:.0%}")
ta=sum(wins[k] for k in wins if k[1]=='拠点優先')/sum(plays[k] for k in plays if k[1]=='拠点優先')
tb=sum(wins[k] for k in wins if k[1]=='ふつう')/sum(plays[k] for k in plays if k[1]=='ふつう')
print(f"  全体     拠点優先 {ta:.1%}  ふつう {tb:.1%}")
