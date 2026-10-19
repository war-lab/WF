# マップ形状ごとの統計
import random, sys
from collections import Counter, defaultdict
from statistics import mean
import mapwf
from wf import STRATS
layout=sys.argv[1]; N=int(sys.argv[2]); n=int(sys.argv[3])
L=mapwf.build(layout)
deg=Counter(len(t) for t in L['VT'].values())
names=list(STRATS); rng=random.Random(41)
wins=Counter(); plays=Counter(); rounds=[]; reasons=Counter(); agg=defaultdict(list); seat=Counter(); fail=0
for gi in range(N):
    st=[rng.choice(names) for _ in range(n)]
    try: g=mapwf.run_map(n,st,gi*23+3,layout)
    except Exception as e: fail+=1; continue
    rounds.append(g.round); reasons[g.end_reason]+=1
    hb=[any(b in g.harbor for b in p.bases) for p in g.players]
    agg['harbor_owners'].append(sum(hb))
    if g.winner is not None and g.end_reason!='timeout':
        agg['win_harbor'].append(1 if hb[g.winner] else 0); agg['share_harbor'].append(sum(hb)/n)
    agg['ev_mean'].append(mean(g.start_ev)); agg['ev_spread'].append(max(g.start_ev)-min(g.start_ev))
    agg['ev_last_minus_first'].append(g.start_ev[-1]-g.start_ev[0])
    for p in g.players:
        plays[p.strat]+=1
        agg['inc'].append((p.st['income']+p.st['relief'])/max(1,g.round)); agg['relief'].append(p.st['relief']/max(1,p.turns))
        agg['discard'].append(p.st['discard']); agg['trade'].append(p.st['trade']); agg['b4'].append(p.st['bank4']); agg['b3'].append(p.st['bank3']); agg['b2'].append(p.st['bank2']); agg['cb'].append(p.st['coinbank']); agg['sd'].append(p.st['seven_discard']); agg['hmax'].append(p.handsize()); agg['coins_end'].append(p.coins)
    if g.winner is not None and g.end_reason!='timeout':
        wins[g.players[g.winner].strat]+=1; seat[g.winner]+=1
print(f"[{layout}] {n}人戦 タイル{L['n']} 交点{len(L['VT'])} 交点の接タイル数{dict(sorted(deg.items()))}  失敗{fail}")
print(f"  ラウンド 平均{mean(rounds):.1f} 15以上{sum(1 for r in rounds if r>=15)}局 終了理由{dict(reasons)} 座席{dict(sorted(seat.items()))}")
print(f"  初期の期待収入/出目 平均{mean(agg['ev_mean']):.3f}  最大-最小{mean(agg['ev_spread']):.3f}  最後手番-先手{mean(agg['ev_last_minus_first']):+.3f}")
print(f"  収入/人/ラウンド {mean(agg['inc']):.2f}  救済率{mean(agg['relief']):.0%}  捨て札{mean(agg['discard']):.2f}  交換{mean(agg['trade']):.2f}")
print(f"  7での捨て札 {mean(agg['sd']) if agg['sd'] else 0:.2f}枚/人・局  終局時の手札 平均{mean(agg['hmax']) if agg['hmax'] else 0:.1f}枚 最大{max(agg['hmax']) if agg['hmax'] else 0}枚")
print("  勝率: "+"  ".join(f"{s} {wins[s]/max(1,plays[s])*100:.0f}%" for s in names)+f"  (均等{100/n:.0f}%)")
if agg['win_harbor']:
    print(f"  港に拠点がある人数/局 {mean(agg['harbor_owners']):.2f}  勝者が港持ちの割合 {mean(agg['win_harbor']):.0%}（港持ちの人数比 {mean(agg['share_harbor']):.0%}）  銀行 4:1={mean(agg['b4']):.2f} 3:1={mean(agg['b3']):.2f} 2:1={mean(agg['b2']):.2f} コイン購入={mean(agg['cb']):.2f} /人・局  残コイン{mean(agg['coins_end']):.1f}")
