# 注文カードの自動生成。英文の型 × 産物 × 数 × 宛先 を組み合わせ、点は必要な手間から計算する
import math, random

NUMW = {1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight'}
CROPS = ['carrot','potato','wheat']
# 産物ごとの英語（1つ／複数）。小麦とミルクは数えられないので単位を付ける
def noun(item, n, unit=True):
    if item=='carrot':  return 'a carrot' if n==1 else f'{NUMW[n]} carrots'
    if item=='potato':  return 'a potato' if n==1 else f'{NUMW[n]} potatoes'
    if item=='egg':     return 'an egg' if n==1 else f'{NUMW[n]} eggs'
    if item=='wheat':   return ('a bag of wheat' if n==1 else f'{NUMW[n]} bags of wheat') if unit else 'wheat'
    if item=='milk':    return ('a bottle of milk' if n==1 else f'{NUMW[n]} bottles of milk') if unit else 'milk'
def plural(item):
    return {'carrot':'carrots','potato':'potatoes','egg':'eggs','wheat':'wheat','milk':'milk'}[item]
def join(parts):
    return parts[0] if len(parts)==1 else ', '.join(parts[:-1])+' and '+parts[-1]

PLACES = [('The cafe','the cafe'),('The bakery','the bakery'),('The school','the school'),('The pancake shop','the pancake shop'),
          ('The hotel','the hotel'),('The hospital','the hospital'),('Grandma','Grandma'),('The soup kitchen','the soup kitchen')]

# 手間：産物1つあたりの重み＋届ける手間＋種類が増える手間。難しい英文は＋0.5
W={'carrot':0.4,'potato':0.4,'wheat':0.4,'egg':0.45,'milk':0.4}
def points(req, hard=False):
    e=0.3+sum(W[k]*v for k,v in req.items())+0.3*(len(req)-1)+(0.5 if hard else 0)
    return max(0.5, min(3.0, round(e*2)/2))

ITEMW=[('carrot',1.0),('potato',1.0),('wheat',1.0),('egg',float(__import__('os').environ.get('EGGW','1.0'))),('milk',float(__import__('os').environ.get('MILKW','1.0')))]
def pick(rng, k=1, exclude=()):
    pool=[(i,w) for i,w in ITEMW if i not in exclude]; out=[]
    for _ in range(k):
        tot=sum(w for _,w in pool); r=rng.random()*tot
        for i,(it,w) in enumerate(pool):
            r-=w
            if r<=0: out.append(it); pool.pop(i); break
    return out

def gen_one(rng, idx):
    t=rng.random()
    place,place_l=rng.choice(PLACES)
    # 易：1種類
    if t<0.35:
        item=pick(rng)[0]; n=rng.randint(1,4)
        tpl=rng.choice([f'{place} needs {noun(item,n)}.', f'Can you bring me {noun(item,n)}?', f'{noun(item,n)[0].upper()+noun(item,n)[1:]}, please.'])
        req={item:n}; return dict(id=idx, kind='fixed', req=req, text=tpl, level='易', pts=points(req), to=place_l if place in tpl else None, picture=True, nums=[])
    # 中：2種類、または「〜ずつ」
    if t<0.75:
        a,b=pick(rng,2)
        if rng.random()<0.4 and a in ('carrot','potato','egg') and b in ('carrot','potato','egg'):
            n=rng.randint(1,3); req={a:n,b:n}
            tpl=f'{place} is looking for {plural(a)} and {plural(b)}, {NUMW[n]} of each.'
        elif rng.random()<0.5:
            n1,n2=rng.randint(1,3),rng.randint(1,3); req={a:n1,b:n2}
            tpl=f'{place} would like {noun(a,n1)} and {noun(b,n2)}.'
        else:
            # 否定の罠：送ってはいけない産物を先に書く
            c=rng.choice([x for x in CROPS+['egg','milk'] if x not in (a,b)])
            n1,n2=rng.randint(1,3),rng.randint(1,3); req={a:n1,b:n2}
            tpl=f'Please don’t send {plural(c)}. We need {noun(a,n1)} and {noun(b,n2)}.'
        return dict(id=idx, kind='fixed', req=req, text=tpl, level='中', pts=points(req), to=place_l if place in tpl else None, picture=False, nums=[])
    # 難：言い換え・合計・同数
    k=rng.random()
    if k<0.3:
        req={'egg':6}; tpl=rng.choice(['Half a dozen eggs, please.','We need half a dozen eggs for the cake.'])
        return dict(id=idx, kind='fixed', req=req, text=tpl, level='難', pts=points(req,True), to=None, picture=False, nums=[])
    if k<0.55:
        ex=rng.choice(CROPS); others=[c for c in CROPS if c!=ex]; n=rng.randint(4,5)
        tpl=f'We need {NUMW[n]} crops in total. Anything but {plural(ex)}!'
        req={others[0]:n,others[1]:n}
        return dict(id=idx, kind='anyof', req=req, total=n, text=tpl, level='難', pts=points({others[0]:n},True), to=None, picture=False, nums=[], allowed=others)
    if k<0.8:
        a,b='carrot','potato'; n=2
        tpl=f'We want the same number of {plural(a)} and {plural(b)}, at least two of each.'
        req={a:2,b:2}
        return dict(id=idx, kind='same', req=req, text=tpl, level='難', pts=points(req,True), to=None, picture=False, nums=[], pair=[a,b])
    n=rng.choice([2,3])
    tpl=f'A school class wants to visit a farm with at least {NUMW[n]} animals.'
    return dict(id=idx, kind='animals', req={}, n=n, text=tpl, level='中', pts=1.5 if n==2 else 2.5, to=None, picture=False, nums=[])

def gen_deck(rng, n=24):
    # 同じ英文は1組に1枚まで
    deck=[]; seen=set()
    while len(deck)<n:
        o=gen_one(rng,len(deck)+1)
        if o['text'] in seen: continue
        seen.add(o['text']); deck.append(o)
    return deck

if __name__=='__main__':
    import sys
    rng=random.Random(int(sys.argv[1]) if len(sys.argv)>1 else 1)
    for o in gen_deck(rng):
        print(f"#{o['id']:2} [{o['level']}] {o['pts']:>3}点  {o['text']}   条件={o['req'] if o['kind']!='animals' else ('動物'+str(o['n'])+'頭以上')}{' 合計'+str(o.get('total')) if o['kind']=='anyof' else ''}")
