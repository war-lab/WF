# 注文カードの自動生成。英文の型 × 産物 × 数 × 宛先 を組み合わせ、点は必要な手間から計算する
import math, random

ANIMALINCL=float(__import__('os').environ.get('ANIMALINCL','0.6'))   # 頭数の注文で指定する動物がニワトリになる確率（0で指定なし）
# 頭数の注文で、動物の名前を出さずにニワトリか牛を指す言い回し。このゲームの動物はニワトリと牛だけなので、
# 「哺乳類ではない」＝ニワトリ、「鳥ではない」＝牛のように、否定や特徴からどちらか1つに決まる
# もう一方の動物を打ち消す「じゃない方」の言い方（not a cow＝ニワトリ）も使う
ANIMAL_HINT = {
 'chicken': ['At least one of them must lay eggs.',
             'At least one of them must have feathers.',
             'At least one of them must walk on two legs.',
             'At least one of them must be a bird.',
             'At least one of them must not be a mammal.',
             'The children want to hear an animal that says "cock-a-doodle-doo".',
             'At least one of them must not be a cow.',
             'At least one of them must be the animal that does not give milk.',
             'At least one of them must not have four legs.'],
 'cow':     ['At least one of them must give milk.',
             'At least one of them must have four legs.',
             'At least one of them must be a mammal.',
             'At least one of them must not be a bird.',
             'At least one of them must not have feathers.',
             'The children want to hear an animal that says "moo".',
             'At least one of them must not be a chicken.',
             'At least one of them must be the animal that does not lay eggs.',
             'At least one of them must not walk on two legs.'],
}
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
# CROPW：作物1つあたりの点、MIXB：種類を1つ増やすごとの上乗せ（試験用。既定は確定仕様の値）
_CW=float(__import__('os').environ.get('CROPW','0.4'))
_MB=float(__import__('os').environ.get('MIXB','0.3'))
W={'carrot':_CW,'potato':_CW,'wheat':_CW,'egg':float(__import__('os').environ.get('EGGPT','0.45')),'milk':float(__import__('os').environ.get('MILKPT','0.4'))}
# ORDERW：品目ごとの点を個別に上書きする（例 carrot:0.4,potato:0.2）
for _kv in filter(None,__import__('os').environ.get('ORDERW','').split(',')):
    _k,_v=_kv.split(':'); W[_k]=float(_v)
def points(req, hard=False):
    e=0.3+sum(W[k]*v for k,v in req.items())+_MB*(len(req)-1)+(0.5 if hard else 0)
    # 0.5点刻みの四捨五入（ちょうど半分は切り上げ）。round() は偶数丸めになるので使わない。浮動小数の誤差を除いてから丸める
    return max(0.5, min(3.0, math.floor(round(e*2,6)+0.5)/2))

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
    # 頭数の注文には「そのうち1頭は指定の動物」を付ける。指定はニワトリを多め（ANIMALINCL＝ニワトリになる確率、0で付けない）
    # 動物の名前は書かず、ANIMAL_HINT の言い回しで言い換える。言い換えなので「難」にし、計算式どおり0.5点足す
    incl=None
    if ANIMALINCL>0: incl='chicken' if rng.random()<ANIMALINCL else 'cow'
    tpl=f'A school class wants to visit a farm with at least {NUMW[n]} animals.'
    if incl: tpl+=' '+rng.choice(ANIMAL_HINT[incl])
    pts=(1.5 if n==2 else 2.5)+(0.5 if incl else 0)
    return dict(id=idx, kind='animals', req={}, n=n, incl=incl, text=tpl, level='難' if incl else '中', pts=min(3,pts), to=None, picture=False, nums=[])

# ボーナス注文：英文には5種類の産物がすべて出てくるが、受け付けるのは2〜3種類。そのうち1種類を選んで好きな数だけ出す
# 点は数×重み（作物とミルク0.2、卵0.25）を0.5点刻みで切り捨て（上限なし）、コインは出した数×1
BONUSN=int(__import__('os').environ.get('BONUSN','0'))   # 山36枚のうちボーナス注文の枚数
BONUSW={'carrot':0.2,'potato':0.2,'wheat':0.2,'milk':0.2,'egg':0.25}
def bonus_points(item, n):
    return math.floor(round(n*BONUSW[item]*2,6))/2
def gen_bonus(rng, idx):
    allp=['carrot','potato','wheat','egg','milk']
    items=rng.sample(allp, rng.choice([2,3])); items=[x for x in allp if x in items]; rest=[x for x in allp if x not in items]
    tpl=f"The farmers' market has enough {join([plural(x) for x in rest])}. Bring {' or '.join(plural(x) for x in items)}, as many as you can!"
    return dict(id=idx, kind='bonus', items=items, req={x:1 for x in items}, text=tpl, level='ボーナス', pts=0.5, to="the farmers' market", picture=False, nums=[])
def gen_deck(rng, n=24):
    # 同じ英文は1組に1枚まで。ボーナス注文は BONUSN 枚を混ぜる（並びは山を作るときにシャッフルする）
    deck=[]; seen=set()
    while len(deck)<n-BONUSN:
        o=gen_one(rng,len(deck)+1)
        if o['text'] in seen: continue
        seen.add(o['text']); deck.append(o)
    for _ in range(BONUSN): deck.append(gen_bonus(rng,len(deck)+1))
    return deck

if __name__=='__main__':
    import sys
    rng=random.Random(int(sys.argv[1]) if len(sys.argv)>1 else 1)
    for o in gen_deck(rng):
        print(f"#{o['id']:2} [{o['level']}] {o['pts']:>3}点  {o['text']}   条件={o['req'] if o['kind']!='animals' else ('動物'+str(o['n'])+'頭以上')}{' 合計'+str(o.get('total')) if o['kind']=='anyof' else ''}")

# ---------- 共同注文 ----------
# 3行（産物の種類ごと）。行ごとに点。全行がそろったら、出した人がそれぞれの行の点を受け取る
EVENTS = ['The village festival','The school lunch','The wedding party','The harvest fair','The football club','The hospital kitchen','The summer camp','The town bakery contest']
JQ = {'carrot':(2,4),'potato':(2,4),'wheat':(2,4),'egg':(2,4),'milk':(2,3)} if __import__('os').environ.get('JQSMALL')=='1' else {'carrot':(3,6),'potato':(3,6),'wheat':(3,6),'egg':(4,6),'milk':(3,4)}
def line_points(item, n):
    return points({item:n})   # 通常の注文と同じ計算式
def gen_joint(rng, idx):
    ev = rng.choice(EVENTS)
    animals = rng.sample(['egg','milk'], rng.choice([1,2]))
    crops = rng.sample(CROPS, 3-len(animals))
    items = animals + crops; rng.shuffle(items)
    lines = []
    for it in items:
        lo, hi = JQ[it]; n = rng.randint(lo, hi)
        lines.append(dict(item=it, n=n, pts=line_points(it, n)))
    parts = [noun(l['item'], l['n']) for l in lines]
    text = f"{ev} needs {join(parts)}."
    return dict(id=idx, kind='joint', lines=lines, text=text, bonus=0.5)
def gen_joint_deck(rng, n=8):
    deck=[]; seen=set()
    while len(deck)<n:
        o=gen_joint(rng, 201+len(deck))
        if o['text'] in seen: continue
        seen.add(o['text']); deck.append(o)
    return deck
def unique_events(deck, taken=()):
    # 宛先の名前が重ならないように、重複を未使用の名前に付け替える（行の中身と乱数は変えない）
    used=set(taken); out=[]
    for o in deck:
        ev=next(e for e in EVENTS if o['text'].startswith(e))
        if ev in used:
            ev=next(e for e in EVENTS if e not in used)
            o=dict(o, text=ev+o['text'][o['text'].index(' needs'):])
        used.add(ev); out.append(o)
    return out
