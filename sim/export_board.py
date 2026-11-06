# 盤面データの書き出し（アプリ設計書 5.4、付録 A）
# mapwf.build('hex454') の座標計算と fixed_layout.json から、アプリのエンジンが読む board.json を作る。
# 交点とタイルの番号は模擬と同じものを使う（fixed_layout.json の港は交点の番号で書かれているため）。
#
#   python export_board.py           書き出す
#   python export_board.py --check   書き出し済みのファイルと一致するかだけ確かめる（不一致なら終了コード1）
import json, math, os, sys
import mapwf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'app', 'packages', 'engine', 'src', 'data', 'board.json'))
LAYOUT = 'hex454'


def r4(x):
    # -0.0 を 0.0 にそろえ、書き出しの差分を安定させる
    v = round(x, 4)
    return 0.0 if v == 0 else v


def build_board():
    fixed = json.load(open(os.path.join(HERE, 'fixed_layout.json'), encoding='utf-8'))
    L = mapwf.build(LAYOUT)
    co = L['coords']
    nv = len(co)
    assert sorted(co) == list(range(nv)), '交点の番号が0からの連番でない'
    assert len(fixed['num']) == L['n'], 'fixed_layout.json の num の数がタイルの数と合わない'

    # 桟橋の向きは、盤面の重心から港の交点へ向かう向き（gen_map_svg.py の描き方と同じ）
    cx = sum(x for x, y in co.values()) / nv
    cy = sum(y for x, y in co.values()) / nv

    tiles = []
    for t, vs in enumerate(L['TV']):
        market = t in L['MARKET']
        num = fixed['num'][t]
        assert (num is None) == market, f'タイル{t}: Market だけが数字を持たない、が成り立たない'
        tiles.append({
            'id': t,
            'center': [r4(sum(co[v][0] for v in vs) / len(vs)), r4(sum(co[v][1] for v in vs) / len(vs))],
            'vertices': list(vs),   # 多角形の頂点の順（描画に使う）
            'number': num,
            'market': market,
        })

    vertices = []
    for v in range(nv):
        x, y = co[v]
        vertices.append({
            'id': v,
            'x': r4(x),
            'y': r4(y),
            'neighbors': sorted(L['NB'][v]),
            'tiles': sorted(L['VT'][v]),
        })

    any_set = set(fixed['anyHarbors'])
    assert any_set <= set(fixed['harbors']), 'anyHarbors が harbors に含まれない'
    harbors = []
    for v in fixed['harbors']:   # 並びは専門港の種類を割り当てる順（BD01 5章）なので変えない
        x, y = co[v]
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy)
        harbors.append({
            'vertex': v,
            'kind': 'any' if v in any_set else 'specialized',
            'pier': [r4(dx / d), r4(dy / d)],
        })

    return {
        'note': 'sim/export_board.py で書き出す。手で直さない。座標は六角の外接円の半径を1とし、y は下向き',
        'layout': LAYOUT,
        'tiles': tiles,
        'vertices': vertices,
        'harbors': harbors,
    }


def dump(board):
    # 1要素を1行にして、差分を読みやすくする
    def arr(items):
        return '[\n' + ',\n'.join('    ' + json.dumps(i, ensure_ascii=False) for i in items) + '\n  ]'
    return ('{\n'
            f'  "note": {json.dumps(board["note"], ensure_ascii=False)},\n'
            f'  "layout": {json.dumps(board["layout"])},\n'
            f'  "tiles": {arr(board["tiles"])},\n'
            f'  "vertices": {arr(board["vertices"])},\n'
            f'  "harbors": {arr(board["harbors"])}\n'
            '}\n')


def main():
    text = dump(build_board())
    assert json.loads(text) == build_board()
    if '--check' in sys.argv:
        cur = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else None
        if cur != text:
            print(f'不一致: {OUT} を python export_board.py で書き出し直す', file=sys.stderr)
            sys.exit(1)
        print('一致')
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(f'書き出した: {OUT}')


if __name__ == '__main__':
    main()
